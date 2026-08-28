-- Phase 1 catalog + pricing schema.
-- Written in portable SQL; runs on node:sqlite for the MVP and lifts to
-- Postgres/Supabase for production (swap INTEGER PRIMARY KEY AUTOINCREMENT for
-- BIGINT GENERATED ... IDENTITY, TEXT stays TEXT, and add real FKs/indexes).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Reference / catalog -------------------------------------------------------

CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id),
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  code          TEXT,
  release_date  TEXT,              -- ISO yyyy-mm-dd
  card_count    INTEGER NOT NULL DEFAULT 0,
  image_url     TEXT,
  external_id   TEXT               -- e.g. "base1" (pokemontcg) or "neo" (scryfall)
);

CREATE TABLE IF NOT EXISTS cards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id        INTEGER NOT NULL REFERENCES sets(id),
  slug          TEXT NOT NULL,     -- name-set-number, unique with id suffix in URLs
  name          TEXT NOT NULL,
  number        TEXT,              -- printed collector number, e.g. "4/102"
  number_sort   INTEGER,           -- numeric part for ordering
  rarity        TEXT,
  artist        TEXT,
  image_small   TEXT,
  image_large   TEXT,
  external_id   TEXT,              -- provider card id
  search_text   TEXT NOT NULL DEFAULT ''  -- normalized: name + set + number + game + rarity + artist
);

-- The table CardUploader deliberately omits: printing/finish variants of a card.
-- Pricing and inventory always hang off the VARIANT, never the bare card.
CREATE TABLE IF NOT EXISTS card_variants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       INTEGER NOT NULL REFERENCES cards(id),
  finish        TEXT NOT NULL,     -- normal | holofoil | reverse_holofoil | foil | etched | 1st_edition ...
  finish_label  TEXT NOT NULL,     -- human label, e.g. "Reverse Holo"
  language      TEXT NOT NULL DEFAULT 'EN',
  printing_note TEXT,
  tcgplayer_id  TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0
);

-- Pricing -------------------------------------------------------------------

-- Every observation, tagged by source and kind. Real current market prices are
-- ingested from the APIs; per-grade values, daily history, and sold comps are
-- generated for the demo and flagged is_demo=1 (real sold data is gated -- see
-- the research report, integrations section).
CREATE TABLE IF NOT EXISTS price_points (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id    INTEGER NOT NULL REFERENCES card_variants(id),
  source        TEXT NOT NULL,     -- tcgplayer | cardmarket | scryfall | ebay | goldin | synthetic
  kind          TEXT NOT NULL,     -- market | sold | history
  grade         TEXT,              -- NULL for raw; else "PSA 10", "CGC 9.5", ...
  condition     TEXT,              -- raw condition when relevant, e.g. "NM"
  currency      TEXT NOT NULL DEFAULT 'USD',
  price_cents   INTEGER NOT NULL,
  observed_on   TEXT NOT NULL,     -- ISO date
  is_demo       INTEGER NOT NULL DEFAULT 0,
  external_ref  TEXT
);

-- Catalog gap reports (the "report a missing/wrong card" loop). Present so the
-- schema is complete; not wired into UI in Phase 1.
CREATE TABLE IF NOT EXISTS catalog_issue_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     INTEGER REFERENCES cards(id),
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TEXT NOT NULL
);

-- Bookkeeping for reproducible seeds
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sets_game       ON sets(game_id);
CREATE INDEX IF NOT EXISTS idx_cards_set        ON cards(set_id);
CREATE INDEX IF NOT EXISTS idx_cards_name       ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_rarity     ON cards(rarity);
CREATE INDEX IF NOT EXISTS idx_variants_card    ON card_variants(card_id);
CREATE INDEX IF NOT EXISTS idx_price_variant    ON price_points(variant_id);
CREATE INDEX IF NOT EXISTS idx_price_kind       ON price_points(variant_id, kind);
