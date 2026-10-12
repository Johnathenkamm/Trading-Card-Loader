// Photo-identification index builder: perceptual-hash every catalog card's
// reference image into card_image_hashes (src/imagehash.ts for the method).
//
// Two callers:
//   - `npm run hash:catalog` (src/scripts/hash-catalog.ts) — manual/forced runs
//   - the server at boot (src/server.ts) — when VISION_PROVIDER=hash and some
//     catalog images still need hashing, fill the index in the background.
//     Hosted deploys (Railway) have no shell access to the database, so without
//     this the index stays empty and every photo falls back to the filename hint.
//
// Re-runnable: cards whose stored image_url is unchanged are skipped, so after a
// catalog sync only new/changed cards are fetched. "Adding a set" is hashing
// its images — no retraining.
//
// Missing images: TCGplayer's CDN answers 403 for products that have no picture
// (Mirror Holofoil and Poke Ball / Master Ball Pattern printings, World
// Championship decks, whole deck sets). An image the host answers 403/404/410
// twice, and never anything else, is recorded in card_image_missing (connection
// resets in between don't count either way) and skipped by later passes, so a
// boot or a Rebuild doesn't re-fetch thousands of dead URLs. It is tried again
// when the card's image URL changes, once the record is
// RECHECK_MISSING_AFTER_DAYS old (TCGplayer adds some pictures late), or on
// request (`retryMissing`, `force`). Resets, timeouts and 5xx stay transient:
// the card is simply tried again next pass.

import { query, one } from "../pg.ts";
import { hashImage, toHex } from "../imagehash.ts";
import { sleep } from "../util.ts";
import { invalidateHashIndex } from "./vision.ts";

const CONCURRENCY = 6;
/** Answers that mean "no such image". */
const MISSING_STATUSES = new Set([403, 404, 410]);
/** That many such answers, and no other HTTP status, make an image missing. */
const MISSING_ANSWERS = 2;
export const RECHECK_MISSING_AFTER_DAYS = 30;

export type HashIndexStats = { cards: number; hashed: number; todo: number; done: number; failed: number; missing: number };

/** The host answered 403/404/410 every time it answered: it has no such image. */
class ImageMissingError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function fetchImage(url: string): Promise<Buffer> {
  let lastErr: unknown;
  let notFound = 0; // 403/404/410 answers; resets and timeouts say nothing either way
  let otherStatus = false; // a 5xx, 429… answer keeps the failure transient
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (attempt > 1) await sleep(500 * (attempt - 1));
    let res: Response;
    let body: Buffer;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": "CardIndex/0.1 (catalog hashing)" },
      });
      // Read the body even for an error status: undici reuses a keep-alive
      // connection only once its body is consumed, and new connections to
      // TCGplayer's CDN are often reset (ECONNRESET, "fetch failed").
      body = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (res.ok) return body;
    lastErr = new Error(`HTTP ${res.status}`);
    if (MISSING_STATUSES.has(res.status)) notFound++;
    else otherStatus = true;
    if (notFound >= MISSING_ANSWERS && !otherStatus) throw new ImageMissingError(res.status);
  }
  throw lastErr;
}

