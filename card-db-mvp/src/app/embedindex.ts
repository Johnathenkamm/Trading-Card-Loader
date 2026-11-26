// Embedding index builder: run every catalog card's reference image through
// the embedding model (src/app/embedding.ts) into card_embeddings, for the
// VISION_PROVIDER=embed matcher in vision.ts.
//
// Same shape as the hash index (hashindex.ts), and the same two callers: the
// server at boot fills any gap in the background (hosted deploys have no shell
// into the database), and `npm run embed:catalog` is the manual / forced run.
// Re-runnable: a card is skipped while its image_url AND model are unchanged,
// so switching EMBED_MODEL / EMBED_DTYPE re-embeds everything.
//
// Vectors are stored as int8 with a per-vector scale (768 bytes + a float per
// card instead of 3 KB): cosine similarity moves by ~0.001, the whole catalog
// fits in ~50 MB of memory.

import { query, one } from "../pg.ts";
import { sleep } from "../util.ts";
import { embedder, embedThreads, type ImageEmbedder } from "./embedding.ts";
import { invalidateEmbedIndex, warmEmbedIndex } from "./vision.ts";
// Same fetch as the hash builder: it reads error bodies so keep-alive
// connections to TCGplayer's CDN get reused (unread bodies caused reset storms).
import { ensureHashIndexSchema, fetchImage } from "./hashindex.ts";

// Images TCGplayer doesn't have (card_image_missing, kept by the hash builder
// and re-checked there every 30 days) are skipped: fetching ~4k dead URLs on
// every boot would only fail again. A card leaves that list once the hash
// builder finds its picture, and the next embed build picks it up.
const KNOWN_MISSING = `EXISTS (SELECT 1 FROM card_image_missing m WHERE m.card_id = c.id AND m.image_url = COALESCE(c.image_small, c.image_large))`;

const FETCHERS = 6; // image downloads in flight
const BATCH = 8; // images per model call

export type EmbedIndexStats = { cards: number; embedded: number; todo: number; done: number; failed: number };

/** Unit vector → int8 bytes + scale (value ≈ byte / scale). */
export function quantize(v: Float32Array): { bytes: Buffer; scale: number } {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const scale = max > 0 ? 127 / max : 1;
  const bytes = Buffer.alloc(v.length);
  for (let i = 0; i < v.length; i++) bytes.writeInt8(Math.round(v[i] * scale), i);
  return { bytes, scale };
}

