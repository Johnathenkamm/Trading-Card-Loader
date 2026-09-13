// Photo-identification index builder: perceptual-hash every catalog card's
// reference image into card_image_hashes (src/imagehash.ts for the method).
//
// Two callers:
//   - `npm run hash:catalog` (src/scripts/hash-catalog.ts) — manual/forced runs
//   - the server at boot (src/server.ts) — when VISION_PROVIDER=hash and the
//     index covers fewer cards than the catalog, fill it in the background.
//     Hosted deploys (Railway) have no shell access to the database, so without
//     this the index stays empty and every photo falls back to the filename hint.
//
// Re-runnable: cards whose stored image_url is unchanged are skipped, so after a
// catalog sync only new/changed cards are fetched. "Adding a set" is hashing
// its images — no retraining.

import { query, one } from "../pg.ts";
import { hashImage, toHex } from "../imagehash.ts";
import { sleep } from "../util.ts";
import { invalidateHashIndex } from "./vision.ts";

const CONCURRENCY = 6;

export type HashIndexStats = { cards: number; hashed: number; todo: number; done: number; failed: number };

async function fetchImage(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": "CardIndex/0.1 (catalog hashing)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      await sleep(500 * attempt);
    }
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
}

/** How many catalog cards have an image vs. how many are in the index. */
export async function hashIndexCoverage(): Promise<{ cards: number; hashed: number }> {
  const r = await one<{ cards: number; hashed: number }>(
    `SELECT (SELECT COUNT(*)::int FROM cards WHERE COALESCE(image_small, image_large) IS NOT NULL) AS cards,
            (SELECT COUNT(*)::int FROM card_image_hashes) AS hashed`
  );
  return r ?? { cards: 0, hashed: 0 };
}

/**
 * Hash every catalog card whose image is new or changed (all of them with
 * `force`). Safe to run while the server serves requests: rows are upserted one
 * at a time and the matcher's in-memory copy is invalidated at the end.
 */
export async function buildHashIndex(opts: { force?: boolean; log?: (line: string) => void } = {}): Promise<HashIndexStats> {
  const log = opts.log ?? (() => {});
  const force = !!opts.force;
  await ensureHashIndexSchema();

  const cards = (await query(
    `SELECT c.id, c.name, COALESCE(c.image_small, c.image_large) AS image, h.image_url AS hashed_url
     FROM cards c
     LEFT JOIN card_image_hashes h ON h.card_id = c.id
     WHERE COALESCE(c.image_small, c.image_large) IS NOT NULL
     ORDER BY c.id`
  )) as Array<{ id: number; name: string; image: string; hashed_url: string | null }>;

  const todo = cards.filter((c) => force || c.hashed_url !== c.image);
  log(`hash index — ${cards.length} cards with images, ${todo.length} to hash${force ? " (forced)" : ""}`);

  let done = 0;
  let failed = 0;
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
        done++;
        if (done % 50 === 0) log(`  ${done}/${todo.length}…`);
      } catch (err: any) {
        failed++;
        log(`  ! ${card.name} (#${card.id}): ${err?.message ?? err}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (done > 0) invalidateHashIndex();

  const total = await one<{ n: number }>("SELECT COUNT(*)::int n FROM card_image_hashes");
  const hashed = total?.n ?? 0;
  log(`hash index done: ${done} hashed, ${failed} failed. Index covers ${hashed}/${cards.length} cards.`);
  return { cards: cards.length, hashed, todo: todo.length, done, failed };
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
      if (cov.hashed >= cov.cards) return;
      console.log(`  Photo-ID index covers ${cov.hashed}/${cov.cards} cards — hashing the rest in the background…`);
      await buildHashIndex({ log: (l) => console.log("  " + l) });
    } catch (err: any) {
      console.error("  Photo-ID index build failed (uploads fall back to filename hints until it succeeds):", err?.message ?? err);
    } finally {
      booting = null;
    }
  })();
}
