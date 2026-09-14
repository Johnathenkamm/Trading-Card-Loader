-- Member-area schema (uploads → review → collection / wishlist), layered on top
-- of the catalog (schema.sql). Portable SQL: runs on node:sqlite for the seed
-- staging file and lifts to Postgres (swap AUTOINCREMENT for identity columns;
-- JSON TEXT columns become jsonb; add real FKs). The running app uses
-- db/schema.postgres.sql; this file is the SQLite mirror kept for `npm run seed`.
--
-- Naming note: the accounts table is still called `sellers` (and its foreign
-- keys `seller_id`) from the product's seller-tool days. It holds members.

PRAGMA foreign_keys = ON;

-- Member accounts and their few preferences.
CREATE TABLE IF NOT EXISTS sellers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT,
  password_hash     TEXT,                            -- scrypt:salt:hash
  last_login_at     TEXT,
  display_name      TEXT NOT NULL DEFAULT 'Collector',
  plan_tier         TEXT NOT NULL DEFAULT 'free',   -- free | pro ($15/mo). Pro gates the collection (app/billing.ts).
  last_seen_at      TEXT,
  is_owner          INTEGER NOT NULL DEFAULT 0,
  training_opt_in   INTEGER NOT NULL DEFAULT 0,      -- opt-in, off by default
  default_condition TEXT NOT NULL DEFAULT 'NM',      -- NM | LP | MP | HP | DMG
  default_language  TEXT NOT NULL DEFAULT 'EN',
  matching_prefs    TEXT,                            -- JSON: Advanced Matching Options defaults
  created_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sellers_email ON sellers (lower(email)) WHERE email IS NOT NULL;

-- Login sessions: opaque random token -> member. The cookie carries the token only.
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  seller_id   INTEGER NOT NULL REFERENCES sellers(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_seller ON sessions(seller_id);

-- One row per upload (photos / pasted list / certs / set picks). `kind` says
-- where it goes: scan, graded, creator → the collection after review; pricing →
-- a shareable priced list.
CREATE TABLE IF NOT EXISTS scan_batches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id    INTEGER NOT NULL REFERENCES sellers(id),
  source       TEXT NOT NULL DEFAULT 'paste',        -- paste | upload | certs | catalog
  label        TEXT,
  status       TEXT NOT NULL DEFAULT 'processing',   -- processing | done
  total        INTEGER NOT NULL DEFAULT 0,
  processed    INTEGER NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL DEFAULT 'scan',         -- scan | graded | creator | pricing
  share_token  TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

-- One row per identified card in the review queue.
CREATE TABLE IF NOT EXISTS scan_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id          INTEGER NOT NULL REFERENCES scan_batches(id),
  seller_id         INTEGER NOT NULL REFERENCES sellers(id),
  raw_input         TEXT NOT NULL DEFAULT '',
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
  price_cents       INTEGER,                          -- market value when identified
  paid_cents        INTEGER,                          -- what the member paid (optional)
  grade             TEXT,
  grader            TEXT,
  cert              TEXT,
  dup_of_item_id    INTEGER,
  created_at        TEXT NOT NULL
);

-- The member's collection.
CREATE TABLE IF NOT EXISTS collection_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id      INTEGER NOT NULL REFERENCES sellers(id),
  card_id        INTEGER NOT NULL REFERENCES cards(id),
  variant_id     INTEGER NOT NULL REFERENCES card_variants(id),
  condition      TEXT NOT NULL DEFAULT 'NM',
  language       TEXT NOT NULL DEFAULT 'EN',
  quantity       INTEGER NOT NULL DEFAULT 1,
  grader         TEXT,
  grade          TEXT,
  cert           TEXT,
  paid_cents     INTEGER,
  notes          TEXT,
  source_item_id INTEGER REFERENCES scan_items(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- The wishlist, with an optional target price per printing.
CREATE TABLE IF NOT EXISTS wishlist_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id    INTEGER NOT NULL REFERENCES sellers(id),
  card_id      INTEGER NOT NULL REFERENCES cards(id),
  variant_id   INTEGER NOT NULL REFERENCES card_variants(id),
  target_cents INTEGER,
  note         TEXT,
  created_at   TEXT NOT NULL,
  notified_at  TEXT,
  UNIQUE (seller_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_scanitems_batch  ON scan_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_scanitems_status ON scan_items(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_coll_member      ON collection_items(seller_id);
CREATE INDEX IF NOT EXISTS idx_wish_member      ON wishlist_items(seller_id);
