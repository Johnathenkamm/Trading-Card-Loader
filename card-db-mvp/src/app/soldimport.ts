// Sold-listings importer -> the canonical sold_sales archive.
//
// Research (carduploader-data-sourcing-research.md §2, §8.1): there is no open
// eBay API for sold data — every real pipeline is a licensed feed, a vendor
// API, or accumulation. CardUploader's archive reaches back ~8 years (bought,
// not built) and its lookup is RAW TITLE KEYWORDS. Our counter is structural:
// whatever feed lands here, every row is (a) deduped by (source, external_id)
// — CardUploader shows the same eBay item twice under two ids — and
// (b) CANONICALIZED to card/variant/grade through the same identify() parser
// the seller workspace uses, so sold history attaches to catalog pages instead
// of drifting as strings. Archive from day one; depth becomes the moat.
//
// Two callers:
//   - `npm run import:sold` (src/scripts/import-sold.ts) — land any feed file
//   - the server at boot (src/server.ts) — sample-row housekeeping: by default
//     any bundled sample rows (db/sold_sample.csv, flagged is_demo) are REMOVED
//     so the public archive only ever shows real sales; SOLD_SAMPLE_ON_BOOT=1
//     (demo/dev deploys) instead loads that sample whenever the archive is empty.
//     Hosted deploys (Railway) have no shell access to the database, which is
//     why this lives in the server rather than a script.
//
// Accepted columns / keys (aliases in parens, case-insensitive):
//   title*                          raw listing title as sold
//   price* (sold_price, sale_price) actual transaction amount, dollars
//   sold_on* (date, sold_date)      yyyy-mm-dd (or parseable date)
//   marketplace (market, source)    ebay | goldin | fanatics | ... (default ebay)
//   sale_type (type)                auction | bin | best_offer
//   list_price (listed)             pre-negotiation list price, dollars
//   currency                        default USD
//   bids, url, image_url, external_id (id, item_id), grade, condition
//   card_id, variant_id                pre-resolved catalog ids (our own sellers'
//                                     orders know the exact SKU) — skips identify()
// * required
//
// Re-runnable: rows with an external_id upsert; rows without insert only if an
// identical (source, title, sold_on, price) row isn't already present.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query, one } from "../pg.ts";
import { identify } from "./identify.ts";

export type FeedRow = Record<string, string | number | null | undefined>;

export type SoldImportStats = { rows: number; inserted: number; updated: number; skipped: number; canonized: number; total: number };

// ---- input parsing --------------------------------------------------------

export function parseCsv(text: string): FeedRow[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj: FeedRow = {};
    header.forEach((h, i) => (obj[h] = cells[i]?.trim() ?? ""));
    return obj;
  });
}

