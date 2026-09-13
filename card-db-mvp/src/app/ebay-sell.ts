// eBay Sell APIs — the seller-side integration (report §3.5, §8):
//   * OAuth authorization-code "Connect eBay account" (user tokens + refresh)
//   * Account API: business policies (fulfillment / payment / return) by ID
//   * Inventory API: merchant location, inventory items, offers, publish /
//     revise / withdraw, bulk price+quantity sync
//   * Fulfillment API: pull open orders, mark them shipped
//
// Everything routes through one `api()` helper with the seller's token; eBay's
// error payloads are turned into readable messages so a rejected listing says
// *why* (the pre-flight in `preflightListing` catches the CSV-era failures —
// unknown policy, missing location, no image, over-long title — before a call
// is made). `EBAY_MOCK=1` runs the whole flow against canned responses so the
// UI is testable without a developer keyset.
//
// Setup: developer.ebay.com → app keyset (App ID / Cert ID) → "User tokens" →
// create a RuName whose "auth accepted URL" is https://<host>/app/ebay/callback.
//   EBAY_CLIENT_ID=…  EBAY_CLIENT_SECRET=…  EBAY_RU_NAME=…  EBAY_ENV=production|sandbox

import { query, one } from "../pg.ts";
import { randomBytes } from "node:crypto";
import { currentSellerId } from "./session-context.ts";
import { getListing, getInventoryItem, getSeller, updateSeller, type Listing } from "./store.ts";

const ENV = () => ({
  clientId: process.env.EBAY_CLIENT_ID ?? "",
  clientSecret: process.env.EBAY_CLIENT_SECRET ?? "",
  ruName: process.env.EBAY_RU_NAME ?? "",
  env: (process.env.EBAY_ENV ?? "production").toLowerCase(),
  marketplace: process.env.EBAY_MARKETPLACE ?? "EBAY_US",
  mock: process.env.EBAY_MOCK === "1",
});
const API_HOST = () => (ENV().env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com");
const AUTH_HOST = () => (ENV().env === "sandbox" ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com");

export const SELL_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

export const LOCATION_KEY = "cardindex-main";

/** True when "Connect eBay" can work: a keyset + RuName, or mock mode. */
export function ebaySellConfigured(): boolean {
  const e = ENV();
  return e.mock || (e.clientId !== "" && e.clientSecret !== "" && e.ruName !== "");
}
export const ebayIsMock = (): boolean => ENV().mock;
export const ebayMarketplace = (): string => ENV().marketplace;

// ---- schema ---------------------------------------------------------------

export async function ensureEbaySchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ebay_connections (
      seller_id          bigint PRIMARY KEY REFERENCES sellers(id) ON DELETE CASCADE,
      ebay_user          text,
      access_token       text NOT NULL,
      access_expires_at  timestamptz NOT NULL,
      refresh_token      text NOT NULL,
      refresh_expires_at timestamptz,
      marketplace        text NOT NULL DEFAULT 'EBAY_US',
      location_key       text,
      policies           jsonb,          -- {fulfillment:[{id,name}], payment:[…], return:[…]}
      policy_ids         jsonb,          -- {fulfillment, payment, return} chosen ids
      location           jsonb,          -- {postalCode, country, city, stateOrProvince}
      connected_at       timestamptz NOT NULL DEFAULT now(),
      last_policy_sync   timestamptz,
      last_order_sync    timestamptz
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state      text PRIMARY KEY,
      seller_id  bigint NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  // Sold-sales harvest watermark (app/soldharvest.ts): when the seller's completed
  // orders were last folded into the sold_sales archive.
  await query(`ALTER TABLE ebay_connections ADD COLUMN IF NOT EXISTS last_sold_harvest timestamptz`);
  await query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS ebay_offer_id text`);
  await query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS last_error text`);
  await query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS published_at timestamptz`);
  await query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS publish_attempts integer NOT NULL DEFAULT 0`);
}

// ---- scheduled / staggered publishing -------------------------------------
// CardUploader's "schedule start time" + "Space Out" stagger: drafts carry a
// scheduled_at; a small in-process runner publishes each one when its time
// comes (for sellers with a live connection). Three failed attempts park the
// listing back as a draft with the error on its row, so nothing loops forever.

