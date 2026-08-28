-- Phase 2–4 seller-workspace schema (scan → review → price → inventory → list).
-- Layered on top of the Phase 1 catalog (schema.sql). Portable SQL: runs on
-- node:sqlite for the MVP and lifts to Postgres/Supabase (swap AUTOINCREMENT for
-- identity columns; JSON TEXT columns become jsonb; add real FKs).
--
-- Mirrors the build plan's schema (users / upload_jobs / uploads / user_inventory
-- / listings / marketplace_connections). Each seller row is now a real account
-- (email + password_hash + login sessions); Stripe subscriptions and OAuth remain
-- the documented next seam. This SQLite schema is the seed-staging mirror — the
-- running app authenticates against Postgres (db/schema.postgres.sql).

PRAGMA foreign_keys = ON;

-- One seller for the MVP. Holds the reusable defaults the spec asks for so the
-- user "shouldn't have to configure this every time": SKU scheme, pricing rule,
-- default condition/language, and eBay listing preferences.
CREATE TABLE IF NOT EXISTS sellers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT,
  password_hash     TEXT,                            -- scrypt:salt:hash; NULL = legacy passwordless seller
  last_login_at     TEXT,
  display_name      TEXT NOT NULL DEFAULT 'My card shop',
  plan_tier         TEXT NOT NULL DEFAULT 'free',   -- free | pro (Stripe billing is a later seam)
  training_opt_in   INTEGER NOT NULL DEFAULT 0,      -- opt-in, off by default (customers keep their data)

  -- SKU scheme (spec §14): PREFIX-000001, auto-incrementing, custom prefix.
  sku_prefix        TEXT NOT NULL DEFAULT 'CARD',
  sku_pad           INTEGER NOT NULL DEFAULT 6,
  sku_next          INTEGER NOT NULL DEFAULT 1,

  -- Default pricing rule (spec §6): market, market ± %, or fixed.
  price_mode        TEXT NOT NULL DEFAULT 'market',  -- market | pct | fixed
  price_pct         INTEGER NOT NULL DEFAULT 0,      -- signed, used when mode = 'pct' (e.g. 10, -5)
  price_fixed_cents INTEGER,                          -- used when mode = 'fixed'

  default_condition TEXT NOT NULL DEFAULT 'NM',      -- NM | LP | MP | HP | DMG
  default_language  TEXT NOT NULL DEFAULT 'EN',

  -- eBay listing preferences (spec §8): saved once, reused on every listing.
  ebay_connected      INTEGER NOT NULL DEFAULT 0,
  ebay_store_category TEXT,
  ebay_shipping_policy TEXT,
  ebay_return_policy   TEXT,
  ebay_payment_policy  TEXT,
  item_location        TEXT,
  title_template       TEXT,                          -- NULL = built-in template
  title_structure      TEXT,                          -- NULL = none; JSON for the visual Title Structure Editor (app/title.ts)

  created_at        TEXT NOT NULL
);

-- One account per email (case-insensitive) among real accounts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sellers_email ON sellers (lower(email)) WHERE email IS NOT NULL;

-- Login sessions: opaque random token -> seller. The cookie carries the token only.
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  seller_id   INTEGER NOT NULL REFERENCES sellers(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_seller ON sessions(seller_id);

-- One row per scan/upload batch; drives the review-queue progress UI (spec §4,
-- build plan §4.5). status advances queued → processing → done.
CREATE TABLE IF NOT EXISTS scan_batches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id    INTEGER NOT NULL REFERENCES sellers(id),
  source       TEXT NOT NULL DEFAULT 'paste',        -- paste | sample | upload
  label        TEXT,
  status       TEXT NOT NULL DEFAULT 'processing',   -- processing | done
  total        INTEGER NOT NULL DEFAULT 0,
  processed    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

-- One row per scanned card. Decoupled from inventory so a card can sit in
-- "needs review" without polluting confirmed stock (build plan design note).
-- ai_confidence routes the item: >= threshold auto-matches, else needs_review.
CREATE TABLE IF NOT EXISTS scan_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id          INTEGER NOT NULL REFERENCES scan_batches(id),
  seller_id         INTEGER NOT NULL REFERENCES sellers(id),
  raw_input         TEXT NOT NULL DEFAULT '',         -- the pasted line / scan token
  image_url         TEXT,
  back_image_url    TEXT,

  matched_card_id   INTEGER REFERENCES cards(id),
  matched_variant_id INTEGER REFERENCES card_variants(id),
  ai_confidence     REAL NOT NULL DEFAULT 0,          -- 0..1
  alternatives      TEXT NOT NULL DEFAULT '[]',       -- JSON: [{variant_id, card_id, label, score}]

  status            TEXT NOT NULL DEFAULT 'needs_review', -- matched | needs_review | failed | approved | skipped
  condition         TEXT NOT NULL DEFAULT 'NM',
  language          TEXT NOT NULL DEFAULT 'EN',
  quantity          INTEGER NOT NULL DEFAULT 1,

  price_mode        TEXT NOT NULL DEFAULT 'market',
  price_pct         INTEGER NOT NULL DEFAULT 0,
  price_cents       INTEGER,                           -- resolved listing price
  price_overridden  INTEGER NOT NULL DEFAULT 0,        -- 1 = user typed an exact price
  prev_price_cents  INTEGER,                           -- "you listed this before at ..." (spec §7)

  sku               TEXT,
  title             TEXT,                              -- generated marketplace title
  dup_of_item_id    INTEGER,                           -- in-batch duplicate (spec §15)
  created_at        TEXT NOT NULL
);

