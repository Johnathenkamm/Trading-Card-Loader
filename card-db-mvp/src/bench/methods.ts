// Identification methods the benchmark compares, behind one interface:
// turn an encoded image into a feature, then score a query feature against a
// gallery feature. Features are cached on disk by image content
// (data/bench/cache/<method>.jsonl), so a rerun only pays for new images —
// which matters for Gemini, where every uncached image is a billed API call.
//
//   hash     today's matcher (src/imagehash.ts): dHash + aHash, Hamming distance
//   dinov2   Meta DINOv2 image embedding, local CPU via ONNX (transformers.js)
//   siglip2  Google SigLIP 2 vision tower, local CPU via ONNX (transformers.js)
//   gemini   Google Gemini Embedding 2, hosted API (GEMINI_API_KEY)

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Jimp } from "jimp";
import { hashImage, hashDistance, toHex, fromHex, type ImageHashes } from "../imagehash.ts";
import { sleep } from "../util.ts";
import { createEmbedder, cosine, toBytes, fromBytes, type EmbedConfig, type ImageEmbedder } from "../app/embedding.ts";

export const BENCH_DIR = join(import.meta.dirname, "../../data/bench");
const CACHE_DIR = join(BENCH_DIR, "cache");

export type Feature = ImageHashes | Float32Array;

export interface Method {
  /** Stable id; part of the cache file name, so it includes the model. */
  readonly id: string;
  /** "distance": lower is closer (hash). "similarity": higher is closer (cosine). */
  readonly kind: "distance" | "similarity";
  /** True when featurizing costs money per image. */
  readonly billed: boolean;
  /** Parallel featurize calls worth running (local ONNX already uses every core). */
  readonly concurrency: number;
  featurize(image: Buffer): Promise<Feature>;
  score(q: Feature, g: Feature): number;
  serialize(f: Feature): string;
  deserialize(s: string): Feature;
}

// ---- on-disk feature cache --------------------------------------------------

export function sha1(b: Buffer | string): string {
  return createHash("sha1").update(b).digest("hex");
}

export class FeatureCache {
  private map = new Map<string, Feature>();
  private file: string;
  private method: Method;
  constructor(method: Method) {
    this.method = method;
    mkdirSync(CACHE_DIR, { recursive: true });
    this.file = join(CACHE_DIR, method.id.replace(/[^\w.-]+/g, "_") + ".jsonl");
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        if (!line) continue;
        try {
          const { k, v } = JSON.parse(line);
          this.map.set(k, method.deserialize(v));
        } catch {
          // a torn last line from an interrupted run — ignore it
        }
      }
    }
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  get(key: string): Feature | undefined {
    return this.map.get(key);
  }
  set(key: string, f: Feature): void {
    this.map.set(key, f);
    appendFileSync(this.file, JSON.stringify({ k: key, v: this.method.serialize(f) }) + "\n");
  }
}

// ---- perceptual hash (today's production matcher) ---------------------------

export class HashMethod implements Method {
  readonly id = "hash";
  readonly kind = "distance";
  readonly billed = false;
  readonly concurrency = 4;
  featurize(image: Buffer): Promise<Feature> {
    return hashImage(image);
  }
  score(q: Feature, g: Feature): number {
    return hashDistance(q as ImageHashes, g as ImageHashes);
  }
  serialize(f: Feature): string {
    const h = f as ImageHashes;
    return [h.full.dhash, h.full.ahash, h.inset.dhash, h.inset.ahash].map(toHex).join(",");
  }
  deserialize(s: string): Feature {
    const [a, b, c, d] = s.split(",").map(fromHex);
    return { full: { dhash: a, ahash: b }, inset: { dhash: c, ahash: d } };
  }
}

// ---- embeddings -------------------------------------------------------------

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

abstract class EmbeddingMethod implements Method {
  abstract readonly id: string;
  abstract readonly billed: boolean;
  abstract readonly concurrency: number;
  readonly kind = "similarity";
  abstract featurize(image: Buffer): Promise<Feature>;
  score(q: Feature, g: Feature): number {
    return cosine(q as Float32Array, g as Float32Array);
  }
  serialize(f: Feature): string {
    return toBytes(f as Float32Array).toString("base64");
  }
  deserialize(s: string): Feature {
    return fromBytes(Buffer.from(s, "base64"));
  }
}

/** A vision model run locally through ONNX: the same code the embed provider ships (src/app/embedding.ts). */
class LocalVisionMethod extends EmbeddingMethod {
  readonly id: string;
  readonly billed = false;
  readonly concurrency = 1;
  private embedder: ImageEmbedder;
  constructor(cfg: EmbedConfig) {
    super();
    this.embedder = createEmbedder(cfg);
    // fp32 ids predate the dtype option; keep them so their caches stay valid.
    this.id = `${cfg.family}:${cfg.model}${cfg.dtype === "fp32" ? "" : "@" + cfg.dtype}`;
  }
  async featurize(image: Buffer): Promise<Feature> {
    return (await this.embedder.embed([image]))[0];
  }
}

export function dinov2(model = "Xenova/dinov2-small", dtype = "fp32"): Method {
  return new LocalVisionMethod({ family: "dinov2", model, dtype, side: 224 });
}
export function siglip2(model = "onnx-community/siglip2-base-patch16-224-ONNX", dtype = "fp32"): Method {
  return new LocalVisionMethod({ family: "siglip2", model, dtype, side: 224 });
}

/**
 * Gemini Embedding 2 over REST (embedContent, one image per call). Images are
 * shrunk to 768 px tall first — plenty for a card, and fewer input tokens.
 */
class GeminiMethod extends EmbeddingMethod {
  readonly id: string;
  readonly billed = true;
  readonly concurrency = 4;
  calls = 0;
  private apiKey: string;
  private model: string;
  private dims: number;
  constructor(apiKey: string, model: string, dims: number) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.dims = dims;
    this.id = `gemini:${model}:${dims}`;
  }
  async featurize(image: Buffer): Promise<Feature> {
    const img = await Jimp.read(image);
    if (img.bitmap.height > 768) img.resize({ h: 768 });
    const jpeg = await img.getBuffer("image/jpeg", { quality: 88 });
    const base = process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
    const body = JSON.stringify({
      content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } }] },
      output_dimensionality: this.dims,
    });
    for (let attempt = 1; ; attempt++) {
      this.calls++;
      const res = await fetch(`${base}/models/${this.model}:embedContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body,
        signal: AbortSignal.timeout(30_000),
      }).catch((err: Error) => ({ ok: false, status: 0, text: async () => err.message }) as const);
      if (res.ok) {
        const j: any = await (res as Response).json();
        const values: number[] | undefined = j?.embedding?.values ?? j?.embeddings?.[0]?.values;
        if (!values?.length) throw new Error("gemini: response had no embedding values");
        return normalize(Float32Array.from(values));
      }
      const retryable = res.status === 0 || res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= 6) throw new Error(`gemini: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      await sleep(2000 * attempt);
    }
  }
}

export function gemini(): Method | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GeminiMethod(key, process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-2", Number(process.env.GEMINI_EMBED_DIMS ?? "768") || 768);
}
