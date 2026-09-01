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
import { numberSort, matchSet } from "./util.ts";

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
  /** Grade the result prices are shown at (e.g. "PSA 10") — null = raw market. */
  gradeApplied: string | null;
  /** Set when no exact match existed and results are trigram close-matches for this text. */
  fuzzyFor: string | null;
  suggestions: string[];
  terms: string[];
};

const PAGE_SIZE = 24;

/**
 * The price column joined to every result row. Raw market by default; when the
 * query named a grade ("charizard psa 10"), the SAME join switches to that
 * grade's value — so a graded search doesn't just filter, it REPRICES the
 * results at the grade the user asked about.
 */
function priceJoin(grade: string | null): { sql: string; params: unknown[] } {
  if (grade)
    return {
      sql: `LEFT JOIN (
    SELECT v.card_id AS cid, MAX(pp.price_cents) AS pc, MAX(pp.currency) AS cur
    FROM card_variants v
    JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade = ?
    GROUP BY v.card_id
  ) hp ON hp.cid=c.id`,
      params: [grade],
    };
  return {
    sql: `LEFT JOIN (
    SELECT v.card_id AS cid, MAX(pp.price_cents) AS pc, MAX(pp.currency) AS cur
    FROM card_variants v
    JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL
    GROUP BY v.card_id
  ) hp ON hp.cid=c.id`,
    params: [],
  };
}

function fromClause(grade: string | null): { sql: string; params: unknown[] } {
  const pj = priceJoin(grade);
  return {
    sql: `FROM cards c
  JOIN sets s ON s.id=c.set_id
  JOIN games g ON g.id=s.game_id
  ${pj.sql}`,
    params: pj.params,
  };
}

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