-- Confirmed stock. Every physical card gets a unique SKU (spec §14). Quantity +
-- duplicate handling per spec §15.
CREATE TABLE IF NOT EXISTS inventory (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id      INTEGER NOT NULL REFERENCES sellers(id),
  card_id        INTEGER NOT NULL REFERENCES cards(id),
  variant_id     INTEGER NOT NULL REFERENCES card_variants(id),
  sku            TEXT NOT NULL,
  condition      TEXT NOT NULL DEFAULT 'NM',
  language       TEXT NOT NULL DEFAULT 'EN',
  quantity       INTEGER NOT NULL DEFAULT 1,

  price_mode     TEXT NOT NULL DEFAULT 'market',
  price_pct      INTEGER NOT NULL DEFAULT 0,
  price_cents    INTEGER,
  acquired_cents INTEGER,

  status         TEXT NOT NULL DEFAULT 'in_stock',    -- in_stock | listed | sold
  source_item_id INTEGER REFERENCES scan_items(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- "Remember previous prices" (spec §7). One row per (variant, condition) sale/
-- list event; the latest is surfaced next time the same card is scanned.
CREATE TABLE IF NOT EXISTS inventory_price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id   INTEGER NOT NULL REFERENCES sellers(id),
  variant_id  INTEGER NOT NULL REFERENCES card_variants(id),
  condition   TEXT NOT NULL DEFAULT 'NM',
  price_cents INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);

-- Generated marketplace listings (spec §9–13, §16). eBay first; the same row
-- shape formats to other channels later (spec §17). "External" publish is a seam
-- (needs eBay OAuth) — the MVP produces the draft + a File Exchange CSV export.
CREATE TABLE IF NOT EXISTS listings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id      INTEGER NOT NULL REFERENCES sellers(id),
  inventory_id   INTEGER NOT NULL REFERENCES inventory(id),
  marketplace    TEXT NOT NULL DEFAULT 'ebay',        -- ebay | tcgplayer | whatnot | shopify | csv ...
  format         TEXT NOT NULL DEFAULT 'fixed',       -- fixed | auction
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category_id    TEXT,
  price_cents    INTEGER,                              -- Buy It Now / fixed price
  start_cents    INTEGER,                              -- auction start
  duration_days  INTEGER,                              -- auction duration
  quantity       INTEGER NOT NULL DEFAULT 1,
  sku            TEXT,
  item_specifics TEXT NOT NULL DEFAULT '{}',          -- JSON name→value
  scheduled_at   TEXT,                                 -- ISO; NULL = list immediately
  status         TEXT NOT NULL DEFAULT 'draft',        -- draft | scheduled | exported | published
  external_ref   TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scanitems_batch  ON scan_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_scanitems_status ON scan_items(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_seller       ON inventory(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_variant      ON inventory(seller_id, variant_id, condition, language);
CREATE INDEX IF NOT EXISTS idx_iph_lookup       ON inventory_price_history(seller_id, variant_id, condition, recorded_at);
CREATE INDEX IF NOT EXISTS idx_listings_inv     ON listings(inventory_id);
