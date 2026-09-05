// Advanced Matching Options — "prioritize or exclude specific sets and keywords
// during matching" (CardUploader's Ungraded page; teardown §6b, report §4.12).
//
// A seller scanning a known collection ("this binder is all Base Set and
// Jungle", "ignore Japanese sets") can steer the matcher instead of correcting
// the same miss fifty times. The prefs are plain data: set slugs + free-text
// terms. identify() applies them (exclusions filter candidates out; priorities
// add a score boost), so photos and pasted lines behave identically. Saved per
// seller as `sellers.matching_prefs` (JSON) and prefilled on the scan forms.

export type MatchingPrefs = {
  prioritizeSets: string[]; // set slugs
  excludeSets: string[]; // set slugs
  prioritizeTerms: string[]; // lower-cased keywords matched against card name + set name
  excludeTerms: string[];
};

export const EMPTY_PREFS: MatchingPrefs = { prioritizeSets: [], excludeSets: [], prioritizeTerms: [], excludeTerms: [] };

export type SetRef = { slug: string; name: string };

const MAX_LIST = 20;

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))].slice(0, MAX_LIST);
}

/** Split a comma/newline separated user field into trimmed, lower-cased terms. */
export function splitTerms(v: string | undefined | null): string[] {
  return uniq(
    String(v ?? "")
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 2 && s.length <= 40)
  );
}

// "Base Set", "base-set", "Base" and "Kamigawa Neon Dynasty" all mean the same
// catalog set: compare on letters/digits only, with a trailing "set" ignored.
const setKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/set$/, "");

/** Resolve typed set names (or slugs) against the catalog; unknown entries are dropped. */
export function resolveSets(v: string | undefined | null, sets: SetRef[]): string[] {
  const byKey = new Map<string, string>();
  for (const s of sets) {
    byKey.set(setKey(s.name), s.slug);
    byKey.set(setKey(s.slug), s.slug);
    // "Kamigawa: Neon Dynasty" is also just "Neon Dynasty" to most sellers.
    const afterColon = s.name.split(":")[1];
    if (afterColon && afterColon.trim()) byKey.set(setKey(afterColon), s.slug);
  }
  return uniq(splitTerms(v).map((t) => byKey.get(setKey(t)) ?? "").filter(Boolean));
}

export function isEmptyPrefs(p: MatchingPrefs | null | undefined): boolean {
  return !p || !(p.prioritizeSets.length || p.excludeSets.length || p.prioritizeTerms.length || p.excludeTerms.length);
}

/** Parse the stored JSON; invalid/empty → EMPTY_PREFS. */
export function parseMatchingPrefs(json: string | null | undefined): MatchingPrefs {
  if (!json || !json.trim()) return EMPTY_PREFS;
  try {
    const o = JSON.parse(json);
    const arr = (x: unknown) => (Array.isArray(x) ? uniq(x.map((v) => String(v).toLowerCase().trim())) : []);
    return {
      prioritizeSets: arr(o?.prioritizeSets),
      excludeSets: arr(o?.excludeSets),
      prioritizeTerms: arr(o?.prioritizeTerms),
      excludeTerms: arr(o?.excludeTerms),
    };
  } catch {
    return EMPTY_PREFS;
  }
}

/** Compact JSON for storage; null when nothing is set (so the column stays NULL). */
export function serializeMatchingPrefs(p: MatchingPrefs): string | null {
  return isEmptyPrefs(p) ? null : JSON.stringify(p);
}

/** Read the four form fields (shared by the scan forms and Settings). */
export function prefsFromForm(f: Record<string, string>, sets: SetRef[]): MatchingPrefs {
  return {
    prioritizeSets: resolveSets(f.prioritize_sets, sets),
    excludeSets: resolveSets(f.exclude_sets, sets),
    prioritizeTerms: splitTerms(f.prioritize_terms),
    excludeTerms: splitTerms(f.exclude_terms),
  };
}

/** Form values for prefilling: set slugs rendered back as their catalog names. */
export function prefsToForm(p: MatchingPrefs, sets: SetRef[]): Record<string, string> {
  const nameOf = new Map(sets.map((s) => [s.slug, s.name]));
  const names = (slugs: string[]) => slugs.map((s) => nameOf.get(s) ?? s).join(", ");
  return {
    prioritize_sets: names(p.prioritizeSets),
    exclude_sets: names(p.excludeSets),
    prioritize_terms: p.prioritizeTerms.join(", "),
    exclude_terms: p.excludeTerms.join(", "),
  };
}

/** One-line human summary, e.g. "Prioritize Base Set, Jungle · Exclude japanese". */
export function describePrefs(p: MatchingPrefs, sets: SetRef[]): string {
  const nameOf = new Map(sets.map((s) => [s.slug, s.name]));
  const parts: string[] = [];
  if (p.prioritizeSets.length) parts.push("Prioritize " + p.prioritizeSets.map((s) => nameOf.get(s) ?? s).join(", "));
  if (p.prioritizeTerms.length) parts.push("Prioritize “" + p.prioritizeTerms.join("”, “") + "”");
  if (p.excludeSets.length) parts.push("Exclude " + p.excludeSets.map((s) => nameOf.get(s) ?? s).join(", "));
  if (p.excludeTerms.length) parts.push("Exclude “" + p.excludeTerms.join("”, “") + "”");
  return parts.join(" · ");
}
