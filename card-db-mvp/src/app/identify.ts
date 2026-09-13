// Card identification (spec §2, build plan §6.1 "the AI core").
//
// The production system fine-tunes a vision/retrieval model on catalog images
// and improves it with confirmed matches from the review queue. Offline, the
// realistic and genuinely useful stand-in is catalog matching: parse what the
// seller typed/scanned (name, number, set, finish, condition, language, grade,
// qty), rank catalog candidates, and confidence-score the top match. This is
// also exactly the "manual card search / show alternatives" path the spec
// requires regardless of how the first guess was produced — so the vision model
// drops in later behind the same IdentifyResult contract, feeding image_url.

import { query, toPg, getVariants } from "../pg.ts";
import type { Variant } from "../db.ts";
import { levenshtein, numberSort, matchSet } from "../util.ts";

export type Parsed = {
  nameTerms: string[];
  number: string | null;
  finish: string | null;
  finishLabel: string | null;
  condition: string | null;
  language: string | null;
  grade: string | null;
  quantity: number;
  raw: string;
  /** Set spoken in the input, resolved against the catalog (identify() fills these). */
  setSlug?: string | null;
  setLabel?: string | null;
};

export type Candidate = {
  card_id: number;
  variant_id: number;
  name: string;
  number: string | null;
  rarity: string | null;
  set_name: string;
  set_slug: string;
  game_name: string;
  game_slug: string;
  image: string | null;
  finish: string;
  finish_label: string;
  language: string;
  score: number; // 0..1
};

export type IdentifyResult = {
  parsed: Parsed;
  best: Candidate | null;
  alternatives: Candidate[];
  confidence: number; // 0..1
  status: "matched" | "needs_review" | "failed";
};

export const AUTO_THRESHOLD = 0.9; // >= auto-matches; below routes to review (build plan §4.5)
const MIN_MATCH = 0.5; // below this, treat as failed even with candidates

/**
 * Advanced Matching Options (app/matching.ts). Exclusions remove candidates
 * before scoring; priorities add a bounded score boost so a card from a set the
 * seller said they're scanning wins ties (and clears the auto-match bar) over
 * the same name in another set.
 */
export type IdentifyOptions = {
  prioritizeSets?: string[]; // set slugs
  excludeSets?: string[];
  prioritizeTerms?: string[]; // lower-case keywords against name + set name
  excludeTerms?: string[];
};
const PRIORITY_SET_BOOST = 0.1;
const PRIORITY_TERM_BOOST = 0.05;

// ---- finish parsing -------------------------------------------------------
// Order matters: check "reverse" before "holo", "1st edition holo" before "1st".
const FINISH_RULES: Array<{ re: RegExp; finish: string; label: string }> = [
  { re: /\b(1st|first)\s*ed(ition)?\s*holo/i, finish: "1st_edition_holofoil", label: "1st Edition Holo" },
  { re: /\b(1st|first)\s*ed(ition)?\b/i, finish: "1st_edition", label: "1st Edition" },
  { re: /\brev(erse)?\s*(holo|foil)?\b/i, finish: "reverse_holofoil", label: "Reverse Holo" },
  { re: /\betched\b/i, finish: "etched", label: "Etched Foil" },
  { re: /\bunlimited\s*holo\b/i, finish: "unlimited_holofoil", label: "Unlimited Holo" },
  { re: /\bunlimited\b/i, finish: "unlimited", label: "Unlimited" },
  { re: /\bholo(foil)?\b/i, finish: "holofoil", label: "Holo" },
  { re: /\bfoil\b/i, finish: "foil", label: "Foil" },
  { re: /\b(non[\s-]?foil|non[\s-]?holo|normal|regular)\b/i, finish: "normal", label: "Normal" },
];

const CONDITION_RULES: Array<{ re: RegExp; code: string }> = [
  { re: /\b(nm|near\s*mint|mint)\b/i, code: "NM" },
  { re: /\b(lp|lightly\s*played|light\s*play)\b/i, code: "LP" },
  { re: /\b(mp|moderately\s*played|moderate\s*play)\b/i, code: "MP" },
  { re: /\b(hp|heavily\s*played|heavy\s*play)\b/i, code: "HP" },
  { re: /\b(dmg|damaged|poor)\b/i, code: "DMG" },
];

