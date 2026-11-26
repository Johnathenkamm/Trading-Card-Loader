// Vision identification — the "AI core" seam (spec §2, build plan §6.1).
//
// An uploaded photo needs to become a catalog card. The design keeps the model
// swappable behind one interface (like storage.ts swaps buckets):
//
//   none  -> no vision; fall back to the filename hint (offline default)
//   mock  -> returns a fixed label set; proves the pixels→labels→catalog→review
//            pipeline works end-to-end with no external service
//   hash  -> local perceptual-hash matcher (src/imagehash.ts); exact catalog-art
//            scans only, it fails once the card doesn't fill the frame
//   embed -> local SigLIP 2 image embeddings (src/app/embedding.ts) + the hash
//            for exact scans; survives background, tilt, glare and blur
//   http  -> POST the image to any recognition API (Ximilar, a self-hosted model,
//            eBay Browse searchByImage, …); map its JSON response to card labels
//
// Whatever the provider returns, it is reduced to a text "hint" and run through
// the existing catalog matcher (identify.ts) — so vision resolves to a *priced
// catalog variant* with alternatives and a confidence, and everything downstream
// (review queue, pricing, listing) is unchanged. Selecting a provider is
// env-only; see .env.example (VISION_*).

import { identify, AUTO_THRESHOLD, type IdentifyResult, type IdentifyOptions } from "./identify.ts";
import { hintFromFilename } from "../upload.ts";
import { query } from "../pg.ts";
import { hashPhoto, hashDistance, fromHex, type ImageHashes, type PhotoHashes } from "../imagehash.ts";
import { embedder, embedConfidence } from "./embedding.ts";

export type VisionImage = { data: Buffer; filename: string; contentType: string };

/** Structured labels a recognizer might return; any subset is fine. */
export type VisionLabels = {
  tcg?: string;
  name?: string;
  set?: string;
  number?: string;
  rarity?: string;
  finish?: string;
  language?: string;
  grade?: string;
};

export type VisionResult = {
  provider: string;
  hintText?: string; // free-text identity; assembled from labels when absent
  labels?: VisionLabels;
  confidence?: number; // 0..1
  raw?: unknown; // provider payload (for logging / future training data)
};

/** Batch settings a recognizer may honour: the upload's "Database" and "Default language". */
export type VisionOptions = { game?: string; language?: string };

// Language editions of one game (CATALOG_GAMES in catalog-import.ts): the same
// artwork printed in another language, priced as a different card. A photo
// can't tell them apart (an English Vivid Voltage Wooper is a few bits from
// its Japanese S4 twin), so with "Any game" the batch's language picks the
// edition: an EN batch never resolves to a Japanese card, a JP batch never to
// the English one. Choosing the edition's Database explicitly still wins.
const LANGUAGE_EDITIONS: Record<string, { of: string; language: string }> = {
  "pokemon-jp": { of: "pokemon", language: "JP" },
};

/** Which games a photo may match: `only` one, or everything not in `exclude`. */
export function photoGamePool(opts: VisionOptions = {}): { only: string | null; exclude: Set<string> } {
  const game = (opts.game ?? "").trim().toLowerCase();
  if (game) return { only: game, exclude: new Set() };
  const lang = (opts.language ?? "EN").trim().toUpperCase() || "EN";
  const exclude = new Set<string>();
  for (const [edition, e] of Object.entries(LANGUAGE_EDITIONS)) exclude.add(lang === e.language ? e.of : edition);
  return { only: null, exclude };
}
const inPool = (pool: ReturnType<typeof photoGamePool>, slug: string) => (pool.only ? slug === pool.only : !pool.exclude.has(slug));

export interface VisionProvider {
  readonly name: string;
  identify(image: VisionImage, opts?: VisionOptions): Promise<VisionResult | null>;
}

/** Assemble a catalog-searchable string from structured labels. */
export function labelsToHint(l: VisionLabels): string {
  return [l.name, l.number, l.set, l.finish, l.grade, l.language]
    .filter((s): s is string => !!s && String(s).trim() !== "")
    .join(" ")
    .trim();
}