export async function ensureEmbedIndexSchema(): Promise<void> {
  await ensureHashIndexSchema(); // card_image_missing
  await query(`CREATE TABLE IF NOT EXISTS card_embeddings (
    card_id    bigint PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    model      text NOT NULL,
    vec        bytea NOT NULL,
    scale      real NOT NULL,
    image_url  text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

/** Per game: catalog cards with an image (that the host has) vs. cards embedded with the current model. */
export async function embedIndexCoverage(): Promise<Array<{ game: string; cards: number; embedded: number }>> {
  await ensureEmbedIndexSchema();
  return (await query(
    `SELECT g.slug AS game,
            COUNT(*)::int AS cards,
            COUNT(e.card_id) FILTER (WHERE e.model = $1)::int AS embedded
     FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
     LEFT JOIN card_embeddings e ON e.card_id = c.id
     WHERE COALESCE(c.image_small, c.image_large) IS NOT NULL AND NOT ${KNOWN_MISSING}
     GROUP BY g.slug ORDER BY g.slug`,
    [embedder().key]
  )) as Array<{ game: string; cards: number; embedded: number }>;
}

let running: Promise<EmbedIndexStats> | null = null;
let progress: { done: number; todo: number } | null = null;

/** Live progress of a running build (for the owner console), or null. */
export function embedIndexProgress(): { done: number; todo: number } | null {
  return progress ? { ...progress } : null;
}

/**
 * Embed every catalog card whose image or model changed (all with `force`).
 * One build at a time per process; a second call joins the running one.
 * Safe while serving: rows are upserted per batch and the matcher picks them up
 * on its next refresh.
 */
export function buildEmbedIndex(opts: { force?: boolean; games?: string[]; log?: (line: string) => void } = {}): Promise<EmbedIndexStats> {
  if (!running) {
    running = runBuild(opts).finally(() => {
      running = null;
      progress = null;
    });
  }
  return running;
}

async function runBuild(opts: { force?: boolean; games?: string[]; log?: (line: string) => void }): Promise<EmbedIndexStats> {
  const log = opts.log ?? (() => {});
  const model: ImageEmbedder = embedder();
  await ensureEmbedIndexSchema();

  const cards = (await query(
    `SELECT c.id::int AS id, c.name, COALESCE(c.image_small, c.image_large) AS image, e.image_url AS done_url, e.model AS done_model
     FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
     LEFT JOIN card_embeddings e ON e.card_id = c.id
     WHERE COALESCE(c.image_small, c.image_large) IS NOT NULL
       AND ($1::text[] IS NULL OR g.slug = ANY($1))
       AND ($2::boolean OR NOT ${KNOWN_MISSING})
     ORDER BY c.id`,
    [opts.games?.length ? opts.games : null, !!opts.force]
  )) as Array<{ id: number; name: string; image: string; done_url: string | null; done_model: string | null }>;

  const todo = cards.filter((c) => opts.force || c.done_url !== c.image || c.done_model !== model.key);
  log(`embedding index (${model.key}, ${embedThreads()} threads) — ${cards.length} cards with images, ${todo.length} to embed${opts.force ? " (forced)" : ""}`);
  progress = { done: 0, todo: todo.length };
  if (todo.length === 0) return { cards: cards.length, embedded: cards.length, todo: 0, done: 0, failed: 0 };

  // Downloads run FETCHERS-wide into a small buffer; one loop drains it in
  // batches through the model (which already uses every CPU core).
  let done = 0;
  let failed = 0;
  const started = Date.now();
  const queue = [...todo];
  const ready: Array<{ card: (typeof todo)[number]; buf: Buffer }> = [];
  let fetching = 0;
  const fetchOne = async () => {
    for (;;) {
      if (ready.length >= BATCH * 4) {
        await sleep(50);
        continue;
      }
      const card = queue.shift();
      if (!card) return;
      fetching++;
      try {
        ready.push({ card, buf: await fetchImage(card.image) });
      } catch (err: any) {
        failed++;
        if (failed <= 20 || failed % 500 === 0) log(`  ! ${card.name} (#${card.id}): ${err?.message ?? err}${failed === 20 ? " (further failures only counted)" : ""}`);
      } finally {
        fetching--;
      }
    }
  };
  const fetchers = Promise.all(Array.from({ length: FETCHERS }, fetchOne));

  let lastLog = Date.now();
  for (;;) {
    if (ready.length === 0) {
      if (queue.length === 0 && fetching === 0) break;
      await sleep(25);
      continue;
    }
    const batch = ready.splice(0, BATCH);
    let vecs: Float32Array[];
    try {
      vecs = await model.embed(batch.map((b) => b.buf));
    } catch {
      // One undecodable image fails the whole batch; retry them one by one.
      vecs = [];
      for (const b of batch) {
        try {
          vecs.push((await model.embed([b.buf]))[0]);
        } catch (err: any) {
          vecs.push(new Float32Array(0));
          failed++;
          log(`  ! ${b.card.name} (#${b.card.id}): ${err?.message ?? err}`);
        }
      }
    }
    for (let i = 0; i < batch.length; i++) {
      if (vecs[i].length === 0) continue;
      const { bytes, scale } = quantize(vecs[i]);
      await query(
        `INSERT INTO card_embeddings (card_id, model, vec, scale, image_url, updated_at) VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (card_id) DO UPDATE SET model=EXCLUDED.model, vec=EXCLUDED.vec, scale=EXCLUDED.scale, image_url=EXCLUDED.image_url, updated_at=now()`,
        [batch[i].card.id, model.key, bytes, scale, batch[i].card.image]
      );
      done++;
    }
    progress = { done, todo: todo.length };
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      const rate = done / ((Date.now() - started) / 1000);
      const left = todo.length - done - failed;
      log(`  ${done}/${todo.length} embedded (${rate.toFixed(1)}/s, ~${Math.ceil(left / Math.max(rate, 0.01) / 60)} min left)…`);
    }
  }
  await fetchers;
  if (done > 0) invalidateEmbedIndex();

  const total = await one<{ n: number }>("SELECT COUNT(*)::int n FROM card_embeddings WHERE model = $1", [model.key]);
  const embedded = total?.n ?? 0;
  log(`embedding index done: ${done} embedded, ${failed} failed in ${Math.round((Date.now() - started) / 1000)} s. Index covers ${embedded} cards.`);
  return { cards: cards.length, embedded, todo: todo.length, done, failed };
}

let booting = false;

/**
 * Boot-time fill when the embed matcher is configured: build whatever is
 * missing in the background (never blocks the listener; failures only log).
 * EMBED_INDEX_ON_BOOT=0 opts out, e.g. when several instances share a DB.
 */
export function startEmbedIndexOnBoot(): void {
  if ((process.env.VISION_PROVIDER ?? "none").toLowerCase() !== "embed") return;
  // Warm-up: on a fresh container the model (~370 MB) downloads from Hugging
  // Face; doing it now means the first scan after a deploy doesn't wait. The
  // index loads too. EMBED_IDLE_MIN later frees the model if no one scans.
  const t0 = Date.now();
  embedder()
    .preload()
    .then(() => warmEmbedIndex())
    .then((n) => console.log(`  Embedding matcher ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (${embedThreads()} threads, ${n.toLocaleString()} cards indexed)`))
    .catch((err) => console.error("  Embedding model failed to load (uploads use the hash matcher until it does):", err?.message ?? err));
  if (process.env.EMBED_INDEX_ON_BOOT === "0") return;
  if (booting) return;
  booting = true;
  (async () => {
    try {
      const cov = await embedIndexCoverage();
      const cards = cov.reduce((s, g) => s + g.cards, 0);
      const embedded = cov.reduce((s, g) => s + g.embedded, 0);
      if (embedded >= cards) return;
      console.log(`  Photo-ID embedding index covers ${embedded}/${cards} cards — embedding the rest in the background…`);
      await buildEmbedIndex({ log: (l) => console.log("  " + l) });
    } catch (err: any) {
      console.error("  Embedding index build failed (uploads use the hash matcher until it succeeds):", err?.message ?? err);
    } finally {
      booting = false;
    }
  })();
}
