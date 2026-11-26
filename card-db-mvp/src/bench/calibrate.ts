// Threshold calibration for the embed provider, from a bench:id run's caches.
//
// For every synthetic query it looks at two situations:
//   in-catalog   the true card is in the gallery — the best match's similarity
//                and its margin over the runner-up when the match is right
//   not-in-catalog  the true card removed — how similar the nearest WRONG card
//                looks (a card we don't carry yet must not auto-match)
// and prints percentiles plus what a (min similarity, min margin) rule would
// auto-match and get wrong.
//
// Run after `npm run bench:id` (same seed/limit):
//   node --env-file-if-exists=.env src/bench/calibrate.ts [--model siglip2:<id>[@dtype]]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { query, close } from "../pg.ts";
import { BENCH_DIR, FeatureCache, sha1, siglip2 } from "./methods.ts";
import { cosine, embedConfidence, embedRule, type EmbedRule } from "../app/embedding.ts";
import { quantize } from "../app/embedindex.ts";

const { values: args } = parseArgs({ options: { dtype: { type: "string", default: "fp32" }, seed: { type: "string", default: "1" }, "show-impostors": { type: "boolean" } } });
const method = siglip2(undefined, args.dtype);
const cache = new FeatureCache(method);

const galleryDir = join(BENCH_DIR, "gallery");
const gallery = new Map<number, Float32Array>();
for (const f of readdirSync(galleryDir)) {
  const v = cache.get(sha1(readFileSync(join(galleryDir, f))));
  if (v) gallery.set(Number(f.split("-")[0]), v as Float32Array);
}
const cardRows = (await query(`SELECT c.id::int AS id, c.name, c.number FROM cards c WHERE c.id = ANY($1)`, [[...gallery.keys()]])) as Array<{ id: number; name: string; number: string | null }>;
const twinKey = new Map(cardRows.map((r) => [r.id, `${r.name.toLowerCase()}#${(r.number ?? "").replace(/^0+/, "")}`]));
const games = new Map(
  ((await query(`SELECT c.id::int AS id, g.slug FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id WHERE c.id = ANY($1)`, [[...gallery.keys()]])) as Array<{ id: number; slug: string }>).map((r) => [r.id, r.slug])
);

type Q = { truth: number; cond: string; v: Float32Array };
const qDir = join(BENCH_DIR, "queries", `seed${args.seed}`);
const queries: Q[] = [];
for (const f of readdirSync(qDir).filter((f) => f.endsWith(".jpg"))) {
  const v = cache.get(sha1(readFileSync(join(qDir, f))));
  const [id, cond] = f.replace(".jpg", "").split("-");
  if (v && gallery.has(Number(id))) queries.push({ truth: Number(id), cond, v: v as Float32Array });
}

type Row = { id: number; best: number; margin: number; right: boolean };
function rank(q: Q, exclude: number | null): Row {
  const g = games.get(q.truth);
  let b = { id: -1, s: -2 };
  let s2 = -2;
  for (const [id, v] of gallery) {
    if (id === exclude || games.get(id) !== g) continue;
    const s = cosine(q.v, v);
    if (s > b.s) {
      s2 = b.s;
      b = { id, s };
    } else if (s > s2) s2 = s;
  }
  return { id: b.id, best: b.s, margin: b.s - s2, right: b.id === q.truth };
}

