// Postgres data layer — the production mirror of db.ts.
//
// db.ts talks to node:sqlite synchronously; this talks to Postgres asynchronously
// via `pg`. The function names and return shapes match db.ts so the incremental
// port is mechanical: change `from "./db.ts"` to `from "./pg.ts"` and `await` the
// call. Nothing here is wired into the running server yet — the SQLite MVP keeps
// working until each route is switched over.
//
// Requires: npm install  (adds the `pg` dependency)
// Config:   DATABASE_URL (+ PGSSLMODE=require for Supabase/Neon) — see .env.example

import pg from "pg";
import type { PoolClient } from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Game, CardSet, Card, Variant, PricePoint } from "./db.ts";

// Load card-db-mvp/.env if the environment doesn't already provide DATABASE_URL.
// Resolved relative to THIS module (not the CWD), so it works however the app is
// launched (npm start, the preview runner, direct node, the ETL). Real env vars
// (e.g. from --env-file or a hosting platform) always take precedence.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env"));
  } catch {
    /* no .env file — rely on real environment variables */
  }
}

const { Pool, types } = pg;

// Keep parity with the SQLite layer so the ported render/store code needs no
// value-shape changes:
//  * dates/timestamps come back as ISO strings (SQLite stored them as text)
//  * json/jsonb come back as raw strings (code does JSON.parse on them)
//  * bigint/int8 come back as JS numbers (SQLite ids were numbers; our ids and
//    COUNT/SUM results are well within Number's safe range)
types.setTypeParser(1082, (v) => v); // date        -> 'yyyy-mm-dd'
types.setTypeParser(1114, (v) => v); // timestamp   -> raw string
types.setTypeParser(1184, (v) => v); // timestamptz -> raw string
types.setTypeParser(114, (v) => v); // json  -> raw string
types.setTypeParser(3802, (v) => v); // jsonb -> raw string
types.setTypeParser(20, (v) => (v == null ? v : Number(v))); // int8/bigint -> number

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env (see db/README.md).");
}

// Hosted Postgres (Supabase, Neon, RDS) requires TLS; local Docker does not.
const sslMode = (process.env.PGSSLMODE ?? "").toLowerCase();
const ssl = ["require", "prefer", "verify-ca", "verify-full"].includes(sslMode)
  ? { rejectUnauthorized: false }
  : undefined;

export const pool = new Pool({ connectionString, ssl });

/** Run a query, return the rows. */
export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