const MAX_ATTEMPTS = 3;

export type DueListing = { id: number; seller_id: number; title: string; scheduled_at: string };

/** Scheduled listings whose time has come, for sellers connected to eBay. */
export function dueScheduled(sellerId?: number): Promise<DueListing[]> {
  return query<DueListing>(
    `SELECT l.id, l.seller_id, l.title, l.scheduled_at FROM listings l
     JOIN ebay_connections c ON c.seller_id=l.seller_id
     WHERE l.status='scheduled' AND l.marketplace='ebay' AND l.scheduled_at IS NOT NULL AND l.scheduled_at <= now()
       AND l.publish_attempts < $1 ${sellerId ? "AND l.seller_id=$2" : ""}
     ORDER BY l.scheduled_at, l.id LIMIT 50`,
    sellerId ? [MAX_ATTEMPTS, sellerId] : [MAX_ATTEMPTS]
  );
}

/**
 * Publish every due listing (each inside its seller's scope). Returns a
 * summary; failures bump publish_attempts and keep the error on the row.
 */
export async function runScheduledPublishes(
  runAs: <T>(sellerId: number, fn: () => Promise<T>) => Promise<T>,
  sellerId?: number
): Promise<{ published: number; failed: number; parked: number }> {
  const out = { published: 0, failed: 0, parked: 0 };
  for (const d of await dueScheduled(sellerId)) {
    try {
      await runAs(d.seller_id, () => publishListing(d.id));
      out.published++;
    } catch (err) {
      out.failed++;
      const r = await one<{ publish_attempts: number }>(
        "UPDATE listings SET publish_attempts=publish_attempts+1 WHERE id=$1 RETURNING publish_attempts",
        [d.id]
      );
      if ((r?.publish_attempts ?? 0) >= MAX_ATTEMPTS) {
        await query("UPDATE listings SET status='draft' WHERE id=$1", [d.id]);
        out.parked++;
      }
      if (!(err instanceof EbayError)) console.error("scheduled publish:", err);
    }
  }
  return out;
}

let schedulerTimer: NodeJS.Timeout | null = null;

/** Start the in-process runner (every SCHEDULER_INTERVAL_MS, default 60s). Idempotent. */
export function startScheduler(runAs: <T>(sellerId: number, fn: () => Promise<T>) => Promise<T>): void {
  if (schedulerTimer) return;
  const every = Math.max(10_000, Number(process.env.SCHEDULER_INTERVAL_MS) || 60_000);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await runScheduledPublishes(runAs);
      if (r.published || r.failed) console.log(`  scheduler: published ${r.published}, failed ${r.failed}${r.parked ? `, parked ${r.parked}` : ""}`);
    } catch (err) {
      console.error("scheduler tick:", err);
    } finally {
      busy = false;
    }
  };
  schedulerTimer = setInterval(tick, every);
  schedulerTimer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}

// ---- types ----------------------------------------------------------------

export type PolicyRef = { id: string; name: string };
export type Policies = { fulfillment: PolicyRef[]; payment: PolicyRef[]; return: PolicyRef[] };
export type PolicyIds = { fulfillment: string; payment: string; return: string };
export type Location = { postalCode: string; country: string; city: string; stateOrProvince: string };

export type EbayConnection = {
  seller_id: number;
  ebay_user: string | null;
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string | null;
  marketplace: string;
  location_key: string | null;
  policies: string | null;
  policy_ids: string | null;
  location: string | null;
  connected_at: string;
  last_policy_sync: string | null;
  last_order_sync: string | null;
  last_sold_harvest: string | null;
};

export class EbayError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(s) as object) } as T;
  } catch {
    return fallback;
  }
};
export const EMPTY_POLICIES: Policies = { fulfillment: [], payment: [], return: [] };
export const EMPTY_IDS: PolicyIds = { fulfillment: "", payment: "", return: "" };
export const EMPTY_LOCATION: Location = { postalCode: "", country: "US", city: "", stateOrProvince: "" };

