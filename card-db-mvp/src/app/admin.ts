// Owner console (/admin): the operator's OWN login, user-activity tracking, and
// the cross-tenant queries the console needs (every other store query is scoped
// to ONE seller; these deliberately are not, and are only reachable behind the
// owner-session gate in server.ts).
//
//   * Owner login       — separate from customer accounts. Credentials come from
//                         ADMIN_EMAIL + ADMIN_PASSWORD (env); a successful sign-in
//                         at /admin/login creates a row in `admin_sessions` and
//                         sets its own HttpOnly cookie. No customer account, Pro
//                         or otherwise, can reach /admin.
//   * `sellers.last_seen_at` — bumped on every workspace request.
//   * `activity_log`    — one row per login/signup/page view/action/plan change;
//                         `by_owner` marks events the owner caused inside a
//                         customer's workspace (owner mode).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query, one } from "../pg.ts";

export const ADMIN_COOKIE = "cardindex_admin";
export const ACT_AS_COOKIE = "cardindex_actas";
const ADMIN_SESSION_HOURS = 24;

// ---- schema ---------------------------------------------------------------

export async function ensureAdminSchema(): Promise<void> {
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`);
  await query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      seller_id   bigint NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      by_owner    boolean NOT NULL DEFAULT false,                     -- true when the owner did it inside this customer's workspace
      kind        text   NOT NULL,                                    -- login | signup | logout | page | action | plan_change | owner
      method      text   NOT NULL DEFAULT 'GET',
      path        text   NOT NULL DEFAULT '',
      detail      text,
      created_at  timestamptz NOT NULL DEFAULT now()
    )`);
  await query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS by_owner boolean NOT NULL DEFAULT false`);
  await query(`CREATE INDEX IF NOT EXISTS idx_activity_seller ON activity_log(seller_id, id DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_activity_recent ON activity_log(id DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token       text PRIMARY KEY,
      created_at  timestamptz NOT NULL DEFAULT now(),
      expires_at  timestamptz NOT NULL,
      ip          text
    )`);
}

// ---- owner login ----------------------------------------------------------

/** True when ADMIN_EMAIL and ADMIN_PASSWORD are both set — the console is usable. */
export function adminConfigured(): boolean {
  return !!(process.env.ADMIN_EMAIL ?? "").trim() && !!(process.env.ADMIN_PASSWORD ?? "");
}

export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

/** Constant-time string compare (hash both sides so length never leaks). */
function same(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Brute-force throttle: after 5 failures from one IP, lock that IP out for 15 min.
const ATTEMPT_LIMIT = 5;
const LOCK_MS = 15 * 60_000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

export function adminLockedFor(ip: string): number {
  const a = attempts.get(ip);
  if (!a) return 0;
  return a.lockedUntil > Date.now() ? Math.ceil((a.lockedUntil - Date.now()) / 60_000) : 0;
}

/**
 * Verify the owner credentials. Returns true on success (and clears the IP's
 * failure count); counts a failure otherwise. Always does the same work for a
 * wrong email and a wrong password.
 */
export function adminAuthenticate(email: string, password: string, ip: string): boolean {
  if (!adminConfigured() || adminLockedFor(ip)) return false;
  const okEmail = same(email.trim().toLowerCase(), adminEmail());
  const okPass = same(password, process.env.ADMIN_PASSWORD ?? "");
  if (okEmail && okPass) {
    attempts.delete(ip);
    return true;
  }
  const a = attempts.get(ip) ?? { count: 0, lockedUntil: 0 };
  a.count++;
  if (a.count >= ATTEMPT_LIMIT) {
    a.count = 0;
    a.lockedUntil = Date.now() + LOCK_MS;
  }
  attempts.set(ip, a);
  return false;
}

export async function createAdminSession(ip: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + ADMIN_SESSION_HOURS * 3600_000).toISOString();
  await query(`INSERT INTO admin_sessions (token, expires_at, ip) VALUES ($1, $2, $3)`, [token, expires, ip]);
  return token;
}

/** True when the token is a live owner session. */
export async function adminSessionValid(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const r = await one<{ token: string }>(`SELECT token FROM admin_sessions WHERE token=$1 AND expires_at > now()`, [token]);
  return !!r;
}

export async function destroyAdminSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await query(`DELETE FROM admin_sessions WHERE token=$1`, [token]);
}

// ---- activity tracking ----------------------------------------------------

export type ActivityKind = "login" | "signup" | "logout" | "page" | "action" | "plan_change" | "owner";

export type ActivityInput = {
  sellerId: number;
  byOwner?: boolean;
  kind: ActivityKind;
  method?: string;
  path?: string;
  detail?: string | null;
};

/**
 * Record one event and (for the customer's own actions) bump last_seen_at.
 * Never throws — a logging failure must not break the request it describes.
 */
export async function logActivity(a: ActivityInput): Promise<void> {
  try {
    await query(
      `INSERT INTO activity_log(seller_id, by_owner, kind, method, path, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [a.sellerId, !!a.byOwner, a.kind, a.method ?? "GET", (a.path ?? "").slice(0, 300), a.detail ? a.detail.slice(0, 300) : null]
    );
    if (!a.byOwner) {
      await query("UPDATE sellers SET last_seen_at=now() WHERE id=$1", [a.sellerId]);
    }
  } catch (err) {
    console.error("activity log:", err);
  }
}