// ---- providers ------------------------------------------------------------

class NoneProvider implements VisionProvider {
  readonly name = "none";
  async identify(): Promise<VisionResult | null> {
    return null;
  }
}

/**
 * Deterministic stand-in for testing/demo without a real model: returns the same
 * labels for every image (configurable via VISION_MOCK_HINT). Lets you exercise
 * the whole upload → vision → catalog match → review flow offline.
 */
class MockProvider implements VisionProvider {
  readonly name = "mock";
  async identify(image: VisionImage): Promise<VisionResult | null> {
    const hint = process.env.VISION_MOCK_HINT ?? "Charizard 4/102 Holo";
    const conf = Number(process.env.VISION_MOCK_CONFIDENCE ?? "0.97");
    return { provider: this.name, hintText: hint, confidence: Number.isFinite(conf) ? conf : 0.97, raw: { mock: true, filename: image.filename } };
  }
}

/**
 * Local perceptual-hash matcher — the first REAL photo identifier that works
 * with no external service (research report §6: card ID is image retrieval;
 * hashing is the proven baseline tier, embeddings/Ximilar the upgrades).
 * Requires the index built by `npm run hash:catalog`; with an empty index it
 * returns null and the caller falls back (filename hint) gracefully.
 */
type HashIndexRow = { card_id: number; name: string; number: string | null; set_name: string; game_slug: string; h: ImageHashes };
let hashIndex: { rows: HashIndexRow[]; at: number } | null = null;
const HASH_INDEX_TTL_MS = 10 * 60 * 1000;

/** Drop the in-memory copy so the next identify reloads it (after a rebuild). */
export function invalidateHashIndex(): void {
  hashIndex = null;
}

async function loadHashIndex(): Promise<HashIndexRow[]> {
  if (hashIndex && Date.now() - hashIndex.at < HASH_INDEX_TTL_MS) return hashIndex.rows;
  const raw = (await query(
    `SELECT h.card_id, h.dhash, h.ahash, h.dhash_inset, h.ahash_inset, c.name, c.number, s.name AS set_name, g.slug AS game_slug
     FROM card_image_hashes h JOIN cards c ON c.id=h.card_id JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id`
  )) as Array<{ card_id: number; dhash: string; ahash: string; dhash_inset: string; ahash_inset: string; name: string; number: string | null; set_name: string; game_slug: string }>;
  const rows = raw.map((r) => ({
    card_id: r.card_id,
    name: r.name,
    number: r.number,
    set_name: r.set_name,
    game_slug: r.game_slug,
    h: {
      full: { dhash: fromHex(r.dhash), ahash: fromHex(r.ahash) },
      inset: { dhash: fromHex(r.dhash_inset), ahash: fromHex(r.ahash_inset) },
    },
  }));
  // Don't memoize an empty index: it usually means the boot-time build is still
  // running, and the next upload should see its rows as soon as they land.
  if (rows.length > 0) hashIndex = { rows, at: Date.now() };
  return rows;
}

class HashProvider implements VisionProvider {
  readonly name = "hash";