// matchSet lives in util.ts so identify.ts can use it too without a cycle.

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
function buildWhere(
  p: SearchParams & { number?: string },
  terms: string[],
  exclude: Set<string>,
  fuzzy = false
): Built {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (!exclude.has("q")) {
    if (fuzzy && terms.length) {
      // trigram close-match on the card name (uses idx_cards_name_trgm; the
      // % operator applies pg_trgm's similarity threshold, default 0.3)
      cond.push("lower(c.name) % ?");
      params.push(terms.join(" "));
    } else {
      for (const t of terms) {
        cond.push("c.search_text LIKE ?");
        params.push(`%${t}%`);
      }
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

function orderBy(
  sort: string | undefined,
  hasQuery: boolean,
  firstTerm: string,
  fuzzy = false
): { sql: string; params: unknown[] } {
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
      // fuzzy relevance: closest name first
      if (fuzzy && hasQuery)
        return {
          sql: "ORDER BY similarity(lower(c.name), ?) DESC, (hp.pc IS NULL), hp.pc DESC",
          params: [firstTerm],
        };
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
  const grade = parsed.grade ?? null;
  const from = fromClause(grade);

  const countWith = async (fuzzy: boolean) => {
    const b = buildWhere(eff, terms, new Set(), fuzzy);
    const n = (await one<{ n: number }>(
      toPg(`SELECT COUNT(*) n ${from.sql} ${b.where}`),
      [...from.params, ...b.params]
    ))!.n;
    return { b, n };
  };

  // exact structured query first; when it finds nothing, silently retry the
  // name as a trigram close-match ("chorizard" -> Charizard results, bannered)
  let fuzzy = false;
  let { b: base, n: total } = await countWith(false);
  if (total === 0 && hasQuery) {
    const attempt = await countWith(true);
    if (attempt.n > 0) {
      fuzzy = true;
      base = attempt.b;
      total = attempt.n;
    }
  }

  const page = Math.max(1, p.page ?? 1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const ob = orderBy(p.sort, hasQuery, firstTerm, fuzzy);
  const rows = (await query(
    toPg(
      `SELECT c.*, s.name AS set_name, s.slug AS set_slug, g.name AS game_name, g.slug AS game_slug,
              hp.pc AS price_cents, hp.cur AS currency
       ${from.sql} ${base.where} ${ob.sql} LIMIT ? OFFSET ?`
    ),
    [...from.params, ...base.params, ...ob.params, PAGE_SIZE, (page - 1) * PAGE_SIZE]
  )) as SearchResult["rows"];

  // ---- facets (each dimension counted with its own filter removed) ----
  const facetQuery = async (excludeDim: string, select: string, tail: string, extraWhere = "") => {
    const w = buildWhere(eff, terms, new Set([excludeDim]), fuzzy);
    return (await query(
      toPg(`${select} ${from.sql} ${w.where}${extraWhere} ${tail}`),
      [...from.params, ...w.params]
    )) as Array<{ key: string; label: string; n: number }>;
  };

  const gameRows = await facetQuery(
    "game",
    "SELECT g.slug key, g.name label, COUNT(*) n",
    "GROUP BY g.slug, g.name ORDER BY n DESC"
  );
  const setRows = await facetQuery(
    "set",
    "SELECT s.slug key, s.name label, COUNT(*) n",
    "GROUP BY s.slug, s.name ORDER BY n DESC LIMIT 12"
  );
  const rwhere = buildWhere(eff, terms, new Set(["rarity"]), fuzzy);
  const rarRows = (await query(
    toPg(
      `SELECT c.rarity key, c.rarity label, COUNT(*) n ${from.sql} ${rwhere.where}${rwhere.where ? " AND" : " WHERE"} c.rarity IS NOT NULL GROUP BY c.rarity ORDER BY n DESC LIMIT 14`
    ),
    [...from.params, ...rwhere.params]
  )) as Array<{ key: string; label: string; n: number }>;

  const pjf = priceJoin(grade);
  const fwhere = buildWhere(eff, terms, new Set(["finish"]), fuzzy);
  const finRows = (await query(
    toPg(
      `SELECT vf.finish key, vf.finish_label label, COUNT(DISTINCT c.id) n
       FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
       JOIN card_variants vf ON vf.card_id=c.id ${pjf.sql}
       ${fwhere.where} GROUP BY vf.finish, vf.finish_label ORDER BY n DESC`
    ),
    [...pjf.params, ...fwhere.params]
  )) as Array<{ key: string; label: string; n: number }>;

  // ---- "did you mean" (only when even the fuzzy retry found nothing) ------
  let suggestions: string[] = [];
  if (total === 0 && hasQuery) {
    const target = terms.join(" ");
    const simRows = (await query(
      `SELECT name FROM (
         SELECT name, MAX(similarity(lower(name), $1)) AS sim
         FROM cards
         WHERE similarity(lower(name), $1) > 0.25
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
    gradeApplied: grade,
    fuzzyFor: fuzzy ? firstTerm : null,
    suggestions,
    terms,
  };
}

type SuggestRow = {
  id: number;
  name: string;
  slug: string;
  set_name: string;
  number: string | null;
  image: string | null;
  price: number | null;
};

/**
 * Type-ahead, speaking the same structured language as full search: the query
 * is parsed (grade/finish/number stripped from the name terms), a collector
 * number filters directly, and — because the last word is usually mid-typing —
 * a zero-hit query retries once without its final term ("charizard ps" still
 * shows Charizards).
 */
export async function suggest(q: string, limit = 8): Promise<SuggestRow[]> {
  const parsed = parseInput(q);
  const ns = parsed.number != null ? numberSort(parsed.number) : null;

  const run = (terms: string[]): Promise<SuggestRow[]> => {
    const conds: string[] = [];
    const params: unknown[] = [];
    for (const t of terms) {
      conds.push("c.search_text LIKE ?");
      params.push(`%${t}%`);
    }
    if (ns != null) {
      conds.push("c.number_sort = ?");
      params.push(ns);
    }
    if (conds.length === 0) return Promise.resolve([]);
    const prefix = `${terms.join(" ")}%`;
    // Wrapped in a subquery so ORDER BY can reference the computed `price`
    // column in an expression (Postgres only allows a bare SELECT alias as a
    // sort key, not inside one — unlike SQLite).
    return query(
      toPg(
        `SELECT id, name, slug, set_name, number, price, image FROM (
           SELECT c.id, c.name, c.slug, s.name AS set_name, c.number,
                  (SELECT MAX(pp.price_cents) FROM card_variants v JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL WHERE v.card_id=c.id) AS price,
                  c.image_small AS image,
                  (lower(c.name) LIKE ?) AS is_prefix
           FROM cards c JOIN sets s ON s.id=c.set_id
           WHERE ${conds.join(" AND ")}
         ) t
         ORDER BY is_prefix DESC, (price IS NULL), price DESC
         LIMIT ?`
      ),
      [prefix, ...params, limit]
    ) as Promise<SuggestRow[]>;
  };

  let rows = await run(parsed.nameTerms);
  if (rows.length === 0 && parsed.nameTerms.length > 1) {
    rows = await run(parsed.nameTerms.slice(0, -1)); // drop the word being typed
  }
  return rows;
}
