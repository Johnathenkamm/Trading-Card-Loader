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

export const CONDITIONS: Array<{ key: string; label: string }> = [
  { key: "NM", label: "Near Mint" },
  { key: "LP", label: "Lightly Played" },
  { key: "MP", label: "Moderately Played" },
  { key: "HP", label: "Heavily Played" },
  { key: "DMG", label: "Damaged" },
];

export const LANGUAGES = ["EN", "JP", "DE", "FR", "IT", "ES", "PT", "KR", "ZH"];
