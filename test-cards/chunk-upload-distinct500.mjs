// 500 DIFFERENT cards through the chunked upload, then score identification
// against distinct500.txt (items are created in upload order, so item i ↔ file i).
// Run from card-db-mvp with the dev server on :5173:
//   node --env-file=.env ../test-cards/chunk-upload-distinct500.mjs
import pg from "file:///C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const BASE = "http://127.0.0.1:5173";
const DIR = "C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/distinct500";
const SELLER = 15, CHUNK = 20;

const expected = readFileSync(join(DIR, "..", "distinct500.txt"), "utf8").trim().split(/\r?\n/).map((l) => {
  const [file, id, name, set, number] = l.split("|");
  return { file, id: Number(id), name, set, number };
});
const photos = expected.map((e) => ({ name: e.file, data: readFileSync(join(DIR, e.file)) }));
const N = photos.length;
console.log(`${N} photos of ${new Set(expected.map((e) => e.id)).size} distinct cards, ${(photos.reduce((s, p) => s + p.data.length, 0) / 1e6).toFixed(0)} MB`);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const token = randomBytes(32).toString("base64url");
await db.query("INSERT INTO sessions(token, seller_id, expires_at) VALUES ($1,$2,now()+interval '2 hours')", [token, SELLER]);
const cookie = `cardindex_session=${token}`;

const fields = () => { const fd = new FormData(); fd.set("mode", "inventory"); fd.set("label", "500 distinct cards"); fd.set("condition", "NM"); fd.set("language", "en"); fd.set("rule", "market"); return fd; };
async function post(path, fd) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { method: "POST", body: fd, headers: { cookie, accept: "application/json" } });
  return { status: r.status, body: await r.json().catch(() => ({})), ms: Date.now() - t0 };
}

const T0 = Date.now();
let r = await post("/app/scan/upload/start", fields());
if (r.status !== 200) throw new Error("start failed: " + JSON.stringify(r.body));
const batchId = r.body.batchId;
console.log(`batch ${batchId} opened`);
const times = [];
for (let i = 0; i < N; i += CHUNK) {
  const group = photos.slice(i, i + CHUNK);
  const fd = fields();
  for (const p of group) fd.append("images", new Blob([p.data], { type: "image/jpeg" }), p.name);
  r = await post(`/app/scan/upload/${batchId}/chunk`, fd);
  if (r.status !== 200 || r.body.added !== group.length) throw new Error(`chunk at ${i} failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  times.push(r.ms);
  if (r.body.total % 100 === 0) console.log(`  ${r.body.total} / ${N}  (${r.ms} ms per chunk, ${(r.ms / group.length).toFixed(0)} ms/photo)`);
}
const tUpload = Date.now() - T0;
r = await post(`/app/scan/upload/${batchId}/finish`, fields());
const tFinish = r.ms, tTotal = Date.now() - T0;
console.log(`finish: HTTP ${r.status} ${JSON.stringify(r.body)}`);

// ---- score ----
const items = (await db.query("SELECT id, status, matched_card_id, ai_confidence, dup_of_item_id, raw_input FROM scan_items WHERE batch_id=$1 ORDER BY id", [batchId])).rows;
const cardName = new Map((await db.query("SELECT c.id, c.name, c.number, s.name set_name FROM cards c JOIN sets s ON s.id=c.set_id")).rows.map((c) => [Number(c.id), `${c.name} #${c.number ?? ""} (${c.set_name})`]));
let right = 0, wrong = 0, unmatched = 0;
const wrongs = [];
items.forEach((it, i) => {
  const exp = expected[i];
  const got = it.matched_card_id == null ? null : Number(it.matched_card_id);
  if (got === exp.id) right++;
  else if (got == null) unmatched++;
  else { wrong++; if (wrongs.length < 15) wrongs.push(`  ${exp.file}: expected ${exp.name} #${exp.number} (${exp.set}) → got ${cardName.get(got)} @${it.ai_confidence}`); }
});
const byStatus = (await db.query("SELECT status, COUNT(*)::int n FROM scan_items WHERE batch_id=$1 GROUP BY status ORDER BY n DESC", [batchId])).rows;
const dups = items.filter((x) => x.dup_of_item_id != null).length;
const conf = items.map((x) => Number(x.ai_confidence)).filter((x) => !Number.isNaN(x));
const bands = { ">=0.9": 0, "0.7-0.9": 0, "<0.7": 0 };
conf.forEach((c) => (c >= 0.9 ? bands[">=0.9"]++ : c >= 0.7 ? bands["0.7-0.9"]++ : bands["<0.7"]++));
const t1 = Date.now();
const page = await fetch(BASE + `/app/review/${batchId}`, { headers: { cookie } });
const html = await page.text();

console.log("\n==== RESULTS ====");
console.log(`items: ${items.length}; by status: ${byStatus.map((x) => `${x.status}=${x.n}`).join(", ")}`);
console.log(`identification: ${right} correct, ${wrong} wrong card, ${unmatched} no match  (${((100 * right) / items.length).toFixed(1)}% correct)`);
console.log(`confidence bands: ${JSON.stringify(bands)}; flagged as duplicates: ${dups}`);
if (wrongs.length) console.log("wrong matches (first 15):\n" + wrongs.join("\n"));
console.log(`upload+identify: ${(tUpload / 1000).toFixed(1)} s (${(tUpload / N).toFixed(0)} ms/photo); chunks min/avg/max ${Math.min(...times)}/${(times.reduce((a, c) => a + c, 0) / times.length).toFixed(0)}/${Math.max(...times)} ms; finish ${(tFinish / 1000).toFixed(1)} s; end to end ${(tTotal / 1000).toFixed(1)} s`);
console.log(`review page: HTTP ${page.status}, ${(html.length / 1e6).toFixed(2)} MB, ${Date.now() - t1} ms`);
console.log(`\nbatch ${batchId}; cookie ${cookie}`);
await db.end();
