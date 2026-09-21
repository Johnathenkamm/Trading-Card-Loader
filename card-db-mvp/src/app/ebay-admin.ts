// Owner-console view of the eBay integration (/admin/ebay): what is configured
// and where it came from, whether the Browse API (live listings + prices) and
// the Sell APIs (account link, policies, publish, orders) can run, a live search
// test with timing, and how much eBay data the site already holds.

import { query, one } from "../pg.ts";
import { ebayConfig, ebayConfigSources, maskSecret, parseCampaignId, type EbayConfigSource } from "./ebay-config.ts";
import { ebayConfigured, ebayBrowseHealth, searchListed, type EbayBrowseHealth, type EbayListing } from "../ebay.ts";
import { ebaySellConfigured } from "./ebay-sell.ts";
import { epnCampaignId } from "../affiliate.ts";
import { HARVEST_SOURCE } from "./soldharvest.ts";

export type EbayTest = { at: string; query: string; ok: boolean; ms: number; count: number; error: string | null; items: EbayListing[]; fresh: boolean };

export type EbayAdminStatus = {
  config: { clientId: string; clientIdMasked: string; hasSecret: boolean; secretMasked: string; ruName: string; env: string; marketplace: string; mock: boolean };
  sources: Record<"client_id" | "client_secret" | "ru_name" | "env" | "marketplace" | "mock" | "epn_campid", EbayConfigSource>;
  browseReady: boolean;
  sellReady: boolean;
  epnCampaign: string | null;
  health: EbayBrowseHealth;
  connections: number;
  published: number;
  harvestedSales: number;
  lastTest: EbayTest | null;
  callbackUrl: string;
};

let lastTest: EbayTest | null = null;

export async function ebayAdminStatus(origin: string): Promise<EbayAdminStatus> {
  const c = ebayConfig();
  const [conn, pub, sold] = await Promise.all([
    one<{ n: number }>("SELECT COUNT(*)::int n FROM ebay_connections").catch(() => ({ n: 0 })),
    one<{ n: number }>("SELECT COUNT(*)::int n FROM listings WHERE status='published' AND external_ref IS NOT NULL").catch(() => ({ n: 0 })),
    one<{ n: number }>("SELECT COUNT(*)::int n FROM sold_sales WHERE source=$1", [HARVEST_SOURCE]).catch(() => ({ n: 0 })),
  ]);
  const base = (process.env.APP_BASE_URL ?? origin).replace(/\/+$/, "");
  return {
    config: {
      clientId: c.clientId,
      clientIdMasked: maskSecret(c.clientId),
      hasSecret: !!c.clientSecret,
      secretMasked: maskSecret(c.clientSecret),
      ruName: c.ruName,
      env: c.env,
      marketplace: c.marketplace,
      mock: c.mock,
    },
    sources: ebayConfigSources(),
    browseReady: ebayConfigured(),
    sellReady: ebaySellConfigured(),
    epnCampaign: epnCampaignId(),
    health: ebayBrowseHealth(),
    connections: conn?.n ?? 0,
    published: pub?.n ?? 0,
    harvestedSales: sold?.n ?? 0,
    lastTest,
    callbackUrl: `${base}/app/ebay/callback`,
  };
}

/** Run one live Browse-API search (bypassing the cache) and remember the outcome for the page. */
export async function runEbayTest(q: string, limit = 10): Promise<EbayTest> {
  const t0 = Date.now();
  const at = new Date().toISOString();
  try {
    const items = await searchListed(q, limit, { fresh: true });
    lastTest = { at, query: q, ok: true, ms: Date.now() - t0, count: items.length, error: null, items, fresh: true };
  } catch (err) {
    lastTest = { at, query: q, ok: false, ms: Date.now() - t0, count: 0, error: err instanceof Error ? err.message : String(err), items: [], fresh: true };
  }
  return lastTest;
}

/** The trimmed `meta` rows the console may keep; used by the save handler to decide what to write. */
export function ebayFormToPatch(f: Record<string, string>): Record<string, string | null> {
  const s = (k: string) => (f[k] ?? "").trim();
  const patch: Record<string, string | null> = {};
  if (s("client_id")) patch.client_id = s("client_id");
  if (s("client_secret")) patch.client_secret = s("client_secret");
  patch.ru_name = s("ru_name") || null;
  patch.env = s("env") === "sandbox" ? "sandbox" : "production";
  patch.marketplace = s("marketplace").toUpperCase().replace(/[^A-Z_]/g, "") || "EBAY_US";
  patch.mock = f.mock === "1" ? "1" : "0";
  // Affiliate: a 10-digit campaign id, or a whole Ambassador/EPN share link
  // (the id is read out of it); blank = leave as is, "clear" = fall back to env.
  if (s("epn_campid")) {
    const id = parseCampaignId(s("epn_campid"));
    if (id) patch.epn_campid = id;
  } else if (f.epn_clear === "1") patch.epn_campid = null;
  return patch;
}

/** Common eBay marketplace ids for the select. */
export const EBAY_MARKETPLACES: Array<[string, string]> = [
  ["EBAY_US", "United States (ebay.com)"],
  ["EBAY_CA", "Canada"],
  ["EBAY_GB", "United Kingdom"],
  ["EBAY_AU", "Australia"],
  ["EBAY_DE", "Germany"],
  ["EBAY_FR", "France"],
  ["EBAY_IT", "Italy"],
  ["EBAY_ES", "Spain"],
];

/** Sellers with an eBay connection, for the console table. */
export function listEbayConnections(): Promise<Array<{ seller_id: number; display_name: string; email: string | null; ebay_user: string | null; marketplace: string; connected_at: string; last_policy_sync: string | null; last_order_sync: string | null; last_sold_harvest: string | null; published: number }>> {
  return query(
    `SELECT c.seller_id, s.display_name, s.email, c.ebay_user, c.marketplace, c.connected_at, c.last_policy_sync, c.last_order_sync, c.last_sold_harvest,
            (SELECT COUNT(*)::int FROM listings l WHERE l.seller_id=c.seller_id AND l.status='published') AS published
     FROM ebay_connections c JOIN sellers s ON s.id=c.seller_id ORDER BY c.connected_at DESC`
  ).catch(() => []);
}