  async identify(image: VisionImage, opts: VisionOptions = {}): Promise<VisionResult | null> {
    let index: HashIndexRow[];
    try {
      index = await loadHashIndex();
    } catch {
      return null;
    }
    // Honour the batch's Database (a Pokémon batch never resolves to a Magic
    // card) and language (an English batch never to a Japanese twin).
    const pool = photoGamePool(opts);
    index = index.filter((r) => inPool(pool, r.game_slug));
    if (index.length === 0) return null;

    let q: PhotoHashes;
    try {
      q = await hashPhoto(image.data);
    } catch {
      return null; // undecodable image
    }

    let best: { row: HashIndexRow; d: number } | null = null;
    let second: { row: HashIndexRow; d: number } | null = null;
    for (const row of index) {
      // A scan with a margin is also compared with its margin cut away.
      const d = q.trimmed ? Math.min(hashDistance(q.photo, row.h), hashDistance(q.trimmed, row.h)) : hashDistance(q.photo, row.h);
      if (!best || d < best.d) {
        if (best && best.row.card_id !== row.card_id) second = best;
        best = { row, d };
      } else if (row.card_id !== best.row.card_id && (!second || d < second.d)) {
        second = { row, d };
      }
    }
    if (!best) return null;

    // distance -> confidence (64-bit dHash + half-weight aHash scale; measured:
    // same image re-encoded ≈ 0, true matches in test-cards/ ≤ 3, while the
    // nearest DIFFERENT card can land as close as 8–10 when the real card isn't
    // in the catalog). Only d ≤ 6 clears the auto-match bar; 6–10 is a strong
    // suggestion that still goes to review.
    let confidence: number | null =
      best.d <= 6 ? 0.97 : best.d <= 10 ? 0.85 : best.d <= 14 ? 0.75 : best.d <= 18 ? 0.55 : null;
    if (confidence == null) return null;
    // near-tie with a different card (reprints/alt arts): route to review
    if (second && second.d - best.d < 2) confidence = Math.min(confidence, 0.7);

    const labels: VisionLabels = {
      name: best.row.name,
      number: best.row.number ?? undefined,
      set: best.row.set_name,
    };
    return {
      provider: this.name,
      labels,
      hintText: labelsToHint(labels),
      confidence,
      raw: {
        distance: best.d,
        runner_up: second
          ? { card_id: second.row.card_id, distance: second.d, hint: labelsToHint({ name: second.row.name, number: second.row.number ?? undefined, set: second.row.set_name }) }
          : null,
        card_id: best.row.card_id,
      },
    };
  }
}

/**
 * Image-embedding matcher (src/app/embedding.ts): the photo becomes a SigLIP 2
 * vector and the nearest catalog card by cosine similarity wins. Unlike the
 * hash it survives background, tilt, glare and blur (npm run bench:id). Exact
 * catalog-art scans still go to the hash first: it's near-certain on those and
 * costs nothing. Requires card_embeddings (built at boot, or `npm run
 * embed:catalog`); while a game's index is empty this returns the hash result.
 */
type EmbedGameIndex = {
  ids: number[];
  meta: Array<{ name: string; number: string | null; set_name: string }>;
  vecs: Int8Array; // ids.length x dim, value ≈ byte / scale
  scales: Float32Array;
  catalog: number; // cards with an image in this game (for coverage)
  unindexed: Set<string>; // base names of this game's cards with no vector (no image, or not built yet)
};
type EmbedIndex = {
  key: string;
  dim: number;
  games: Map<string, EmbedGameIndex>;
  /** Cards with a fetchable image per game, including games with no vectors yet. */
  catalog: Map<string, number>;
  pos: Map<number, { game: string; row: number }>;
  since: number;
  checked: number;
};
let embedIndex: EmbedIndex | null = null;
const EMBED_REFRESH_MS = 2 * 60 * 1000;

/** Drop the in-memory copy so the next identify reloads it (after a rebuild). */
export function invalidateEmbedIndex(): void {
  embedIndex = null;
}

/** Load the embedding index now (at boot), so the first scan doesn't wait for it. Returns the vector count. */
export async function warmEmbedIndex(): Promise<number> {
  const idx = await loadEmbedIndex();
  return idx.pos.size;
}

type EmbedRow = { card_id: number; vec: Buffer; scale: number; updated_us: number; name: string; number: string | null; set_name: string; game: string };
const EMBED_ROW_SQL = `SELECT e.card_id::int AS card_id, e.vec, e.scale, (extract(epoch FROM e.updated_at) * 1000000)::float8 AS updated_us, c.name, c.number, s.name AS set_name, g.slug AS game
  FROM card_embeddings e JOIN cards c ON c.id=e.card_id JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
  WHERE e.model = $1`;

let embedLoading: Promise<EmbedIndex> | null = null;

/** The in-memory index, loaded once and refreshed every 2 min; concurrent callers share one load. */
function loadEmbedIndex(): Promise<EmbedIndex> {
  const key = embedder().key;
  if (embedIndex && embedIndex.key === key && Date.now() - embedIndex.checked < EMBED_REFRESH_MS) return Promise.resolve(embedIndex);
  if (!embedLoading) embedLoading = refreshEmbedIndex(key).finally(() => (embedLoading = null));
  return embedLoading;
}