const LANG_RULES: Array<{ re: RegExp; code: string }> = [
  { re: /\b(jpn?|japanese)\b/i, code: "JP" },
  { re: /\b(ger|german|deutsch)\b/i, code: "DE" },
  { re: /\b(fr|french|francais)\b/i, code: "FR" },
  { re: /\b(it|italian)\b/i, code: "IT" },
  { re: /\b(sp|es|spanish)\b/i, code: "ES" },
  { re: /\b(pt|portuguese)\b/i, code: "PT" },
  { re: /\b(kr|korean)\b/i, code: "KR" },
  { re: /\b(zh|chinese)\b/i, code: "ZH" },
  { re: /\b(en|eng|english)\b/i, code: "EN" },
];

const STOP = new Set(["the", "a", "an", "of", "and", "card", "tcg"]);

export function parseInput(raw: string): Parsed {
  let s = " " + raw.trim() + " ";
  const eat = (re: RegExp): RegExpMatchArray | null => {
    const m = s.match(re);
    if (m) s = s.replace(m[0], " ");
    return m;
  };

  // quantity: "3x", "x3", "qty 3"
  let quantity = 1;
  const qm = s.match(/\b(?:qty\s*)?(\d{1,3})\s*x\b/i) || s.match(/\bx\s*(\d{1,3})\b/i);
  if (qm) {
    quantity = Math.max(1, Math.min(999, Number(qm[1])));
    s = s.replace(qm[0], " ");
  }

  // grade: PSA/CGC/BGS/SGC/TAG/ACE 10
  let grade: string | null = null;
  const gm = eat(/\b(psa|cgc|bgs|sgc|tag|ace)\s*(10|[1-9](?:\.\d)?)\b/i);
  if (gm) grade = `${gm[1].toUpperCase()} ${gm[2]}`;

  // finish
  let finish: string | null = null;
  let finishLabel: string | null = null;
  for (const r of FINISH_RULES) {
    const m = s.match(r.re);
    if (m) {
      finish = r.finish;
      finishLabel = r.label;
      s = s.replace(m[0], " ");
      break;
    }
  }

  // condition
  let condition: string | null = null;
  for (const r of CONDITION_RULES) {
    const m = s.match(r.re);
    if (m) {
      condition = r.code;
      s = s.replace(m[0], " ");
      break;
    }
  }

  // language (only strip if it looks intentional — avoid eating name words)
  let language: string | null = null;
  for (const r of LANG_RULES) {
    const m = s.match(r.re);
    if (m) {
      language = r.code;
      s = s.replace(m[0], " ");
      break;
    }
  }

  // number: "#119", "020/189", "4/102", "SV049", or a standalone integer
  let number: string | null = null;
  const nm =
    s.match(/#\s*([a-z]{0,3}\d+[a-z]?(?:\/\d+)?)/i) ||
    s.match(/\b(\d{1,4}\/\d{1,4})\b/) ||
    s.match(/\b([a-z]{1,3}\d{1,4})\b/i) ||
    s.match(/\b(\d{1,4})\b/);
  if (nm) {
    number = nm[1];
    s = s.replace(nm[0], " ");
  }

  const nameTerms = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));

  return { nameTerms, number, finish, finishLabel, condition, language, grade, quantity, raw: raw.trim() };
}

// ---- candidate scoring ----------------------------------------------------

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function numericPart(n: string | null): number | null {
  return numberSort(n);
}

type Row = {
  id: number;
  name: string;
  number: string | null;
  rarity: string | null;
  image_small: string | null;
  image_large: string | null;
  set_name: string;
  set_slug: string;
  game_name: string;
  game_slug: string;
};

