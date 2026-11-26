// Full-scale calibration: score the benchmark's query photos against the REAL
// stored index (card_embeddings, the whole game) instead of the small bench
// gallery. At catalog scale the runner-up is usually the same card name from
// another set, so margins shrink; this shows which thresholds stay safe there.
//
// Query vectors come from the bench:id cache (fp32 SigLIP 2, same model the
// index was built with), so nothing is re-embedded. Two situations per photo:
//   in-catalog       the true card is in the index
//   not-in-catalog   the true card removed: would we auto-match a wrong card?
//
// Run after `npm run bench:id` and `npm run embed:catalog -- --game <game>`:
//   node --env-file-if-exists=.env src/bench/calibrate-full.ts --game pokemon

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { query, close } from "../pg.ts";
import { BENCH_DIR, FeatureCache, sha1, siglip2 } from "./methods.ts";
import { embedConfidence, embedRule, embedKey, embedConfig, type EmbedRule } from "../app/embedding.ts";

const { values: args } = parseArgs({ options: { game: { type: "string", default: "pokemon" }, seed: { type: "string", default: "1" } } });
const cache = new FeatureCache(siglip2());

const rows = (await query(
  `SELECT e.card_id::int AS id, e.vec, e.scale, c.name, c.number, s.name AS set_name
   FROM card_embeddings e JOIN cards c ON c.id=e.card_id JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
   WHERE g.slug = $1 AND e.model = $2`,
  [args.game, embedKey(embedConfig())]
)) as Array<{ id: number; vec: Buffer; scale: number; name: string; number: string | null; set_name: string }>;
const dim = rows[0]?.vec.length ?? 0;
const vecs = new Int8Array(rows.length * dim);
rows.forEach((r, i) => vecs.set(new Int8Array(r.vec.buffer, r.vec.byteOffset, dim), i * dim));
const pos = new Map(rows.map((r, i) => [r.id, i]));
const base = (n: string) => n.toLowerCase().replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s*-\s.*$/, "").trim();

const qDir = join(BENCH_DIR, "queries", `seed${args.seed}`);
type Q = { truth: number; cond: string; v: Float32Array };
const queries: Q[] = [];
for (const f of readdirSync(qDir).filter((f) => f.endsWith(".jpg"))) {
  const [id, cond] = f.replace(".jpg", "").split("-");
  const v = cache.get(sha1(readFileSync(join(qDir, f))));
  if (v && pos.has(Number(id))) queries.push({ truth: Number(id), cond, v: v as Float32Array });
}
console.log(`${args.game}: ${rows.length} cards in the index, ${queries.length} query photos`);

type Row = { id: number; sim: number; margin: number; right: boolean; sameName: boolean };
function search(q: Q, exclude: number | null): Row {
  let b = -1, bs = -2, ss = -2;
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].id === exclude) continue;
    let dot = 0;
    const o = r * dim;
    for (let i = 0; i < dim; i++) dot += q.v[i] * vecs[o + i];
    const s = dot / rows[r].scale;
    if (s > bs) { ss = bs; bs = s; b = r; } else if (s > ss) ss = s;
  }
  const truth = rows[pos.get(q.truth)!];
  return { id: rows[b].id, sim: bs, margin: bs - ss, right: rows[b].id === q.truth, sameName: base(rows[b].name) === base(truth.name) };
}
const inCat = queries.map((q) => search(q, null));
const outCat = queries.map((q) => search(q, q.truth));

const wrong = inCat.filter((r) => !r.right);
console.log(`in-catalog top-1: ${inCat.length - wrong.length}/${inCat.length} right; of the ${wrong.length} wrong, ${wrong.filter((r) => r.sameName).length} were the same card name in another printing`);
console.log(`wrong picks' margins: ${wrong.map((r) => r.margin.toFixed(3)).sort().join(" ")}`);

const now = embedRule();
const variants: Array<[string, EmbedRule]> = [["shipped", now]];
for (const autoMargin of [0.03, 0.04, 0.05]) for (const autoSim of [0.85, 0.88]) variants.push([`sim ${autoSim} margin ${autoMargin}`, { ...now, autoSim, autoMargin }]);
console.log(`\nrule: in-catalog auto-matched (wrong) · not-in-catalog wrongly auto-matched (of which same name, other printing)`);
for (const [name, rule] of variants) {
  const auto = inCat.filter((r) => embedConfidence(r.sim, r.margin, rule) === 0.95);
  const out = outCat.filter((r) => embedConfidence(r.sim, r.margin, rule) === 0.95);
  console.log(`  ${name.padEnd(24)} ${((100 * auto.length) / inCat.length).toFixed(1)}% (${auto.filter((r) => !r.right).length} wrong) · ${((100 * out.length) / outCat.length).toFixed(1)}% (${out.filter((r) => r.sameName).length} same name)`);
}
await close();
