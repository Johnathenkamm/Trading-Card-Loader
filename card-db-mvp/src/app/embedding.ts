// Image embeddings for photo identification (VISION_PROVIDER=embed).
//
// A vision model turns a card image into a vector; photos of the same card
// land close together even with background, tilt, glare and blur, which is
// where perceptual hashes fall apart (npm run bench:id: on synthetic phone
// photos SigLIP 2 found the right card 98% of the time, the hash matcher 22%).
//
// Runs on the server's CPU through ONNX (@huggingface/transformers): no API
// key, no per-scan cost. The model downloads from Hugging Face on first use
// into EMBED_MODEL_DIR (default data/models, ~370 MB) and stays loaded:
// ~600 MB of RAM and ~0.3 s of CPU per image (measured on a 16-core dev box).
//
//   EMBED_MODEL  Hugging Face model id (default: SigLIP 2 base, 224 px)
//   EMBED_DTYPE  weights (default fp32). Measured on bench:id: q8 drops top-1
//                from 98% to 55% on phone-style photos, so don't; fp16 matches
//                fp32 but saves no RAM on CPU (ONNX Runtime upcasts it).
//   EMBED_THREADS  model threads (default: the container's CPU quota). A
//                Railway container reports the host's 48 cores but may use 8;
//                ONNX Runtime sizing itself to 48 oversubscribes every scan.
//   EMBED_IDLE_MIN  free the model after this many minutes without a scan
//                (default 15; 0 keeps it loaded). Memory is billed per second
//                and sellers scan in bursts; reloading from disk takes ~2 s.

import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Jimp } from "jimp";
import { sleep } from "../util.ts";

/** Threads for the model: EMBED_THREADS, else the cgroup CPU quota, else every core. */
export function embedThreads(): number {
  const env = Number(process.env.EMBED_THREADS);
  if (process.env.EMBED_THREADS && Number.isFinite(env) && env >= 1) return Math.floor(env);
  try {
    // cgroup v2: "<quota> <period>" in microseconds, or "max <period>" when unlimited
    const [quota, period] = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/);
    const n = quota === "max" ? 0 : Math.floor(Number(quota) / Number(period));
    if (n >= 1) return Math.min(n, availableParallelism());
  } catch {
    // not Linux / no cgroup v2
  }
  return availableParallelism();
}

export type EmbedFamily = "siglip2" | "dinov2";
export type EmbedConfig = { family: EmbedFamily; model: string; dtype: string; side: number };

export function embedConfig(): EmbedConfig {
  return {
    family: "siglip2",
    model: process.env.EMBED_MODEL ?? "onnx-community/siglip2-base-patch16-224-ONNX",
    dtype: process.env.EMBED_DTYPE ?? "fp32",
    side: 224,
  };
}

/** Stored with every vector, so changing model or dtype re-embeds the catalog. */
export function embedKey(c: EmbedConfig = embedConfig()): string {
  return `${c.model}@${c.dtype}`;
}

type TransformersModule = typeof import("@huggingface/transformers");
let transformers: Promise<TransformersModule> | null = null;
function loadTransformers(): Promise<TransformersModule> {
  if (!transformers) {
    transformers = import("@huggingface/transformers").then((T) => {
      T.env.cacheDir = process.env.EMBED_MODEL_DIR ?? join(import.meta.dirname, "../../data/models");
      return T;
    });
  }
  return transformers;
}

