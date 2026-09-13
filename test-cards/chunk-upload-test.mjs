// End-to-end check of the chunked photo upload (start → chunk… → finish) against
// the local dev server, as the throwaway seller uploader-test@local (id 15).
// Run from card-db-mvp with the dev server on :5173:
//   node --env-file=.env ../test-cards/chunk-upload-test.mjs
import pg from "file:///C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/node_modules/pg/lib/index.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const BASE = "http://127.0.0.1:5173";
const IMG_DIR = "C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/neutral";
const SELLER = 15; // uploader-test@local

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const token = randomBytes(32).toString("base64url");
await db.query("INSERT INTO sessions(token, seller_id, expires_at) VALUES ($1,$2,now()+interval '1 hour')", [token, SELLER]);
const cookie = `cardindex_session=${token}`;

const files = readdirSync(IMG_DIR).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
console.log(`${files.length} test images`);

function fields(extra = {}) {
  const fd = new FormData();
  fd.set("mode", "inventory");
  fd.set("label", "chunk test");
  fd.set("condition", "NM");
  fd.set("language", "en");
  fd.set("rule", "market");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
async function post(path, fd) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { method: "POST", body: fd, headers: { cookie, accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, ms: Date.now() - t0 };
}
const expect = (name, ok, detail) => console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);

// ---- happy path: 50 photos in chunks of 20 ----
let r = await post("/app/scan/upload/start", fields());
expect("start opens a batch", r.status === 200 && r.body.batchId > 0 && r.body.max === 500 && r.body.chunk === 20, JSON.stringify(r.body));
const batchId = r.body.batchId;

let sent = 0;
for (let i = 0; i < files.length; i += 20) {
  const group = files.slice(i, i + 20);
  const fd = fields();
  for (const f of group) fd.append("images", new Blob([readFileSync(join(IMG_DIR, f))], { type: "image/png" }), f);
  r = await post(`/app/scan/upload/${batchId}/chunk`, fd);
  sent += group.length;
  expect(`chunk ${group.length} photos`, r.status === 200 && r.body.added === group.length && r.body.total === sent, `${JSON.stringify(r.body)} in ${r.ms} ms`);
}
r = await post(`/app/scan/upload/${batchId}/finish`, fields());
expect("finish lands on review", r.status === 200 && r.body.landing === `/app/review/${batchId}` && r.body.total === 50, JSON.stringify(r.body));

const b = (await db.query("SELECT status,total,processed FROM scan_batches WHERE id=$1", [batchId])).rows[0];
const items = (await db.query("SELECT status, COUNT(*)::int n FROM scan_items WHERE batch_id=$1 GROUP BY status", [batchId])).rows;
expect("batch row done with 50/50", b.status === "done" && b.total === 50 && b.processed === 50, JSON.stringify(b));
console.log("      items by status:", items.map((x) => `${x.status}=${x.n}`).join(", "));
const page = await fetch(BASE + `/app/review/${batchId}`, { headers: { cookie } });
expect("review page renders", page.status === 200, `HTTP ${page.status}`);

// ---- guards ----
r = await post(`/app/scan/upload/${batchId}/chunk`, fields());
expect("chunk into a closed batch is refused", r.status === 404, JSON.stringify(r.body));

r = await post("/app/scan/upload/start", fields());
const empty = r.body.batchId;
r = await post(`/app/scan/upload/${empty}/finish`, fields());
expect("finish with no photos is refused", r.status === 400, JSON.stringify(r.body));

// cap: pretend the batch already holds 499
await db.query("UPDATE scan_batches SET total=499, processed=499 WHERE id=$1", [empty]);
let fd = fields();
for (const f of files.slice(0, 2)) fd.append("images", new Blob([readFileSync(join(IMG_DIR, f))], { type: "image/png" }), f);
r = await post(`/app/scan/upload/${empty}/chunk`, fd);
expect("cap trims a chunk to the room left (1 of 2)", r.status === 200 && r.body.added === 1 && r.body.total === 500, JSON.stringify(r.body));
r = await post(`/app/scan/upload/${empty}/chunk`, fd);
expect("full batch refuses more", r.status === 409, JSON.stringify(r.body));
await db.query("DELETE FROM scan_items WHERE batch_id=$1", [empty]);
await db.query("DELETE FROM scan_batches WHERE id=$1", [empty]);

// someone else's batch
r = await post(`/app/scan/upload/999999/chunk`, fields());
expect("unknown batch is refused", r.status === 404);

// ---- Free tier: inventory gated, price-only allowed with the 100 cap ----
await db.query("UPDATE sellers SET plan_tier='free' WHERE id=$1", [SELLER]);
r = await post("/app/scan/upload/start", fields());
expect("Free: inventory start is paywalled", r.status === 402 && r.body.redirect === "/pricing?upgrade=1", JSON.stringify(r.body));
r = await post("/app/scan/upload/start", fields({ mode: "price" }));
expect("Free: price-only start works with cap 100", r.status === 200 && r.body.max === 100, JSON.stringify(r.body));
await db.query("DELETE FROM scan_batches WHERE id=$1", [r.body.batchId]);
await db.query("UPDATE sellers SET plan_tier='pro' WHERE id=$1", [SELLER]);

console.log(`\nbatch ${batchId} kept for the UI check; session cookie: ${cookie}`);
await db.end();