async function fetchRows(parsed: Parsed): Promise<Row[]> {
  const select = `SELECT c.id, c.name, c.number, c.rarity, c.image_small, c.image_large,
      s.name AS set_name, s.slug AS set_slug, g.name AS game_name, g.slug AS game_slug
    FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id`;
  // A recognized set narrows every stage (and its tokens are already out of nameTerms).
  const setCond = parsed.setSlug ? " AND s.slug = ?" : "";
  const setParams = parsed.setSlug ? [parsed.setSlug] : [];

  // Primary: every name term must appear in search_text (precise).
  const terms = parsed.nameTerms.filter((t) => t.length >= 2);
  if (terms.length) {
    const where = terms.map(() => "c.search_text LIKE ?").join(" AND ");
    const rows = await query<Row>(
      toPg(`${select} WHERE ${where}${setCond} LIMIT 80`),
      [...terms.map((t) => `%${t}%`), ...setParams]
    );
    if (rows.length) return rows;
  }

  // Relax: match the longest single term (recall).
  const longest = [...parsed.nameTerms].sort((a, b) => b.length - a.length)[0];
  if (longest) {
    const rows = await query<Row>(
      toPg(`${select} WHERE c.search_text LIKE ?${setCond} LIMIT 80`),
      [`%${longest}%`, ...setParams]
    );
    if (rows.length) return rows;
  }

  // Typo tolerance: trigram close-match on the card name (idx_cards_name_trgm),
  // so a pasted "chorizard 4/102" still reaches scoring instead of failing.
  if (terms.length) {
    const rows = await query<Row>(
      toPg(`${select} WHERE lower(c.name) % ?${setCond} LIMIT 80`),
      [terms.join(" "), ...setParams]
    );
    if (rows.length) return rows;
  }

  // Last resort: if only a number was given, match by number.
  if (parsed.number) {
    const ns = numericPart(parsed.number);
    if (ns != null)
      return await query<Row>(toPg(`${select} WHERE c.number_sort=?${setCond} LIMIT 80`), [ns, ...setParams]);
  }
  return [];
}

// Token equivalence with typo slack: exact/substring, or a small edit distance
// on longer tokens — so trigram-recalled candidates ("chorizard") score fairly.
function tokenMatches(a: string, b: string): boolean {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const len = Math.min(a.length, b.length);
  if (len >= 6) return levenshtein(a, b) <= 2;
  if (len >= 4) return levenshtein(a, b) <= 1;
  return false;
}

function scoreRow(parsed: Parsed, row: Row): number {
  const inputTokens = parsed.nameTerms;
  const nameTokens = tokenize(row.name);
  const haystack = tokenize(`${row.name} ${row.set_name} ${row.game_name}`);

  // recall: how much of the catalog card's NAME the input covered
  const nameHits = nameTokens.filter((t) => inputTokens.some((i) => tokenMatches(i, t)));
  const recall = nameTokens.length ? nameHits.length / nameTokens.length : 0;

  // precision: how much of what the user typed is accounted for by name+set+game
  const covered = inputTokens.filter((i) => haystack.some((h) => tokenMatches(h, i)));
  const precision = inputTokens.length ? covered.length / inputTokens.length : recall;

  // whole-string similarity as a tie-breaker on close names
  const joined = inputTokens.join(" ");
  const nm = row.name.toLowerCase();
  const strSim = joined ? Math.max(0, 1 - levenshtein(joined, nm) / Math.max(joined.length, nm.length)) : 0;

  let textScore = 0.5 * recall + 0.35 * precision + 0.15 * strSim;

  // number component
  let numberScore = 0.4; // neutral when unknown
  if (parsed.number) {
    const want = numericPart(parsed.number);
    const have = numericPart(row.number);
    if (want != null && have != null) numberScore = want === have ? 1 : 0;
    else if (want != null && have == null) numberScore = 0.2;
  }

  let wText = 0.75,
    wNum = 0.25;
  if (!parsed.number) {
    wText = 1;
    wNum = 0;
  }
  return wText * textScore + wNum * numberScore;
}

async function pickVariant(cardId: number, finish: string | null, language: string | null): Promise<Variant | null> {
  const all = await getVariants(cardId);
  if (all.length === 0) return null;
  // A parsed language ("japanese") narrows to that language's printings when the
  // catalog has them; otherwise fall back to every printing of the card.
  const inLang = language ? all.filter((v) => v.language && v.language.toUpperCase() === language.toUpperCase()) : [];
  const vs = inLang.length ? inLang : all;
  if (finish) {
    const exact = vs.find((v) => v.finish === finish);
    if (exact) return exact;
    const partial = vs.find((v) => v.finish.includes(finish) || finish.includes(v.finish));
    if (partial) return partial;
  }
  return vs.find((v) => v.is_default) === undefined ? vs[0] : vs.find((v) => v.is_default)!;
}

