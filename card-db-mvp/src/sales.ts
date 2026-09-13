// Public Sales Lookup — search the canonical sold-sales archive.
//
// CardUploader's only public search is exactly this surface (research report
// §2/§6): keyword search over raw sold listings, 200 results, last-sale /
// last-3-average stats, revealed Best Offer prices. Ours matches that feature
// set and then does the thing theirs structurally can't: the query is parsed
// (grade/number/finish/set) and resolved against the CATALOG, so when we
// recognize the card we also return every archived sale canonicalized to it —
// title wording no longer matters — and each such row links to the card page.
//
// Like CardUploader, a grade in the query auto-filters to that exact grade
// (their "Showing only PSA 10 — Disable Filter" affordance); pass grade=all
// to disable. Data comes from sold_sales (import:sold feeds it).

import { query, one, toPg } from "./pg.ts";
import type { SoldSale } from "./db.ts";
import { identify } from "./app/identify.ts";
import { parseInput } from "./app/identify.ts";

/**
 * Sold-sales archive schema (idempotent, runs at server start like the other
 * ensure*Schema bootstraps). Creates `sold_sales` when the database was
 * provisioned before the archive existed — a deploy must never crash on a
 * missing table — and adds the link-health columns populated by
 * `npm run check:sold-links`. Mirrors db/schema.postgres.sql.
 */
export async function ensureSalesSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS sold_sales (
      id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      source           text NOT NULL,
      marketplace      text NOT NULL,
      external_id      text,
      title            text NOT NULL,
      price_cents      integer NOT NULL,
      list_price_cents integer,
      currency         text NOT NULL DEFAULT 'USD',
      sale_type        text NOT NULL DEFAULT 'unknown',
      bids             integer,
      sold_on          date NOT NULL,
      url              text,
      image_url        text,
      card_id          bigint REFERENCES cards(id) ON DELETE SET NULL,
      variant_id       bigint REFERENCES card_variants(id) ON DELETE SET NULL,
      grade            text,
      condition        text,
      canon_confidence real,
      is_demo          boolean NOT NULL DEFAULT false,
      raw              jsonb,
      created_at       timestamptz NOT NULL DEFAULT now(),
      url_status       integer,
      url_checked_at   timestamptz
    )`);
  await query(`ALTER TABLE sold_sales ADD COLUMN IF NOT EXISTS url_status integer`);
  await query(`ALTER TABLE sold_sales ADD COLUMN IF NOT EXISTS url_checked_at timestamptz`);
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_sold_ext ON sold_sales(source, external_id) WHERE external_id IS NOT NULL`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_sold_variant ON sold_sales(variant_id, grade, sold_on DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sold_card ON sold_sales(card_id, sold_on DESC)`);
  // Trigram index needs pg_trgm; the extension may need privileges we lack on a
  // managed database, so a failure here only costs search speed, never the boot.
  try {
    await query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sold_title_trgm ON sold_sales USING gin (title gin_trgm_ops)`);
  } catch (err) {
    console.warn("  sold_sales: trigram index not created (pg_trgm unavailable):", (err as Error).message);
  }
}

// ---- Listing links ----------------------------------------------------------
//
// A sold row's `url` is only rendered as a link when we have good reason to
// believe the page exists. Two layers, because marketplaces can't be trusted
// to answer a server-side probe honestly (eBay 403s every bot, Goldin and
// TCGplayer return 200 for nonexistent pages):
//
//   1. Shape: the URL must be http(s), must not be a sample/placeholder, and
//      for eBay must be a real item URL (/itm/<12-digit id>).
//   2. Health: a definitive 404/410 recorded by check:sold-links hides the link.
//      Anything else (never checked, 403, timeouts) is inconclusive → keep it.

/** HTTP statuses that prove a listing page is gone. */
export const DEAD_LINK_STATUSES = new Set([404, 410]);

