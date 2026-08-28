import { query, one, toPg } from "./pg.ts";
import type { Card } from "./db.ts";
import { levenshtein } from "./util.ts";

export type SearchParams = {
  q?: string;
  game?: string;
  set?: string;
  rarity?: string;
  finish?: string;
  min?: number; // dollars
  max?: number; // dollars
  sort?: string;
  page?: number;
};

export type FacetOption = { key: string; label: string; count: number; active: boolean };
export type SearchResult = {
  rows: Array<Card & { set_name: string; set_slug: string; game_name: string; game_slug: string; price_cents: number | null; currency: string | null }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: { game: FacetOption[]; set: FacetOption[]; rarity: FacetOption[]; finish: FacetOption[] };
  parsedGrade: string | null;
  suggestions: string[];
  terms: string[];
};

const PAGE_SIZE = 24;
const HP_JOIN = `LEFT JOIN (
    SELECT v.card_id AS cid, MAX(pp.price_cents) AS pc, MAX(pp.currency) AS cur
    FROM card_variants v
    JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL
    GROUP BY v.card_id
  ) hp ON hp.cid=c.id`;
const BASE_FROM = `FROM cards c
  JOIN sets s ON s.id=c.set_id
  JOIN games g ON g.id=s.game_id
  ${HP_JOIN}`;

const GAME_WORDS: Record<string, string> = {
  pokemon: "pokemon",
  "pokémon": "pokemon",
  mtg: "mtg",
  magic: "mtg",
  gathering: "mtg",
};

function parseQuery(raw: string): { terms: string[]; gameFromQuery?: string; grade?: string } {
  let q = raw.toLowerCase().trim();
  let grade: string | undefined;
  const gm = q.match(/\b(psa|cgc|bgs|sgc)\s*(\d{1,2}(?:\.\d)?)\b/);
  if (gm) {
    grade = `${gm[1].toUpperCase()} ${gm[2]}`;
    q = q.replace(gm[0], " ");
  }
  const words = q.split(/\s+/).filter(Boolean);
  let gameFromQuery: string | undefined;
  const terms: string[] = [];
  for (const w of words) {
    if (GAME_WORDS[w] && !gameFromQuery) gameFromQuery = GAME_WORDS[w];
    else terms.push(w);
  }
  return { terms, gameFromQuery, grade };
}

type Built = { where: string; params: unknown[] };
function buildWhere(p: SearchParams, terms: string[], exclude: Set<string>): Built {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (!exclude.has("q")) {
    for (const t of terms) {
      cond.push("c.search_text LIKE ?");
      params.push(`%${t}%`);
    }
  }
  if (!exclude.has("game") && p.game) {
    cond.push("g.slug = ?");
    params.push(p.game);
  }
  if (!exclude.has("set") && p.set) {
    cond.push("s.slug = ?");
    params.push(p.set);
  }
  if (!exclude.has("rarity") && p.rarity) {
    cond.push("c.rarity = ?");
    params.push(p.rarity);
  }
  if (!exclude.has("finish") && p.finish) {
    cond.push("EXISTS (SELECT 1 FROM card_variants vf WHERE vf.card_id=c.id AND vf.finish=?)");
    params.push(p.finish);
  }
  if (!exclude.has("price") && p.min != null) {
    cond.push("hp.pc >= ?");
    params.push(Math.round(p.min * 100));
  }
  if (!exclude.has("price") && p.max != null) {
    cond.push("hp.pc <= ?");
    params.push(Math.round(p.max * 100));
  }
  return { where: cond.length ? "WHERE " + cond.join(" AND ") : "", params };
}

function orderBy(sort: string | undefined, hasQuery: boolean, firstTerm: string): { sql: string; params: unknown[] } {
  switch (sort) {
    case "price_asc":
      return { sql: "ORDER BY (hp.pc IS NULL), hp.pc ASC, c.name", params: [] };
    case "name":
      return { sql: "ORDER BY c.name, s.release_date DESC", params: [] };
    case "number":
      return { sql: "ORDER BY s.release_date DESC, c.number_sort, c.name", params: [] };
    case "price_desc":
      return { sql: "ORDER BY (hp.pc IS NULL), hp.pc DESC, c.name", params: [] };
    default:
      // relevance: exact name, then starts-with, then value
      if (hasQuery)
        return {
          sql: "ORDER BY CASE WHEN lower(c.name)=? THEN 0 WHEN lower(c.name) LIKE ? THEN 1 ELSE 2 END, (hp.pc IS NULL), hp.pc DESC",
          params: [firstTerm, `${firstTerm}%`],
        };
      return { sql: "ORDER BY (hp.pc IS NULL), hp.pc DESC, c.name", params: [] };
  }
}

function facetList(
  rows: Array<{ key: string; label: string; n: number }>,
  activeKey: string | undefined
): FacetOption[] {
  return rows.map((r) => ({ key: r.key, label: r.label, count: r.n, active: r.key === activeKey }));
}

