// Public catalog search. The research (carduploader-data-sourcing-research.md §6)
// found CardUploader's text search is plain keyword matching — the exploitable
// upgrade is STRUCTURED search: parse what the query means ("charizard psa 10
// base set reverse holo" -> name:charizard, grade:PSA 10, set:Base, finish:
// reverse holo) and filter facets accordingly. We reuse the seller workspace's
// identify parser (app/identify.ts) so both surfaces speak one query language,
// and pg_trgm (already indexed) supplies typo-tolerant "did you mean".

import { query, one, toPg } from "./pg.ts";
import type { Card } from "./db.ts";
import { parseInput } from "./app/identify.ts";
import { numberSort } from "./util.ts";

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
  /** Filters understood from the free-text query (not removable chips — edit the query). */
  parsedChips: string[];
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

type ParsedQuery = {
  terms: string[];
  gameFromQuery?: string;
  grade?: string;
  number?: string;
  finish?: string;
  finishLabel?: string;
  setSlug?: string;
  setLabel?: string;
};

/** Find a known set spoken inside the query terms and consume its tokens.
 *  Accepts the full set name, the name + trailing "set" ("base set" -> "Base"),
 *  or any >= 2-token contiguous run of the name ("neon dynasty" -> "Kamigawa:
 *  Neon Dynasty"). */
function matchSet(
  terms: string[],
  sets: Array<{ slug: string; name: string }>
): { slug: string; label: string; terms: string[] } | null {
  const tokensOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  let best: { slug: string; label: string; at: number; len: number } | null = null;
  for (const s of sets) {
    const key = tokensOf(s.name);
    const candidates: string[][] = [key];
    if (key[key.length - 1] !== "set") candidates.push([...key, "set"]);
    for (let start = 0; start < key.length; start++) {
      for (let end = key.length; end - start >= 2; end--) {
        if (start === 0 && end === key.length) continue; // already covered
        candidates.push(key.slice(start, end));
      }
    }
    for (const cand of candidates) {
      for (let i = 0; i + cand.length <= terms.length; i++) {
        if (cand.every((t, j) => terms[i + j] === t)) {
          if (!best || cand.length > best.len) best = { slug: s.slug, label: s.name, at: i, len: cand.length };
        }
      }
    }
  }
  if (!best) return null;
  const rest = [...terms.slice(0, best.at), ...terms.slice(best.at + best.len)];
  return { slug: best.slug, label: best.label, terms: rest };
}

async function parseQuery(raw: string): Promise<ParsedQuery> {
  if (!raw.trim()) return { terms: [] };
  // Full structured parse (grade, finish, condition, language, number, qty) —
  // the same language the seller workspace's identify() speaks.
  const p = parseInput(raw);
  let terms = p.nameTerms;

  let gameFromQuery: string | undefined;
  terms = terms.filter((w) => {
    if (GAME_WORDS[w] && !gameFromQuery) {
      gameFromQuery = GAME_WORDS[w];
      return false;
    }
    return true;
  });

  let setSlug: string | undefined;
  let setLabel: string | undefined;
  if (terms.length) {
    const sets = (await query("SELECT slug, name FROM sets")) as Array<{ slug: string; name: string }>;
    const m = matchSet(terms, sets);
    if (m) {
      setSlug = m.slug;
      setLabel = m.label;
      terms = m.terms;
    }
  }

  return {
    terms,
    gameFromQuery,
    grade: p.grade ?? undefined,
    number: p.number ?? undefined,
    finish: p.finish ?? undefined,
    finishLabel: p.finishLabel ?? undefined,
    setSlug,
    setLabel,
  };
}

