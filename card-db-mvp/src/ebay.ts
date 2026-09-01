// eBay Browse API — live "Listed on eBay" comps for card pages.
//
// Research (carduploader-data-sourcing-research.md §3): searching LIVE eBay
// listings needs no partnership — the Browse API's item_summary/search runs on
// a self-serve developer keyset with an application (client-credentials) token
// and the basic scope. This is the same API class behind CardUploader's
// "eBay Listed" modal. SOLD prices are a different story (no open API; see the
// sold_sales archive + import:sold) — this module is active listings only.
//
// Setup (free): register at developer.ebay.com -> create an app keyset ->
// put the App ID (client id) + Cert ID (client secret) in .env:
//   EBAY_CLIENT_ID=...        EBAY_CLIENT_SECRET=...
//   EBAY_ENV=production       (or sandbox)
//   EBAY_MARKETPLACE=EBAY_US  (EBAY_AU, EBAY_GB, ... — buyer marketplace)
//   EBAY_MOCK=1               (no keys needed: canned rows, for UI testing)
//
// Without config the card page simply doesn't render the panel (the free
// "eBay listed ↗" link-out remains). Results are cached in-memory for 10
// minutes per query — default keysets get 5,000 calls/day.

const ENV = () => ({
  clientId: process.env.EBAY_CLIENT_ID ?? "",
  clientSecret: process.env.EBAY_CLIENT_SECRET ?? "",
  env: (process.env.EBAY_ENV ?? "production").toLowerCase(),
  marketplace: process.env.EBAY_MARKETPLACE ?? "EBAY_US",
  mock: process.env.EBAY_MOCK === "1",
});

const API_HOST = () => (ENV().env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com");

export type EbayListing = {
  title: string;
  price_cents: number | null;
  currency: string;
  url: string | null;
  image: string | null;
  condition: string | null;
  buying: string; // "Buy It Now" | "Auction" | "Auction · N bids" | "Best Offer" | ""
};

export function ebayConfigured(): boolean {
  const e = ENV();
  return e.mock || (e.clientId !== "" && e.clientSecret !== "");
}

// ---- application token (client-credentials), cached until expiry ----------
let tokenCache: { token: string; expiresAt: number } | null = null;

async function appToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const e = ENV();
  const basic = Buffer.from(`${e.clientId}:${e.clientSecret}`).toString("base64");
  const res = await fetch(`${API_HOST()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`eBay token request failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return json.access_token;
}

// ---- search cache (10 min TTL) --------------------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; items: EbayListing[] }>();

function buyingLabel(options: string[] | undefined, bids: number | undefined): string {
  const o = options ?? [];
  if (o.includes("AUCTION")) return bids ? `Auction · ${bids} bids` : "Auction";
  if (o.includes("BEST_OFFER")) return "Best Offer";
  if (o.includes("FIXED_PRICE")) return "Buy It Now";
  return "";
}

/** Live eBay listings for a query. Returns [] when nothing matches. */
export async function searchListed(query: string, limit = 10): Promise<EbayListing[]> {
  const e = ENV();
  if (e.mock) return mockListings(query, limit);

  const key = `${e.marketplace}|${limit}|${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;

  const token = await appToken();
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    // default is FIXED_PRICE only — ask for auctions and best-offer too
    filter: "buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER}",
  });
  const res = await fetch(`${API_HOST()}/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": e.marketplace,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`eBay search failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as any;

  const items: EbayListing[] = (json.itemSummaries ?? []).map((it: any) => {
    const price = it.price ?? it.currentBidPrice;
    return {
      title: String(it.title ?? ""),
      price_cents: price?.value != null ? Math.round(Number(price.value) * 100) : null,
      currency: price?.currency ?? "USD",
      // itemAffiliateWebUrl appears when an EPN campaign id is configured on the keyset
      url: it.itemAffiliateWebUrl ?? it.itemWebUrl ?? null,
      image: it.thumbnailImages?.[0]?.imageUrl ?? it.image?.imageUrl ?? null,
      condition: it.condition ?? null,
      buying: buyingLabel(it.buyingOptions, it.bidCount),
    };
  });

  cache.set(key, { at: Date.now(), items });
  if (cache.size > 300) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return items;
}

// Deterministic canned rows so the panel is testable end-to-end with no keys.
function mockListings(query: string, limit: number): EbayListing[] {
  const base = [
    { mult: 1.0, cond: "Ungraded", buy: "Buy It Now" },
    { mult: 0.93, cond: "Ungraded", buy: "Best Offer" },
    { mult: 1.12, cond: "Graded - PSA 9", buy: "Auction · 12 bids" },
    { mult: 0.88, cond: "Ungraded", buy: "Auction · 3 bids" },
    { mult: 11.8, cond: "Graded - PSA 10", buy: "Buy It Now" },
  ];
  let h = 0;
  for (const ch of query) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const anchor = 500 + (h % 90_000); // cents
  return base.slice(0, limit).map((b, i) => ({
    title: `${query} — mock listing ${i + 1}`,
    price_cents: Math.round(anchor * b.mult),
    currency: "USD",
    url: "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query),
    image: null,
    condition: b.cond,
    buying: b.buy,
  }));
}