export async function search(p: SearchParams): Promise<SearchResult> {
  const parsed = parseQuery(p.q ?? "");
  const terms = parsed.terms;
  // query game keyword acts as a filter unless the user set one explicitly
  if (!p.game && parsed.gameFromQuery) p.game = parsed.gameFromQuery;
  const hasQuery = terms.length > 0;
  const firstTerm = (terms.join(" ") || "").trim();

  const base = buildWhere(p, terms, new Set());
  const total = (await one<{ n: number }>(
    toPg(`SELECT COUNT(*) n ${BASE_FROM} ${base.where}`),
    base.params
  ))!.n;

  const page = Math.max(1, p.page ?? 1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const ob = orderBy(p.sort, hasQuery, firstTerm);
  const rows = (await query(
    toPg(
      `SELECT c.*, s.name AS set_name, s.slug AS set_slug, g.name AS game_name, g.slug AS game_slug,
              hp.pc AS price_cents, hp.cur AS currency
       ${BASE_FROM} ${base.where} ${ob.sql} LIMIT ? OFFSET ?`
    ),
    [...base.params, ...ob.params, PAGE_SIZE, (page - 1) * PAGE_SIZE]
  )) as SearchResult["rows"];

  // ---- facets (each dimension counted with its own filter removed) ----
  const gwhere = buildWhere(p, terms, new Set(["game"]));
  const gameRows = (await query(
    toPg(`SELECT g.slug key, g.name label, COUNT(*) n ${BASE_FROM} ${gwhere.where} GROUP BY g.slug, g.name ORDER BY n DESC`),
    gwhere.params
  )) as Array<{ key: string; label: string; n: number }>;

  const swhere = buildWhere(p, terms, new Set(["set"]));
  const setRows = (await query(
    toPg(`SELECT s.slug key, s.name label, COUNT(*) n ${BASE_FROM} ${swhere.where} GROUP BY s.slug, s.name ORDER BY n DESC LIMIT 12`),
    swhere.params
  )) as Array<{ key: string; label: string; n: number }>;

  const rwhere = buildWhere(p, terms, new Set(["rarity"]));
  const rarRows = (await query(
    toPg(
      `SELECT c.rarity key, c.rarity label, COUNT(*) n ${BASE_FROM} ${rwhere.where}${rwhere.where ? " AND" : " WHERE"} c.rarity IS NOT NULL GROUP BY c.rarity ORDER BY n DESC LIMIT 14`
    ),
    rwhere.params
  )) as Array<{ key: string; label: string; n: number }>;

  const fwhere = buildWhere(p, terms, new Set(["finish"]));
  const finRows = (await query(
    toPg(
      `SELECT vf.finish key, vf.finish_label label, COUNT(DISTINCT c.id) n
       FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
       JOIN card_variants vf ON vf.card_id=c.id ${HP_JOIN}
       ${fwhere.where} GROUP BY vf.finish, vf.finish_label ORDER BY n DESC`
    ),
    fwhere.params
  )) as Array<{ key: string; label: string; n: number }>;

  // ---- fuzzy fallback ----
  let suggestions: string[] = [];
  if (total === 0 && hasQuery) {
    const names = (await query("SELECT DISTINCT name FROM cards")) as Array<{ name: string }>;
    const target = terms.join(" ");
    suggestions = names
      .map((r) => {
        const nl = r.name.toLowerCase();
        const whole = levenshtein(target, nl);
        const byWord = Math.min(...nl.split(/\s+/).map((w) => levenshtein(target, w)), whole);
        return { name: r.name, d: Math.min(whole, byWord) };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .filter((x) => x.d <= Math.max(3, target.length * 0.5))
      .map((x) => x.name);
  }

  return {
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages,
    facets: {
      game: facetList(gameRows, p.game),
      set: facetList(setRows, p.set),
      rarity: facetList(rarRows, p.rarity),
      finish: facetList(finRows, p.finish),
    },
    parsedGrade: parsed.grade ?? null,
    suggestions,
    terms,
  };
}

/** Type-ahead: top name matches (prefix first, then substring). */
export function suggest(
  q: string,
  limit = 8
): Promise<Array<{ id: number; name: string; slug: string; set_name: string; image: string | null; price: number | null }>> {
  const like = `%${q.toLowerCase()}%`;
  const prefix = `${q.toLowerCase()}%`;
  // Wrapped in a subquery so ORDER BY can reference the computed `price` column
  // in an expression (Postgres only allows a bare SELECT alias as a sort key,
  // not inside one — unlike SQLite).
  return query(
    `SELECT id, name, slug, set_name, price, image FROM (
       SELECT c.id, c.name, c.slug, s.name AS set_name,
              (SELECT MAX(pp.price_cents) FROM card_variants v JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL WHERE v.card_id=c.id) AS price,
              c.image_small AS image,
              (lower(c.name) LIKE $2) AS is_prefix
       FROM cards c JOIN sets s ON s.id=c.set_id
       WHERE c.search_text LIKE $1
     ) t
     ORDER BY is_prefix DESC, (price IS NULL), price DESC
     LIMIT $3`,
    [like, prefix, limit]
  ) as Promise<Array<{ id: number; name: string; slug: string; set_name: string; image: string | null; price: number | null }>>;
}
