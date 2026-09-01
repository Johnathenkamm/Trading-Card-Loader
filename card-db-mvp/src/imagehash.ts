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
  const img = await Jimp.read(data);
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

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Distance between a query image and a reference, tolerant of cropping
 * differences: the best dHash distance across frame pairings, with the
 * corresponding aHash distance as a weighted corroborator.
 */
export function hashDistance(q: ImageHashes, ref: ImageHashes): number {
  const pairs: Array<[FrameHashes, FrameHashes]> = [
    [q.full, ref.full],
    [q.inset, ref.inset],
    [q.full, ref.inset],
    [q.inset, ref.full],
  ];
  let best = Infinity;
  for (const [qa, ra] of pairs) {
    const d = hamming(qa.dhash, ra.dhash) + 0.5 * hamming(qa.ahash, ra.ahash);
    if (d < best) best = d;
  }
  return best;
}

export function toHex(bits: bigint): string {
  return bits.toString(16).padStart(16, "0");
}
export function fromHex(hex: string): bigint {
  return BigInt("0x" + hex);
}
