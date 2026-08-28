// Authentication: password hashing, session tokens, account creation, and the
// small amount of auth-specific data access (sellers-by-email, sessions).
//
// Zero new dependencies — password hashing uses Node's built-in scrypt and
// sessions are opaque random tokens stored in Postgres. Every customer is a row
// in `sellers` (the workspace tables already carry seller_id), so an account is
// just a seller with an email + password_hash.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query, one } from "../pg.ts";

const scrypt = promisify(scryptCb);

const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 30;
export const SESSION_COOKIE = "cardindex_session";

// ---- schema bootstrap -----------------------------------------------------

/**
 * Ensure the auth columns and sessions table exist. Runs at server start so the
 * feature works against an already-provisioned database without a separate
 * migration step. Idempotent (ADD COLUMN / CREATE TABLE IF NOT EXISTS).
 */
export async function ensureAuthSchema(): Promise<void> {
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS password_hash text`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS last_login_at timestamptz`);
  // One account per email (case-insensitive), but only among real accounts —
  // the legacy passwordless seller may have a null email.
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_sellers_email
       ON sellers (lower(email)) WHERE email IS NOT NULL`
  );
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token       text PRIMARY KEY,
      seller_id   bigint NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      created_at  timestamptz NOT NULL DEFAULT now(),
      expires_at  timestamptz NOT NULL
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sessions_seller ON sessions(seller_id)`);
}

// ---- password hashing -----------------------------------------------------

/** Hash a password: `scrypt:<saltHex>:<hashHex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Verify a password against a stored `scrypt:salt:hash` string (timing-safe). */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let derived: Buffer;
  try {
    derived = (await scrypt(password, salt, expected.length)) as Buffer;
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---- validation -----------------------------------------------------------

export const PASSWORD_MIN = 8;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

// ---- accounts -------------------------------------------------------------

export type Account = { id: number; email: string | null; display_name: string };

export async function findSellerByEmail(email: string): Promise<{ id: number; password_hash: string | null } | undefined> {
  return one<{ id: number; password_hash: string | null }>(
    `SELECT id, password_hash FROM sellers WHERE lower(email) = $1`,
    [normalizeEmail(email)]
  );
}

export async function getAccount(sellerId: number): Promise<Account | undefined> {
  return one<Account>(`SELECT id, email, display_name FROM sellers WHERE id = $1`, [sellerId]);
}

export class AuthError extends Error {}

/**
 * Create an account. The first-ever account claims the legacy implicit seller
 * (the passwordless `id=1` row the single-tenant MVP wrote all its data under),
 * so existing inventory/scans/settings are preserved and land behind the new
 * login. Every subsequent account is an isolated new seller row.
 */
export async function createAccount(
  emailRaw: string,
  password: string,
  displayNameRaw: string
): Promise<number> {
  const email = normalizeEmail(emailRaw);
  const display_name = displayNameRaw.trim().slice(0, 80) || "My card shop";

  if (!isValidEmail(email)) throw new AuthError("Enter a valid email address.");
  if (password.length < PASSWORD_MIN) throw new AuthError(`Password must be at least ${PASSWORD_MIN} characters.`);
  if (await findSellerByEmail(email)) throw new AuthError("An account with that email already exists.");

  const password_hash = await hashPassword(password);

  // Claim the legacy passwordless seller if one exists (one-time migration).
  const legacy = await one<{ id: number }>(
    `SELECT id FROM sellers WHERE password_hash IS NULL AND email IS NULL ORDER BY id LIMIT 1`
  );
  if (legacy) {
    await query(`UPDATE sellers SET email = $1, password_hash = $2, display_name = $3 WHERE id = $4`, [
      email,
      password_hash,
      display_name,
      legacy.id,
    ]);
    return legacy.id;
  }

  const row = await one<{ id: number }>(
    `INSERT INTO sellers (email, password_hash, display_name, created_at)
     VALUES ($1, $2, $3, now()) RETURNING id`,
    [email, password_hash, display_name]
  );
  return row!.id;
}

/** Verify email + password; returns the seller id or null. Updates last_login_at. */
export async function authenticate(emailRaw: string, password: string): Promise<number | null> {
  const seller = await findSellerByEmail(emailRaw);
  if (!seller || !(await verifyPassword(password, seller.password_hash))) return null;
  await query(`UPDATE sellers SET last_login_at = now() WHERE id = $1`, [seller.id]);
  return seller.id;
}

// ---- sessions -------------------------------------------------------------

export async function createSession(sellerId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await query(`INSERT INTO sessions (token, seller_id, expires_at) VALUES ($1, $2, $3)`, [
    token,
    sellerId,
    expires,
  ]);
  return token;
}

/** Resolve a session token to its seller id, or null if missing/expired. */
export async function sellerForSession(token: string | undefined | null): Promise<number | null> {
  if (!token) return null;
  const row = await one<{ seller_id: number }>(
    `SELECT seller_id FROM sessions WHERE token = $1 AND expires_at > now()`,
    [token]
  );
  return row?.seller_id ?? null;
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

// ---- cookies --------------------------------------------------------------

/** Parse a Cookie header into a name→value map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// Secure flag only when the deployment terminates TLS (set COOKIE_SECURE=1 in
// production); off for localhost so the cookie is accepted over http.
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";

export function sessionCookie(token: string): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(): string {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (COOKIE_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}