const PAGE_LABELS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^\/app$/, () => "Dashboard"],
  [/^\/app\/inventory\/automatic$/, () => "Automatic inventory"],
  [/^\/app\/inventory$/, () => "Inventory"],
  [/^\/app\/batches$/, () => "Batches"],
  [/^\/app\/scan$/, () => "Scan / add cards"],
  [/^\/app\/graded$/, () => "Graded cards"],
  [/^\/app\/listing-creator$/, () => "Listing creator"],
  [/^\/app\/blank-listing$/, () => "Blank listing"],
  [/^\/app\/listings$/, () => "Listings"],
  [/^\/app\/pricing-tool$/, () => "Pricing tool"],
  [/^\/app\/pricing\/(\d+)$/, (m) => `Pricing results #${m[1]}`],
  [/^\/app\/card-search$/, () => "Card search"],
  [/^\/app\/orders\/picklist$/, () => "Picklist"],
  [/^\/app\/orders$/, () => "Orders"],
  [/^\/app\/inbox$/, () => "Inbox"],
  [/^\/app\/settings$/, () => "Settings"],
  [/^\/app\/review\/(\d+)$/, (m) => `Review queue · batch #${m[1]}`],
  [/^\/app\/list\/(\d+)$/, (m) => `Listing builder · inventory #${m[1]}`],
  [/^\/app\/export\/(\w+)\.csv$/, (m) => `Exported ${m[1]} CSV`],
  [/^\/app\/ebay\/connect$/, () => "Started eBay connect"],
  [/^\/app\/ebay\/callback$/, () => "Returned from eBay OAuth"],
];

const ACTION_LABELS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^\/app\/scan\/upload$/, () => "Uploaded card photos"],
  [/^\/app\/scan$/, () => "Pasted a card list"],
  [/^\/app\/pricing-tool\/upload$/, () => "Uploaded photos to the pricing tool"],
  [/^\/app\/pricing-tool$/, () => "Priced a pasted list"],
  [/^\/app\/pricing\/(\d+)\/(share|unshare|convert)$/, (m) => `${m[2] === "share" ? "Shared" : m[2] === "unshare" ? "Unshared" : "Converted"} pricing batch #${m[1]}`],
  [/^\/app\/graded$/, () => "Added graded cards"],
  [/^\/app\/listing-creator$/, () => "Added cards from the catalog"],
  [/^\/app\/blank-listing$/, () => "Created a blank listing"],
  [/^\/app\/review\/(\d+)\/commit$/, (m) => `Added batch #${m[1]} to inventory`],
  [/^\/app\/review\/(\d+)\/item\/(\d+)\/image$/, (m) => `Attached an image · batch #${m[1]}`],
  [/^\/app\/review\/(\d+)\/item\/(\d+)$/, (m) => `Edited a review item · batch #${m[1]}`],
  [/^\/app\/list\/(\d+)$/, (m) => `Created a listing · inventory #${m[1]}`],
  [/^\/app\/listings\/bulk$/, () => "Listings bulk action"],
  [/^\/app\/listings\/(\d+)\/(publish|end)$/, (m) => `${m[2] === "publish" ? "Published" : "Ended"} listing #${m[1]}`],
  [/^\/app\/inventory\/bulk$/, () => "Inventory bulk update"],
  [/^\/app\/inventory\/automatic\/(\d+)$/, (m) => `Updated live listing #${m[1]}`],
  [/^\/app\/orders\/import$/, () => "Imported a pull sheet"],
  [/^\/app\/orders\/fetch-ebay$/, () => "Fetched eBay orders"],
  [/^\/app\/orders\/(\d+)\/(pick|ship|delete)$/, (m) => `${m[2] === "pick" ? "Picked" : m[2] === "ship" ? "Shipped" : "Deleted"} order #${m[1]}`],
  [/^\/app\/orders$/, () => "Created an order"],
  [/^\/app\/inbox$/, () => "Sent feedback"],
  [/^\/app\/settings$/, () => "Saved settings"],
  [/^\/app\/ebay\/disconnect$/, () => "Disconnected eBay"],
  [/^\/app\/ebay\/sync-policies$/, () => "Synced eBay policies"],
];