async function refreshEmbedIndex(key: string): Promise<EmbedIndex> {

  // First load reads everything; later refreshes only rows written since.
  const fresh = !embedIndex || embedIndex.key !== key;
  const idx: EmbedIndex = fresh ? { key, dim: 0, games: new Map(), catalog: new Map(), pos: new Map(), since: 0, checked: 0 } : embedIndex!;
  const rows = (await query(`${EMBED_ROW_SQL} AND e.updated_at > to_timestamp($2::float8 / 1000000) ORDER BY e.updated_at`, [key, idx.since])) as EmbedRow[];
  const added = new Map<string, EmbedRow[]>();
  for (const r of rows) {
    idx.dim ||= r.vec.length;
    if (r.vec.length !== idx.dim) continue;
    const at = idx.pos.get(r.card_id);
    if (at && at.game === r.game) {
      // re-embedded card: overwrite its row in place
      const g = idx.games.get(at.game)!;
      g.vecs.set(new Int8Array(r.vec.buffer, r.vec.byteOffset, r.vec.length), at.row * idx.dim);
      g.scales[at.row] = r.scale;
    } else {
      if (!added.has(r.game)) added.set(r.game, []);
      added.get(r.game)!.push(r);
    }
    if (r.updated_us > idx.since) idx.since = r.updated_us;
  }
  for (const [game, adds] of added) {
    const old = idx.games.get(game);
    const n0 = old?.ids.length ?? 0;
    const vecs = new Int8Array((n0 + adds.length) * idx.dim);
    const scales = new Float32Array(n0 + adds.length);
    if (old) {
      vecs.set(old.vecs);
      scales.set(old.scales);
    }
    const g: EmbedGameIndex = { ids: old?.ids ?? [], meta: old?.meta ?? [], vecs, scales, catalog: old?.catalog ?? 0, unindexed: old?.unindexed ?? new Set() };
    adds.forEach((r, i) => {
      vecs.set(new Int8Array(r.vec.buffer, r.vec.byteOffset, r.vec.length), (n0 + i) * idx.dim);
      scales[n0 + i] = r.scale;
      g.ids.push(r.card_id);
      g.meta.push({ name: r.name, number: r.number, set_name: r.set_name });
      idx.pos.set(r.card_id, { game, row: n0 + i });
    });
    idx.games.set(game, g);
  }
  // Coverage: an index that's still building can't rule out the true card.
  // Counted against the cards whose image the hash index could fetch: an image
  // TCGplayer refuses (403) fails here too, and shouldn't keep a game "building"
  // forever (Japanese Pokémon would never auto-match at 91%).
  const cov = (await query(
    `SELECT g.slug AS game, COUNT(*)::int AS n, COUNT(h.card_id)::int AS fetchable
     FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
     LEFT JOIN card_image_hashes h ON h.card_id = c.id
     WHERE COALESCE(c.image_small, c.image_large) IS NOT NULL GROUP BY g.slug`
  ).catch(() => [])) as Array<{ game: string; n: number; fetchable: number }>;
  idx.catalog = new Map();
  for (const c of cov) {
    idx.catalog.set(c.game, c.fetchable || c.n);
    const g = idx.games.get(c.game);
    if (g) g.catalog = c.fetchable || c.n;
  }
  // Cards we can't match by image (TCGplayer refuses some images, ~9% of
  // Japanese Pokémon). A photo of one lands on a sibling version with the same
  // name (Zarude V → Zarude V (Full Art)) with a confident-looking margin, so a
  // match whose name has an unindexed version always goes to review.
  const missing = (await query(
    `SELECT DISTINCT g.slug AS game, c.name FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
     LEFT JOIN card_embeddings e ON e.card_id = c.id AND e.model = $1
     WHERE e.card_id IS NULL`,
    [key]
  )) as Array<{ game: string; name: string }>;
  for (const g of idx.games.values()) g.unindexed = new Set();
  for (const m of missing) idx.games.get(m.game)?.unindexed.add(baseName(m.name));
  idx.checked = Date.now();
  embedIndex = idx;
  return idx;
}

