// TCGplayer API — per-condition (NM/LP/MP/HP) SKU prices for card pages.
//
// Research (carduploader-data-sourcing-research.md §4): TCGplayer's developer
// program is CLOSED to new applicants ("We are no longer granting new API
// access at this time") — unlike eBay there is nothing to self-serve register
// for. Grandfathered keys keep working indefinitely, and per-condition prices
// are SKU-level data that only this API carries (TCGCSV's mirror explicitly
// excludes SKUs). CardUploader's NM/LP/MP/HP chips imply exactly this access.
//
// So this module is the env-gated seam for the lucky case: if the client ever
// holds a grandfathered/partner keyset, paste it in .env and card pages grow a
// per-condition price panel. Until then the panel is hidden — product-level
// market/low/mid/high still flows daily from TCGCSV via sync:tcgcsv, and
// TCGPLAYER_MOCK=1 renders canned conditions for UI testing.
//
//   TCGPLAYER_PUBLIC_KEY=...   TCGPLAYER_PRIVATE_KEY=...
//   TCGPLAYER_API_VERSION=v1.39.0   (the maintenance-mode current version)
//   TCGPLAYER_MOCK=1                (no keys needed: canned rows)
//
// NOTE: the live path follows TCGplayer's published API reference (token,
// catalog skus/printings/conditions, pricing/sku) but cannot be integration-
// tested here without a real key — verify on first use with one.

const ENV = () => ({
  publicKey: process.env.TCGPLAYER_PUBLIC_KEY ?? "",
  privateKey: process.env.TCGPLAYER_PRIVATE_KEY ?? "",
  version: process.env.TCGPLAYER_API_VERSION ?? "v1.39.0",
  mock: process.env.TCGPLAYER_MOCK === "1",
});

const BASE = () => `https://api.tcgplayer.com/${ENV().version}`;

// game slug -> TCGplayer category id (same map as scripts/sync-tcgcsv.ts)
const CATEGORY_BY_GAME: Record<string, number> = { pokemon: 3, mtg: 1 };

export type ConditionRow = {
  condition: string; // "Near Mint"
  abbr: string; // "NM"
  market_cents: number | null;
  low_cents: number | null;
};
export type ConditionGroup = { printing: string; rows: ConditionRow[] };

export function tcgConfigured(): boolean {
  const e = ENV();
  return e.mock || (e.publicKey !== "" && e.privateKey !== "");
}

// ---- bearer token (docs: ~14-day expiry), cached --------------------------
let tokenCache: { token: string; expiresAt: number } | null = null;

async function bearer(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const e = ENV();
  const res = await fetch("https://api.tcgplayer.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(e.publicKey)}&client_secret=${encodeURIComponent(e.privateKey)}`,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TCGplayer token failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 3600) * 1000 };
  return json.access_token;
}

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${BASE()}${path}`, {
    headers: { Authorization: `Bearer ${await bearer()}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`TCGplayer GET ${path} failed: HTTP ${res.status}`);
  const json = (await res.json()) as any;
  return json.results ?? [];
}

// ---- per-category name maps (stable; cached for the process lifetime) -----
const FALLBACK_CONDITIONS: Record<number, { name: string; abbr: string }> = {
  1: { name: "Near Mint", abbr: "NM" },
  2: { name: "Lightly Played", abbr: "LP" },
  3: { name: "Moderately Played", abbr: "MP" },
  4: { name: "Heavily Played", abbr: "HP" },
  5: { name: "Damaged", abbr: "DMG" },
  6: { name: "Unopened", abbr: "U" },
};
const nameCaches = new Map<string, Map<number, { name: string; abbr: string }>>();

async function categoryNames(categoryId: number, kind: "printings" | "conditions"): Promise<Map<number, { name: string; abbr: string }>> {
  const key = `${kind}:${categoryId}`;
  const hit = nameCaches.get(key);
  if (hit) return hit;
  const map = new Map<number, { name: string; abbr: string }>();
  try {
    const rows = await apiGet(`/catalog/categories/${categoryId}/${kind}`);
    for (const r of rows) {
      const id = kind === "printings" ? r.printingId : r.conditionId;
      map.set(id, { name: r.name ?? String(id), abbr: r.abbreviation ?? r.name ?? String(id) });
    }
  } catch {
    /* fall through to fallbacks below */
  }
  nameCaches.set(key, map);
  return map;
}

