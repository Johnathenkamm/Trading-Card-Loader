// Regression check for the margin trim (imagehash.ts hashPhoto): runs bench:id's
// synthetic photos against the LOCAL hash index, photo-only vs photo-or-trimmed,
// and counts right top-1 and wrong auto-matches (d <= 6) per condition.
//
//   node --env-file-if-exists=.env src/bench/trim-check.ts

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { query, close } from "../pg.ts";
import { hashPhoto, hashDistance, fromHex, type ImageHashes } from "../imagehash.ts";
import { BENCH_DIR } from "./methods.ts";

const dir = join(BENCH_DIR, "queries", "seed1");
const rows = ((await query(
  `SELECT h.card_id::int id, h.dhash, h.ahash, h.dhash_inset, h.ahash_inset FROM card_image_hashes h
   JOIN cards c ON c.id=h.card_id JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id WHERE g.slug <> 'pokemon-jp'`
)) as any[]).map((r) => ({ id: r.id as number, h: { full: { dhash: fromHex(r.dhash), ahash: fromHex(r.ahash) }, inset: { dhash: fromHex(r.dhash_inset), ahash: fromHex(r.ahash_inset) } } as ImageHashes }));

const tally = new Map<string, { n: number; trimmed: number; before: number; after: number; beforeAutoWrong: number; afterAutoWrong: number; beforeAuto: number; afterAuto: number }>();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".jpg"))) {
  const truth = Number(f.split("-")[0]);
  const cond = f.replace(".jpg", "").split("-")[1];
  const q = await hashPhoto(readFileSync(join(dir, f)));
  let b0 = { id: -1, d: 1e9 }, b1 = { id: -1, d: 1e9 };
  for (const r of rows) {
    const d0 = hashDistance(q.photo, r.h);
    const d1 = q.trimmed ? Math.min(d0, hashDistance(q.trimmed, r.h)) : d0;
    if (d0 < b0.d) b0 = { id: r.id, d: d0 };
    if (d1 < b1.d) b1 = { id: r.id, d: d1 };
  }
  const s = tally.get(cond) ?? { n: 0, trimmed: 0, before: 0, after: 0, beforeAutoWrong: 0, afterAutoWrong: 0, beforeAuto: 0, afterAuto: 0 };
  s.n++;
  if (q.trimmed) s.trimmed++;
  if (b0.id === truth) s.before++;
  if (b1.id === truth) s.after++;
  if (b0.d <= 6) { s.beforeAuto++; if (b0.id !== truth) s.beforeAutoWrong++; }
  if (b1.d <= 6) { s.afterAuto++; if (b1.id !== truth) s.afterAutoWrong++; }
  tally.set(cond, s);
}
console.log("condition      n  trimmed  right before→after  auto before→after (wrong before→after)");
for (const [c, s] of [...tally].sort()) console.log(`${c.padEnd(12)} ${String(s.n).padStart(4)} ${String(s.trimmed).padStart(8)}   ${s.before}→${s.after}   ${s.beforeAuto}→${s.afterAuto} (${s.beforeAutoWrong}→${s.afterAutoWrong})`);
await close();
