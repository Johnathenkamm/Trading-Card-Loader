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
import { hashImage, hashDistance, fromHex, type ImageHashes } from "../imagehash.ts";

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

/** Batch settings a recognizer may honour (the upload's "Database" choice). */
export type VisionOptions = { game?: string };

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
    // Honour the batch's Database: a Pokémon batch never resolves to a Magic card.
    const game = (opts.game ?? "").trim().toLowerCase();
    if (game) index = index.filter((r) => r.game_slug === game);
    if (index.length === 0) return null;

    let q: ImageHashes;
    try {
      q = await hashImage(image.data);
    } catch {
      return null; // undecodable image
    }

    let best: { row: HashIndexRow; d: number } | null = null;
    let second: { row: HashIndexRow; d: number } | null = null;
    for (const row of index) {
      const d = hashDistance(q, row.h);
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
    vision = await visionProvider().identify(image, { game: opts.game });
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