/** "Zarude V (Full Art)" and "Zarude V" are versions of one card name. */
function baseName(name: string): string {
  return name.toLowerCase().replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+/g, " ").trim();
}

class EmbedProvider implements VisionProvider {
  readonly name = "embed";
  private hash = new HashProvider();

  async identify(image: VisionImage, opts: VisionOptions = {}): Promise<VisionResult | null> {
    // 1. A clean scan of catalog art: the hash is near-certain and cheap.
    const hashed = await this.hash.identify(image, opts).catch(() => null);
    if (hashed && (hashed.confidence ?? 0) >= 0.97) return { ...hashed, provider: this.name, raw: { ...(hashed.raw as object), method: "hash" } };

    // 2. Everything else: nearest card by image embedding, within the batch's game.
    const pool = photoGamePool(opts);
    let idx: EmbedIndex;
    let q: Float32Array;
    try {
      idx = await loadEmbedIndex();
      if (![...idx.games.keys()].some((g) => inPool(pool, g))) return hashed;
      [q] = await embedder().embed([image.data]);
    } catch {
      return hashed; // model or index unavailable: fall back to the hash result
    }
    if (q.length !== idx.dim) return hashed;

    // Coverage counts every game the photo may belong to, including one with no
    // vectors yet: while Magic is still being embedded, a Magic photo would
    // otherwise get a confident pick from among the Pokémon cards.
    let catalog = 0;
    let indexed = 0;
    for (const [slug, n] of idx.catalog) {
      if (!inPool(pool, slug)) continue;
      catalog += n;
      indexed += idx.games.get(slug)?.ids.length ?? 0;
    }
    let best: { game: string; row: number; sim: number } | null = null;
    let second: { game: string; row: number; sim: number } | null = null;
    for (const [slug, g] of idx.games) {
      if (!inPool(pool, slug)) continue;
      const { vecs, scales } = g;
      const dim = idx.dim;
      for (let r = 0; r < g.ids.length; r++) {
        let dot = 0;
        const o = r * dim;
        for (let i = 0; i < dim; i++) dot += q[i] * vecs[o + i];
        const sim = dot / scales[r];
        if (!best || sim > best.sim) {
          second = best;
          best = { game: slug, row: r, sim };
        } else if (!second || sim > second.sim) {
          second = { game: slug, row: r, sim };
        }
      }
    }
    if (!best) return hashed;

    // similarity + margin → confidence: the calibrated rule lives in embedding.ts.
    const margin = second ? best.sim - second.sim : 1;
    let confidence = embedConfidence(best.sim, margin);
    if (confidence == null) return hashed;
    if (catalog > 0 && indexed / catalog < 0.95) confidence = Math.min(confidence, 0.85); // still building

    const at = (h: { game: string; row: number }) => ({ id: idx.games.get(h.game)!.ids[h.row], m: idx.games.get(h.game)!.meta[h.row] });
    const b = at(best);
    const unindexedVersion = idx.games.get(best.game)!.unindexed.has(baseName(b.m.name));
    if (unindexedVersion) confidence = Math.min(confidence, 0.85);
    const labels: VisionLabels = { name: b.m.name, number: b.m.number ?? undefined, set: b.m.set_name };
    const s = second ? at(second) : null;
    // `distance` keeps the orchestrator's near-tie rule (runner-up < 2 away)
    // meaning "within 0.02 similarity".
    const dist = (sim: number) => (1 - sim) * 100;
    return {
      provider: this.name,
      labels,
      hintText: labelsToHint(labels),
      confidence,
      raw: {
        method: "embed",
        card_id: b.id,
        similarity: best.sim,
        distance: dist(best.sim),
        runner_up: s && second
          ? { card_id: s.id, similarity: second.sim, distance: dist(second.sim), hint: labelsToHint({ name: s.m.name, number: s.m.number ?? undefined, set: s.m.set_name }) }
          : null,
        coverage: catalog ? indexed / catalog : null,
        unindexed_version: unindexedVersion,
        hash: hashed?.raw ?? null,
      },
    };
  }
}

