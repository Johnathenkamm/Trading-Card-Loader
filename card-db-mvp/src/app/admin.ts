// Owner console (/admin): the operator's OWN login, member-activity tracking,
// and the cross-tenant queries the console needs (every other data query is
// scoped to ONE member; these deliberately are not, and are only reachable
// behind the owner-session gate in server.ts).
//
//   * Owner login       — separate from member accounts. Credentials come from
//                         ADMIN_EMAIL + ADMIN_PASSWORD (env); a successful sign-in
//                         at /admin/login creates a row in `admin_sessions` and
//                         sets its own HttpOnly cookie. No member account, Pro
//                         or otherwise, can reach /admin.
//   * Owner's own row   — the owner has a personal member row (`sellers.is_owner`)
//                         so the console's uploader (/admin/upload) and the
//                         owner's /collection put cards in the OWNER's own
//                         collection, never in a member's. It is created on boot
//                         from ADMIN_EMAIL and hidden from the member lists.
//   * `sellers.last_seen_at` — bumped on every member-area request.
//   * `activity_log`    — one row per login/signup/page view/action/plan change;
//                         `by_owner` marks events the owner caused inside a
//                         member's collection (owner mode).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query, one } from "../pg.ts";
import { normalizeEmail } from "./auth.ts";

export const ADMIN_COOKIE = "cardindex_admin";
export const ACT_AS_COOKIE = "cardindex_actas";
const ADMIN_SESSION_HOURS = 24;

// ---- schema ---------------------------------------------------------------

export async function ensureAdminSchema(): Promise<void> {
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false`);
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

// ---- the owner's own member row ---------------------------------------------
// The owner uploads to THEIR OWN account, not to a member's. That account is an
// ordinary row flagged `is_owner`, so every data query (uploads, review queue,
// collection, wishlist, settings) works unchanged inside
// `runWithSeller(ownerSellerId())`. Resolution, in order: an existing flagged
// row; else the member account whose email equals ADMIN_EMAIL (the owner signed
// up normally before the console existed — same person, same data); else a
// fresh row. Runs once and is cached for the process lifetime.

let ownerSellerCache: number | null = null;

export async function ensureOwnerSeller(): Promise<number | null> {
  if (ownerSellerCache) return ownerSellerCache;
  if (!adminConfigured()) return null;
  const flagged = await one<{ id: number }>(`SELECT id FROM sellers WHERE is_owner ORDER BY id LIMIT 1`);
  if (flagged) return (ownerSellerCache = flagged.id);
  const email = normalizeEmail(adminEmail());
  const byEmail = await one<{ id: number }>(`SELECT id FROM sellers WHERE lower(email)=$1 ORDER BY id LIMIT 1`, [email]);
  if (byEmail) {
    await query(`UPDATE sellers SET is_owner=true, plan_tier='pro' WHERE id=$1`, [byEmail.id]);
    return (ownerSellerCache = byEmail.id);
  }
  const row = await one<{ id: number }>(
    `INSERT INTO sellers (email, display_name, plan_tier, is_owner, created_at)
     VALUES ($1, 'Owner', 'pro', true, now()) RETURNING id`,
    [email]
  );
  return (ownerSellerCache = row!.id);
}

/** Id of the owner's own seller row, or null when the console isn't configured. */
export function ownerSellerId(): Promise<number | null> {
  return ensureOwnerSeller();
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
  [/^\/collection$/, () => "Collection home"],
  [/^\/collection\/cards$/, () => "Collection"],
  [/^\/collection\/wishlist$/, () => "Wishlist"],
  [/^\/collection\/uploads$/, () => "Uploads"],
  [/^\/collection\/add$/, () => "Add cards"],
  [/^\/collection\/graded$/, () => "Graded slabs"],
  [/^\/collection\/from-set$/, () => "Add from a set"],
  [/^\/collection\/priced\/(\d+)$/, (m) => `Price check #${m[1]}`],
  [/^\/collection\/inbox$/, () => "Inbox"],
  [/^\/collection\/settings$/, () => "Settings"],
  [/^\/collection\/review\/(\d+)$/, (m) => `Review · upload #${m[1]}`],
  [/^\/collection\/export\.csv$/, () => "Exported the collection CSV"],
];

const ACTION_LABELS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^\/collection\/add\/upload/, () => "Uploaded card photos"],
  [/^\/collection\/add$/, () => "Pasted a card list"],
  [/^\/collection\/priced\/(\d+)\/(share|unshare|convert)$/, (m) => `${m[2] === "share" ? "Shared" : m[2] === "unshare" ? "Unshared" : "Converted"} price check #${m[1]}`],
  [/^\/collection\/graded$/, () => "Added graded slabs"],
  [/^\/collection\/from-set$/, () => "Picked cards from a set"],
  [/^\/collection\/review\/(\d+)\/commit$/, (m) => `Added upload #${m[1]} to the collection`],
  [/^\/collection\/review\/(\d+)\/item\/(\d+)\/image$/, (m) => `Attached an image · upload #${m[1]}`],
  [/^\/collection\/review\/(\d+)\/item\/(\d+)$/, (m) => `Edited a review item · upload #${m[1]}`],
  [/^\/collection\/cards\/bulk$/, () => "Collection bulk update"],
  [/^\/collection\/cards\/(\d+)$/, (m) => `Edited collection row #${m[1]}`],
  [/^\/collection\/wishlist$/, () => "Added to the wishlist"],
  [/^\/collection\/wishlist\/(\d+)\/(remove|target)$/, (m) => `${m[2] === "remove" ? "Removed" : "Retargeted"} wishlist card #${m[1]}`],
  [/^\/collection\/inbox$/, () => "Sent feedback"],
  [/^\/collection\/settings$/, () => "Saved settings"],
];

