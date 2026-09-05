// Pricing rules (spec §6): market price, market ± %, or a fixed price, with a
// manual override always possible. Prices are integer cents throughout.

export type PriceMode = "market" | "pct" | "fixed";

export type PriceRule = {
  mode: PriceMode;
  pct?: number | null; // signed percent, e.g. 10 or -5 (used when mode = 'pct')
  fixed_cents?: number | null; // used when mode = 'fixed'
};

/** Resolve a rule against a market price. Returns cents, or null if unknowable. */
export function resolvePrice(marketCents: number | null | undefined, rule: PriceRule): number | null {
  if (rule.mode === "fixed") return rule.fixed_cents ?? null;
  if (marketCents == null) return null;
  if (rule.mode === "market") return marketCents;
  // pct
  const pct = rule.pct ?? 0;
  const out = Math.round(marketCents * (1 + pct / 100));
  return Math.max(0, out);
}

/** Short human label for a rule, e.g. "Market + 10%" or "Fixed $4.00". */
export function ruleLabel(rule: PriceRule): string {
  switch (rule.mode) {
    case "market":
      return "Market";
    case "pct": {
      const p = rule.pct ?? 0;
      if (p === 0) return "Market";
      return `Market ${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
    }
    case "fixed":
      return "Fixed price";
  }
}

export const PRICE_MODES: Array<{ key: string; label: string }> = [
  { key: "market", label: "Market" },
  { key: "pct:10", label: "Market + 10%" },
  { key: "pct:5", label: "Market + 5%" },
  { key: "pct:-5", label: "Market − 5%" },
  { key: "pct:-10", label: "Market − 10%" },
  { key: "fixed", label: "Fixed $" },
];

/** Parse a "mode:pct" select value (e.g. "pct:-5", "market", "fixed"). */
export function parseRuleKey(key: string): { mode: PriceMode; pct: number } {
  if (key === "fixed") return { mode: "fixed", pct: 0 };
  if (key.startsWith("pct:")) return { mode: "pct", pct: Number(key.slice(4)) || 0 };
  return { mode: "market", pct: 0 };
}

/** The select value for a stored rule, so the dropdown re-selects correctly. */
export function ruleKey(mode: string, pct: number): string {
  if (mode === "fixed") return "fixed";
  if (mode === "pct") return `pct:${pct}`;
  return "market";
}

// ---- automatic pricing preference ----------------------------------------
// CardUploader's Configuration → Ungraded → "Automatic Pricing": a first and
// second choice between the price you last listed a card at and the market rule,
// plus "do not price below start price". Modelled here as one preference + an
// optional floor, applied whenever a scan item's price is first resolved.

export type AutoPricePref = "rule" | "previous_first" | "previous_only";

export const AUTO_PRICE_PREFS: Array<{ key: AutoPricePref; label: string; hint: string }> = [
  { key: "previous_first", label: "Previous price first, then pricing rule", hint: "Re-listing the same printing? Reuse what you priced it at last time; fall back to the rule for new cards." },
  { key: "rule", label: "Pricing rule only", hint: "Always compute from market (Market, Market ± %, or Fixed). Previous prices are shown as a hint only." },
  { key: "previous_only", label: "Previous price only", hint: "Never auto-price from market — leave the price empty for cards you haven't listed before." },
];

export function parseAutoPricePref(v: string | null | undefined): AutoPricePref {
  return v === "previous_first" || v === "previous_only" ? v : "rule";
}

export type AutoPriceResult = { price: number | null; source: "previous" | "rule" | "floor" | null };

/**
 * Pick the automatic price for a freshly identified card from the seller's
 * preference, then enforce the floor ("never price below $X").
 */
export function autoPrice(
  ruled: number | null,
  prev: number | null,
  pref: AutoPricePref,
  floorCents: number | null | undefined
): AutoPriceResult {
  let price: number | null;
  let source: AutoPriceResult["source"];
  if (pref === "previous_only") {
    price = prev;
    source = prev != null ? "previous" : null;
  } else if (pref === "previous_first" && prev != null) {
    price = prev;
    source = "previous";
  } else {
    price = ruled;
    source = ruled != null ? "rule" : null;
  }
  return applyFloor(price, floorCents, source);
}

/** Raise an automatic price to the floor when one is set. */
export function applyFloor(
  price: number | null,
  floorCents: number | null | undefined,
  source: AutoPriceResult["source"] = "rule"
): AutoPriceResult {
  if (price != null && floorCents != null && floorCents > 0 && price < floorCents) return { price: floorCents, source: "floor" };
  return { price, source };
}

export const CONDITIONS: Array<{ key: string; label: string }> = [
  { key: "NM", label: "Near Mint" },
  { key: "LP", label: "Lightly Played" },
  { key: "MP", label: "Moderately Played" },
  { key: "HP", label: "Heavily Played" },
  { key: "DMG", label: "Damaged" },
];

export const LANGUAGES = ["EN", "JP", "DE", "FR", "IT", "ES", "PT", "KR", "ZH"];