export async function ensureHashIndexSchema(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS card_image_hashes (
    card_id     bigint PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    dhash       text NOT NULL,
    ahash       text NOT NULL,
    dhash_inset text NOT NULL,
    ahash_inset text NOT NULL,
    image_url   text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS card_image_missing (
    card_id    bigint PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    image_url  text NOT NULL,
    status     integer NOT NULL,
    checked_at timestamptz NOT NULL DEFAULT now()
  )`);
}

/**
 * How many catalog cards have an image, how many are in the index, how many
 * images the host doesn't have (known missing), and how many a default build
 * would fetch (`pending`: not hashed at their current URL and not known missing,
 * or known missing but due for a re-check — the same rule as buildHashIndex).
 */
export async function hashIndexCoverage(): Promise<{ cards: number; hashed: number; missing: number; pending: number }> {
  const r = await one<{ cards: number; hashed: number; missing: number; pending: number }>(
    `SELECT COUNT(*)::int AS cards,
            COUNT(h.card_id)::int AS hashed,
            COUNT(*) FILTER (WHERE h.image_url IS DISTINCT FROM i.url AND m.image_url = i.url)::int AS missing,
            COUNT(*) FILTER (WHERE h.image_url IS DISTINCT FROM i.url
              AND NOT (m.image_url IS NOT DISTINCT FROM i.url AND m.checked_at > now() - interval '${RECHECK_MISSING_AFTER_DAYS} days'))::int AS pending
     FROM cards c
     CROSS JOIN LATERAL (SELECT COALESCE(c.image_small, c.image_large) AS url) i
     LEFT JOIN card_image_hashes h ON h.card_id = c.id
     LEFT JOIN card_image_missing m ON m.card_id = c.id
     WHERE i.url IS NOT NULL`
  );
  return r ?? { cards: 0, hashed: 0, missing: 0, pending: 0 };
}

/**
 * Hash every catalog card whose image is new or changed (all of them with
 * `force`). Images known to be missing are skipped unless their URL changed,
 * they're due for a re-check, or `retryMissing` / `force` is set. Safe to run
 * while the server serves requests: rows are upserted one at a time and the
 * matcher's in-memory copy is invalidated at the end.
 */
export async function buildHashIndex(opts: { force?: boolean; retryMissing?: boolean; log?: (line: string) => void } = {}): Promise<HashIndexStats> {
  const log = opts.log ?? (() => {});
  const force = !!opts.force;
  await ensureHashIndexSchema();

  const cards = (await query(
    `SELECT c.id, c.name, COALESCE(c.image_small, c.image_large) AS image, h.image_url AS hashed_url,
            m.image_url AS missing_url, m.checked_at > now() - interval '${RECHECK_MISSING_AFTER_DAYS} days' AS missing_recent
     FROM cards c
     LEFT JOIN card_image_hashes h ON h.card_id = c.id
     LEFT JOIN card_image_missing m ON m.card_id = c.id
     WHERE COALESCE(c.image_small, c.image_large) IS NOT NULL
     ORDER BY c.id`
  )) as Array<{ id: number; name: string; image: string; hashed_url: string | null; missing_url: string | null; missing_recent: boolean | null }>;

  const unhashed = cards.filter((c) => force || c.hashed_url !== c.image);
  const todo = force || opts.retryMissing ? unhashed : unhashed.filter((c) => !(c.missing_url === c.image && c.missing_recent));
  const skipped = unhashed.length - todo.length;
  log(
    `hash index — ${cards.length} cards with images, ${todo.length} to hash${force ? " (forced)" : opts.retryMissing ? " (retrying missing images)" : ""}` +
      (skipped ? `, ${skipped} skipped (no image at the source when last checked)` : "")
  );

  // A host that turns this server away answers 403 too. Before the first image
  // from a host is recorded as missing, check that an image hashed earlier from
  // the same host still loads; if it doesn't, nothing is recorded this pass.
  const hostChecks = new Map<string, Promise<boolean>>();
  const hostServesImages = (url: string): Promise<boolean> => {
    const origin = new URL(url).origin;
    let check = hostChecks.get(origin);
    if (!check) {
      check = (async () => {
        const ref = await one<{ image_url: string }>(
          "SELECT image_url FROM card_image_hashes WHERE image_url LIKE $1 ORDER BY random() LIMIT 1",
          [origin + "/%"]
        );
        if (!ref) return true; // nothing hashed from this host yet; take the 403 at its word
        const ok = await fetchImage(ref.image_url).then(() => true, () => false);
        if (!ok) log(`  ! ${origin} didn't serve an image it served before, so this pass records nothing as missing`);
        return ok;
      })();
      hostChecks.set(origin, check);
    }
    return check;
  };

  let done = 0;
  let failed = 0;
  let missing = 0;
  let processed = 0;
  const queue = [...todo];
  const worker = async () => {
    for (;;) {
      const card = queue.shift();
      if (!card) return;
      try {
        const h = await hashImage(await fetchImage(card.image));
        await query(
          `INSERT INTO card_image_hashes (card_id, dhash, ahash, dhash_inset, ahash_inset, image_url, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT (card_id) DO UPDATE SET dhash=EXCLUDED.dhash, ahash=EXCLUDED.ahash,
             dhash_inset=EXCLUDED.dhash_inset, ahash_inset=EXCLUDED.ahash_inset,
             image_url=EXCLUDED.image_url, updated_at=now()`,
          [card.id, toHex(h.full.dhash), toHex(h.full.ahash), toHex(h.inset.dhash), toHex(h.inset.ahash), card.image]
        );
        if (card.missing_url) await query("DELETE FROM card_image_missing WHERE card_id=$1", [card.id]);
        done++;
      } catch (err: any) {
        if (err instanceof ImageMissingError && (await hostServesImages(card.image))) {
          await query(
            `INSERT INTO card_image_missing (card_id, image_url, status, checked_at) VALUES ($1,$2,$3,now())
             ON CONFLICT (card_id) DO UPDATE SET image_url=EXCLUDED.image_url, status=EXCLUDED.status, checked_at=now()`,
            [card.id, card.image, err.status]
          );
          missing++;
          if (missing <= 5) log(`  - no image: ${card.name} (#${card.id}): ${err.message}${missing === 5 ? " (further ones counted, not listed)" : ""}`);
        } else {
          failed++;
          log(`  ! ${card.name} (#${card.id}): ${err?.message ?? err}`);
        }
      }
      if (++processed % 50 === 0) log(`  ${processed}/${todo.length}…`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (done > 0) invalidateHashIndex();

  const cov = await hashIndexCoverage();
  log(
    `hash index done: ${done} hashed, ${missing} with no image at the source, ${failed} failed. ` +
      `Index covers ${cov.hashed}/${cov.cards} cards; ${cov.missing} have no image (skipped until their URL changes or a re-check).`
  );
  return { cards: cov.cards, hashed: cov.hashed, todo: todo.length, done, failed, missing: cov.missing };
}

let booting: Promise<void> | null = null;

/**
 * Boot-time fill: when the hash matcher is the configured recognizer and the
 * index is behind the catalog, build it in the background (never blocks the
 * listener; failures only log). Set HASH_INDEX_ON_BOOT=0 to opt out, e.g. when
 * running several instances and one already does it.
 */
export function startHashIndexOnBoot(): void {
  if (process.env.HASH_INDEX_ON_BOOT === "0") return;
  if ((process.env.VISION_PROVIDER ?? "none").toLowerCase() !== "hash") return;
  if (booting) return;
  booting = (async () => {
    try {
      await ensureHashIndexSchema();
      const cov = await hashIndexCoverage();
      if (cov.pending === 0) return;
      console.log(
        `  Photo-ID index covers ${cov.hashed}/${cov.cards} cards${cov.missing ? ` (${cov.missing} have no image at the source)` : ""} — hashing ${cov.pending} in the background…`
      );
      await buildHashIndex({ log: (l) => console.log("  " + l) });
    } catch (err: any) {
      console.error("  Photo-ID index build failed (uploads fall back to filename hints until it succeeds):", err?.message ?? err);
    } finally {
      booting = null;
    }
  })();
}