type Built = { where: string; params: unknown[] };
function buildWhere(p: SearchParams & { number?: string }, terms: string[], exclude: Set<string>): Built {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (!exclude.has("q")) {
    for (const t of terms) {
      cond.push("c.search_text LIKE ?");
      params.push(`%${t}%`);
    }
    const ns = p.number != null ? numberSort(p.number) : null;
    if (ns != null) {
      cond.push("c.number_sort = ?");
      params.push(ns);
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
  const parsed = await parseQuery(p.q ?? "");
  const terms = parsed.terms;

  // Effective filters = explicit params, back-filled by what the query text
  // said. Explicit always wins; parser-derived filters surface as parsedChips
  // (not removable — the honest way to drop them is editing the query).
  const eff: SearchParams & { number?: string } = { ...p };
  const parsedChips: string[] = [];
  if (!eff.game && parsed.gameFromQuery) {
    eff.game = parsed.gameFromQuery;
  }
  if (!eff.set && parsed.setSlug) {
    eff.set = parsed.setSlug;
    parsedChips.push(`Set: ${parsed.setLabel}`);
  }
  if (!eff.finish && parsed.finish) {
    eff.finish = parsed.finish;
    parsedChips.push(parsed.finishLabel ?? parsed.finish);
  }
  if (parsed.number && numberSort(parsed.number) != null) {
    eff.number = parsed.number;
    parsedChips.push(`#${parsed.number}`);
  }
  if (parsed.grade) parsedChips.push(parsed.grade);

  const hasQuery = terms.length > 0;
  const firstTerm = (terms.join(" ") || "").trim();

  const base = buildWhere(eff, terms, new Set());
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
  const gwhere = buildWhere(eff, terms, new Set(["game"]));
  const gameRows = (await query(
    toPg(`SELECT g.slug key, g.name label, COUNT(*) n ${BASE_FROM} ${gwhere.where} GROUP BY g.slug, g.name ORDER BY n DESC`),
    gwhere.params
  )) as Array<{ key: string; label: string; n: number }>;

  const swhere = buildWhere(eff, terms, new Set(["set"]));
  const setRows = (await query(
    toPg(`SELECT s.slug key, s.name label, COUNT(*) n ${BASE_FROM} ${swhere.where} GROUP BY s.slug, s.name ORDER BY n DESC LIMIT 12`),
    swhere.params
  )) as Array<{ key: string; label: string; n: number }>;

  const rwhere = buildWhere(eff, terms, new Set(["rarity"]));
  const rarRows = (await query(
    toPg(
      `SELECT c.rarity key, c.rarity label, COUNT(*) n ${BASE_FROM} ${rwhere.where}${rwhere.where ? " AND" : " WHERE"} c.rarity IS NOT NULL GROUP BY c.rarity ORDER BY n DESC LIMIT 14`
    ),
    rwhere.params
  )) as Array<{ key: string; label: string; n: number }>;

  const fwhere = buildWhere(eff, terms, new Set(["finish"]));
  const finRows = (await query(
    toPg(
      `SELECT vf.finish key, vf.finish_label label, COUNT(DISTINCT c.id) n
       FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
       JOIN card_variants vf ON vf.card_id=c.id ${HP_JOIN}
       ${fwhere.where} GROUP BY vf.finish, vf.finish_label ORDER BY n DESC`
    ),
    fwhere.params
  )) as Array<{ key: string; label: string; n: number }>;

  // ---- typo-tolerant fallback: pg_trgm similarity over the indexed names ----
  // (replaces the old app-side Levenshtein scan; idx_cards_name_trgm serves it)
  let suggestions: string[] = [];
  if (total === 0 && hasQuery) {
    const target = terms.join(" ");
    const simRows = (await query(
      `SELECT name FROM (
         SELECT name, MAX(similarity(lower(name), $1)) AS sim
         FROM cards
         WHERE similarity(lower(name), $1) > 0.3
         GROUP BY name
       ) t ORDER BY sim DESC LIMIT 3`,
      [target]
    )) as Array<{ name: string }>;
    suggestions = simRows.map((r) => r.name);
  }

  return {
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages,
    facets: {
      game: facetList(gameRows, eff.game),
      set: facetList(setRows, eff.set),
      rarity: facetList(rarRows, eff.rarity),
      finish: facetList(finRows, eff.finish),
    },
    parsedChips,
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