/** Run a query, return the first row (or undefined). */
export async function one<T = any>(text: string, params: any[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

/** Close the pool (call on shutdown / after scripts). */
export async function close(): Promise<void> {
  await pool.end();
}

/**
 * Run `fn` inside a transaction on a single dedicated client (BEGIN/COMMIT, or
 * ROLLBACK on throw). Use for multi-statement writes that must be atomic — e.g.
 * committing a scan batch to inventory. All queries inside must use the passed
 * client, not the pool helpers (those grab a different connection).
 */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failure; surface the original error */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Convert `?` placeholders to Postgres `$1, $2, …` in order. Lets the dynamic
 * query builders (search facets, inventory filters) keep their `?`-based
 * assembly. Only valid when the SQL contains no literal `?` outside placeholders
 * (true for all our queries — like values are passed as parameters).
 */
export function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ---- Catalog queries (async mirror of db.ts) ------------------------------

export function getGames(): Promise<Game[]> {
  return query<Game>("SELECT * FROM games ORDER BY sort, name");
}

export function getGameBySlug(slug: string): Promise<Game | undefined> {
  return one<Game>("SELECT * FROM games WHERE slug=$1", [slug]);
}

export function getSetsForGame(gameId: number): Promise<CardSet[]> {
  return query<CardSet>(
    "SELECT * FROM sets WHERE game_id=$1 ORDER BY release_date DESC, name",
    [gameId]
  );
}

export function getAllSets(): Promise<CardSet[]> {
  return query<CardSet>(
    `SELECT s.*, g.name AS game_name, g.slug AS game_slug
     FROM sets s JOIN games g ON g.id=s.game_id
     ORDER BY g.sort, s.release_date DESC`
  );
}

export function getSetBySlug(slug: string): Promise<CardSet | undefined> {
  return one<CardSet>(
    `SELECT s.*, g.name AS game_name, g.slug AS game_slug
     FROM sets s JOIN games g ON g.id=s.game_id WHERE s.slug=$1`,
    [slug]
  );
}

export function getCardsInSet(setId: number): Promise<Card[]> {
  return query<Card>("SELECT * FROM cards WHERE set_id=$1 ORDER BY number_sort, name", [setId]);
}

export function getCard(id: number): Promise<Card | undefined> {
  return one<Card>(
    `SELECT c.*, s.name AS set_name, s.slug AS set_slug, g.name AS game_name, g.slug AS game_slug
     FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
     WHERE c.id=$1`,
    [id]
  );
}

export function getVariants(cardId: number): Promise<Variant[]> {
  return query<Variant>(
    "SELECT * FROM card_variants WHERE card_id=$1 ORDER BY is_default DESC, id",
    [cardId]
  );
}

/** Latest raw market price (in cents) for a variant. */
export function latestMarket(variantId: number): Promise<PricePoint | undefined> {
  return one<PricePoint>(
    `SELECT * FROM price_points
     WHERE variant_id=$1 AND kind='market' AND grade IS NULL
     ORDER BY observed_on DESC LIMIT 1`,
    [variantId]
  );
}

/** Default-variant latest market price for a card (used in listings/tiles). */
export function cardHeadlinePrice(
  cardId: number
): Promise<{ price_cents: number; currency: string } | undefined> {
  return one(
    `SELECT pp.price_cents, pp.currency
     FROM card_variants v
     JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL
     WHERE v.card_id=$1
     ORDER BY v.is_default DESC, pp.observed_on DESC
     LIMIT 1`,
    [cardId]
  );
}

export function priceHistory(variantId: number): Promise<PricePoint[]> {
  return query<PricePoint>(
    `SELECT * FROM price_points WHERE variant_id=$1 AND kind='history'
     ORDER BY observed_on ASC`,
    [variantId]
  );
}

export function gradedValues(variantId: number): Promise<PricePoint[]> {
  return query<PricePoint>(
    `SELECT * FROM price_points WHERE variant_id=$1 AND kind='market' AND grade IS NOT NULL
     ORDER BY id`,
    [variantId]
  );
}

export function soldComps(variantId: number): Promise<PricePoint[]> {
  return query<PricePoint>(
    `SELECT * FROM price_points WHERE variant_id=$1 AND kind='sold'
     ORDER BY observed_on DESC`,
    [variantId]
  );
}

export async function getMeta(key: string): Promise<string | undefined> {
  const r = await one<{ value: string }>("SELECT value FROM meta WHERE key=$1", [key]);
  return r?.value;
}

export function counts(): Promise<
  { games: number; sets: number; cards: number; variants: number; prices: number }
> {
  // COUNT returns bigint (parsed as string by pg); cast to int for JS numbers.
  return one(
    `SELECT (SELECT COUNT(*) FROM games)::int         AS games,
            (SELECT COUNT(*) FROM sets)::int          AS sets,
            (SELECT COUNT(*) FROM cards)::int         AS cards,
            (SELECT COUNT(*) FROM card_variants)::int AS variants,
            (SELECT COUNT(*) FROM price_points)::int  AS prices`
  ) as Promise<{ games: number; sets: number; cards: number; variants: number; prices: number }>;
}

/** A few high-value cards for the "trending" rail on the home page. */
export function trendingCards(
  limit = 8
): Promise<Array<Card & { price_cents: number; currency: string }>> {
  // Postgres is strict about GROUP BY: c.id (the PK) covers c.*, but the joined
  // columns must be grouped explicitly, and currency needs an aggregate.
  return query(
    `SELECT c.*, s.slug AS set_slug, s.name AS set_name, g.slug AS game_slug,
            MAX(pp.price_cents) AS price_cents, MAX(pp.currency) AS currency
     FROM cards c
     JOIN sets s ON s.id=c.set_id
     JOIN games g ON g.id=s.game_id
     JOIN card_variants v ON v.card_id=c.id
     JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL
     GROUP BY c.id, s.slug, s.name, g.slug
     ORDER BY price_cents DESC
     LIMIT $1`,
    [limit]
  ) as Promise<Array<Card & { price_cents: number; currency: string }>>;
}