type HttpConfig = {
  url: string;
  apiKey?: string;
  authHeader: string;
  authPrefix: string;
  imageField: string;
  timeoutMs: number;
  map: Record<keyof VisionLabels | "confidence", string | undefined>;
};

/**
 * Generic HTTP recognizer. POSTs the image as base64 JSON and maps the response
 * to labels via dot-paths (env-overridable; `*` selects the first array element),
 * e.g. VISION_MAP_NAME=records.*.name. Any failure (network, non-200, unmapped)
 * returns null so the caller falls back gracefully. Requires network at runtime,
 * so it's inert in this offline environment until a real endpoint is configured.
 */
class HttpVisionProvider implements VisionProvider {
  readonly name: string;
  private cfg: HttpConfig;
  constructor(name: string, cfg: HttpConfig) {
    this.name = name;
    this.cfg = cfg;
  }

  async identify(image: VisionImage): Promise<VisionResult | null> {
    if (!this.cfg.url) return null;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.cfg.apiKey) headers[this.cfg.authHeader] = this.cfg.authPrefix + this.cfg.apiKey;
      const res = await fetch(this.cfg.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ [this.cfg.imageField]: image.data.toString("base64"), filename: image.filename, content_type: image.contentType }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      if (!res.ok) return null;
      const json = await res.json();

      const labels: VisionLabels = {
        tcg: str(getPath(json, this.cfg.map.tcg)),
        name: str(getPath(json, this.cfg.map.name)),
        set: str(getPath(json, this.cfg.map.set)),
        number: str(getPath(json, this.cfg.map.number)),
        rarity: str(getPath(json, this.cfg.map.rarity)),
        finish: str(getPath(json, this.cfg.map.finish)),
        language: str(getPath(json, this.cfg.map.language)),
        grade: str(getPath(json, this.cfg.map.grade)),
      };
      const hintText = labelsToHint(labels);
      if (!hintText) return null; // nothing recognizable
      let confidence = num(getPath(json, this.cfg.map.confidence));
      if (confidence != null && confidence > 1) confidence = confidence / 100; // accept 0..100
      return { provider: this.name, labels, hintText, confidence: confidence ?? undefined, raw: json };
    } catch {
      return null; // offline / timeout / bad response → graceful fallback
    }
  }
}

function str(v: unknown): string | undefined {
  return v == null ? undefined : String(v).trim() || undefined;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}
/** Read a dot-path from a nested object; `*` (or `[]`) selects the first array item. */
function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let cur: any = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    if (seg === "*" || seg === "[]") cur = Array.isArray(cur) ? cur[0] : undefined;
    else if (/^\d+$/.test(seg)) cur = Array.isArray(cur) ? cur[Number(seg)] : undefined;
    else cur = cur[seg];
  }
  return cur;
}

// ---- factory --------------------------------------------------------------

let _provider: VisionProvider | null = null;

function build(): VisionProvider {
  const p = (process.env.VISION_PROVIDER ?? "none").toLowerCase();
  if (p === "hash") return new HashProvider();
  if (p === "embed") return new EmbedProvider();
  if (p === "mock") return new MockProvider();
  if (p === "http" || p === "custom" || p === "ximilar") {
    return new HttpVisionProvider(p, {
      url: process.env.VISION_API_URL ?? "",
      apiKey: process.env.VISION_API_KEY,
      authHeader: process.env.VISION_AUTH_HEADER ?? "Authorization",
      // Ximilar uses "Token ", most bearer APIs use "Bearer "; override per provider.
      authPrefix: process.env.VISION_AUTH_PREFIX ?? (p === "ximilar" ? "Token " : "Bearer "),
      imageField: process.env.VISION_IMAGE_FIELD ?? "image",
      timeoutMs: Number(process.env.VISION_TIMEOUT_MS ?? "12000") || 12000,
      map: {
        name: process.env.VISION_MAP_NAME ?? "name",
        number: process.env.VISION_MAP_NUMBER ?? "card_number",
        set: process.env.VISION_MAP_SET ?? "set",
        tcg: process.env.VISION_MAP_TCG,
        rarity: process.env.VISION_MAP_RARITY,
        finish: process.env.VISION_MAP_FINISH,
        language: process.env.VISION_MAP_LANGUAGE,
        grade: process.env.VISION_MAP_GRADE,
        confidence: process.env.VISION_MAP_CONFIDENCE ?? "confidence",
      },
    });
  }
  return new NoneProvider();
}

