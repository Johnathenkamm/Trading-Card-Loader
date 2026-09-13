// 500-photo chunked upload against the local dev server, with timing and result stats.
import pg from "file:///C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/node_modules/pg/lib/index.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const BASE = "http://127.0.0.1:5173";
const SRC = "C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/phone";
const SELLER = 15, N = 500, CHUNK = 20;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const token = randomBytes(32).toString("base64url");
await db.query("INSERT INTO sessions(token, seller_id, expires_at) VALUES ($1,$2,now()+interval '2 hours')", [token, SELLER]);
const cookie = `cardindex_session=${token}`;

const srcs = readdirSync(SRC).filter((f) => f.endsWith(".jpg")).sort().map((f) => readFileSync(join(SRC, f)));
const photos = Array.from({ length: N }, (_, i) => ({ name: `IMG_${String(i + 1).padStart(4, "0")}.jpg`, data: srcs[i % srcs.length] }));
const totalBytes = photos.reduce((s, p) => s + p.data.length, 0);
console.log(`${N} photos, ${(totalBytes / 1e6).toFixed(0)} MB total, ${srcs.length} distinct images`);

const fields = () => { const fd = new FormData(); fd.set("mode", "inventory"); fd.set("label", "500-card test"); fd.set("condition", "NM"); fd.set("language", "en"); fd.set("rule", "market"); return fd; };
async function post(path, fd) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { method: "POST", body: fd, headers: { cookie, accept: "application/json" } });
  return { status: r.status, body: await r.json().catch(() => ({})), ms: Date.now() - t0 };
}

const T0 = Date.now();
let r = await post("/app/scan/upload/start", fields());
if (r.status !== 200) throw new Error("start failed: " + JSON.stringify(r.body));
const batchId = r.body.batchId;
console.log(`batch ${batchId} opened (max ${r.body.max}, chunk ${r.body.chunk})`);

const times = [];
for (let i = 0; i < N; i += CHUNK) {
  const group = photos.slice(i, i + CHUNK);
  const fd = fields();
  for (const p of group) fd.append("images", new Blob([p.data], { type: "image/jpeg" }), p.name);
  r = await post(`/app/scan/upload/${batchId}/chunk`, fd);
  if (r.status !== 200 || r.body.added !== group.length) throw new Error(`chunk at ${i} failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  times.push(r.ms);
  process.stdout.write(`  ${String(r.body.total).padStart(3)} / ${N}  chunk ${r.ms} ms  (${(r.ms / group.length).toFixed(0)} ms/photo)\n`);
}
const tUpload = Date.now() - T0;
r = await post(`/app/scan/upload/${batchId}/finish`, fields());
const tFinish = r.ms;
console.log(`finish: HTTP ${r.status} ${JSON.stringify(r.body)} in ${tFinish} ms`);
const tTotal = Date.now() - T0;

const b = (await db.query("SELECT status,total,processed FROM scan_batches WHERE id=$1", [batchId])).rows[0];
const byStatus = (await db.query("SELECT status, COUNT(*)::int n FROM scan_items WHERE batch_id=$1 GROUP BY status ORDER BY n DESC", [batchId])).rows;
const dups = (await db.query("SELECT COUNT(*)::int n FROM scan_items WHERE batch_id=$1 AND dup_of_item_id IS NOT NULL", [batchId])).rows[0].n;
const conf = (await db.query("SELECT MIN(ai_confidence) lo, AVG(ai_confidence) avg, MAX(ai_confidence) hi FROM scan_items WHERE batch_id=$1", [batchId])).rows[0];
const distinct = (await db.query("SELECT COUNT(DISTINCT matched_card_id)::int n FROM scan_items WHERE batch_id=$1 AND matched_card_id IS NOT NULL", [batchId])).rows[0].n;
const titled = (await db.query("SELECT COUNT(*)::int n FROM scan_items WHERE batch_id=$1 AND title IS NOT NULL", [batchId])).rows[0].n;

const t1 = Date.now();
const page = await fetch(BASE + `/app/review/${batchId}`, { headers: { cookie } });
const html = await page.text();
const tPage = Date.now() - t1;

console.log("\n==== RESULTS ====");
console.log(`batch row: ${JSON.stringify(b)}`);
console.log(`upload+identify: ${(tUpload / 1000).toFixed(1)} s for ${N} photos (${(tUpload / N).toFixed(0)} ms/photo); chunks min/avg/max ${Math.min(...times)}/${(times.reduce((a, c) => a + c, 0) / times.length).toFixed(0)}/${Math.max(...times)} ms`);
console.log(`finish (duplicates + totals + titles): ${(tFinish / 1000).toFixed(1)} s; end to end ${(tTotal / 1000).toFixed(1)} s`);
console.log(`items by status: ${byStatus.map((x) => `${x.status}=${x.n}`).join(", ")}`);
console.log(`distinct cards matched: ${distinct}; flagged as duplicates: ${dups}; titled: ${titled}`);
console.log(`confidence min/avg/max: ${conf.lo}/${Number(conf.avg).toFixed(2)}/${conf.hi}`);
console.log(`review page: HTTP ${page.status}, ${(html.length / 1e6).toFixed(2)} MB HTML, server render ${tPage} ms`);
console.log(`\nbatch ${batchId}; cookie ${cookie}`);
await db.end();
