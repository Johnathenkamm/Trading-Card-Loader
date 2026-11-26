// Card-identification benchmark: which photo → card method finds the right card?
//
// Compares today's perceptual-hash matcher against image embeddings (DINOv2 and
// SigLIP 2 locally, Gemini Embedding 2 hosted) on the SAME queries and gallery,
// and reports top-1 / top-5 accuracy, MRR, and how many photos each method could
// auto-match while staying ≥98% correct.
//
// Two query sources:
//   synthetic (default) — catalog reference images rendered as "phone photos"
//       (src/bench/augment.ts: background, tilt, glare, blur/JPEG, all combined).
//       Methods suffixed -crop see the card straightened with its known corners:
//       the ceiling a perfect find-and-straighten step would reach.
//   real — a folder of labelled photos:  --photos <dir> --labels <file>
//       labels: one "file|card_id" or "file|Card name number set" per line
//       ("," also works); text labels are resolved through the catalog matcher.
//
// The gallery per game = every query card + every card in the query cards' sets
// (the hard negatives: same frame, same era) + --distractors random cards.
// Each query is ranked only against its own game, as production does.
// `hash-prod` instead ranks against the ENTIRE stored hash index for the game —
// exactly what an upload sees today.
//
// Run:  npm run bench:id                                   (100 cards x 6 conditions)
//       npm run bench:id -- --limit 30 --methods hash,siglip2
//       npm run bench:id -- --photos ../photos --labels ../photos/labels.txt
//       GEMINI_API_KEY=... npm run bench:id -- --methods gemini,siglip2 --limit 30
//
// Results: data/bench/results/<timestamp>/{report.md,results.json,queries.csv}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { query, close } from "../pg.ts";
import { fromHex, type ImageHashes } from "../imagehash.ts";
import { identify } from "../app/identify.ts";
import { sleep } from "../util.ts";
import { CONDITIONS, seedOf, synthesize, unwarp, encodeJpeg, type Quad } from "../bench/augment.ts";
import { BENCH_DIR, FeatureCache, HashMethod, dinov2, siglip2, gemini, sha1, type Feature, type Method } from "../bench/methods.ts";
import { Jimp } from "jimp";

const { values: args } = parseArgs({
  options: {
    cards: { type: "string", default: join(import.meta.dirname, "../../../test-cards/distinct500.txt") },
    limit: { type: "string", default: "100" },
    conditions: { type: "string", default: CONDITIONS.join(",") },
    methods: { type: "string" },
    photos: { type: "string" },
    labels: { type: "string" },
    game: { type: "string" },
    distractors: { type: "string", default: "300" },
    "same-sets": { type: "string", default: "yes" },
    seed: { type: "string", default: "1" },
    "max-api-calls": { type: "string", default: "1500" },
    "dinov2-model": { type: "string" },
    "siglip-model": { type: "string" },
    "dinov2-dtype": { type: "string" },
    "siglip-dtype": { type: "string" },
  },
});

