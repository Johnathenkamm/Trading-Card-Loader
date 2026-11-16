// Replays a real client batch against a dumped copy of the prod photo-hash
// index, to measure matcher changes on the photos that actually failed.
//
//   node src/bench/client-batch.ts [dir]      (default data/bench/client-batch8)
//
// The dir holds photos/<id>.jpg, truth.json ({id: [name, number, set]}) and
// prod-hash-index.json (rows of card_image_hashes joined to card/set/game,
// dumped over `railway ssh`). Nothing here touches a database.
//
// Columns: before = the photo as uploaded against every game (prod until Nov
// 2026); now = what HashProvider does today (margin-trimmed photo too, and an
// "Any game" + EN batch skips the Japanese edition); pokemon = now, with the
// batch's Database set to Pokémon.

import fs from "node:fs";
import path from "node:path";
import { hashPhoto, hashDistance, fromHex, type ImageHashes, type PhotoHashes } from "../imagehash.ts";
import { photoGamePool } from "../app/vision.ts";

type Row = { id: number; g: string; n: string; num: string | null; s: string; h: ImageHashes };

const dir = process.argv[2] ?? "data/bench/client-batch8";
const truth = JSON.parse(fs.readFileSync(path.join(dir, "truth.json"), "utf8")) as Record<string, [string, string, string]>;
const raw = JSON.parse(fs.readFileSync(path.join(dir, "prod-hash-index.json"), "utf8")) as Array<{ id: number; g: string; n: string; num: string | null; s: string; d: string; a: string; di: string; ai: string }>;
const index: Row[] = raw.map((r) => ({
  id: r.id, g: r.g, n: r.n, num: r.num, s: r.s,
  h: { full: { dhash: fromHex(r.d), ahash: fromHex(r.a) }, inset: { dhash: fromHex(r.di), ahash: fromHex(r.ai) } },
}));

const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isRight = (r: Row, t: [string, string, string]) => r.g === "pokemon" && norm(r.n).startsWith(norm(t[0])) && norm(r.num) === norm(t[1]);
const poolOf = (opts: { game?: string; language?: string }) => {
  const p = photoGamePool(opts);
  return index.filter((r) => (p.only ? r.g === p.only : !p.exclude.has(r.g)));
};

const runs: Array<{ name: string; pool: Row[]; trim: boolean }> = [
  { name: "before", pool: index, trim: false },
  { name: "now", pool: poolOf({ language: "EN" }), trim: true },
  { name: "pokemon", pool: poolOf({ game: "pokemon" }), trim: true },
];

function best(q: PhotoHashes, pool: Row[], trim: boolean) {
  let b: { r: Row; d: number } | null = null;
  for (const r of pool) {
    const d = trim && q.trimmed ? Math.min(hashDistance(q.photo, r.h), hashDistance(q.trimmed, r.h)) : hashDistance(q.photo, r.h);
    if (!b || d < b.d) b = { r, d };
  }
  return b!;
}

const ids = Object.keys(truth).filter((k) => !k.startsWith("_"));
const score: Record<string, { right: number; auto: number; autoWrong: number }> = {};
let trimmedN = 0;
for (const id of ids) {
  const t = truth[id];
  const q = await hashPhoto(fs.readFileSync(path.join(dir, "photos", `${id}.jpg`)));
  if (q.trimmed) trimmedN++;
  const cells: string[] = [];
  for (const run of runs) {
    const b = best(q, run.pool, run.trim);
    const ok = isRight(b.r, t);
    const s = (score[run.name] ??= { right: 0, auto: 0, autoWrong: 0 });
    if (ok) s.right++;
    if (b.d <= 6) { s.auto++; if (!ok) s.autoWrong++; }
    cells.push(`${run.name}=${ok ? "OK" : `${b.r.g}:${b.r.n} ${b.r.num ?? ""}`} d${b.d}`);
  }
  console.log(`${id} ${t[0]} ${t[1]} | ${cells.join(" | ")}`);
}
console.log(`\n${ids.length} photos (${trimmedN} had a margin to trim). right = top-1 correct; auto = d<=6 (would auto-match)`);
for (const [k, s] of Object.entries(score)) console.log(`${k.padEnd(8)} right ${String(s.right).padStart(2)}/${ids.length}   auto ${s.auto} (wrong ${s.autoWrong})`);
