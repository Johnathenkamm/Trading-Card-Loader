// eBay Marketplace Account Deletion / Closure notifications.
//
// eBay will not enable a PRODUCTION keyset until the app either subscribes to
// these notifications or is granted an exemption — and the exemption only fits
// apps that keep no eBay user data. We do keep some (a connected seller's eBay
// username, user id and OAuth tokens in `ebay_connections`), so we subscribe:
//
//   developer.ebay.com → Alerts & Notifications → Marketplace Account Deletion
//     Email:                    the owner's address
//     Endpoint:                 https://<host>/ebay/account-deletion
//     Verification token:       shown in the owner console (/admin/ebay)
//   then Save (eBay GETs the endpoint with ?challenge_code=… and checks the
//   hash) and "Send Test Notification".
//
// Protocol:
//   GET  ?challenge_code=X  → 200 {"challengeResponse": sha256hex(X + token + endpoint)}
//   POST {metadata:{topic:"MARKETPLACE_ACCOUNT_DELETION"}, notification:{notificationId,
//         eventDate, data:{username, userId, eiasToken}}}
//        header X-EBAY-SIGNATURE = base64(JSON {alg, kid, signature, digest});
//        the ECDSA public key for `kid` comes from the Notification API.
//        Verified → delete that user's data, answer 204. Bad signature → 412.
//
// What a deletion removes: the matching `ebay_connections` row (username, user
// id, tokens, policies, ship-from address) and the seller's "connected" flag,
// plus the buyer username + ship-to on any pulled eBay order they bought.
// The sold-sales archive never holds eBay identities: the harvest keeps only
// title/price/date/SKU, and soldimport.ts strips seller/buyer fields out of the
// raw feed rows (existing rows are scrubbed once at boot, below).
//
// The verification token is generated once and kept in `meta` (outside the
// `ebay.*` keys, so "Remove console keys" never changes it); EBAY_DELETION_TOKEN
// overrides it. The endpoint URL in the hash must be byte-for-byte what was
// typed into eBay's portal — EBAY_DELETION_ENDPOINT pins it when the derived
// one (APP_BASE_URL, else the request's proto + host) doesn't match.

import type { IncomingMessage } from "node:http";
import { createHash, randomBytes, verify as verifySignature } from "node:crypto";
import { query, one } from "../pg.ts";
import { ebayConfig } from "./ebay-config.ts";
import { ebayAppToken, ebayConfigured } from "../ebay.ts";

export const DELETION_PATH = "/ebay/account-deletion";
const TOKEN_META_KEY = "ebay-deletion-token";
const SCRUB_META_KEY = "sold-raw-identity-scrub-v1";

/** Feed-row keys that name an eBay member; never persisted in sold_sales.raw. */
export const IDENTITY_KEY = /seller|buyer|bidder|winner|member|feedback|email|^user|user_?name|user_?id/i;

let storedToken = "";

export async function ensureDeletionSchema(): Promise<void> {
  await query(`ALTER TABLE ebay_connections ADD COLUMN IF NOT EXISTS ebay_user_id text`);
  // Receipt log for dedupe and the console — deliberately no username / user id.
  await query(`
    CREATE TABLE IF NOT EXISTS ebay_deletion_log (
      notification_id     text PRIMARY KEY,
      event_date          timestamptz,
      received_at         timestamptz NOT NULL DEFAULT now(),
      connections_removed integer NOT NULL DEFAULT 0
    )`);
  const t = await one<{ value: string }>("SELECT value FROM meta WHERE key=$1", [TOKEN_META_KEY]);
  if (t?.value) storedToken = t.value;
  else {
    // 48 chars of [A-Za-z0-9_-] — inside eBay's 32–80 character rule.
    storedToken = randomBytes(36).toString("base64url");
    await query("INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING", [TOKEN_META_KEY, storedToken]);
  }
  // One-time: drop seller/buyer fields already sitting in imported feed rows.
  const done = await one<{ value: string }>("SELECT value FROM meta WHERE key=$1", [SCRUB_META_KEY]);
  if (!done) {
    const re = IDENTITY_KEY.source;
    const r = await query<{ id: number }>(
      `UPDATE sold_sales s SET raw = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(s.raw) e(k, v) WHERE k !~* $1)
       WHERE jsonb_typeof(s.raw) = 'object' AND EXISTS (SELECT 1 FROM jsonb_object_keys(s.raw) k WHERE k ~* $1)
       RETURNING id`,
      [re]
    );
    if (r.length) console.log(`  eBay privacy: removed seller/buyer fields from ${r.length} archived sale row${r.length === 1 ? "" : "s"}`);
    await query("INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING", [SCRUB_META_KEY, new Date().toISOString()]);
  }
}

/** Drop member-identifying keys from a feed row before it is stored. */
export function stripIdentity<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!IDENTITY_KEY.test(k)) out[k] = v;
  return out as T;
}

export function deletionVerificationToken(): string {
  return process.env.EBAY_DELETION_TOKEN?.trim() || storedToken;
}

/** The public origin as eBay reaches it (Railway terminates TLS, so trust X-Forwarded-Proto). */
function publicOrigin(req: IncomingMessage): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, "");
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0].trim();
  const xfp = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  return `${xfp || (local ? "http" : "https")}://${host}`;
}

export function deletionEndpointUrl(req: IncomingMessage): string {
  return process.env.EBAY_DELETION_ENDPOINT?.trim() || publicOrigin(req) + DELETION_PATH;
}

/** GET ?challenge_code=… → the hash eBay expects back. */
export function challengeResponse(challengeCode: string, endpoint: string): string {
  return createHash("sha256").update(challengeCode).update(deletionVerificationToken()).update(endpoint).digest("hex");
}

