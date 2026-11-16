// Perceptual image hashing for card identification.
//
// The research report (§6) grounds this: production card identifiers are
// image-RETRIEVAL systems, and the proven low-cost baseline is perceptual
// hashing — hash every reference card image once, hash the query photo, and
// the nearest Hamming distance is the match (hobbyist pipelines identify
// standard cards near-perfectly this way; embeddings/pgvector or a Ximilar
// API are the upgrade tiers, and drop in behind the same VisionProvider seam).
//
// Two 64-bit hashes per frame:
//   dHash — 9x8 luminance gradient (adjacent-pixel comparisons). Robust to
//           scaling/compression; the primary distance.
//   aHash — 8x8 mean threshold. Cheap corroborator / tie-break.
// Each image is hashed twice: full frame and an 8% inset crop, so a photo
// with a small border or background sliver still lands near the reference.

import { Jimp } from "jimp";

export type FrameHashes = { dhash: bigint; ahash: bigint };
export type ImageHashes = { full: FrameHashes; inset: FrameHashes };

type AnyImg = Awaited<ReturnType<typeof Jimp.read>>;

function lum(img: AnyImg, x: number, y: number): number {
  const idx = (img.bitmap.width * y + x) * 4;
  const d = img.bitmap.data;
  // Rec. 601 luma — cheaper than a full greyscale() pass over clones
  return 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
}

function dhashOf(img: AnyImg): bigint {
  const small = img.clone().resize({ w: 9, h: 8 });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (lum(small, x, y) > lum(small, x + 1, y) ? 1n : 0n);
    }
  }
  return bits;
}

function ahashOf(img: AnyImg): bigint {
  const small = img.clone().resize({ w: 8, h: 8 });
  const vals: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vals.push(lum(small, x, y));
  const mean = vals.reduce((s, v) => s + v, 0) / 64;
  let bits = 0n;
  for (const v of vals) bits = (bits << 1n) | (v > mean ? 1n : 0n);
  return bits;
}

function frame(img: AnyImg): FrameHashes {
  return { dhash: dhashOf(img), ahash: ahashOf(img) };
}

/** Hash an encoded image (JPEG/PNG/WebP...) — full frame + 8% inset crop. */
export async function hashImage(data: Buffer): Promise<ImageHashes> {
  return hashesOf(await Jimp.read(data));
}

function hashesOf(img: AnyImg): ImageHashes {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const ix = Math.round(w * 0.08);
  const iy = Math.round(h * 0.08);
  const inset =
    w > 20 && h > 20
      ? img.clone().crop({ x: ix, y: iy, w: w - 2 * ix, h: h - 2 * iy })
      : img;
  return { full: frame(img), inset: frame(inset) };
}

/** A query photo's hashes: as uploaded, and with a flat background margin cut away. */
export type PhotoHashes = { photo: ImageHashes; trimmed: ImageHashes | null };

/**
 * Hash an uploaded photo for matching. Catalog art is cropped tight to the
 * card, but a flatbed scan (or a card on a plain table) carries a margin, and
 * that alone puts it 14–18 bits from its own card — as far as unrelated cards
 * (client batch, Nov 2026). So the photo is also hashed with the margin
 * trimmed; the matcher takes the closer of the two.
 */
export async function hashPhoto(data: Buffer): Promise<PhotoHashes> {
  const img = await Jimp.read(data);
  const box = backgroundBox(img);
  return { photo: hashesOf(img), trimmed: box ? hashesOf(img.clone().crop(box)) : null };
}

/**
 * The card's box inside a flat background, or null when there's nothing to
 * trim: the four corners must share one colour (a scanner lid, a plain
 * table), and edge rows/columns are cut while nearly all their pixels still
 * match it. A tight crop (the card's own border reaches the edge) is left alone.
 */
function backgroundBox(img: AnyImg): { x: number; y: number; w: number; h: number } | null {
  const { width: W, height: H, data } = img.bitmap;
  if (W < 40 || H < 40) return null;
  const px = (x: number, y: number) => {
    const i = (W * y + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const patch = (x0: number, y0: number) => {
    const acc = [0, 0, 0];
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) px(x0 + dx, y0 + dy).forEach((v, k) => (acc[k] += v / 16));
    return acc;
  };
  const corners = [patch(0, 0), patch(W - 4, 0), patch(0, H - 4), patch(W - 4, H - 4)];
  const diff = (a: number[], b: number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (diff(corners[i], corners[j]) > 30) return null;
  const bg = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4);
  const TOL = 40; // channel difference that counts as "not background"
  const busy = (n: number, of: number) => n > of * 0.02; // >2% foreground: the card starts here
  const rowBusy = (y: number) => {
    let n = 0;
    for (let x = 0; x < W; x += 2) if (diff(px(x, y), bg) > TOL) n++;
    return busy(n, W / 2);
  };
  const colBusy = (x: number, y0: number, y1: number) => {
    let n = 0;
    for (let y = y0; y < y1; y += 2) if (diff(px(x, y), bg) > TOL) n++;
    return busy(n, (y1 - y0) / 2);
  };
  let top = 0;
  while (top < H / 3 && !rowBusy(top)) top++;
  let bottom = H - 1;
  while (bottom > (2 * H) / 3 && !rowBusy(bottom)) bottom--;
  let left = 0;
  while (left < W / 3 && !colBusy(left, top, bottom)) left++;
  let right = W - 1;
  while (right > (2 * W) / 3 && !colBusy(right, top, bottom)) right--;
  const w = right - left + 1;
  const h = bottom - top + 1;
  // Nothing (or next to nothing) to cut, or the "card" is implausibly small.
  if (w * h > W * H * 0.97 || w < W / 2 || h < H / 2) return null;
  return { x: left, y: top, w, h };
}

/** Set bits in a 32-bit value (SWAR popcount). */
function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}
const LOW32 = 0xffffffffn;

// The matcher runs this 8× per catalog card per photo (60k+ cards with the
// Japanese catalog), so it counts the two 32-bit halves instead of looping
// over 64 BigInt bits.
export function hamming(a: bigint, b: bigint): number {
  const x = a ^ b;
  return popcount32(Number(x & LOW32)) + popcount32(Number(x >> 32n));
}

function frameDistance(qa: FrameHashes, ra: FrameHashes): number {
  return hamming(qa.dhash, ra.dhash) + 0.5 * hamming(qa.ahash, ra.ahash);
}

/**
 * Distance between a query image and a reference, tolerant of cropping
 * differences: the best dHash distance across frame pairings, with the
 * corresponding aHash distance as a weighted corroborator.
 */
export function hashDistance(q: ImageHashes, ref: ImageHashes): number {
  return Math.min(
    frameDistance(q.full, ref.full),
    frameDistance(q.inset, ref.inset),
    frameDistance(q.full, ref.inset),
    frameDistance(q.inset, ref.full)
  );
}

export function toHex(bits: bigint): string {
  return bits.toString(16).padStart(16, "0");
}
export function fromHex(hex: string): bigint {
  return BigInt("0x" + hex);
}
