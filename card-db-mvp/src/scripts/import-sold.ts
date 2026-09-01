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
// Usage:
//   npm run import:sold -- <file.(csv|json)> [--source=<feed-id>] [--demo]
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
// * required
//
// Re-runnable: rows with an external_id upsert; rows without insert only if an
// identical (source, title, sold_on, price) row isn't already present.

import { readFileSync } from "node:fs";
import { query, one, close } from "../pg.ts";
import { identify } from "../app/identify.ts";

type FeedRow = Record<string, string | number | null | undefined>;

// ---- input parsing --------------------------------------------------------

function parseCsv(text: string): FeedRow[] {
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

// ---- main -----------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const source = args.find((a) => a.startsWith("--source="))?.slice("--source=".length) ?? "manual";
  const isDemo = args.includes("--demo");
  if (!file) {
    console.error("Usage: npm run import:sold -- <file.(csv|json)> [--source=<feed-id>] [--demo]");
    process.exit(1);
  }

  const text = readFileSync(file, "utf8");
  const feed: FeedRow[] = file.toLowerCase().endsWith(".json")
    ? (JSON.parse(text) as FeedRow[])
    : parseCsv(text);
  console.log(`import:sold — ${feed.length} rows from ${file} (source='${source}'${isDemo ? ", demo" : ""})`);

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

    // canonicalize: title -> card/variant (+ grade/condition when feed lacks them)
    const id = await identify(cleanTitle(title));
    const attach = id.best && id.confidence >= 0.5 ? id.best : null;
    const grade = pick(row, "grade") ?? id.parsed.grade;
    const condition = pick(row, "condition") ?? (grade ? null : id.parsed.condition);
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
      canon_confidence: attach ? Number(id.confidence.toFixed(3)) : null,
      is_demo: isDemo,
      raw: JSON.stringify(row),
    };

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
        [
          vals.source, vals.marketplace, vals.external_id, vals.title, vals.price_cents,
          vals.list_price_cents, vals.currency, vals.sale_type, vals.bids, vals.sold_on, vals.url,
          vals.image_url, vals.card_id, vals.variant_id, vals.grade, vals.condition,
          vals.canon_confidence, vals.is_demo, vals.raw,
        ]
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
        [
          vals.source, vals.marketplace, vals.external_id, vals.title, vals.price_cents,
          vals.list_price_cents, vals.currency, vals.sale_type, vals.bids, vals.sold_on, vals.url,
          vals.image_url, vals.card_id, vals.variant_id, vals.grade, vals.condition,
          vals.canon_confidence, vals.is_demo, vals.raw,
        ]
      );
      inserted++;
    }
  }

  const total = await one<{ n: number }>("SELECT COUNT(*)::int n FROM sold_sales");
  console.log(
    `Done: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ` +
      `${canonized}/${inserted + updated} canonicalized to a catalog card. Archive now holds ${total!.n} sales.`
  );
}

main()
  .then(() => close())
  .catch(async (err) => {
    console.error("import failed:", err);
    await close();
    process.exit(1);
  });
