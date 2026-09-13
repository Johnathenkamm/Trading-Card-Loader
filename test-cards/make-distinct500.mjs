// Build a 500-photo test set of 500 DIFFERENT catalog cards: fetch each card's
// reference image (the one the hash index was built from), upscale it to the
// 1200x1600 size a browser-side resize would send, and save it under a neutral
// camera-style name. Writes distinct500.txt (file|card_id|name|set|number).
// Run from card-db-mvp: node --env-file=.env ../test-cards/make-distinct500.mjs
import pg from "file:///C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/node_modules/pg/lib/index.js";
import { Jimp } from "file:///C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/node_modules/jimp/dist/esm/index.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/distinct500";
const N = 500;
mkdirSync(OUT, { recursive: true });

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
// Alternate games so the set isn't all one TCG; order by id for a stable pick.
const rows = (await db.query(
  `SELECT c.id, c.name, c.number, s.name AS set_name, g.name AS game, h.image_url
   FROM card_image_hashes h JOIN cards c ON c.id=h.card_id JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
   ORDER BY c.id`
)).rows;
await db.end();
const pick = rows.slice(0, N);
console.log(`${rows.length} hashed cards; using ${pick.length} (${pick.filter((r) => r.game === "Pokemon").length} Pokemon, ${pick.filter((r) => r.game !== "Pokemon").length} Magic)`);

const lines = [];
let done = 0, failed = 0;
const t0 = Date.now();
async function one(i) {
  const r = pick[i];
  const file = `IMG_${String(i + 1).padStart(4, "0")}.jpg`;
  const path = join(OUT, file);
  if (!existsSync(path)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(r.image_url, { headers: { "User-Agent": "CardIndex-test/0.1" }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const img = await Jimp.read(Buffer.from(await res.arrayBuffer()));
        img.resize({ w: 1200, h: 1600 });
        writeFileSync(path, await img.getBuffer("image/jpeg", { quality: 85 }));
        break;
      } catch (e) {
        if (attempt === 2) { failed++; console.log(`  FAILED ${file} ${r.image_url}: ${e.message}`); return; }
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    }
  }
  lines[i] = `${file}|${r.id}|${r.name}|${r.set_name}|${r.number ?? ""}`;
  done++;
  if (done % 50 === 0) console.log(`  ${done}/${pick.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
// modest concurrency: the images come from public CDNs (pokemontcg.io / Scryfall)
const workers = 4;
let next = 0;
await Promise.all(Array.from({ length: workers }, async () => { while (next < pick.length) await one(next++); }));
writeFileSync(join(OUT, "..", "distinct500.txt"), lines.filter(Boolean).join("\n") + "\n");
console.log(`done: ${done} images, ${failed} failed, ${Math.round((Date.now() - t0) / 1000)} s`);