const PLACEHOLDER_URL = /(^|[/._-])(sample|placeholder|example|test)\d*([/._-]|$)|example\.(com|org|net)/i;
const EBAY_ITEM_PATH = /^\/itm\/(?:[^/?#]+\/)?\d{12}(?:[/?#]|$)/;

type LinkFields = Pick<SoldSale, "url" | "is_demo" | "url_status">;

/** The href to render for a sold row, or null to show the title as plain text. */
export function soldListingLink(s: LinkFields): string | null {
  if (!s.url || s.is_demo) return null;
  if (s.url_status != null && DEAD_LINK_STATUSES.has(s.url_status)) return null;
  let u: URL;
  try {
    u = new URL(s.url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (PLACEHOLDER_URL.test(u.hostname + u.pathname)) return null;
  const host = u.hostname.toLowerCase();
  if (host === "ebay.com" || host.endsWith(".ebay.com") || /(^|\.)ebay\.[a-z.]+$/.test(host)) {
    // Search / category / signed-in pages aren't listings; only /itm/<id> is.
    if (!EBAY_ITEM_PATH.test(u.pathname)) return null;
  }
  return s.url;
}

export type SalesParams = {
  q?: string;
  market?: string; // ebay | goldin | fanatics
  type?: string; // auction | bin | best_offer
  grade?: string; // explicit grade filter; "all" disables the auto grade filter
  sort?: string; // new (default) | price
};

export type MatchedCard = {
  card_id: number;
  name: string;
  number: string | null;
  set_name: string;
  slug: string;
  image: string | null;
};

export type SalesRow = SoldSale & { card_slug: string | null };

export type SalesResult = {
  rows: SalesRow[];
  total: number;
  stats: { last_cents: number | null; last3_avg_cents: number | null; currency: string };
  matchedCard: MatchedCard | null;
  gradeFilter: string | null; // active auto/explicit grade filter
  markets: Array<{ key: string; n: number }>;
  allDemo: boolean;
};

const LIMIT = 200;

export async function searchSales(p: SalesParams): Promise<SalesResult> {
  const raw = (p.q ?? "").trim();
  const parsed = raw ? parseInput(raw) : null;

  // canonical resolution: does the query name a card we know? The threshold is
  // deliberately strict (0.85): identify()'s margin dampening caps a perfect
  // name that TIES across several cards ("charizard" alone) at 0.80, while a
  // unique name scores ~0.99 and a number-corroborated match floors at 0.92 —
  // so 0.85 pins the banner only when the query genuinely singles out a card.
  let matchedCard: MatchedCard | null = null;
  if (raw) {
    const id = await identify(raw);
    if (id.best && id.confidence >= 0.85) {
      matchedCard = {
        card_id: id.best.card_id,
        name: id.best.name,
        number: id.best.number,
        set_name: id.best.set_name,
        slug: `${id.best.set_slug}`, // set slug kept for context; card link built below
        image: id.best.image,
      };
      // build the card page path the render layer links to
      const row = await one<{ slug: string; id: number }>("SELECT slug, id FROM cards WHERE id=$1", [
        id.best.card_id,
      ]);
      if (row) matchedCard.slug = `/c/${row.slug}-${row.id}`;
    }
  }

  // grade filter: explicit param wins; "all" disables; else auto from the query
  let gradeFilter: string | null = null;
  if (p.grade && p.grade !== "all") gradeFilter = p.grade;
  else if (p.grade !== "all" && parsed?.grade) gradeFilter = parsed.grade;

  // Real sales only: demo/sample rows never reach the public lookup.
  const cond: string[] = ["s.is_demo = false"];
  const params: unknown[] = [];
  if (raw) {
    const terms = (parsed?.nameTerms ?? []).filter(Boolean);
    const titleConds = terms.map(() => "s.title ILIKE ?");
    const titleParams = terms.map((t) => `%${t}%`);
    if (matchedCard && titleConds.length) {
      cond.push(`(s.card_id = ? OR (${titleConds.join(" AND ")}))`);
      params.push(matchedCard.card_id, ...titleParams);
    } else if (matchedCard) {
      cond.push("s.card_id = ?");
      params.push(matchedCard.card_id);
    } else if (titleConds.length) {
      cond.push(`(${titleConds.join(" AND ")})`);
      params.push(...titleParams);
    } else {
      // query was pure structure (e.g. just a number/grade): fall back to raw text
      cond.push("s.title ILIKE ?");
      params.push(`%${raw}%`);
    }
  }
  if (gradeFilter) {
    cond.push("s.grade = ?");
    params.push(gradeFilter);
  }
  if (p.market) {
    cond.push("s.marketplace = ?");
    params.push(p.market.toLowerCase());
  }
  if (p.type) {
    cond.push("s.sale_type = ?");
    params.push(p.type);
  }
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  const order = p.sort === "price" ? "ORDER BY s.price_cents DESC, s.sold_on DESC" : "ORDER BY s.sold_on DESC, s.id DESC";

  const rows = (await query(
    toPg(`SELECT s.*, c.slug AS card_slug FROM sold_sales s LEFT JOIN cards c ON c.id = s.card_id ${where} ${order} LIMIT ${LIMIT}`),
    params
  )) as SalesRow[];
  const total = (await one<{ n: number }>(
    toPg(`SELECT COUNT(*)::int n FROM sold_sales s ${where}`),
    params
  ))!.n;

  // stats over the filtered set, most-recent-first regardless of sort
  const recent = [...rows].sort((a, b) => (a.sold_on < b.sold_on ? 1 : -1));
  const last3 = recent.slice(0, 3);
  const stats = {
    last_cents: recent[0]?.price_cents ?? null,
    last3_avg_cents: last3.length
      ? Math.round(last3.reduce((s, r) => s + r.price_cents, 0) / last3.length)
      : null,
    currency: recent[0]?.currency ?? "USD",
  };

  const markets = (await query(
    toPg(`SELECT s.marketplace AS key, COUNT(*)::int n FROM sold_sales s ${where} GROUP BY s.marketplace ORDER BY n DESC`),
    params
  )) as Array<{ key: string; n: number }>;

  return {
    rows,
    total,
    stats,
    matchedCard,
    gradeFilter,
    markets,
    allDemo: rows.length > 0 && rows.every((r) => r.is_demo),
  };
}