export async function identify(raw: string, opts: IdentifyOptions = {}): Promise<IdentifyResult> {
  const parsed = parseInput(raw);

  // Set awareness: if the input speaks a set name ("charizard base set holo"),
  // consume its tokens and hard-filter candidates to that set — precision and
  // confidence both rise because set words stop reading as unmatched noise.
  if (parsed.nameTerms.length) {
    const sets = (await query("SELECT slug, name FROM sets")) as Array<{ slug: string; name: string }>;
    const m = matchSet(parsed.nameTerms, sets);
    if (m && m.terms.length) {
      // only consume when card-name terms remain — "base set" alone stays a name query
      parsed.setSlug = m.slug;
      parsed.setLabel = m.label;
      parsed.nameTerms = m.terms;
    }
  }

  const fetched = await fetchRows(parsed);

  // Advanced Matching Options: drop excluded sets/keywords, boost prioritized ones.
  const exSets = new Set(opts.excludeSets ?? []);
  const priSets = new Set(opts.prioritizeSets ?? []);
  const exTerms = opts.excludeTerms ?? [];
  const priTerms = opts.prioritizeTerms ?? [];
  const hay = (r: Row) => `${r.name} ${r.set_name}`.toLowerCase();
  const rows = fetched.filter((r) => !exSets.has(r.set_slug) && !exTerms.some((t) => hay(r).includes(t)));

  const scored = rows
    .map((r) => {
      let score = scoreRow(parsed, r);
      if (priSets.has(r.set_slug)) score += PRIORITY_SET_BOOST;
      if (priTerms.length) score += PRIORITY_TERM_BOOST * priTerms.filter((t) => hay(r).includes(t)).length;
      return { row: r, score: Math.min(1, score) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (scored.length === 0) {
    return { parsed, best: null, alternatives: [], confidence: 0, status: "failed" };
  }

  const toCandidate = async (r: Row, score: number): Promise<Candidate | null> => {
    const v = await pickVariant(r.id, parsed.finish, parsed.language);
    if (!v) return null;
    return {
      card_id: r.id,
      variant_id: v.id,
      name: r.name,
      number: r.number,
      rarity: r.rarity,
      set_name: r.set_name,
      set_slug: r.set_slug,
      game_name: r.game_name,
      game_slug: r.game_slug,
      image: r.image_small || r.image_large,
      finish: v.finish,
      finish_label: v.finish_label,
      language: parsed.language || v.language,
      score,
    };
  };

  const cands = (await Promise.all(scored.map((s) => toCandidate(s.row, s.score)))).filter(
    (c): c is Candidate => c !== null
  );
  if (cands.length === 0) return { parsed, best: null, alternatives: [], confidence: 0, status: "failed" };

  const best = cands[0];
  const second = cands[1];

  // Confidence: top score, sharpened by the margin over the runner-up, and
  // floored high when an exact card-number match corroborates the name.
  let confidence = best.score;
  if (second) {
    const margin = best.score - second.score;
    confidence = best.score * (0.8 + 0.2 * Math.min(1, margin / 0.12));
  }
  if (parsed.number) {
    const want = numericPart(parsed.number);
    const have = numericPart(best.number);
    if (want != null && have != null && want === have && best.score >= 0.6) {
      confidence = Math.max(confidence, 0.92);
    }
  }
  // a spoken set that matches the candidate corroborates like a number does
  if (parsed.setSlug && best.set_slug === parsed.setSlug && best.score >= 0.6) {
    confidence = Math.max(confidence, 0.9);
  }
  confidence = Math.max(0, Math.min(0.99, confidence));

  const status: IdentifyResult["status"] =
    best.score < MIN_MATCH ? "failed" : confidence >= AUTO_THRESHOLD ? "matched" : "needs_review";

  return { parsed, best, alternatives: cands.slice(1, 5), confidence, status };
}