const SEED = Number(args.seed);
const LIMIT = Number(args.limit);
const REAL = !!args.photos;
const t0 = Date.now();
const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${s}`);

// ---- helpers ----------------------------------------------------------------

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    })
  );
}

function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function fetchImage(url: string): Promise<Buffer> {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "CardIndex/0.1 (id benchmark)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = err;
      await sleep(600 * attempt);
    }
  }
  throw last;
}

const pct = (x: number) => (Number.isFinite(x) ? (100 * x).toFixed(1) + "%" : "–");

// ---- catalog ----------------------------------------------------------------

type CardRow = { id: number; name: string; number: string | null; set_id: number; set_name: string; game: string; image_url: string };
const CARD_SQL = `SELECT c.id::int AS id, c.name, c.number, s.id::int AS set_id, s.name AS set_name, g.slug AS game, h.image_url
  FROM card_image_hashes h JOIN cards c ON c.id=h.card_id JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id`;

function label(c: CardRow): string {
  return `${c.name}${c.number ? " " + c.number : ""} (${c.set_name})`;
}

// ---- queries ----------------------------------------------------------------

type Query = { id: string; truth: number; condition: string; image: Buffer; corners: Quad | null };

async function loadRealQueries(): Promise<Array<{ file: string; truth: number }>> {
  if (!args.labels) throw new Error("--photos needs --labels <file> (lines: file|card_id  or  file|Card name number set)");
  const out: Array<{ file: string; truth: number }> = [];
  for (const raw of readFileSync(resolve(args.labels), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [file, ref] = line.split(/[|,]/).map((s) => s.trim());
    if (!file || !ref) continue;
    if (!existsSync(join(resolve(args.photos!), file))) {
      console.warn(`  skip ${file}: not in ${args.photos}`);
      continue;
    }
    if (/^\d+$/.test(ref)) {
      out.push({ file, truth: Number(ref) });
      continue;
    }
    const r = await identify(ref, { game: args.game });
    if (!r.best) {
      console.warn(`  skip ${file}: no catalog card for "${ref}"`);
      continue;
    }
    if (r.confidence < 0.9) console.warn(`  ${file}: "${ref}" → card ${r.best.card_id} at ${pct(r.confidence)} — check this label`);
    out.push({ file, truth: r.best.card_id });
  }
  return out;
}

function syntheticCardIds(): number[] {
  // Accepts test-cards formats: "IMG_0001.jpg|1|Alakazam|…" and "41|Seel|Base|…".
  const ids: number[] = [];
  for (const line of readFileSync(resolve(args.cards!), "utf8").split(/\r?\n/)) {
    const f = line.split("|").map((s) => s.trim());
    const id = /^\d+$/.test(f[0] ?? "") ? f[0] : /^\d+$/.test(f[1] ?? "") ? f[1] : null;
    if (id) ids.push(Number(id));
  }
  return [...new Set(ids)];
}

// ---- metrics ----------------------------------------------------------------

type Outcome = {
  query: string;
  condition: string;
  method: string;
  truth: number;
  rank: number | null; // 1-based rank of the true card, null if absent from the ranking
  top: number | null;
  best: number; // best score
  second: number; // runner-up score (different card)
  ms: number;
  /** Wrong card, but the same name + number in another printing (Base vs Shadowless, reprints). */
  twin?: boolean;
};

type Cell = { n: number; top1: number; top1Art: number; top5: number; mrr: number; auto98: number; ms: number; prodAuto?: number; prodWrong?: number };

/** Margin between best and runner-up, oriented so bigger = more confident. */
function margin(o: Outcome, kind: Method["kind"]): number {
  return kind === "distance" ? o.second - o.best : o.best - o.second;
}

/** Largest share of queries a margin threshold can auto-accept with ≥98% of them correct. */
function autoCoverage(os: Outcome[], kind: Method["kind"]): number {
  const sorted = [...os].sort((a, b) => margin(b, kind) - margin(a, kind));
  let ok = 0;
  let best = 0;
  sorted.forEach((o, i) => {
    if (o.rank === 1) ok++;
    if (ok / (i + 1) >= 0.98) best = i + 1;
  });
  return os.length ? best / os.length : NaN;
}

function cell(os: Outcome[], kind: Method["kind"], isHash: boolean): Cell {
  const n = os.length;
  const c: Cell = {
    n,
    top1: os.filter((o) => o.rank === 1).length / n,
    top1Art: os.filter((o) => o.rank === 1 || o.twin).length / n,
    top5: os.filter((o) => o.rank != null && o.rank <= 5).length / n,
    mrr: os.reduce((s, o) => s + (o.rank ? 1 / o.rank : 0), 0) / n,
    auto98: autoCoverage(os, kind),
    ms: os.reduce((s, o) => s + o.ms, 0) / n,
  };
  if (isHash) {
    // Production's rule (src/app/vision.ts): auto-match when d ≤ 6 and the
    // runner-up is ≥ 2 further away; everything else goes to review.
    const auto = os.filter((o) => o.best <= 6 && o.second - o.best >= 2);
    c.prodAuto = auto.length / n;
    c.prodWrong = auto.filter((o) => o.rank !== 1).length / n;
  }
  return c;
}

// ---- main -------------------------------------------------------------------

async function main() {
  // 1. Which cards are we asking about?
  let realQueries: Array<{ file: string; truth: number }> = [];
  let truthIds: number[];
  if (REAL) {
    realQueries = await loadRealQueries();
    truthIds = [...new Set(realQueries.map((q) => q.truth))];
  } else {
    truthIds = shuffled(syntheticCardIds(), SEED).slice(0, LIMIT);
  }
  const truthRows = (await query<CardRow>(`${CARD_SQL} WHERE c.id = ANY($1)`, [truthIds])) as CardRow[];
  const byId = new Map(truthRows.map((r) => [r.id, r]));
  const missing = truthIds.filter((id) => !byId.has(id));
  if (missing.length) console.warn(`  ${missing.length} query card(s) have no reference image in card_image_hashes — dropped: ${missing.slice(0, 10).join(", ")}`);
  truthIds = truthIds.filter((id) => byId.has(id));
  if (!truthIds.length) throw new Error("no query cards with reference images");

  // 2. Gallery: query cards + their sets + random distractors, per game.
  const games = [...new Set(truthRows.map((r) => r.game))];
  const setIds = [...new Set(truthRows.map((r) => r.set_id))];
  const gallery = new Map<number, CardRow>(truthRows.map((r) => [r.id, r]));
  if (args["same-sets"] !== "no") {
    for (const r of (await query<CardRow>(`${CARD_SQL} WHERE s.id = ANY($1)`, [setIds])) as CardRow[]) gallery.set(r.id, r);
  }
  const nDistract = Number(args.distractors);
  for (const g of games) {
    if (nDistract <= 0) break;
    const rows = (await query<CardRow>(`${CARD_SQL} WHERE g.slug = $1 AND NOT (s.id = ANY($2)) ORDER BY md5(c.id::text || $3) LIMIT $4`, [g, setIds, String(SEED), nDistract])) as CardRow[];
    for (const r of rows) gallery.set(r.id, r);
  }
  log(`${truthIds.length} query cards in ${games.join(", ")}; gallery ${gallery.size} cards (${setIds.length} sets + distractors)`);

  // 3. Reference images (cached under data/bench/gallery).
  const galleryDir = join(BENCH_DIR, "gallery");
  mkdirSync(galleryDir, { recursive: true });
  const refImage = new Map<number, Buffer>();
  let failed = 0;
  await pool([...gallery.values()], 8, async (r) => {
    const file = join(galleryDir, `${r.id}-${sha1(r.image_url).slice(0, 8)}.img`);
    try {
      const buf = existsSync(file) ? readFileSync(file) : await fetchImage(r.image_url);
      if (!existsSync(file)) writeFileSync(file, buf);
      refImage.set(r.id, buf);
    } catch {
      failed++;
      gallery.delete(r.id);
    }
  });
  if (failed) log(`  ${failed} reference image(s) failed to download — left out of the gallery`);
  truthIds = truthIds.filter((id) => gallery.has(id));
  log(`gallery images ready (${refImage.size})`);

  // 4. Query images.
  const queries: Query[] = [];
  if (REAL) {
    for (const q of realQueries) {
      if (!gallery.has(q.truth)) continue;
      queries.push({ id: q.file, truth: q.truth, condition: "real", image: readFileSync(join(resolve(args.photos!), q.file)), corners: null });
    }
  } else {
    const conds = args.conditions!.split(",").map((s) => s.trim()).filter(Boolean);
    const qDir = join(BENCH_DIR, "queries", `seed${SEED}`);
    mkdirSync(qDir, { recursive: true });
    const jobs = truthIds.flatMap((id) => conds.map((c) => ({ id, c })));
    let made = 0;
    await pool(jobs, 2, async ({ id, c }) => {
      const base = join(qDir, `${id}-${c}`);
      let image: Buffer;
      let corners: Quad;
      if (existsSync(base + ".jpg") && existsSync(base + ".json")) {
        image = readFileSync(base + ".jpg");
        corners = JSON.parse(readFileSync(base + ".json", "utf8"));
      } else {
        const s = await synthesize(refImage.get(id)!, c, seedOf(SEED, id, c));
        image = s.jpeg;
        corners = s.corners;
        writeFileSync(base + ".jpg", image);
        writeFileSync(base + ".json", JSON.stringify(corners));
        if (++made % 50 === 0) log(`  rendered ${made} synthetic photos…`);
      }
      queries.push({ id: `${id}-${c}`, truth: id, condition: c, image, corners });
    });
    queries.sort((a, b) => a.id.localeCompare(b.id));
    log(`${queries.length} synthetic queries (${conds.join(", ")}) — images in ${qDir}`);
  }

  // 5. Methods.
  const gem = gemini();
  const wanted = (args.methods ?? `hash,hash-crop,hash-prod,dinov2,dinov2-crop,siglip2,siglip2-crop${gem ? ",gemini" : ""}`)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((m) => !(REAL && m.endsWith("-crop")));
  if (!gem && wanted.some((m) => m.startsWith("gemini"))) throw new Error("gemini needs GEMINI_API_KEY in the environment (or .env)");
  const bases = new Map<string, Method>();
  const baseOf = (name: string): Method => {
    const b = name.replace(/-crop$/, "").replace(/^hash-prod$/, "hash");
    if (!bases.has(b)) {
      const m = b === "hash" ? new HashMethod() : b === "dinov2" ? dinov2(args["dinov2-model"], args["dinov2-dtype"]) : b === "siglip2" ? siglip2(args["siglip-model"], args["siglip-dtype"]) : b === "gemini" ? gem : null;
      if (!m) throw new Error(`unknown method "${name}" (have: hash, hash-prod, dinov2, siglip2, gemini, and any of them with -crop)`);
      bases.set(b, m);
    }
    return bases.get(b)!;
  };
  for (const w of wanted) baseOf(w);

  // Straightened crops for the -crop variants (card at 5:7, 600 px wide).
  const crops = new Map<string, Buffer>();
  if (wanted.some((m) => m.endsWith("-crop"))) {
    for (const q of queries) {
      if (!q.corners) continue;
      const img = await Jimp.read(q.image);
      const bm = { width: img.bitmap.width, height: img.bitmap.height, data: Buffer.from(img.bitmap.data) };
      crops.set(q.id, await encodeJpeg(unwarp(bm, q.corners, 600, 840), 92));
    }
  }

  // Spending guard: count uncached images per billed method before calling anything.
  for (const [name, m] of bases) {
    if (!m.billed) continue;
    const cache = new FeatureCache(m);
    const imgs = [...refImage.values(), ...queries.map((q) => q.image), ...(wanted.includes(name + "-crop") ? [...crops.values()] : [])];
    const todo = imgs.filter((b) => !cache.has(sha1(b))).length;
    log(`${m.id}: ${todo} uncached image(s) → ${todo} API call(s)`);
    if (todo > Number(args["max-api-calls"])) {
      throw new Error(`${m.id} would make ${todo} API calls (> --max-api-calls ${args["max-api-calls"]}). Lower --limit/--distractors or raise the cap.`);
    }
  }

  // Featurize with the cache; a failed image is recorded and left out.
  const featureTimes = new Map<string, number>(); // method id → avg ms for uncached images
  async function features(m: Method, images: Array<{ key: string; buf: Buffer }>, what: string): Promise<Map<string, Feature>> {
    const cache = new FeatureCache(m);
    const out = new Map<string, Feature>();
    let fresh = 0;
    let ms = 0;
    let errors = 0;
    let lastErr = "";
    await pool(images, m.concurrency, async ({ key, buf }) => {
      const h = sha1(buf);
      let f = cache.get(h);
      if (!f) {
        const s = Date.now();
        try {
          f = await m.featurize(buf);
        } catch (err) {
          errors++;
          lastErr = (err as Error).message;
          return;
        }
        ms += Date.now() - s;
        cache.set(h, f);
        if (++fresh % 100 === 0) log(`  ${m.id}: ${fresh} ${what} featurized…`);
      }
      out.set(key, f);
    });
    if (fresh) featureTimes.set(m.id, ms / fresh);
    if (errors) log(`  ${m.id}: ${errors} ${what} failed (last: ${lastErr.slice(0, 160)})`);
    return out;
  }

  // Full production hash index (hash-prod), per game.
  let prodIndex: Map<string, Array<{ id: number; h: ImageHashes }>> | null = null;
  if (wanted.some((m) => m.startsWith("hash-prod"))) {
    prodIndex = new Map();
    const rows = (await query(
      `SELECT h.card_id::int AS id, h.dhash, h.ahash, h.dhash_inset, h.ahash_inset, g.slug AS game
       FROM card_image_hashes h JOIN cards c ON c.id=h.card_id JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
       WHERE g.slug = ANY($1)`,
      [games]
    )) as Array<{ id: number; dhash: string; ahash: string; dhash_inset: string; ahash_inset: string; game: string }>;
    for (const r of rows) {
      if (!prodIndex.has(r.game)) prodIndex.set(r.game, []);
      prodIndex.get(r.game)!.push({ id: r.id, h: { full: { dhash: fromHex(r.dhash), ahash: fromHex(r.ahash) }, inset: { dhash: fromHex(r.dhash_inset), ahash: fromHex(r.ahash_inset) } } });
    }
    log(`hash-prod index: ${[...prodIndex].map(([g, r]) => `${g} ${r.length}`).join(", ")}`);
  }

  const outcomes: Outcome[] = [];
  const kinds = new Map<string, Method["kind"]>();
  for (const name of wanted) {
    const m = baseOf(name);
    kinds.set(name, m.kind);
    const isCrop = name.endsWith("-crop");
    log(`${name}: featurizing…`);
    const galleryFeats =
      name.startsWith("hash-prod") ? null : await features(m, [...refImage].map(([id, buf]) => ({ key: String(id), buf })), "gallery images");
    const qs = queries.filter((q) => !isCrop || crops.has(q.id));
    const queryFeats = await features(m, qs.map((q) => ({ key: q.id, buf: isCrop ? crops.get(q.id)! : q.image })), "queries");

    // Candidates per game.
    const candidates = new Map<string, Array<{ id: number; f: Feature }>>();
    if (galleryFeats) {
      for (const [id, r] of gallery) {
        const f = galleryFeats.get(String(id));
        if (!f) continue;
        if (!candidates.has(r.game)) candidates.set(r.game, []);
        candidates.get(r.game)!.push({ id, f });
      }
    } else {
      for (const [g, rows] of prodIndex!) candidates.set(g, rows.map((r) => ({ id: r.id, f: r.h })));
    }

    const sign = m.kind === "distance" ? 1 : -1; // sort ascending on sign*score
    for (const q of qs) {
      const qf = queryFeats.get(q.id);
      const cands = candidates.get(gallery.get(q.truth)!.game) ?? [];
      const s0 = Date.now();
      let rank: number | null = null;
      let top: number | null = null;
      let best = NaN;
      let second = NaN;
      if (qf && cands.length) {
        const scored = cands.map((c) => ({ id: c.id, s: m.score(qf, c.f) })).sort((a, b) => sign * (a.s - b.s));
        const idx = scored.findIndex((c) => c.id === q.truth);
        rank = idx >= 0 ? idx + 1 : null;
        top = scored[0].id;
        best = scored[0].s;
        second = scored.find((c) => c.id !== top)?.s ?? best;
      }
      outcomes.push({ query: q.id, condition: q.condition, method: name, truth: q.truth, rank, top, best, second, ms: Date.now() - s0 + (featureTimes.get(m.id) ?? 0) });
    }
    const done = outcomes.filter((o) => o.method === name);
    log(`  ${name}: top-1 ${pct(done.filter((o) => o.rank === 1).length / done.length)} over ${done.length} queries`);
  }

  // Flag misses that picked the same card in another printing; hash-prod's
  // picks can be outside the gallery, so look those up.
  const meta = new Map<number, { name: string; number: string | null }>([...gallery].map(([id, r]) => [id, r]));
  const unknown = [...new Set(outcomes.map((o) => o.top).filter((id): id is number => id != null && !meta.has(id)))];
  if (unknown.length) {
    for (const r of (await query(`SELECT id::int AS id, name, number FROM cards WHERE id = ANY($1)`, [unknown])) as Array<{ id: number; name: string; number: string | null }>) meta.set(r.id, r);
  }
  const norm = (c?: { name: string; number: string | null }) => (c ? `${c.name.toLowerCase()}#${(c.number ?? "").replace(/^0+/, "").toLowerCase()}` : "");
  for (const o of outcomes) {
    if (o.rank !== 1 && o.top != null) o.twin = norm(meta.get(o.top)) === norm(meta.get(o.truth));
  }

  // 6. Report.
  const conds = [...new Set(queries.map((q) => q.condition))];
  const table: Record<string, Record<string, Cell>> = {};
  for (const name of wanted) {
    table[name] = {};
    const mine = outcomes.filter((o) => o.method === name);
    for (const c of [...conds, "all"]) {
      const os = c === "all" ? mine : mine.filter((o) => o.condition === c);
      if (os.length) table[name][c] = cell(os, kinds.get(name)!, name.startsWith("hash"));
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = join(BENCH_DIR, "results", stamp);
  mkdirSync(outDir, { recursive: true });
  const cols = [...conds, "all"];
  const gamesSummary = games.map((g) => `${g} ${[...gallery.values()].filter((r) => r.game === g).length}`).join(", ");
  const head = (title: string) => [`| ${title} | ${cols.join(" | ")} |`, `|---|${cols.map(() => "---:").join("|")}|`];
  const rows = (fmt: (c: Cell) => string, only?: (name: string) => boolean) =>
    wanted.filter((n) => !only || only(n)).map((n) => `| ${n} | ${cols.map((c) => (table[n][c] ? fmt(table[n][c]) : "–")).join(" | ")} |`);

  const examples = outcomes
    .filter((o) => o.method === wanted[0] && o.rank !== 1 && !o.twin && o.top != null)
    .slice(0, 8)
    .map((o) => `- \`${o.query}\` truth **${label(byId.get(o.truth) ?? gallery.get(o.truth)!)}** → got ${gallery.get(o.top!) ? label(gallery.get(o.top!)!) : "card " + o.top} (true card rank ${o.rank ?? "–"})`);

  const md = [
    `# Card ID benchmark — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    "",
    `- Queries: **${queries.length}** (${REAL ? "real photos from " + args.photos : `${truthIds.length} cards × ${conds.length} synthetic conditions, seed ${SEED}`})`,
    `- Gallery: **${gallery.size}** cards (${gamesSummary}); query cards' own sets + ${nDistract} random distractors per game. \`hash-prod\` searches the full stored index instead.`,
    `- Each query is ranked only against cards of its own game, as production does.`,
    "",
    "## Top-1 accuracy (top-5 in brackets)",
    "",
    ...head("method"),
    ...rows((c) => `${pct(c.top1)} (${pct(c.top5)})`),
    "",
    "## Top-1 counting the right card in the wrong printing",
    "",
    "Same name + number in another set (Base vs Shadowless, reprints) counted as right: the ceiling an image method reaches before OCR/set-symbol has to pick the printing.",
    "",
    ...head("method"),
    ...rows((c) => pct(c.top1Art)),
    "",
    "## Auto-match coverage at ≥98% precision",
    "",
    "Share of photos that could be auto-matched (no review) by thresholding the best-vs-runner-up margin, while ≥98% of those auto-matches are right. Higher = fewer cards in the review queue.",
    "",
    ...head("method"),
    ...rows((c) => pct(c.auto98)),
    "",
    "## Production rule for the hash matcher",
    "",
    "Auto-matched with today's thresholds (d ≤ 6, runner-up ≥ 2 further) / of those, wrong. Wrong auto-matches are the \"99% match, wrong card\" complaint.",
    "",
    ...head("method"),
    ...rows((c) => `${pct(c.prodAuto!)} / ${pct(c.prodWrong!)} wrong`, (n) => n.startsWith("hash")),
    "",
    "## MRR and time per query",
    "",
    ...head("method"),
    ...rows((c) => `${c.mrr.toFixed(3)} · ${c.ms.toFixed(0)} ms`),
    "",
    "Time is featurizing one uncached image plus ranking; on a rerun from cache only the ranking is measured.",
    "",
    `## Sample misses (${wanted[0]})`,
    "",
    ...(examples.length ? examples : ["- none"]),
    "",
    "## Read this before deciding",
    "",
    ...(REAL
      ? ["- Real photos: these numbers are what users would see, within the gallery used here."]
      : [
          "- Synthetic queries are rendered FROM the gallery's own reference image, so every method is matching a damaged copy of the exact catalog image. Real photos (different print, scan, lighting, sleeve) are harder; treat these as upper bounds and rerun with `--photos`.",
          "- `-crop` rows use the card's known corners: the best case for a find-and-straighten step, not a working detector.",
        ]),
    "- The gallery is a few hundred to a few thousand cards; production searches tens of thousands, so absolute accuracy drops with scale (compare `hash` with `hash-prod`).",
    "- Identical-art reprints in different sets can't be told apart by any image method; those misses need OCR on the set/number.",
    "",
  ].join("\n");

  writeFileSync(join(outDir, "report.md"), md);
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ args, gallery: gallery.size, queries: queries.length, table }, null, 2));
  writeFileSync(
    join(outDir, "queries.csv"),
    ["query,condition,method,truth,rank,top,best,second", ...outcomes.map((o) => [o.query, o.condition, o.method, o.truth, o.rank ?? "", o.top ?? "", o.best, o.second].join(","))].join("\n")
  );
  console.log("\n" + md.split("## Auto-match")[0]);
  log(`report: ${join(outDir, "report.md")}`);
}

main()
  .then(() => close())
  .catch(async (err) => {
    console.error("bench:id failed:", err.message ?? err);
    await close();
    process.exit(1);
  });