/** Human label for a member-area request, for the activity feed. */
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
  collection: number; // printings in the collection
  wishlist: number;
  events_7d: number;
};

export type UserFilter = { q?: string; tier?: string; sort?: string };

const USER_SELECT = `
  SELECT s.id, s.email, s.display_name, s.plan_tier, s.created_at, s.last_login_at, s.last_seen_at,
         (SELECT COUNT(*) FROM scan_batches b WHERE b.seller_id=s.id)::int AS batches,
         (SELECT COUNT(*) FROM collection_items c WHERE c.seller_id=s.id)::int AS collection,
         (SELECT COUNT(*) FROM wishlist_items w WHERE w.seller_id=s.id)::int AS wishlist,
         (SELECT COUNT(*) FROM activity_log a WHERE a.seller_id=s.id AND a.created_at > now() - interval '7 days')::int AS events_7d
  FROM sellers s`;

/** Members only: the owner's own row never shows up as a user. */
export function listUsers(f: UserFilter = {}, limit = 500): Promise<UserRow[]> {
  const cond: string[] = ["NOT s.is_owner"];
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
    f.sort === "collection" ? "collection DESC, s.id" :
    "s.last_seen_at DESC NULLS LAST, s.last_login_at DESC NULLS LAST, s.id DESC";
  params.push(limit);
  return query<UserRow>(`${USER_SELECT}${cond.length ? " WHERE " + cond.join(" AND ") : ""} ORDER BY ${order} LIMIT $${params.length}`, params);
}

export function getUser(id: number): Promise<UserRow | undefined> {
  return one<UserRow>(`${USER_SELECT} WHERE s.id=$1`, [id]);
}

export type UserUsage = {
  review_items: number;
  collection_units: number;
  collection_value_cents: number;
  graded: number;
  wishlist: number;
  wishlist_hits: number;
  price_checks: number;
  feedback_open: number;
  last_batch_at: string | null;
};

export async function userUsage(id: number): Promise<UserUsage> {
  return (await one<UserUsage>(
    `SELECT (SELECT COUNT(*) FROM scan_items WHERE seller_id=$1 AND status='needs_review')::int AS review_items,
            (SELECT COALESCE(SUM(quantity),0) FROM collection_items WHERE seller_id=$1)::int AS collection_units,
            (SELECT COALESCE(SUM(ci.quantity * COALESCE(gm.price_cents, m.price_cents, 0)),0) FROM collection_items ci
               LEFT JOIN LATERAL (SELECT price_cents FROM price_points WHERE variant_id=ci.variant_id AND kind='market' AND grade IS NULL ORDER BY observed_on DESC LIMIT 1) m ON true
               LEFT JOIN LATERAL (SELECT price_cents FROM price_points WHERE ci.grade IS NOT NULL AND variant_id=ci.variant_id AND kind='market' AND upper(grade)=upper(ci.grade) ORDER BY observed_on DESC LIMIT 1) gm ON true
               WHERE ci.seller_id=$1)::bigint AS collection_value_cents,
            (SELECT COALESCE(SUM(quantity),0) FROM collection_items WHERE seller_id=$1 AND grade IS NOT NULL)::int AS graded,
            (SELECT COUNT(*) FROM wishlist_items WHERE seller_id=$1)::int AS wishlist,
            (SELECT COUNT(*) FROM wishlist_items w
               LEFT JOIN LATERAL (SELECT price_cents FROM price_points WHERE variant_id=w.variant_id AND kind='market' AND grade IS NULL ORDER BY observed_on DESC LIMIT 1) m ON true
               WHERE w.seller_id=$1 AND w.target_cents IS NOT NULL AND m.price_cents <= w.target_cents)::int AS wishlist_hits,
            (SELECT COUNT(*) FROM scan_batches WHERE seller_id=$1 AND kind='pricing')::int AS price_checks,
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
  collection_rows: number;
  wishlist_rows: number;
  batches: number;
  events_24h: number;
};

export async function overview(): Promise<Overview> {
  return (await one<Overview>(
    `SELECT (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND NOT is_owner)::int AS total,
            (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND NOT is_owner AND plan_tier='pro')::int AS pro,
            (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND NOT is_owner AND plan_tier<>'pro')::int AS free,
            (SELECT COUNT(*) FROM sellers WHERE NOT is_owner AND last_seen_at > now() - interval '7 days')::int AS active_7d,
            (SELECT COUNT(*) FROM sellers WHERE NOT is_owner AND last_seen_at > now() - interval '30 days')::int AS active_30d,
            (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND NOT is_owner AND created_at > now() - interval '7 days')::int AS new_7d,
            (SELECT COUNT(*) FROM sellers WHERE email IS NOT NULL AND NOT is_owner AND created_at > now() - interval '30 days')::int AS new_30d,
            (SELECT COUNT(*) FROM feedback WHERE status='open')::int AS feedback_open,
            (SELECT COUNT(*) FROM collection_items c JOIN sellers s ON s.id=c.seller_id WHERE NOT s.is_owner)::int AS collection_rows,
            (SELECT COUNT(*) FROM wishlist_items w JOIN sellers s ON s.id=w.seller_id WHERE NOT s.is_owner)::int AS wishlist_rows,
            (SELECT COUNT(*) FROM scan_batches b JOIN sellers s ON s.id=b.seller_id WHERE NOT s.is_owner)::int AS batches,
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

/** Every member's feedback (newest first), open notes first. */
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

/** Recent uploads for one member (owner profile page). */
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
