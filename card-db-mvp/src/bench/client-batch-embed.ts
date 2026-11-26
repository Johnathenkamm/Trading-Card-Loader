// Runs a real client batch through visionIdentify() — the exact upload path —
// against the LOCAL catalog and index, and scores it against truth.json.
//
//   VISION_PROVIDER=embed node --env-file-if-exists=.env src/bench/client-batch-embed.ts [dir] [game]
//
// dir defaults to data/bench/client-batch8; game "" = Any game.

import fs from "node:fs";
import path from "node:path";
import { query, close } from "../pg.ts";
import { visionIdentify } from "../app/vision.ts";

const dir = process.argv[2] || "data/bench/client-batch8";
const game = process.argv[3] ?? "";
const truth = JSON.parse(fs.readFileSync(path.join(dir, "truth.json"), "utf8")) as Record<string, [string, string, string]>;
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

let right = 0, auto = 0, autoWrong = 0, ms = 0;
const ids = Object.keys(truth).filter((k) => !k.startsWith("_"));
const methods: Record<string, number> = {};
for (const id of ids) {
  const t = truth[id];
  const t0 = Date.now();
  const r = await visionIdentify({ data: fs.readFileSync(path.join(dir, "photos", `${id}.jpg`)), filename: "image39665.jpg", contentType: "image/jpeg" }, game ? { game } : {});
  ms += Date.now() - t0;
  const b = r.result.best;
  const [row] = b ? ((await query(`SELECT c.name, c.number, g.slug FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id WHERE c.id=$1`, [b.card_id])) as any[]) : [];
  const ok = !!row && row.slug === "pokemon" && norm(row.name).startsWith(norm(t[0])) && norm(row.number) === norm(t[1]);
  const m = String((r.vision?.raw as any)?.method ?? r.vision?.provider ?? r.source);
  methods[m] = (methods[m] ?? 0) + 1;
  if (ok) right++;
  if (r.result.status === "matched") { auto++; if (!ok) autoWrong++; }
  const raw = r.vision?.raw as any;
  console.log(`${id} ${t[0]} ${t[1]} -> ${ok ? "OK" : row ? `${row.slug}:${row.name} ${row.number ?? ""}` : "none"} ${r.result.status} conf ${r.result.confidence.toFixed(2)} sim ${raw?.similarity?.toFixed?.(3) ?? "-"} ${m}`);
}
console.log(`\n${process.env.VISION_PROVIDER} game=${game || "any"}: right ${right}/${ids.length}, auto-matched ${auto} (wrong ${autoWrong}), ${Math.round(ms / ids.length)} ms/photo`, JSON.stringify(methods));
await close();