export function visionProvider(): VisionProvider {
  if (!_provider) _provider = build();
  return _provider;
}

/** True when a real (non-`none`) recognizer is configured. */
export function visionEnabled(): boolean {
  return visionProvider().name !== "none";
}

// ---- orchestrator ---------------------------------------------------------

export type IdentifySource = "vision" | "filename" | "none";

/**
 * Identify an uploaded card image. Tries the configured vision provider; its
 * labels/hint are resolved against the catalog by identify() (so we get a priced
 * variant + alternatives), with the provider's own confidence folded in. Falls
 * back to the filename hint, then to an empty result (which the caller routes to
 * the review queue). `hintText` is the human-readable identity to show in review.
 */
export async function visionIdentify(
  image: VisionImage,
  opts: IdentifyOptions = {}
): Promise<{ result: IdentifyResult; source: IdentifySource; hintText: string | null; vision: VisionResult | null }> {
  let vision: VisionResult | null = null;
  try {
    vision = await visionProvider().identify(image, { game: opts.game, language: opts.language });
  } catch {
    vision = null;
  }

  const visionHint = vision ? (vision.hintText || (vision.labels ? labelsToHint(vision.labels) : "")) : "";
  if (visionHint && visionHint.trim()) {
    let result = await identify(visionHint, opts);
    // The photo is the evidence; the hint lookup only finds that card in the
    // catalog. When the hint IS a catalog card's own name (hash matcher) the
    // lookup always scores ~0.99, so the photo's confidence has to cap the
    // result, never floor it — otherwise a weak nearest neighbour (a card that
    // isn't in the catalog at all) shows as a "99% match".
    if (result.best && vision?.confidence != null) {
      // Pin to the exact card the recognizer picked when it named one (same
      // name in another set would otherwise win the text lookup).
      const raw = vision.raw as { card_id?: number; distance?: number; runner_up?: { card_id: number; distance: number; hint?: string } | null } | undefined;
      const pinned = raw?.card_id;
      let { best, alternatives } = result;
      let c = Math.min(result.confidence, Math.min(0.99, vision.confidence));
      if (pinned != null && best.card_id !== pinned) {
        const hit = alternatives.find((a) => a.card_id === pinned);
        if (hit) {
          alternatives = [best, ...alternatives.filter((a) => a !== hit)];
          best = hit;
        } else {
          c = Math.min(c, 0.7);
        }
      }
      // A near-tie (identical-art reprint: Base vs Shadowless, a Prize Pack
      // stamp) goes to review; offer the runner-up as a one-click alternative.
      const ru = raw?.runner_up;
      if (c < AUTO_THRESHOLD && ru?.hint && raw?.distance != null && ru.distance - raw.distance < 2 && ![best, ...alternatives].some((a) => a.card_id === ru.card_id)) {
        const alt = (await identify(ru.hint, opts)).best;
        if (alt && alt.card_id === ru.card_id) alternatives = [alt, ...alternatives].slice(0, 4);
      }
      // Their text scores are as inflated as the best's; the photo caps them too.
      alternatives = alternatives.map((a) => ({ ...a, score: Math.min(a.score, c) }));
      result = { ...result, best, alternatives, confidence: c, status: c >= AUTO_THRESHOLD ? "matched" : "needs_review" };
    }
    return { result, source: "vision", hintText: visionHint, vision };
  }

  // Fallback: derive a hint from the filename (e.g. "charizard-4-102.jpg").
  const fileHint = hintFromFilename(image.filename);
  const result = await identify(fileHint ?? "", opts);
  return { result, source: fileHint ? "filename" : "none", hintText: fileHint, vision };
}