export interface ImageEmbedder {
  readonly key: string;
  /** Unit-length vectors, one per encoded image (JPEG/PNG/WebP …). */
  embed(images: Buffer[]): Promise<Float32Array[]>;
  /** Download (first time) and load the model now, so the first scan doesn't wait. */
  preload(): Promise<void>;
  /** True while the model is loaded in memory. */
  loaded(): boolean;
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/**
 * Build an embedder. Images are squashed to the model's square input first:
 * cards are 5:7 portrait, and the processors' own centre-crop would cut off the
 * name bar and the set/number line.
 */
export function createEmbedder(cfg: EmbedConfig): ImageEmbedder {
  let ready: Promise<{ T: TransformersModule; proc: any; model: any }> | null = null;
  let isLoaded = false;
  let busy = 0; // embed calls in flight: never unload under one
  let lastUse = 0;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  const idleMs = () => Math.max(0, envNum("EMBED_IDLE_MIN", 15)) * 60_000;

  // Free the model once it has sat idle for EMBED_IDLE_MIN; the next embed reloads it.
  const watchIdle = () => {
    const ms = idleMs();
    if (!ms || idleTimer) return;
    idleTimer = setInterval(() => {
      if (!ready || busy > 0 || Date.now() - lastUse < ms) return;
      const old = ready;
      ready = null;
      isLoaded = false;
      if (idleTimer) clearInterval(idleTimer);
      idleTimer = null;
      old.then((m) => m.model.dispose?.()).catch(() => {});
    }, Math.min(60_000, ms));
    idleTimer.unref(); // never keeps a script alive
  };

  const load = () => {
    if (!ready) {
      ready = (async () => {
        const T = await loadTransformers();
        const Model = cfg.family === "siglip2" ? T.SiglipVisionModel : T.AutoModel;
        const threads = embedThreads();
        let last: unknown;
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            const proc = await T.AutoProcessor.from_pretrained(cfg.model);
            const model = await Model.from_pretrained(cfg.model, {
              dtype: cfg.dtype as any,
              session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
            });
            isLoaded = true;
            return { T, proc, model };
          } catch (err) {
            last = err; // Hugging Face downloads reset now and then
            await sleep(1500 * attempt);
          }
        }
        ready = null;
        throw new Error(`loading ${cfg.model} (${cfg.dtype}): ${(last as Error)?.message ?? last}`);
      })();
    }
    return ready;
  };

  return {
    key: embedKey(cfg),
    loaded: () => isLoaded,
    async preload(): Promise<void> {
      busy++;
      try {
        await load();
      } finally {
        busy--;
        lastUse = Date.now();
        watchIdle();
      }
    },
    async embed(images: Buffer[]): Promise<Float32Array[]> {
      if (images.length === 0) return [];
      busy++;
      try {
        const { T, proc, model } = await load();
        const raws = await Promise.all(
          images.map(async (buf) => {
            const img = await Jimp.read(buf);
            img.resize({ w: cfg.side, h: cfg.side });
            return new T.RawImage(new Uint8ClampedArray(img.bitmap.data), cfg.side, cfg.side, 4).rgb();
          })
        );
        const out = await model(await proc(raws));
        // SigLIP: pooled image embedding. DINOv2: the CLS token (position 0).
        const t = cfg.family === "siglip2" ? out.pooler_output : out.last_hidden_state;
        const data = t.data as Float32Array;
        const n = images.length;
        if (cfg.family === "siglip2") {
          const dim = t.dims[1];
          return Array.from({ length: n }, (_, i) => normalize(data.slice(i * dim, (i + 1) * dim)));
        }
        const [, tokens, dim] = t.dims;
        return Array.from({ length: n }, (_, i) => normalize(data.slice(i * tokens * dim, i * tokens * dim + dim)));
      } finally {
        busy--;
        lastUse = Date.now();
        watchIdle();
      }
    },
  };
}

let shared: ImageEmbedder | null = null;
/** The configured embedder, loaded once per process. */
export function embedder(): ImageEmbedder {
  if (!shared) shared = createEmbedder(embedConfig());
  return shared;
}

// ---- similarity → confidence --------------------------------------------------
//
// Calibrated on bench:id photos with src/bench/calibrate.ts (small gallery) and
// src/bench/calibrate-full.ts (the whole stored index). Two things decide
// whether a photo can skip review:
//   similarity  how close the photo is to its nearest card. Varies by game:
//               right Pokémon matches sit around 0.90, right MTG matches 0.74–0.88
//               (busier frames, small reference scans).
//   margin      how far ahead of the runner-up that card is. Across the full
//               Pokémon catalog (27k cards) the runner-up is usually the same
//               card name from another set, so right matches lead by only
//               0.03–0.06; every WRONG top pick led by ≤ 0.015 (identical-art
//               reprints), which the near-tie cap below sends to review.
// So a photo auto-matches on high similarity with a clear margin, OR on a wide
// margin at moderate similarity (MTG). Full catalog, Pokémon: 29% of non-clean
// photos auto-match, none wrong; the rest go to review with the right card
// pre-selected 94% of the time. Lowering EMBED_AUTO_MARGIN to 0.03 auto-matches
// 44%, but when a printing is missing from the catalog, more photos land on
// another printing of the same card (6.4% vs 4.3%).

export type EmbedRule = {
  autoSim: number; // tier 1: similarity ≥ autoSim and margin ≥ autoMargin
  autoMargin: number;
  wideSim: number; // tier 2: similarity ≥ wideSim and margin ≥ wideMargin
  wideMargin: number;
  floor: number; // below this similarity there's no usable match at all
};

const envNum = (name: string, d: number) => {
  const v = process.env[name];
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : d;
};

/** Defaults, each overridable without a deploy (EMBED_AUTO_SIM, EMBED_AUTO_MARGIN, EMBED_WIDE_SIM, EMBED_WIDE_MARGIN, EMBED_FLOOR). */
export function embedRule(): EmbedRule {
  return {
    autoSim: envNum("EMBED_AUTO_SIM", 0.88),
    autoMargin: envNum("EMBED_AUTO_MARGIN", 0.04),
    wideSim: envNum("EMBED_WIDE_SIM", 0.7),
    wideMargin: envNum("EMBED_WIDE_MARGIN", 0.1),
    floor: envNum("EMBED_FLOOR", 0.55),
  };
}

/** 0.95 = auto-match; 0.85 / 0.7 = suggestion for review; null = no match. */
export function embedConfidence(sim: number, margin: number, rule: EmbedRule = embedRule()): number | null {
  if (sim < rule.floor) return null;
  const auto = (sim >= rule.autoSim && margin >= rule.autoMargin) || (sim >= rule.wideSim && margin >= rule.wideMargin);
  let c = auto ? 0.95 : sim >= 0.75 && margin >= 0.02 ? 0.85 : 0.7;
  if (margin < 0.02) c = Math.min(c, 0.7); // reprint / alt-art near-tie
  return c;
}

export function cosine(a: Float32Array, b: Float32Array, offset = 0): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[offset + i];
  return s; // both are unit length
}

export function toBytes(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
export function fromBytes(b: Buffer): Float32Array {
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