// ---- signature verification ----------------------------------------------

const KEY_TTL_MS = 60 * 60 * 1000;
const keyCache = new Map<string, { at: number; pem: string; digest: string }>();

/** eBay returns the key as one line between the PEM armour; rewrap it so node can parse it. */
function toPem(key: string): string {
  const body = key.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

async function publicKey(kid: string): Promise<{ pem: string; digest: string }> {
  const hit = keyCache.get(kid);
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit;
  const host = ebayConfig().env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const res = await fetch(`${host}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, {
    headers: { Authorization: `Bearer ${await ebayAppToken()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`public key lookup failed: HTTP ${res.status}`);
  const j = (await res.json()) as { key: string; digest?: string };
  const entry = { at: Date.now(), pem: toPem(j.key), digest: (j.digest ?? "SHA1").toLowerCase() };
  keyCache.set(kid, entry);
  return entry;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/** Verify X-EBAY-SIGNATURE over the raw body. Mock mode without keys skips the check (local testing). */
export async function verifyNotification(rawBody: string, header: string | undefined): Promise<SignatureCheck> {
  const cfg = ebayConfig();
  if (cfg.mock && (!cfg.clientId || !cfg.clientSecret)) return { ok: true };
  if (!ebayConfigured()) return { ok: false, reason: "no eBay keyset configured" };
  if (!header) return { ok: false, reason: "missing X-EBAY-SIGNATURE" };
  let sig: { kid?: string; signature?: string };
  try {
    sig = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "unreadable signature header" };
  }
  if (!sig.kid || !sig.signature) return { ok: false, reason: "signature header lacks kid/signature" };
  const key = await publicKey(sig.kid);
  const signature = Buffer.from(sig.signature, "base64");
  // eBay signs the JSON as it serialises it; the raw bytes normally match, the
  // re-serialised form covers a proxy that reformatted the body.
  const candidates = [rawBody];
  try {
    const again = JSON.stringify(JSON.parse(rawBody));
    if (again !== rawBody) candidates.push(again);
  } catch {
    /* not JSON — the raw attempt decides */
  }
  for (const c of candidates) if (verifySignature(key.digest, Buffer.from(c, "utf8"), key.pem, signature)) return { ok: true };
  return { ok: false, reason: "signature does not verify" };
}

// ---- the deletion itself -------------------------------------------------

export type DeletionNotice = { notificationId: string; eventDate: string | null; username: string; userId: string };

export function parseNotice(rawBody: string): DeletionNotice | null {
  try {
    const j = JSON.parse(rawBody);
    const n = j?.notification;
    if (!n?.notificationId) return null;
    return {
      notificationId: String(n.notificationId),
      eventDate: n.eventDate ? String(n.eventDate) : null,
      username: String(n.data?.username ?? "").trim(),
      userId: String(n.data?.userId ?? "").trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Remove everything held about that eBay member. Idempotent per notification
 * id (eBay retries until it gets a 2xx). Returns how many connections went.
 */
export async function applyDeletion(n: DeletionNotice): Promise<{ duplicate: boolean; removed: number }> {
  const seen = await one<{ notification_id: string }>("SELECT notification_id FROM ebay_deletion_log WHERE notification_id=$1", [n.notificationId]);
  if (seen) return { duplicate: true, removed: 0 };
  // Delete first, log after: if anything throws, eBay's retry finds no receipt
  // and runs the deletion again (it is idempotent).
  const gone = n.username || n.userId
    ? await query<{ seller_id: number }>(
        `DELETE FROM ebay_connections
         WHERE ($1 <> '' AND ebay_user_id = $1) OR ($2 <> '' AND lower(ebay_user) = lower($2))
         RETURNING seller_id`,
        [n.userId, n.username]
      )
    : [];
  for (const g of gone) await query("UPDATE sellers SET ebay_connected=false WHERE id=$1", [g.seller_id]);
  // The member may also be a BUYER on a seller's pulled eBay orders: clear the
  // username and ship-to (name, city, state, ZIP) but keep the order itself.
  if (n.username) {
    await query(
      "UPDATE orders SET buyer=NULL, ship_to=NULL WHERE platform='ebay' AND buyer IS NOT NULL AND lower(buyer)=lower($1)",
      [n.username]
    ).catch(() => undefined); // orders table absent on a bare database
  }
  await query(
    `INSERT INTO ebay_deletion_log (notification_id, event_date, connections_removed) VALUES ($1, $2, $3)
     ON CONFLICT (notification_id) DO UPDATE SET connections_removed = ebay_deletion_log.connections_removed + EXCLUDED.connections_removed`,
    [n.notificationId, n.eventDate && !Number.isNaN(Date.parse(n.eventDate)) ? n.eventDate : null, gone.length]
  );
  if (gone.length) console.log(`  eBay account deletion: removed ${gone.length} connection${gone.length === 1 ? "" : "s"} (notification ${n.notificationId})`);
  return { duplicate: false, removed: gone.length };
}

/** Console summary: how many notices arrived, when the last one did, how many matched a seller. */
export async function deletionStats(): Promise<{ received: number; lastAt: string | null; removed: number }> {
  const r = await one<{ n: number; last: string | null; removed: number }>(
    "SELECT COUNT(*)::int n, MAX(received_at) AS last, COALESCE(SUM(connections_removed),0)::int removed FROM ebay_deletion_log"
  ).catch(() => undefined);
  return { received: r?.n ?? 0, lastAt: r?.last ?? null, removed: r?.removed ?? 0 };
}