/** Human label for a workspace request, for the activity feed. */
export function describeActivity(method: string, path: string): string {
  const table = method === "POST" ? ACTION_LABELS : PAGE_LABELS;
  for (const [re, fn] of table) {
    const m = path.match(re);
    if (m) return fn(m);
  }
  return method === "POST" ? `Action: ${path}` : `Viewed ${path}`;
}

// ---- cross-tenant queries (owner only) -------------------------------------

export type UserRow = {
  id: number;
  email: string | null;
  display_name: string;
  plan_tier: string;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  batches: number;
  inventory: number;
  listings: number;
  events_7d: number;
};

export type UserFilter = { q?: string; tier?: string; sort?: string };

const USER_SELECT = `
  SELECT s.id, s.email, s.display_name, s.plan_tier, s.created_at, s.last_login_at, s.last_seen_at,
         (SELECT COUNT(*) FROM scan_batches b WHERE b.seller_id=s.id)::int AS batches,
         (SELECT COUNT(*) FROM inventory i WHERE i.seller_id=s.id)::int AS inventory,
         (SELECT COUNT(*) FROM listings l WHERE l.seller_id=s.id)::int AS listings,
         (SELECT COUNT(*) FROM activity_log a WHERE a.seller_id=s.id AND a.created_at > now() - interval '7 days')::int AS events_7d
  FROM sellers s`;

export function listUsers(f: UserFilter = {}, limit = 500): Promise<UserRow[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (f.q && f.q.trim()) {
    params.push(`%${f.q.trim().toLowerCase()}%`);
    cond.push(`(lower(coalesce(s.email,'')) LIKE $${params.length} OR lower(s.display_name) LIKE $${params.length})`);
  }
  if (f.tier === "pro" || f.tier === "free") {
    params.push(f.tier);
    cond.push(f.tier === "pro" ? `s.plan_tier = $${params.length}` : `s.plan_tier <> 'pro' AND $${params.length} = 'free'`);
  }
  const order =
    f.sort === "newest" ? "s.created_at DESC" :
    f.sort === "name" ? "lower(s.display_name), s.id" :
    f.sort === "tier" ? "(s.plan_tier='pro') DESC, s.last_seen_at DESC NULLS LAST" :
    f.sort === "inventory" ? "inventory DESC, s.id" :
    "s.last_seen_at DESC NULLS LAST, s.last_login_at DESC NULLS LAST, s.id DESC";
  params.push(limit);
  return query<UserRow>(`${USER_SELECT}${cond.length ? " WHERE " + cond.join(" AND ") : ""} ORDER BY ${order} LIMIT $${params.length}`, params);
}

export function getUser(id: number): Promise<UserRow | undefined> {
  return one<UserRow>(`${USER_SELECT} WHERE s.id=$1`, [id]);
}

export type UserUsage = {
  review_items: number;
  inventory_units: number;
  inventory_value_cents: number;
  listed: number;
  sold: number;
  orders: number;
  feedback_open: number;
  last_batch_at: string | null;
};

export async function userUsage(id: number): Promise<UserUsage> {
  return (await one<UserUsage>(
    `SELECT (SELECT COUNT(*) FROM scan_items WHERE seller_id=$1 AND status='needs_review')::int AS review_items,
            (SELECT COALESCE(SUM(quantity),0) FROM inventory WHERE seller_id=$1 AND status<>'sold')::int AS inventory_units,
            (SELECT COALESCE(SUM(quantity*COALESCE(price_cents,0)),0) FROM inventory WHERE seller_id=$1 AND status<>'sold')::bigint AS inventory_value_cents,
            (SELECT COUNT(*) FROM inventory WHERE seller_id=$1 AND status='listed')::int AS listed,
            (SELECT COUNT(*) FROM inventory WHERE seller_id=$1 AND status='sold')::int AS sold,
            (SELECT COUNT(*) FROM orders WHERE seller_id=$1)::int AS orders,
            (SELECT COUNT(*) FROM feedback WHERE seller_id=$1 AND status='open')::int AS feedback_open,
            (SELECT MAX(created_at) FROM scan_batches WHERE seller_id=$1) AS last_batch_at`,
    [id]
  ))!;
}

export type Overview = {
  total: number;
  pro: number;
  free: number;
  active_7d: number;
  active_30d: number;
  new_7d: number;
  new_30d: number;
  feedback_open: number;
  inventory_rows: number;
  listings: number;
  batches: number;
  events_24h: number;
};

