// End-to-end check of the configured vision provider on bench:id's synthetic
// photos: runs each through visionIdentify() — the exact path an upload takes
// (provider → catalog lookup → confidence → matched / needs_review) — and
// tallies right card, auto-matched, and wrong auto-matches per condition.
//
// Run after `npm run bench:id` (it renders the photos) and building the index:
//   VISION_PROVIDER=embed node --env-file-if-exists=.env src/bench/provider-check.ts [game]
// No game: all MTG photos + 20 Pokémon clean/phone photos.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { query, close } from "../pg.ts";
import { visionIdentify } from "../app/vision.ts";
import { BENCH_DIR } from "./methods.ts";
const dir = join(BENCH_DIR, "queries", "seed1");
const files = readdirSync(dir).filter((f) => f.endsWith(".jpg"));
const ids = [...new Set(files.map((f) => Number(f.split("-")[0])))];
const games = new Map(((await query(`SELECT c.id::int id, g.slug FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id WHERE c.id = ANY($1)`, [ids])) as any[]).map((r) => [r.id, r.slug]));
const pick = (game: string) => files.filter((f) => games.get(Number(f.split("-")[0])) === game);
const tally = new Map<string, { n: number; right: number; auto: number; autoWrong: number; ms: number; methods: Record<string, number> }>();
const only = process.argv[2];
const runs: Array<[string, string[]]> = only ? [[only, pick(only)]] : [["mtg", pick("mtg")], ["pokemon", pick("pokemon").filter((f) => /-(clean|phone)\.jpg$/.test(f)).slice(0, 20)]];
for (const [game, list] of runs) {
  for (const f of list) {
    const truth = Number(f.split("-")[0]);
    const cond = f.replace(".jpg", "").split("-")[1];
    const t = Date.now();
    const r = await visionIdentify({ data: readFileSync(join(dir, f)), filename: "IMG_1234.jpg", contentType: "image/jpeg" }, { game });
    const k = `${game}/${cond}`;
    const s = tally.get(k) ?? { n: 0, right: 0, auto: 0, autoWrong: 0, ms: 0, methods: {} };
    const ok = r.result.best?.card_id === truth;
    s.n++; s.ms += Date.now() - t;
    if (ok) s.right++;
    if (r.result.status === "matched") { s.auto++; if (!ok) s.autoWrong++; }
    const m = String((r.vision?.raw as any)?.method ?? r.vision?.provider ?? r.source);
    s.methods[m] = (s.methods[m] ?? 0) + 1;
    tally.set(k, s);
  }
}
for (const [k, s] of [...tally].sort()) console.log(k.padEnd(18), `right ${s.right}/${s.n}`, `auto-matched ${s.auto} (wrong ${s.autoWrong})`, `${Math.round(s.ms / s.n)} ms`, JSON.stringify(s.methods));
await close();