export function getConnection(sellerId = currentSellerId()): Promise<EbayConnection | undefined> {
  return one<EbayConnection>("SELECT * FROM ebay_connections WHERE seller_id=$1", [sellerId]);
}
export const policiesOf = (c: EbayConnection | undefined): Policies => parseJson(c?.policies, EMPTY_POLICIES);
export const policyIdsOf = (c: EbayConnection | undefined): PolicyIds => parseJson(c?.policy_ids, EMPTY_IDS);
export const locationOf = (c: EbayConnection | undefined): Location => parseJson(c?.location, EMPTY_LOCATION);

// ---- OAuth ----------------------------------------------------------------

/** Start the consent flow: a one-time state row, then eBay's authorize URL. */
export async function beginConnect(): Promise<string> {
  const e = ENV();
  const state = randomBytes(16).toString("base64url");
  await query("INSERT INTO oauth_states(state, seller_id) VALUES ($1,$2)", [state, currentSellerId()]);
  await query("DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'");
  if (e.mock) return `/app/ebay/callback?code=mock&state=${state}`;
  const p = new URLSearchParams({
    client_id: e.clientId,
    redirect_uri: e.ruName,
    response_type: "code",
    scope: SELL_SCOPES.join(" "),
    state,
  });
  return `${AUTH_HOST()}/oauth2/authorize?${p}`;
}