export async function overview(): Promise<Overview> {
  return (await one<Overview>(
    `SELECT (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL)::int AS total,
            (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND plan_tier='pro')::int AS pro,
            (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND plan_tier<>'pro')::int AS free,
            (SELECT COUNT(*) FROM sellers WHERE last_seen_at > now() - interval '7 days')::int AS active_7d,
            (SELECT COUNT(*) FROM sellers WHERE last_seen_at > now() - interval '30 days')::int AS active_30d,
            (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND created_at > now() - interval '7 days')::int AS new_7d,
            (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND created_at > now() - interval '30 days')::int AS new_30d,
            (SELECT COUNT(*) FROM feedback WHERE status='open')::int AS feedback_open,
            (SELECT COUNT(*) FROM inventory)::int AS inventory_rows,
            (SELECT COUNT(*) FROM listings)::int AS listings,
            (SELECT COUNT(*) FROM scan_batches)::int AS batches,
            (SELECT COUNT(*) FROM activity_log WHERE created_at > now() - interval '24 hours')::int AS events_24h`
  ))!;
}

export type ActivityRow = {
  id: number;
  seller_id: number;
  by_owner: boolean;
  kind: string;
  method: string;
  path: string;
  detail: string | null;
  created_at: string;
  display_name: string;
  email: string | null;
};

export type ActivityFilter = { sellerId?: number; kind?: string };

export function listActivity(f: ActivityFilter = {}, limit = 200): Promise<ActivityRow[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (f.sellerId) {
    params.push(f.sellerId);
    cond.push(`a.seller_id=$${params.length}`);
  }
  if (f.kind && f.kind !== "all") {
    params.push(f.kind);
    cond.push(`a.kind=$${params.length}`);
  }
  params.push(limit);
  return query<ActivityRow>(
    `SELECT a.*, s.display_name, s.email
     FROM activity_log a
     JOIN sellers s ON s.id=a.seller_id
     ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
     ORDER BY a.id DESC LIMIT $${params.length}`,
    params
  );
}

/** Daily active-user counts for the last N days (owner overview sparkline). */
export function dailyActive(days = 14): Promise<Array<{ day: string; users: number; events: number }>> {
  return query(
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
            COALESCE((SELECT COUNT(DISTINCT seller_id) FROM activity_log a WHERE a.created_at::date = d::date), 0)::int AS users,
            COALESCE((SELECT COUNT(*) FROM activity_log a WHERE a.created_at::date = d::date), 0)::int AS events
     FROM generate_series(now()::date - ($1::int - 1), now()::date, interval '1 day') d
     ORDER BY d`,
    [days]
  );
}

export type FeedbackRow = {
  id: number;
  seller_id: number;
  kind: string;
  title: string;
  body: string;
  status: string;
  reply: string | null;
  created_at: string;
  replied_at: string | null;
  display_name: string;
  email: string | null;
};

/** Every customer's feedback (newest first), open notes first. */
export function listAllFeedback(opts: { sellerId?: number; status?: string } = {}, limit = 200): Promise<FeedbackRow[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (opts.sellerId) {
    params.push(opts.sellerId);
    cond.push(`f.seller_id=$${params.length}`);
  }
  if (opts.status && opts.status !== "all") {
    params.push(opts.status);
    cond.push(`f.status=$${params.length}`);
  }
  params.push(limit);
  return query<FeedbackRow>(
    `SELECT f.*, s.display_name, s.email FROM feedback f JOIN sellers s ON s.id=f.seller_id
     ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
     ORDER BY (f.status='open') DESC, f.id DESC LIMIT $${params.length}`,
    params
  );
}

/** Recent batches for one customer (owner profile page). */
export function userBatches(sellerId: number, limit = 8): Promise<Array<{ id: number; label: string | null; source: string; kind: string; status: string; total: number; review: number; created_at: string }>> {
  return query(
    `SELECT b.id, b.label, b.source, b.kind, b.status, b.total, b.created_at,
            COALESCE(SUM(CASE WHEN i.status='needs_review' THEN 1 ELSE 0 END),0)::int AS review
     FROM scan_batches b LEFT JOIN scan_items i ON i.batch_id=b.id
     WHERE b.seller_id=$1 GROUP BY b.id ORDER BY b.id DESC LIMIT $2`,
    [sellerId, limit]
  );
}

// ---- cookies --------------------------------------------------------------

const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";

function cookie(name: string, value: string, maxAge: number | null): string {
  const attrs = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (maxAge != null) attrs.push(`Max-Age=${maxAge}`);
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

/** Owner-session cookie (24 h, matching the admin_sessions row). */
export function adminCookie(token: string): string {
  return cookie(ADMIN_COOKIE, token, ADMIN_SESSION_HOURS * 3600);
}
export function clearAdminCookie(): string {
  return cookie(ADMIN_COOKIE, "", 0);
}

/** Session-lived cookie (no Max-Age) — closing the browser ends owner mode. */
export function actAsCookie(sellerId: number): string {
  return cookie(ACT_AS_COOKIE, String(sellerId), null);
}
export function clearActAsCookie(): string {
  return cookie(ACT_AS_COOKIE, "", 0);
}
