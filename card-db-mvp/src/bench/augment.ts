// Synthetic "phone photo" generator for the identification benchmark.
//
// test-cards/ is clean catalog art, which flatters every matcher (the query IS
// the reference). Until real photos are labelled, this turns a reference image
// into the failure modes real uploads have — background, tilt/perspective,
// glare, blur + heavy JPEG, colour cast — deterministically (seeded), and
// records where the card's corners landed so the harness can also measure an
// "ideal crop" (what a perfect find-and-straighten step 1 would give).
//
// Drop real background photos (desk, playmat, binder page …) into
// data/bench/backgrounds/*.jpg to use them instead of the procedural ones.

import { Jimp } from "jimp";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Bitmap = { width: number; height: number; data: Buffer };
export type Pt = [number, number];
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

export const CANVAS_W = 1200;
export const CANVAS_H = 1600; // what the browser-side resize sends (≤1600 px)

// ---- seeded randomness ------------------------------------------------------

/** FNV-1a over the parts, so (seed, card, condition) always gives the same photo. */
export function seedOf(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
function gauss(r: Rng): number {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// ---- perspective ------------------------------------------------------------

/** 3x3 homography (h33 = 1) taking each `from` corner onto the matching `to` corner. */
export function homography(from: Quad, to: Quad): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

function apply(h: number[], x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + 1;
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

function rectQuad(w: number, h: number): Quad {
  return [[0, 0], [w, 0], [w, h], [0, h]];
}

/** Bilinear sample of src at (x, y) into out[o..o+3]; false when outside. */
function sample(src: Bitmap, x: number, y: number, out: Buffer, o: number): boolean {
  if (x < 0 || y < 0 || x > src.width - 1 || y > src.height - 1) return false;
  const x0 = Math.min(Math.floor(x), src.width - 2);
  const y0 = Math.min(Math.floor(y), src.height - 2);
  const fx = x - x0;
  const fy = y - y0;
  const d = src.data;
  const i00 = (y0 * src.width + x0) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + src.width * 4;
  const i11 = i01 + 4;
  for (let c = 0; c < 4; c++) {
    const top = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx;
    const bot = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
    out[o + c] = top + (bot - top) * fy;
  }
  return true;
}

/** Paint the whole of `src` into `dst` so its corners land on `quad`. */
export function warpInto(dst: Bitmap, src: Bitmap, quad: Quad): void {
  const inv = homography(quad, rectQuad(src.width - 1, src.height - 1));
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(dst.width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(dst.height - 1, Math.ceil(Math.max(...ys)));
  const px = Buffer.alloc(4);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [sx, sy] = apply(inv, x, y);
      if (!sample(src, sx, sy, px, 0)) continue;
      const o = (y * dst.width + x) * 4;
      const a = px[3] / 255; // PNG reference art can have transparent corners
      for (let c = 0; c < 3; c++) dst.data[o + c] = px[c] * a + dst.data[o + c] * (1 - a);
      dst.data[o + 3] = 255;
    }
  }
}

/** Cut `quad` out of `src` and straighten it into a w x h rectangle. */
export function unwarp(src: Bitmap, quad: Quad, w: number, h: number): Bitmap {
  const fwd = homography(rectQuad(w - 1, h - 1), quad);
  const out: Bitmap = { width: w, height: h, data: Buffer.alloc(w * h * 4, 255) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = apply(fwd, x, y);
      sample(src, sx, sy, out.data, (y * w + x) * 4);
    }
  }
  return out;
}

// ---- backgrounds ------------------------------------------------------------

const BG_DIR = join(import.meta.dirname, "../../data/bench/backgrounds");
let bgFiles: string[] | null = null;

async function background(r: Rng): Promise<Bitmap> {
  if (bgFiles == null) {
    bgFiles = existsSync(BG_DIR) ? readdirSync(BG_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => join(BG_DIR, f)) : [];
  }
  if (bgFiles.length > 0) {
    const img = await Jimp.read(readFileSync(bgFiles[Math.floor(r() * bgFiles.length)]));
    img.cover({ w: CANVAS_W, h: CANVAS_H });
    return { width: CANVAS_W, height: CANVAS_H, data: Buffer.from(img.bitmap.data) };
  }
  // Procedural: wood grain, a plain desk with a light falloff, or a blotchy playmat.
  const kind = Math.floor(r() * 3);
  const base = [between(r, 30, 220), between(r, 30, 200), between(r, 30, 190)];
  if (kind === 0) [base[0], base[1], base[2]] = [between(r, 110, 170), between(r, 70, 110), between(r, 40, 70)];
  const f1 = between(r, 0.004, 0.012);
  const f2 = between(r, 0.02, 0.06);
  const ph = between(r, 0, 6.28);
  const out: Bitmap = { width: CANVAS_W, height: CANVAS_H, data: Buffer.alloc(CANVAS_W * CANVAS_H * 4) };
  for (let y = 0; y < CANVAS_H; y++) {
    for (let x = 0; x < CANVAS_W; x++) {
      let m: number;
      if (kind === 0) m = 1 + 0.18 * Math.sin(y * f2 + Math.sin(x * f1 + ph) * 3) + 0.06 * Math.sin(y * f2 * 7.3);
      else if (kind === 1) m = 1.1 - 0.35 * Math.hypot(x / CANVAS_W - 0.5, y / CANVAS_H - 0.4);
      else m = 1 + 0.2 * Math.sin(x * f1 * 1.7 + ph) * Math.sin(y * f1 * 1.3 - ph);
      const o = (y * CANVAS_W + x) * 4;
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.max(0, Math.min(255, base[c] * m));
      out.data[o + 3] = 255;
    }
  }
  return out;
}

// ---- conditions -------------------------------------------------------------

type Spec = {
  scale: [number, number]; // card height as a fraction of the canvas
  rot: number; // max in-plane rotation, degrees
  persp: number; // max corner jitter as a fraction of card width (tilt)
  glare: boolean;
  light: number; // strength of a directional lighting falloff
  blur: [number, number]; // box-blur radius in px (0 = none)
  noise: number; // sensor noise sigma (0..255)
  cast: boolean; // white-balance shift
  jpeg: number; // output JPEG quality
};

const SPECS: Record<string, Spec> = {
  background: { scale: [0.6, 0.8], rot: 6, persp: 0, glare: false, light: 0, blur: [0, 0], noise: 0, cast: false, jpeg: 88 },
  tilt: { scale: [0.6, 0.8], rot: 15, persp: 0.12, glare: false, light: 0.1, blur: [0, 0], noise: 2, cast: false, jpeg: 85 },
  glare: { scale: [0.65, 0.82], rot: 5, persp: 0.04, glare: true, light: 0.25, blur: [0, 0], noise: 2, cast: false, jpeg: 85 },
  blur: { scale: [0.6, 0.8], rot: 5, persp: 0.03, glare: false, light: 0.1, blur: [3, 6], noise: 6, cast: false, jpeg: 45 },
  phone: { scale: [0.55, 0.8], rot: 12, persp: 0.1, glare: true, light: 0.3, blur: [1, 3], noise: 4, cast: true, jpeg: 75 },
};

export const CONDITIONS = ["clean", ...Object.keys(SPECS)];

export type Synthetic = { jpeg: Buffer; corners: Quad; bitmap: Bitmap };

/**
 * Render one synthetic photo of `card` (an encoded reference image) under
 * `condition`. "clean" is the reference stretched to the canvas — the same
 * thing test-cards/ already contains, kept as the baseline.
 */
export async function synthesize(card: Buffer, condition: string, seed: number): Promise<Synthetic> {
  const r = rng(seed);
  const src = await Jimp.read(card);
  if (condition === "clean") {
    src.resize({ w: CANVAS_W, h: CANVAS_H });
    const bitmap = { width: CANVAS_W, height: CANVAS_H, data: Buffer.from(src.bitmap.data) };
    const jpeg = await Jimp.fromBitmap(bitmap).getBuffer("image/jpeg", { quality: 90 });
    return { jpeg, corners: rectQuad(CANVAS_W - 1, CANVAS_H - 1), bitmap };
  }
  const spec = SPECS[condition];
  if (!spec) throw new Error(`unknown condition "${condition}" (have: ${CONDITIONS.join(", ")})`);

  const card0: Bitmap = { width: src.bitmap.width, height: src.bitmap.height, data: Buffer.from(src.bitmap.data) };
  const dst = await background(r);

  // Place: scale, centre offset, rotate, then jitter each corner for tilt.
  const ch = between(r, spec.scale[0], spec.scale[1]) * CANVAS_H;
  const cw = ch * (card0.width / card0.height);
  const cx = CANVAS_W / 2 + between(r, -0.08, 0.08) * CANVAS_W;
  const cy = CANVAS_H / 2 + between(r, -0.06, 0.06) * CANVAS_H;
  const a = (between(r, -spec.rot, spec.rot) * Math.PI) / 180;
  const corners = ([[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]] as Pt[]).map(([x, y]) => {
    const jx = between(r, -spec.persp, spec.persp) * cw;
    const jy = between(r, -spec.persp, spec.persp) * cw;
    return [cx + x * Math.cos(a) - y * Math.sin(a) + jx, cy + x * Math.sin(a) + y * Math.cos(a) + jy] as Pt;
  }) as Quad;
  warpInto(dst, card0, corners);

  // Lighting falloff, glare hotspot, colour cast, sensor noise — one pass.
  const dir = between(r, 0, 2 * Math.PI);
  const gx = between(r, 0.3, 0.7) * CANVAS_W;
  const gy = between(r, 0.25, 0.65) * CANVAS_H;
  const gr = between(r, 0.12, 0.25) * cw;
  const gi = between(r, 0.6, 0.95);
  const cast = spec.cast ? [1 + between(r, -0.08, 0.08), 1, 1 + between(r, -0.1, 0.1)] : [1, 1, 1];
  const d = dst.data;
  const cosD = Math.cos(dir) / CANVAS_W;
  const sinD = Math.sin(dir) / CANVAS_H;
  const reach2 = (3 * gr) ** 2; // the hotspot is ~0 beyond 3 sigma; skip the exp there
  for (let y = 0; y < CANVAS_H; y++) {
    const dy2 = ((y - gy) * 1.6) ** 2;
    for (let x = 0; x < CANVAS_W; x++) {
      const o = (y * CANVAS_W + x) * 4;
      const lit = 1 - spec.light * ((x - CANVAS_W / 2) * cosD + (y - CANVAS_H / 2) * sinD + 0.5);
      const d2 = (x - gx) ** 2 + dy2;
      const g = spec.glare && d2 < reach2 ? gi * Math.exp(-d2 / (2 * gr * gr)) : 0;
      const n = spec.noise ? gauss(r) * spec.noise : 0; // luminance noise, shared by the channels
      for (let c = 0; c < 3; c++) {
        let v = d[o + c] * lit * cast[c];
        v += (255 - v) * g + n;
        d[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }

  const img = Jimp.fromBitmap(dst);
  const radius = Math.round(between(r, spec.blur[0], spec.blur[1]));
  if (radius > 0) img.blur(radius);
  const jpeg = await img.getBuffer("image/jpeg", { quality: spec.jpeg });
  // Decode what we actually wrote so the ideal crop sees the same pixels as the matcher.
  const back = await Jimp.read(jpeg);
  return { jpeg, corners, bitmap: { width: back.bitmap.width, height: back.bitmap.height, data: Buffer.from(back.bitmap.data) } };
}

export async function encodeJpeg(b: Bitmap, quality = 90): Promise<Buffer> {
  return Jimp.fromBitmap(b).getBuffer("image/jpeg", { quality });
}