const inCat = queries.map((q) => rank(q, null));
const outCat = queries.map((q) => rank(q, q.truth));
const pctl = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const f3 = (x: number) => x.toFixed(3);
const right = inCat.filter((r) => r.right);
console.log(`${method.id}: ${queries.length} queries, gallery ${gallery.size}`);
console.log(`in-catalog, right matches (${right.length}): best sim p5 ${f3(pctl(right.map((r) => r.best), 0.05))} p50 ${f3(pctl(right.map((r) => r.best), 0.5))}; margin p5 ${f3(pctl(right.map((r) => r.margin), 0.05))} p50 ${f3(pctl(right.map((r) => r.margin), 0.5))}`);
console.log(`not-in-catalog (nearest wrong card): best sim p50 ${f3(pctl(outCat.map((r) => r.best), 0.5))} p95 ${f3(pctl(outCat.map((r) => r.best), 0.95))} max ${f3(Math.max(...outCat.map((r) => r.best)))}; margin p95 ${f3(pctl(outCat.map((r) => r.margin), 0.95))}`);
// The shipped rule (embedding.ts) and variants, per game: auto-matched share,
// how many of those were wrong, and how many not-in-catalog photos would have
// auto-matched (to a wrong card) under the same rule.
const base = embedRule();
const variants: Array<[string, EmbedRule]> = [
  ["shipped", base],
  ["tier 1 only", { ...base, wideMargin: 9 }],
  ["auto margin 0.07", { ...base, autoMargin: 0.07 }],
  ["auto margin 0.08", { ...base, autoMargin: 0.08 }],
  ["wide margin 0.08", { ...base, wideMargin: 0.08 }],
  ["wide margin 0.12", { ...base, wideMargin: 0.12 }],
  ["wide sim 0.6", { ...base, wideSim: 0.6 }],
];
const gameOf = queries.map((q) => games.get(q.truth)!);
console.log(`\nrule → per game: in-catalog auto-matched (wrong) · not-in-catalog wrongly auto-matched`);
for (const [name, rule] of variants) {
  const parts: string[] = [];
  for (const g of [...new Set(gameOf)].sort()) {
    const ix = queries.map((_, i) => i).filter((i) => gameOf[i] === g);
    const auto = ix.filter((i) => embedConfidence(inCat[i].best, inCat[i].margin, rule) === 0.95);
    const wrong = auto.filter((i) => !inCat[i].right).length;
    const outIx = ix.filter((i) => embedConfidence(outCat[i].best, outCat[i].margin, rule) === 0.95);
    const twins = outIx.filter((i) => twinKey.get(outCat[i].id) === twinKey.get(queries[i].truth)).length;
    parts.push(`${g} ${((100 * auto.length) / ix.length).toFixed(1)}% (${wrong} wrong) · ${((100 * outIx.length) / ix.length).toFixed(1)}% (${twins}/${outIx.length} same card, other printing)`);
  }
  console.log(`  ${name.padEnd(18)} ${parts.join("   ")}`);
}
const dropped = inCat.filter((r) => r.right && embedConfidence(r.best, r.margin, base) == null).length;
console.log(`right matches below the floor (${base.floor}, would return no match): ${dropped}/${right.length}`);

// int8 storage (embedindex.ts quantize): similarity error vs float32.
let maxErr = 0;
for (const q of queries.slice(0, 60)) {
  for (const [, v] of [...gallery].slice(0, 200)) {
    const { bytes, scale } = quantize(v);
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += q.v[i] * bytes.readInt8(i);
    maxErr = Math.max(maxErr, Math.abs(dot / scale - cosine(q.v, v)));
  }
}
console.log(`int8 storage: max similarity error ${maxErr.toFixed(4)} (60 queries x 200 cards)`);
const byCond = new Map<string, Row[]>();
queries.forEach((q, i) => byCond.set(q.cond, [...(byCond.get(q.cond) ?? []), inCat[i]]));
console.log("\nbest sim of right matches by condition (p5 / p50):", [...byCond].map(([c, rs]) => `${c} ${f3(pctl(rs.filter((r) => r.right).map((r) => r.best), 0.05))}/${f3(pctl(rs.filter((r) => r.right).map((r) => r.best), 0.5))}`).join(", "));
await close();
if (args["show-impostors"]) {
  const names = new Map(cardRows.map((r) => [r.id, `${r.name} ${r.number ?? ""}`]));
  queries.forEach((q, i) => {
    const r = outCat[i];
    if (embedConfidence(r.best, r.margin, base) === 0.95) console.log(`  ${q.cond.padEnd(10)} ${names.get(q.truth)} → ${names.get(r.id)}  sim ${f3(r.best)} margin ${f3(r.margin)}`);
  });
}