async function tokenRequest(body: URLSearchParams): Promise<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }> {
  const e = ENV();
  const basic = Buffer.from(`${e.clientId}:${e.clientSecret}`).toString("base64");
  const res = await fetch(`${API_HOST()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new EbayError(`eBay token request failed (HTTP ${res.status}): ${text.slice(0, 300)}`, res.status);
  return JSON.parse(text);
}

/** Finish the consent flow: validate state, exchange the code, store tokens, learn the username. */
export async function completeConnect(code: string, state: string): Promise<EbayConnection> {
  const sid = currentSellerId();
  const st = await one<{ seller_id: number }>("DELETE FROM oauth_states WHERE state=$1 RETURNING seller_id", [state]);
  if (!st || st.seller_id !== sid) throw new EbayError("The eBay sign-in didn't match this session — try Connect again.");
  const e = ENV();
  let tok: { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number };
  if (e.mock) tok = { access_token: "mock-access", expires_in: 7200, refresh_token: "mock-refresh", refresh_token_expires_in: 47304000 };
  else tok = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: e.ruName }));
  const accessExp = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
  const refreshExp = tok.refresh_token_expires_in ? new Date(Date.now() + tok.refresh_token_expires_in * 1000).toISOString() : null;
  await query(
    `INSERT INTO ebay_connections(seller_id, access_token, access_expires_at, refresh_token, refresh_expires_at, marketplace)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (seller_id) DO UPDATE SET access_token=EXCLUDED.access_token, access_expires_at=EXCLUDED.access_expires_at,
       refresh_token=EXCLUDED.refresh_token, refresh_expires_at=EXCLUDED.refresh_expires_at, marketplace=EXCLUDED.marketplace, connected_at=now()`,
    [sid, tok.access_token, accessExp, tok.refresh_token ?? "", refreshExp, e.marketplace]
  );
  await updateSeller({ ebay_connected: 1 });
  // best-effort username
  try {
    const me = e.mock ? { username: "mock_seller" } : await api<{ username: string }>("GET", "/commerce/identity/v1/user/");
    await query("UPDATE ebay_connections SET ebay_user=$1 WHERE seller_id=$2", [me.username ?? null, sid]);
  } catch {
    /* identity scope may be missing on older keysets — not fatal */
  }
  return (await getConnection(sid))!;
}

export async function disconnect(): Promise<void> {
  await query("DELETE FROM ebay_connections WHERE seller_id=$1", [currentSellerId()]);
  await updateSeller({ ebay_connected: 0 });
}

/** A valid user access token for the current seller, refreshing when close to expiry. */
async function userToken(): Promise<string> {
  const c = await getConnection();
  if (!c) throw new EbayError("Connect your eBay account first (Settings → eBay).");
  if (ENV().mock) return c.access_token;
  if (new Date(c.access_expires_at).getTime() - Date.now() > 120_000) return c.access_token;
  const tok = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refresh_token, scope: SELL_SCOPES.join(" ") }));
  const accessExp = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
  await query("UPDATE ebay_connections SET access_token=$1, access_expires_at=$2 WHERE seller_id=$3", [tok.access_token, accessExp, c.seller_id]);
  return tok.access_token;
}

// ---- API helper -----------------------------------------------------------

function explain(status: number, text: string): string {
  try {
    const j = JSON.parse(text);
    const errs: any[] = j.errors ?? (j.error ? [{ message: j.error_description ?? j.error }] : []);
    if (errs.length) return errs.map((e) => [e.message, e.longMessage].filter(Boolean).join(" — ")).join("; ");
  } catch {
    /* not json */
  }
  return `HTTP ${status}${text ? ": " + text.slice(0, 200) : ""}`;
}

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await userToken();
  const e = ENV();
  const res = await fetch(`${API_HOST()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": e.marketplace,
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new EbayError(explain(res.status, text), res.status);
  return (text ? JSON.parse(text) : {}) as T;
}

// ---- business policies ----------------------------------------------------

const MOCK_POLICIES: Policies = {
  fulfillment: [{ id: "6155001000", name: "Cards — Standard Envelope" }, { id: "6155002000", name: "Cards — Tracked (Ground)" }],
  payment: [{ id: "6155003000", name: "Managed Payments" }],
  return: [{ id: "6155004000", name: "30-day returns" }, { id: "6155005000", name: "No returns" }],
};

/** Pull the seller's business policies for the marketplace and store them (ids + names). */
export async function syncPolicies(): Promise<Policies> {
  const sid = currentSellerId();
  let p: Policies;
  if (ENV().mock) p = MOCK_POLICIES;
  else {
    const mp = ENV().marketplace;
    const [f, pay, r] = await Promise.all([
      api<any>("GET", `/sell/account/v1/fulfillment_policy?marketplace_id=${mp}`),
      api<any>("GET", `/sell/account/v1/payment_policy?marketplace_id=${mp}`),
      api<any>("GET", `/sell/account/v1/return_policy?marketplace_id=${mp}`),
    ]);
    p = {
      fulfillment: (f.fulfillmentPolicies ?? []).map((x: any) => ({ id: String(x.fulfillmentPolicyId), name: String(x.name) })),
      payment: (pay.paymentPolicies ?? []).map((x: any) => ({ id: String(x.paymentPolicyId), name: String(x.name) })),
      return: (r.returnPolicies ?? []).map((x: any) => ({ id: String(x.returnPolicyId), name: String(x.name) })),
    };
  }
  await query("UPDATE ebay_connections SET policies=$1::jsonb, last_policy_sync=now() WHERE seller_id=$2", [JSON.stringify(p), sid]);
  // Auto-pick when there's exactly one of a kind and nothing chosen yet.
  const c = await getConnection(sid);
  const ids = policyIdsOf(c);
  const pick = (k: keyof PolicyIds) => {
    if (!ids[k] && p[k].length === 1) ids[k] = p[k][0].id;
  };
  pick("fulfillment");
  pick("payment");
  pick("return");
  await setPolicyIds(ids);
  return p;
}

/** Store chosen policy ids; mirror the names into the seller's CSV fields so file exports agree. */
export async function setPolicyIds(ids: PolicyIds): Promise<void> {
  const sid = currentSellerId();
  await query("UPDATE ebay_connections SET policy_ids=$1::jsonb WHERE seller_id=$2", [JSON.stringify(ids), sid]);
  const p = policiesOf(await getConnection(sid));
  const nameOf = (k: keyof PolicyIds) => p[k].find((x) => x.id === ids[k])?.name ?? null;
  const patch: Record<string, unknown> = {};
  if (nameOf("fulfillment")) patch.ebay_shipping_policy = nameOf("fulfillment");
  if (nameOf("payment")) patch.ebay_payment_policy = nameOf("payment");
  if (nameOf("return")) patch.ebay_return_policy = nameOf("return");
  if (Object.keys(patch).length) await updateSeller(patch);
}

// ---- merchant location ----------------------------------------------------

/** Create (or confirm) the inventory location eBay requires on every offer. */
export async function ensureLocation(loc: Location): Promise<string> {
  const sid = currentSellerId();
  if (!loc.postalCode.trim()) throw new EbayError("A postal code is required for the eBay ship-from location.");
  const location = { ...loc, country: loc.country.trim().toUpperCase() || "US" };
  if (!ENV().mock) {
    try {
      await api("GET", `/sell/inventory/v1/location/${LOCATION_KEY}`);
    } catch (err) {
      if (!(err instanceof EbayError) || err.status !== 404) throw err;
      await api("POST", `/sell/inventory/v1/location/${LOCATION_KEY}`, {
        location: { address: { postalCode: location.postalCode, country: location.country, city: location.city || undefined, stateOrProvince: location.stateOrProvince || undefined } },
        locationTypes: ["WAREHOUSE"],
        name: "CardIndex inventory",
        merchantLocationStatus: "ENABLED",
      });
    }
  }
  await query("UPDATE ebay_connections SET location_key=$1, location=$2::jsonb WHERE seller_id=$3", [LOCATION_KEY, JSON.stringify(location), sid]);
  return LOCATION_KEY;
}

// ---- listings: preflight, publish, revise, withdraw -----------------------

type Prepared = {
  listing: Listing;
  sku: string;
  title: string;
  description: string;
  images: string[];
  aspects: Record<string, string[]>;
  graded: boolean;
  priceCents: number;
  quantity: number;
  category: string;
};

async function prepare(listingId: number): Promise<{ prepared: Prepared | null; problems: string[] }> {
  const problems: string[] = [];
  const l = await getListing(listingId);
  if (!l) return { prepared: null, problems: ["Listing not found."] };
  const inv = l.inventory_id != null ? await getInventoryItem(l.inventory_id) : undefined;
  let specifics: Record<string, string> = {};
  try {
    specifics = JSON.parse(l.item_specifics || "{}");
  } catch {
    specifics = {};
  }
  const graded = specifics["Graded"] === "Yes" || !!inv?.grade;
  const images = [l.image_url, inv?.image_large, inv?.image_small].filter((x): x is string => !!x && /^https?:\/\//.test(x));
  const title = l.title.trim();
  const sku = (l.sku ?? inv?.sku ?? "").trim();
  const priceCents = l.format === "auction" ? l.start_cents ?? l.price_cents ?? 0 : l.price_cents ?? 0;
  if (!title) problems.push("Title is empty.");
  if (title.length > 80) problems.push(`Title is ${title.length} characters — eBay allows 80.`);
  if (!sku) problems.push("SKU is empty — eBay inventory items are keyed by SKU.");
  else if (/[\s"']/.test(sku) || sku.length > 50) problems.push(`SKU "${sku}" has spaces/quotes or is over 50 characters.`);
  if (!(priceCents > 0)) problems.push("Price must be greater than zero.");
  if (l.quantity < 1) problems.push("Quantity must be at least 1.");
  if (!l.category_id) problems.push("eBay category is missing.");
  if (!images.length) problems.push("At least one image with a public https:// URL is required (catalog cards have one; blank listings need an Image URL).");
  const c = await getConnection();
  if (!c) problems.push("Connect your eBay account first (Settings → eBay).");
  else {
    const ids = policyIdsOf(c);
    const p = policiesOf(c);
    for (const k of ["fulfillment", "payment", "return"] as const) {
      if (!ids[k]) problems.push(`No ${k} policy selected (Settings → eBay → Sync policies).`);
      else if (p[k].length && !p[k].some((x) => x.id === ids[k])) problems.push(`The selected ${k} policy no longer exists on your eBay account — re-sync and pick again.`);
    }
    if (!c.location_key) problems.push("No ship-from location yet — save a postal code under Settings → eBay.");
  }
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(specifics)) if (v && v.trim()) aspects[k] = [v.trim().slice(0, 65)];
  const prepared: Prepared = {
    listing: l,
    sku,
    title,
    description: l.description || title,
    images: images.slice(0, 12),
    aspects,
    graded,
    priceCents,
    quantity: l.quantity,
    category: l.category_id ?? "183454",
  };
  return { prepared: problems.length ? null : prepared, problems };
}

/** Pre-flight only: what would stop this listing from publishing. */
export async function preflightListing(listingId: number): Promise<string[]> {
  return (await prepare(listingId)).problems;
}

const dollars = (c: number) => (c / 100).toFixed(2);

/**
 * Publish (or revise, when already on eBay) a listing draft through the
 * Inventory API: inventory item → offer → publish. Stores the offer id and
 * listing id back on the row; errors land in `last_error` and the flash.
 */
export async function publishListing(listingId: number): Promise<{ listingId: string; offerId: string; revised: boolean }> {
  const sid = currentSellerId();
  const { prepared, problems } = await prepare(listingId);
  if (!prepared) {
    await query("UPDATE listings SET last_error=$1 WHERE id=$2 AND seller_id=$3", [problems.join(" "), listingId, sid]);
    throw new EbayError(problems.join(" "));
  }
  const l = prepared.listing;
  const c = (await getConnection())!;
  const ids = policyIdsOf(c);
  const e = ENV();
  const existingOffer = (l as Listing & { ebay_offer_id?: string | null }).ebay_offer_id ?? null;
  try {
    if (e.mock) {
      const offerId = existingOffer ?? `mock-offer-${listingId}`;
      const ebayListingId = l.external_ref ?? String(110000000000 + listingId);
      await query(
        "UPDATE listings SET status='published', external_ref=$1, ebay_offer_id=$2, last_error=NULL, published_at=COALESCE(published_at, now()) WHERE id=$3 AND seller_id=$4",
        [ebayListingId, offerId, listingId, sid]
      );
      return { listingId: ebayListingId, offerId, revised: !!existingOffer };
    }
    // 1) inventory item (product + availability + condition)
    await api("PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(prepared.sku)}`, {
      availability: { shipToLocationAvailability: { quantity: prepared.quantity } },
      condition: prepared.graded ? "LIKE_NEW" : "USED_VERY_GOOD", // 2750 Graded / 4000 Ungraded in the CCG categories
      product: { title: prepared.title, description: prepared.description, imageUrls: prepared.images, aspects: prepared.aspects },
    });
    // 2) offer (create or update)
    const offer: Record<string, unknown> = {
      sku: prepared.sku,
      marketplaceId: e.marketplace,
      format: l.format === "auction" ? "AUCTION" : "FIXED_PRICE",
      availableQuantity: prepared.quantity,
      categoryId: prepared.category,
      listingDescription: prepared.description.replace(/\n/g, "<br>"),
      listingPolicies: { fulfillmentPolicyId: ids.fulfillment, paymentPolicyId: ids.payment, returnPolicyId: ids.return },
      merchantLocationKey: c.location_key,
      pricingSummary:
        l.format === "auction"
          ? { auctionStartPrice: { value: dollars(prepared.priceCents), currency: "USD" } }
          : { price: { value: dollars(prepared.priceCents), currency: "USD" } },
      ...(l.format === "auction" ? { listingDuration: `DAYS_${[1, 3, 5, 7, 10].includes(l.duration_days ?? 7) ? l.duration_days ?? 7 : 7}` } : {}),
    };
    let offerId = existingOffer;
    if (offerId) await api("PUT", `/sell/inventory/v1/offer/${offerId}`, offer);
    else offerId = String((await api<{ offerId: string }>("POST", "/sell/inventory/v1/offer", offer)).offerId);
    // 3) publish (a PUT on a live offer already applied; publishing again is a no-op for live listings)
    let ebayListingId = l.external_ref;
    if (!existingOffer || l.status !== "published") {
      ebayListingId = String((await api<{ listingId: string }>("POST", `/sell/inventory/v1/offer/${offerId}/publish`)).listingId);
    }
    await query(
      "UPDATE listings SET status='published', external_ref=$1, ebay_offer_id=$2, last_error=NULL, published_at=COALESCE(published_at, now()) WHERE id=$3 AND seller_id=$4",
      [ebayListingId, offerId, listingId, sid]
    );
    return { listingId: ebayListingId!, offerId, revised: !!existingOffer };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query("UPDATE listings SET last_error=$1 WHERE id=$2 AND seller_id=$3", [msg.slice(0, 1000), listingId, sid]);
    throw err;
  }
}

/** End a live listing (withdraw the offer). */
export async function endListing(listingId: number): Promise<void> {
  const sid = currentSellerId();
  const l = (await getListing(listingId)) as (Listing & { ebay_offer_id?: string | null }) | undefined;
  if (!l) return;
  if (l.ebay_offer_id && !ENV().mock) await api("POST", `/sell/inventory/v1/offer/${l.ebay_offer_id}/withdraw`);
  await query("UPDATE listings SET status='ended', last_error=NULL WHERE id=$1 AND seller_id=$2", [listingId, sid]);
}

/**
 * Push a new quantity to eBay for every live listing of an inventory row
 * (bulk_update_price_quantity). Called after non-eBay sales so eBay stock stays true.
 */
export async function syncQuantityForInventory(inventoryId: number): Promise<number> {
  const sid = currentSellerId();
  const inv = await getInventoryItem(inventoryId);
  if (!inv) return 0;
  const live = await query<Listing & { ebay_offer_id: string | null }>(
    "SELECT * FROM listings WHERE seller_id=$1 AND inventory_id=$2 AND marketplace='ebay' AND status='published' AND ebay_offer_id IS NOT NULL",
    [sid, inventoryId]
  );
  if (!live.length) return 0;
  if (!ENV().mock) {
    await api("POST", "/sell/inventory/v1/bulk_update_price_quantity", {
      requests: live.map((l) => ({
        sku: l.sku ?? inv.sku,
        shipToLocationAvailability: { quantity: inv.quantity },
        offers: [{ offerId: l.ebay_offer_id, availableQuantity: inv.quantity }],
      })),
    });
  }
  await query("UPDATE listings SET quantity=$1 WHERE seller_id=$2 AND inventory_id=$3 AND status='published'", [inv.quantity, sid, inventoryId]);
  if (inv.quantity <= 0) await query("UPDATE listings SET status='ended' WHERE seller_id=$1 AND inventory_id=$2 AND status='published'", [sid, inventoryId]);
  return live.length;
}

// ---- orders ---------------------------------------------------------------

export type EbayOrder = {
  orderId: string;
  buyer: string;
  shipTo: string;
  total_cents: number | null;
  items: Array<{ sku: string | null; title: string; quantity: number; price_cents: number | null }>;
};

/** Open (unshipped) orders from the Fulfillment API. */
export async function fetchOpenOrders(): Promise<EbayOrder[]> {
  if (ENV().mock) {
    // One sample order against the seller's first listed SKU, so the flow is testable.
    const s = await getSeller();
    const inv = await one<{ sku: string; title: string; price_cents: number | null }>(
      `SELECT inv.sku, c.name AS title, inv.price_cents FROM inventory inv JOIN cards c ON c.id=inv.card_id WHERE inv.seller_id=$1 AND inv.status<>'sold' ORDER BY inv.id LIMIT 1`,
      [s.id]
    );
    return [
      {
        orderId: `MOCK-${s.id}-${new Date().toISOString().slice(0, 10)}`,
        buyer: "mock_buyer",
        shipTo: "Sam Buyer · Portland, OR 97201",
        total_cents: inv?.price_cents ?? 1250,
        items: [{ sku: inv?.sku ?? "CARD-000001", title: inv?.title ?? "Sample card", quantity: 1, price_cents: inv?.price_cents ?? 1250 }],
      },
    ];
  }
  const j = await api<any>("GET", "/sell/fulfillment/v1/order?filter=orderfulfillmentstatus:%7BNOT_STARTED%7CIN_PROGRESS%7D&limit=50");
  return (j.orders ?? []).map((o: any): EbayOrder => {
    const ship = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const addr = ship?.contactAddress;
    const shipTo = [ship?.fullName, addr?.city, addr?.stateOrProvince, addr?.postalCode].filter(Boolean).join(", ");
    const total = o.pricingSummary?.total?.value;
    return {
      orderId: String(o.orderId),
      buyer: String(o.buyer?.username ?? ""),
      shipTo,
      total_cents: total != null ? Math.round(Number(total) * 100) : null,
      items: (o.lineItems ?? []).map((li: any) => ({
        sku: li.sku ?? null,
        title: String(li.title ?? ""),
        quantity: Number(li.quantity ?? 1),
        price_cents: li.lineItemCost?.value != null ? Math.round(Number(li.lineItemCost.value) * 100) : null,
      })),
    };
  });
}

/** One sold line item from a paid, non-cancelled order — the raw material for the sold_sales archive. */
export type EbaySoldLine = {
  orderId: string;
  lineItemId: string;
  legacyItemId: string | null; // the /itm/<id> listing the buyer bought from
  sku: string | null;
  title: string;
  quantity: number;
  unit_cents: number | null; // per-unit sale price (line cost / quantity)
  sold_format: "auction" | "bin" | "unknown";
  sold_on: string; // yyyy-mm-dd, order creation date
};

const ORDER_PAGE = 200;

/**
 * Every PAID line item on orders created since `sinceIso` (pages through the
 * Fulfillment API, which keeps ~2 years). Cancelled orders and unpaid checkouts
 * are dropped: only money that changed hands is a comp. Nothing about the
 * buyer is returned — the archive is public and never carries PII.
 */
export async function fetchCompletedOrderLines(sinceIso: string): Promise<EbaySoldLine[]> {
  if (ENV().mock) {
    // One paid sale against the seller's first stocked SKU so the harvest is testable.
    const s = await getSeller();
    const inv = await one<{ sku: string; title: string; price_cents: number | null }>(
      `SELECT inv.sku, c.name AS title, inv.price_cents FROM inventory inv JOIN cards c ON c.id=inv.card_id WHERE inv.seller_id=$1 AND inv.status<>'sold' ORDER BY inv.id LIMIT 1`,
      [s.id]
    );
    const today = new Date().toISOString().slice(0, 10);
    return [
      {
        orderId: `MOCK-${s.id}-${today}`,
        lineItemId: "1",
        legacyItemId: "123456789012",
        sku: inv?.sku ?? "CARD-000001",
        title: inv?.title ?? "Sample card",
        quantity: 1,
        unit_cents: inv?.price_cents ?? 1250,
        sold_format: "bin",
        sold_on: today,
      },
    ];
  }
  const out: EbaySoldLine[] = [];
  const filter = encodeURIComponent(`creationdate:[${sinceIso}..]`);
  for (let offset = 0; ; offset += ORDER_PAGE) {
    const j = await api<any>("GET", `/sell/fulfillment/v1/order?filter=${filter}&limit=${ORDER_PAGE}&offset=${offset}`);
    const orders: any[] = j.orders ?? [];
    for (const o of orders) {
      if (String(o.orderPaymentStatus ?? "") !== "PAID") continue;
      if (String(o.cancelStatus?.cancelState ?? "NONE_REQUESTED") === "CANCELED") continue;
      const soldOn = String(o.creationDate ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(soldOn)) continue;
      for (const li of o.lineItems ?? []) {
        const qty = Math.max(1, Number(li.quantity ?? 1));
        const cost = li.lineItemCost?.value != null ? Math.round(Number(li.lineItemCost.value) * 100) : null;
        const fmt = String(li.soldFormat ?? "").toUpperCase();
        out.push({
          orderId: String(o.orderId),
          lineItemId: String(li.lineItemId ?? out.length),
          legacyItemId: li.legacyItemId ? String(li.legacyItemId) : null,
          sku: li.sku ?? null,
          title: String(li.title ?? ""),
          quantity: qty,
          unit_cents: cost != null ? Math.round(cost / qty) : null,
          sold_format: fmt === "AUCTION" ? "auction" : fmt === "FIXED_PRICE" ? "bin" : "unknown",
          sold_on: soldOn,
        });
      }
    }
    if (orders.length < ORDER_PAGE || offset + ORDER_PAGE >= Number(j.total ?? 0)) break;
  }
  return out;
}

/** Tell eBay an order shipped (optional tracking). Best-effort: local state is the source of truth. */
export async function markShippedOnEbay(orderRef: string, tracking?: { carrier: string; number: string }): Promise<void> {
  if (ENV().mock) return;
  const o = await api<any>("GET", `/sell/fulfillment/v1/order/${encodeURIComponent(orderRef)}`);
  const lineItems = (o.lineItems ?? []).map((li: any) => ({ lineItemId: li.lineItemId, quantity: li.quantity }));
  await api("POST", `/sell/fulfillment/v1/order/${encodeURIComponent(orderRef)}/shipping_fulfillment`, {
    lineItems,
    shippedDate: new Date().toISOString(),
    ...(tracking ? { shippingCarrierCode: tracking.carrier, trackingNumber: tracking.number } : {}),
  });
}

export async function touchOrderSync(): Promise<void> {
  await query("UPDATE ebay_connections SET last_order_sync=now() WHERE seller_id=$1", [currentSellerId()]);
}