/** Parse feed text (the contents of a .csv or .json file) into rows. */
export function parseFeedText(text: string, filename: string): FeedRow[] {
  const body = text.replace(/^﻿/, ""); // strip a UTF-8 BOM (Excel exports)
  if (filename.toLowerCase().endsWith(".json") || /^\s*[\[{]/.test(body)) {
    const parsed = JSON.parse(body);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed?.sales) ? parsed.sales : null;
    if (!rows) throw new Error("JSON must be an array of sales (or an object with a `rows` / `sales` array).");
    return rows as FeedRow[];
  }
  return parseCsv(body);
}

/** Read a .csv or .json feed file into rows. */
export function readFeedFile(file: string): FeedRow[] {
  return parseFeedText(readFileSync(file, "utf8"), file);
}

// ---- archive summary (owner console) ----------------------------------------

export type SoldSourceRow = { source: string; n: number; canonized: number; is_demo: boolean; first_sale: string | null; last_sale: string | null; imported_at: string | null };
export type SoldArchiveSummary = {
  total: number;
  real: number;
  demo: number;
  canonized: number;
  cards: number; // distinct catalog cards with at least one sale
  sources: SoldSourceRow[];
  marketplaces: Array<{ marketplace: string; n: number }>;
};

/** What the sold-sales archive holds, by feed source and marketplace. */
export async function soldArchiveSummary(): Promise<SoldArchiveSummary> {
  const [tot, sources, marketplaces] = await Promise.all([
    one<{ total: number; real: number; demo: number; canonized: number; cards: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE NOT is_demo)::int AS real,
              COUNT(*) FILTER (WHERE is_demo)::int AS demo,
              COUNT(*) FILTER (WHERE card_id IS NOT NULL)::int AS canonized,
              COUNT(DISTINCT card_id)::int AS cards
       FROM sold_sales`
    ),
    query<SoldSourceRow>(
      `SELECT source, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE card_id IS NOT NULL)::int AS canonized,
              bool_or(is_demo) AS is_demo, MIN(sold_on)::text AS first_sale, MAX(sold_on)::text AS last_sale, MAX(created_at)::text AS imported_at
       FROM sold_sales GROUP BY source ORDER BY MAX(created_at) DESC`
    ),
    query<{ marketplace: string; n: number }>(`SELECT marketplace, COUNT(*)::int AS n FROM sold_sales GROUP BY marketplace ORDER BY n DESC`),
  ]);
  return { total: tot?.total ?? 0, real: tot?.real ?? 0, demo: tot?.demo ?? 0, canonized: tot?.canonized ?? 0, cards: tot?.cards ?? 0, sources, marketplaces };
}

/** Remove every sale imported under one feed source (undo a bad upload). Returns rows removed. */
export async function deleteSoldSource(source: string): Promise<number> {
  const r = await one<{ n: number }>("WITH d AS (DELETE FROM sold_sales WHERE source=$1 RETURNING 1) SELECT COUNT(*)::int n FROM d", [source]);
  return r?.n ?? 0;
}

const ALIASES: Record<string, string[]> = {
  title: ["title", "listing_title", "name"],
  price: ["price", "sold_price", "sale_price", "amount"],
  sold_on: ["sold_on", "date", "sold_date", "sale_date"],
  marketplace: ["marketplace", "market"],
  sale_type: ["sale_type", "type", "format"],
  list_price: ["list_price", "listed", "listed_price", "original_price"],
  currency: ["currency"],
  bids: ["bids", "bid_count"],
  url: ["url", "link"],
  image_url: ["image_url", "image"],
  external_id: ["external_id", "id", "item_id", "listing_id"],
  grade: ["grade"],
  condition: ["condition"],
  card_id: ["card_id"],
  variant_id: ["variant_id"],
};

function pick(row: FeedRow, key: string): string | null {
  for (const alias of ALIASES[key]) {
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === alias) {
        const v = row[k];
        if (v != null && String(v).trim() !== "") return String(v).trim();
      }
    }
  }
  return null;
}

function toCents(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function toDate(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function normSaleType(v: string | null): string {
  const s = (v ?? "").toLowerCase();
  if (/best\s*_?offer|offer/.test(s)) return "best_offer";
  if (/auction/.test(s)) return "auction";
  if (/bin|buy\s*it\s*now|fixed/.test(s)) return "bin";
  return "unknown";
}

// Listing titles carry marketplace noise identify() shouldn't chew on.
function cleanTitle(t: string): string {
  return t
    .replace(/\b(19|20)\d{2}\b/g, " ") // years
    .replace(/\b(gem|mint|graded|slab|slabbed|nr|no\s*reserve|l@@k|rare!*)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- import ---------------------------------------------------------------

/**
 * Land feed rows in sold_sales, deduped and canonicalized. Safe to run while
 * the server serves requests: one row per statement, no table locks.
 */
export async function importSoldFeed(
  feed: FeedRow[],
  opts: { source: string; demo?: boolean; log?: (line: string) => void }
): Promise<SoldImportStats> {
  const log = opts.log ?? (() => {});
  const source = opts.source;
  const isDemo = !!opts.demo;
  log(`import:sold — ${feed.length} rows (source='${source}'${isDemo ? ", demo" : ""})`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let canonized = 0;

  for (const row of feed) {
    const title = pick(row, "title");
    const priceCents = toCents(pick(row, "price"));
    const soldOn = toDate(pick(row, "sold_on"));
    if (!title || priceCents == null || !soldOn) {
      skipped++;
      continue;
    }

    // canonicalize: a pre-resolved card_id (our sellers' own orders) is exact;
    // otherwise title -> card/variant (+ grade/condition when feed lacks them)
    const presetCard = Number(pick(row, "card_id"));
    let attach: { card_id: number; variant_id: number | null } | null = null;
    let confidence = 1;
    let parsedGrade: string | null = null;
    let parsedCondition: string | null = null;
    if (Number.isInteger(presetCard) && presetCard > 0) {
      const v = Number(pick(row, "variant_id"));
      attach = { card_id: presetCard, variant_id: Number.isInteger(v) && v > 0 ? v : null };
    } else {
      const id = await identify(cleanTitle(title));
      attach = id.best && id.confidence >= 0.5 ? { card_id: id.best.card_id, variant_id: id.best.variant_id } : null;
      confidence = id.confidence;
      parsedGrade = id.parsed.grade;
      parsedCondition = id.parsed.condition;
    }
    const grade = pick(row, "grade") ?? parsedGrade;
    const condition = pick(row, "condition") ?? (grade ? null : parsedCondition);
    if (attach) canonized++;

    const vals = {
      source,
      marketplace: (pick(row, "marketplace") ?? "ebay").toLowerCase(),
      external_id: pick(row, "external_id"),
      title,
      price_cents: priceCents,
      list_price_cents: toCents(pick(row, "list_price")),
      currency: (pick(row, "currency") ?? "USD").toUpperCase(),
      sale_type: normSaleType(pick(row, "sale_type")),
      bids: pick(row, "bids") != null ? Number(pick(row, "bids")) || null : null,
      sold_on: soldOn,
      url: pick(row, "url"),
      image_url: pick(row, "image_url"),
      card_id: attach?.card_id ?? null,
      variant_id: attach?.variant_id ?? null,
      grade: grade ?? null,
      condition: condition ?? null,
      canon_confidence: attach ? Number(confidence.toFixed(3)) : null,
      is_demo: isDemo,
      raw: JSON.stringify(row),
    };
    const params = [
      vals.source, vals.marketplace, vals.external_id, vals.title, vals.price_cents,
      vals.list_price_cents, vals.currency, vals.sale_type, vals.bids, vals.sold_on, vals.url,
      vals.image_url, vals.card_id, vals.variant_id, vals.grade, vals.condition,
      vals.canon_confidence, vals.is_demo, vals.raw,
    ];

    if (vals.external_id) {
      const res = await one<{ inserted: boolean }>(
        `INSERT INTO sold_sales (source, marketplace, external_id, title, price_cents, list_price_cents,
           currency, sale_type, bids, sold_on, url, image_url, card_id, variant_id, grade, condition,
           canon_confidence, is_demo, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
         ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET price_cents=EXCLUDED.price_cents, list_price_cents=EXCLUDED.list_price_cents,
           sale_type=EXCLUDED.sale_type, card_id=EXCLUDED.card_id, variant_id=EXCLUDED.variant_id,
           grade=EXCLUDED.grade, condition=EXCLUDED.condition, canon_confidence=EXCLUDED.canon_confidence
         RETURNING (xmax = 0) AS inserted`,
        params
      );
      if (res?.inserted) inserted++;
      else updated++;
    } else {
      const dup = await one(
        "SELECT 1 FROM sold_sales WHERE source=$1 AND title=$2 AND sold_on=$3 AND price_cents=$4",
        [vals.source, vals.title, vals.sold_on, vals.price_cents]
      );
      if (dup) {
        skipped++;
        continue;
      }
      await query(
        `INSERT INTO sold_sales (source, marketplace, external_id, title, price_cents, list_price_cents,
           currency, sale_type, bids, sold_on, url, image_url, card_id, variant_id, grade, condition,
           canon_confidence, is_demo, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
        params
      );
      inserted++;
    }
  }

  const total = (await one<{ n: number }>("SELECT COUNT(*)::int n FROM sold_sales"))?.n ?? 0;
  log(
    `Done: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ` +
      `${canonized}/${inserted + updated} canonicalized to a catalog card. Archive now holds ${total} sales.`
  );
  return { rows: feed.length, inserted, updated, skipped, canonized, total };
}

// ---- boot-time sample -----------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
/** The bundled sample feed (README: `npm run import:sold -- db/sold_sample.csv --source=sample --demo`). */
export const SAMPLE_FEED = join(here, "..", "..", "db", "sold_sample.csv");
export const SAMPLE_SOURCE = "sample";

let booting: Promise<void> | null = null;

/**
 * Boot-time sample handling. By default the archive is HONEST: Sales Lookup
 * shows only real sales, so any bundled sample rows (source=sample, demo) left
 * by an earlier load are removed. Set SOLD_SAMPLE_ON_BOOT=1 for a demo/dev
 * deploy that wants the sample feed loaded whenever the archive is empty.
 * Runs in the background; never blocks the listener; failures only log.
 */
export function startSoldSampleOnBoot(): void {
  if (booting) return;
  const wantSample = process.env.SOLD_SAMPLE_ON_BOOT === "1";
  booting = (async () => {
    try {
      if (!wantSample) {
        const r = await one<{ n: number }>(
          "WITH d AS (DELETE FROM sold_sales WHERE source=$1 AND is_demo RETURNING 1) SELECT COUNT(*)::int n FROM d",
          [SAMPLE_SOURCE]
        );
        if (r?.n) console.log(`  Sold archive: removed ${r.n} bundled sample row${r.n === 1 ? "" : "s"} (SOLD_SAMPLE_ON_BOOT=1 keeps them).`);
        return;
      }
      const n = (await one<{ n: number }>("SELECT COUNT(*)::int n FROM sold_sales"))?.n ?? 0;
      if (n > 0) return;
      console.log("  Sold archive is empty — loading the bundled sample feed (demo-flagged) in the background…");
      const feed = readFeedFile(SAMPLE_FEED);
      await importSoldFeed(feed, { source: SAMPLE_SOURCE, demo: true, log: (l) => console.log("  " + l) });
    } catch (err: any) {
      console.error("  Sold sample step failed:", err?.message ?? err);
    } finally {
      booting = null;
    }
  })();
}
