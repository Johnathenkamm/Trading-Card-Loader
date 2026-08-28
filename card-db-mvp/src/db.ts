import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = join(here, "..", "data", "catalog.db");
const SCHEMA_PATH = join(here, "schema.sql");
const APP_SCHEMA_PATH = join(here, "schema.app.sql");

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  // Phase 2–4 seller-workspace tables (scan/review/inventory/listings). Layered
  // on top of the Phase 1 catalog so the same DB serves the public site and the
  // seller tools.
  _db.exec(readFileSync(APP_SCHEMA_PATH, "utf8"));
  migrate(_db);
  return _db;
}

/** Idempotent column adds for DBs seeded before a schema change. */
function migrate(d: DatabaseSync): void {
  const cols = d.prepare("PRAGMA table_info(sellers)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "title_structure")) {
    d.exec("ALTER TABLE sellers ADD COLUMN title_structure TEXT");
  }
}

// ---- Row shapes -----------------------------------------------------------

export type Game = { id: number; slug: string; name: string; sort: number };
export type CardSet = {
  id: number;
  game_id: number;
  slug: string;
  name: string;
  code: string | null;
  release_date: string | null;
  card_count: number;
  image_url: string | null;
  game_name?: string;
  game_slug?: string;
};
export type Card = {
  id: number;
  set_id: number;
  slug: string;
  name: string;
  number: string | null;
  number_sort: number | null;
  rarity: string | null;
  artist: string | null;
  image_small: string | null;
  image_large: string | null;
  search_text: string;
  set_name?: string;
  set_slug?: string;
  game_name?: string;
  game_slug?: string;
};
export type Variant = {
  id: number;
  card_id: number;
  finish: string;
  finish_label: string;
  language: string;
  printing_note: string | null;
  tcgplayer_id: string | null;
  is_default: number;
};
export type PricePoint = {
  id: number;
  variant_id: number;
  source: string;
  kind: string;
  grade: string | null;
  condition: string | null;
  currency: string;
  price_cents: number;
  observed_on: string;
  is_demo: number;
};

// ---- Queries --------------------------------------------------------------

export function getGames(): Game[] {
  return db().prepare("SELECT * FROM games ORDER BY sort, name").all() as Game[];
}

export function getGameBySlug(slug: string): Game | undefined {
  return db().prepare("SELECT * FROM games WHERE slug=?").get(slug) as Game | undefined;
}

export function getSetsForGame(gameId: number): CardSet[] {
  return db()
    .prepare("SELECT * FROM sets WHERE game_id=? ORDER BY release_date DESC, name")
    .all(gameId) as CardSet[];
}

export function getAllSets(): CardSet[] {
  return db()
    .prepare(
      `SELECT s.*, g.name AS game_name, g.slug AS game_slug
       FROM sets s JOIN games g ON g.id=s.game_id
       ORDER BY g.sort, s.release_date DESC`
    )
    .all() as CardSet[];
}

export function getSetBySlug(slug: string): CardSet | undefined {
  return db()
    .prepare(
      `SELECT s.*, g.name AS game_name, g.slug AS game_slug
       FROM sets s JOIN games g ON g.id=s.game_id WHERE s.slug=?`
    )
    .get(slug) as CardSet | undefined;
}

export function getCardsInSet(setId: number): Card[] {
  return db()
    .prepare("SELECT * FROM cards WHERE set_id=? ORDER BY number_sort, name")
    .all(setId) as Card[];
}

export function getCard(id: number): Card | undefined {
  return db()
    .prepare(
      `SELECT c.*, s.name AS set_name, s.slug AS set_slug, g.name AS game_name, g.slug AS game_slug
       FROM cards c JOIN sets s ON s.id=c.set_id JOIN games g ON g.id=s.game_id
       WHERE c.id=?`
    )
    .get(id) as Card | undefined;
}

export function getVariants(cardId: number): Variant[] {
  return db()
    .prepare("SELECT * FROM card_variants WHERE card_id=? ORDER BY is_default DESC, id")
    .all(cardId) as Variant[];
}

/** Latest raw market price (in cents) for a variant. */
export function latestMarket(variantId: number): PricePoint | undefined {
  return db()
    .prepare(
      `SELECT * FROM price_points
       WHERE variant_id=? AND kind='market' AND grade IS NULL
       ORDER BY observed_on DESC LIMIT 1`
    )
    .get(variantId) as PricePoint | undefined;
}

/** Default-variant latest market price for a card (used in listings/tiles). */
export function cardHeadlinePrice(cardId: number): { price_cents: number; currency: string } | undefined {
  return db()
    .prepare(
      `SELECT pp.price_cents, pp.currency
       FROM card_variants v
       JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL
       WHERE v.card_id=?
       ORDER BY v.is_default DESC, pp.observed_on DESC
       LIMIT 1`
    )
    .get(cardId) as { price_cents: number; currency: string } | undefined;
}

export function priceHistory(variantId: number): PricePoint[] {
  return db()
    .prepare(
      `SELECT * FROM price_points WHERE variant_id=? AND kind='history'
       ORDER BY observed_on ASC`
    )
    .all(variantId) as PricePoint[];
}

export function gradedValues(variantId: number): PricePoint[] {
  return db()
    .prepare(
      `SELECT * FROM price_points WHERE variant_id=? AND kind='market' AND grade IS NOT NULL
       ORDER BY id`
    )
    .all(variantId) as PricePoint[];
}

export function soldComps(variantId: number): PricePoint[] {
  return db()
    .prepare(
      `SELECT * FROM price_points WHERE variant_id=? AND kind='sold'
       ORDER BY observed_on DESC`
    )
    .all(variantId) as PricePoint[];
}

export function getMeta(key: string): string | undefined {
  const r = db().prepare("SELECT value FROM meta WHERE key=?").get(key) as
    | { value: string }
    | undefined;
  return r?.value;
}

export function counts(): { games: number; sets: number; cards: number; variants: number; prices: number } {
  const q = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  return {
    games: q("SELECT COUNT(*) n FROM games"),
    sets: q("SELECT COUNT(*) n FROM sets"),
    cards: q("SELECT COUNT(*) n FROM cards"),
    variants: q("SELECT COUNT(*) n FROM card_variants"),
    prices: q("SELECT COUNT(*) n FROM price_points"),
  };
}

/** A few high-value cards for the "trending" rail on the home page. */
export function trendingCards(limit = 8): Array<Card & { price_cents: number; currency: string }> {
  return db()
    .prepare(
      `SELECT c.*, s.slug AS set_slug, s.name AS set_name, g.slug AS game_slug,
              MAX(pp.price_cents) AS price_cents, pp.currency AS currency
       FROM cards c
       JOIN sets s ON s.id=c.set_id
       JOIN games g ON g.id=s.game_id
       JOIN card_variants v ON v.card_id=c.id
       JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL
       GROUP BY c.id
       ORDER BY price_cents DESC
       LIMIT ?`
    )
    .all(limit) as Array<Card & { price_cents: number; currency: string }>;
}