// ---- condition prices for one product -------------------------------------
const CACHE_TTL_MS = 30 * 60 * 1000;
const resultCache = new Map<string, { at: number; groups: ConditionGroup[] }>();

export async function conditionPrices(opts: {
  productId: number;
  gameSlug: string;
  /** used only by mock mode to anchor prices */
  mockBaseCents?: number | null;
  mockPrinting?: string;
}): Promise<ConditionGroup[]> {
  const e = ENV();
  if (e.mock) return mockGroups(opts.mockBaseCents ?? null, opts.mockPrinting ?? "Standard", opts.productId);

  const cacheKey = String(opts.productId);
  const hit = resultCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.groups;

  const categoryId = CATEGORY_BY_GAME[opts.gameSlug] ?? 0;
  const [skus, printings, conditions] = await Promise.all([
    apiGet(`/catalog/products/${opts.productId}/skus`) as Promise<
      Array<{ skuId: number; printingId: number; conditionId: number; languageId: number }>
    >,
    categoryNames(categoryId, "printings"),
    categoryNames(categoryId, "conditions"),
  ]);
  if (skus.length === 0) return [];

  const prices = (await apiGet(`/pricing/sku/${skus.map((s) => s.skuId).join(",")}`)) as Array<{
    skuId: number;
    marketPrice: number | null;
    lowPrice: number | null;
  }>;
  const priceBySku = new Map(prices.map((p) => [p.skuId, p]));

  const byPrinting = new Map<number, ConditionRow[]>();
  for (const sku of skus) {
    const p = priceBySku.get(sku.skuId);
    if (!p || (p.marketPrice == null && p.lowPrice == null)) continue;
    const cond = conditions.get(sku.conditionId) ?? FALLBACK_CONDITIONS[sku.conditionId] ?? { name: `Condition ${sku.conditionId}`, abbr: String(sku.conditionId) };
    const rows = byPrinting.get(sku.printingId) ?? [];
    rows.push({
      condition: cond.name,
      abbr: cond.abbr,
      market_cents: p.marketPrice != null ? Math.round(p.marketPrice * 100) : null,
      low_cents: p.lowPrice != null ? Math.round(p.lowPrice * 100) : null,
    });
    byPrinting.set(sku.printingId, rows);
  }

  const condOrder = ["NM", "LP", "MP", "HP", "DMG", "U"];
  const groups: ConditionGroup[] = [...byPrinting.entries()].map(([printingId, rows]) => ({
    printing: printings.get(printingId)?.name ?? `Printing ${printingId}`,
    rows: rows.sort((a, b) => condOrder.indexOf(a.abbr) - condOrder.indexOf(b.abbr)),
  }));

  resultCache.set(cacheKey, { at: Date.now(), groups });
  if (resultCache.size > 300) {
    const oldest = [...resultCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) resultCache.delete(oldest[0]);
  }
  return groups;
}

// Canned conditions anchored to the variant's real market price when known.
function mockGroups(baseCents: number | null, printing: string, productId: number): ConditionGroup[] {
  let anchor = baseCents ?? 0;
  if (!anchor) {
    let h = productId >>> 0;
    h = (h * 2654435761) >>> 0;
    anchor = 300 + (h % 50_000);
  }
  const mult: Array<[string, string, number]> = [
    ["Near Mint", "NM", 1.0],
    ["Lightly Played", "LP", 0.85],
    ["Moderately Played", "MP", 0.7],
    ["Heavily Played", "HP", 0.55],
    ["Damaged", "DMG", 0.4],
  ];
  return [
    {
      printing,
      rows: mult.map(([condition, abbr, m]) => ({
        condition,
        abbr,
        market_cents: Math.round(anchor * m),
        low_cents: Math.round(anchor * m * 0.9),
      })),
    },
  ];
}
