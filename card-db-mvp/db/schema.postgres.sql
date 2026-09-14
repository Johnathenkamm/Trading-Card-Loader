-- CardIndex — production Postgres schema.
--
-- Idiomatic translation of the MVP's portable SQL (src/schema.sql +
-- src/schema.app.sql) to Postgres/Supabase. Applied automatically on first
-- `docker compose up` (mounted into /docker-entrypoint-initdb.d) and re-runnable
-- with `npm run db:schema`. The server also brings an older database up to date
-- at boot (ensure*Schema() in src/app/*.ts), so this file and boot agree.
--
-- What changed from the SQLite schema, and why:
--   * INTEGER PRIMARY KEY AUTOINCREMENT -> bigint GENERATED ALWAYS AS IDENTITY
--   * 0/1 integer flags               -> boolean          (is_default, is_demo, ...)
--   * ISO date/datetime TEXT          -> date / timestamptz
--   * JSON stored as TEXT             -> jsonb            (alternatives, matching_prefs)
--   * real foreign keys with ON DELETE behavior on every reference
--   * pg_trgm trigram index for fuzzy search (replaces the MVP's Levenshtein fallback)
--
-- Money stays as integer cents (price_cents) — the correct pattern for currency;
-- never floats.

-- Idempotent: safe to re-run. Drops nothing; creates only if missing.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ===========================================================================
-- The price guide — public catalog + pricing
-- ===========================================================================

CREATE TABLE IF NOT EXISTS games (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug  text    NOT NULL UNIQUE,
  name  text    NOT NULL,
  sort  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sets (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id      bigint  NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slug         text    NOT NULL UNIQUE,
  name         text    NOT NULL,
  code         text,
  release_date date,                       -- ISO yyyy-mm-dd
  card_count   integer NOT NULL DEFAULT 0,
  image_url    text,
  external_id  text,                       -- e.g. "base1" (pokemontcg) or "neo" (scryfall)
  tcgplayer_group_id integer               -- TCGCSV/TCGplayer group; cached by sync:tcgcsv
);

CREATE TABLE IF NOT EXISTS cards (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id       bigint NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  slug         text   NOT NULL,            -- name-set-number; unique with id suffix in URLs
  name         text   NOT NULL,
  number       text,                       -- printed collector number, e.g. "4/102"
  number_sort  integer,                    -- numeric part for ordering
  rarity       text,
  artist       text,
  image_small  text,                       -- catalog art: external/CDN URL (Pokemon TCG API, Scryfall)
  image_large  text,
  external_id  text,                       -- provider card id
  search_text  text   NOT NULL DEFAULT '', -- normalized: name + set + number + game + rarity + artist

  -- TCGplayer linkage (filled by sync:tcgcsv): the product id keys price
  -- syncs, the canonical URL powers the "Buy on TCGplayer" link-out.
  tcgplayer_product_id bigint,
  tcgplayer_url        text
);

-- Printing/finish variants of a card. Pricing, the collection and the
-- wishlist always hang off the VARIANT, never the bare card.
CREATE TABLE IF NOT EXISTS card_variants (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id       bigint  NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  finish        text    NOT NULL,          -- normal | holofoil | reverse_holofoil | foil | etched | 1st_edition ...
  finish_label  text    NOT NULL,          -- human label, e.g. "Reverse Holo"
  language      text    NOT NULL DEFAULT 'EN',
  printing_note text,
  tcgplayer_id  text,
  is_default    boolean NOT NULL DEFAULT false
);

-- Every price observation, tagged by source and kind. Real current market prices
-- are ingested from the APIs; per-grade values, daily history, and sold comps are
-- generated for the demo and flagged is_demo=true until real data accrues.
CREATE TABLE IF NOT EXISTS price_points (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id   bigint  NOT NULL REFERENCES card_variants(id) ON DELETE CASCADE,
  source       text    NOT NULL,           -- tcgplayer | cardmarket | scryfall | ebay | goldin | synthetic
  kind         text    NOT NULL,           -- market | sold | history | market_low | market_mid | market_high
  grade        text,                       -- NULL for raw; else "PSA 10", "CGC 9.5", ...
  condition    text,                       -- raw condition when relevant, e.g. "NM"
  currency     text    NOT NULL DEFAULT 'USD',
  price_cents  integer NOT NULL,
  observed_on  date    NOT NULL,
  is_demo      boolean NOT NULL DEFAULT false,
  external_ref text
);

-- Canonical sold-sales archive. Every sold listing from any feed lands here,
-- deduped by (source, external_id) — and is CANONICALIZED to card/variant/grade
-- via the identify() parser, so sold history is tied to the exact card rather
-- than a title keyword. Feeds plug in through scripts/import-sold.ts.
CREATE TABLE IF NOT EXISTS sold_sales (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source           text NOT NULL,                      -- feed id: 'manual', 'sample', vendor name...
  marketplace      text NOT NULL,                      -- ebay | goldin | fanatics | ...
  external_id      text,                               -- listing/item id when the feed has one
  title            text NOT NULL,                      -- raw listing title as sold
  price_cents      integer NOT NULL,                   -- actual transaction price
  list_price_cents integer,                            -- pre-negotiation list price (best-offer delta)
  currency         text NOT NULL DEFAULT 'USD',
  sale_type        text NOT NULL DEFAULT 'unknown',    -- auction | bin | best_offer | unknown
  bids             integer,
  sold_on          date NOT NULL,
  url              text,
  image_url        text,

  -- canonicalization: the sale attached to OUR catalog
  card_id          bigint REFERENCES cards(id) ON DELETE SET NULL,
  variant_id       bigint REFERENCES card_variants(id) ON DELETE SET NULL,
  grade            text,                               -- "PSA 10" when graded
  condition        text,                               -- NM/LP/... when raw and stated
  canon_confidence real,                               -- identify() confidence 0..1

  is_demo          boolean NOT NULL DEFAULT false,
  raw              jsonb,                              -- untouched feed row
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- link health (scripts/check-sold-links.ts): last HTTP status for `url`.
  -- Renderers hide the link on 404/410 so nobody lands on a dead listing page.
  url_status       integer,
  url_checked_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sold_ext     ON sold_sales(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sold_variant       ON sold_sales(variant_id, grade, sold_on DESC);
CREATE INDEX IF NOT EXISTS idx_sold_card          ON sold_sales(card_id, sold_on DESC);
CREATE INDEX IF NOT EXISTS idx_sold_title_trgm    ON sold_sales USING gin (title gin_trgm_ops);

-- Perceptual hashes of catalog reference images (photo identification: hash
-- the catalog once, hash the query photo, nearest Hamming distance wins).
-- Populated by `npm run hash:catalog` and filled at boot; consumed by the
-- VISION_PROVIDER=hash matcher. Hex-encoded 64-bit dHash/aHash, full frame + inset.
CREATE TABLE IF NOT EXISTS card_image_hashes (
  card_id     bigint PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  dhash       text NOT NULL,
  ahash       text NOT NULL,
  dhash_inset text NOT NULL,
  ahash_inset text NOT NULL,
  image_url   text NOT NULL,                -- which image was hashed (skip unchanged)
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Catalog gap reports (the "report a missing/wrong card" loop).
CREATE TABLE IF NOT EXISTS catalog_issue_reports (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id    bigint REFERENCES cards(id) ON DELETE SET NULL,
  note       text,
  status     text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Bookkeeping for reproducible seeds and one-time migrations.
CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sets_game      ON sets(game_id);
CREATE INDEX IF NOT EXISTS idx_cards_set      ON cards(set_id);
CREATE INDEX IF NOT EXISTS idx_cards_name     ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_rarity   ON cards(rarity);
CREATE INDEX IF NOT EXISTS idx_variants_card  ON card_variants(card_id);
CREATE INDEX IF NOT EXISTS idx_price_variant  ON price_points(variant_id);
CREATE INDEX IF NOT EXISTS idx_price_kind     ON price_points(variant_id, kind);
-- Fuzzy / typo-tolerant search, natively in Postgres (replaces app-side Levenshtein).
CREATE INDEX IF NOT EXISTS idx_cards_search_trgm ON cards USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm   ON cards USING gin (name gin_trgm_ops);

-- ===========================================================================
-- Members — accounts, uploads + review queue, collection, wishlist
-- ===========================================================================

-- Member accounts. The table is still called `sellers` (and its foreign keys
-- `seller_id`) from the product's seller-tool days; renaming the live schema
-- buys nothing a visitor can see. Every member-area table carries seller_id.
CREATE TABLE IF NOT EXISTS sellers (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             text,
  password_hash     text,                              -- scrypt:salt:hash; NULL = legacy passwordless row
  last_login_at     timestamptz,
  display_name      text    NOT NULL DEFAULT 'Collector', -- shown on shared price lists
  plan_tier         text    NOT NULL DEFAULT 'free',   -- free | pro ($15/mo). Pro gates the collection (app/billing.ts); Stripe checkout is the next seam.
  last_seen_at      timestamptz,                       -- bumped on every member-area request (activity tracking, owner console)
  is_owner          boolean NOT NULL DEFAULT false,    -- the owner's OWN row (created on boot for ADMIN_EMAIL): /admin/upload and the owner's /collection add cards here, never to a member; hidden from the member lists
  training_opt_in   boolean NOT NULL DEFAULT false,    -- let confirmed matches improve identification; off by default

  default_condition text    NOT NULL DEFAULT 'NM',     -- NM | LP | MP | HP | DMG — pre-selected on uploads
  default_language  text    NOT NULL DEFAULT 'EN',
  matching_prefs    jsonb,                             -- Advanced Matching Options defaults: {prioritizeSets, excludeSets, prioritizeTerms, excludeTerms}

  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One account per email (case-insensitive), among real (password-bearing) accounts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sellers_email ON sellers (lower(email)) WHERE email IS NOT NULL;

-- Login sessions: opaque random token -> member. Cookie carries the token only.
CREATE TABLE IF NOT EXISTS sessions (
  token       text        PRIMARY KEY,
  seller_id   bigint      NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_seller ON sessions(seller_id);

-- Password-reset tokens (sha256 of the emailed token; single use; 60 min).
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash  text        PRIMARY KEY,
  seller_id   bigint      NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- Owner-console login sessions (app/admin.ts). The owner signs in at
-- /admin/login with ADMIN_EMAIL / ADMIN_PASSWORD from the environment — a
-- separate login from member accounts, with its own cookie.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       text        PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          text
);

-- Member-activity log for the owner console (app/admin.ts): one row per login /
-- sign-up / page view / action / plan change. by_owner is true when the event
-- happened inside a member's collection in owner mode.
CREATE TABLE IF NOT EXISTS activity_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint      NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  by_owner    boolean     NOT NULL DEFAULT false,
  kind        text        NOT NULL,                    -- login | signup | logout | page | action | plan_change | owner
  method      text        NOT NULL DEFAULT 'GET',
  path        text        NOT NULL DEFAULT '',
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_seller ON activity_log(seller_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_recent ON activity_log(id DESC);

-- Feedback → Inbox: notes members send, and the owner's replies.
CREATE TABLE IF NOT EXISTS feedback (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  kind        text   NOT NULL DEFAULT 'feedback',   -- feedback | bug | question | missing_card
  title       text   NOT NULL,
  body        text   NOT NULL DEFAULT '',
  status      text   NOT NULL DEFAULT 'open',       -- open | answered | closed
  reply       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  replied_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_feedback_seller ON feedback(seller_id, id DESC);

-- One row per upload (photos, pasted list, cert numbers, set picks). `kind`
-- says where it goes: scan/graded/creator → the collection after review,
-- pricing → a shareable priced list (share_token is the public capability).
CREATE TABLE IF NOT EXISTS scan_batches (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  source      text    NOT NULL DEFAULT 'paste',        -- paste | upload | certs | catalog
  label       text,
  status      text    NOT NULL DEFAULT 'processing',   -- processing | done
  total       integer NOT NULL DEFAULT 0,
  processed   integer NOT NULL DEFAULT 0,
  kind        text    NOT NULL DEFAULT 'scan',         -- scan | graded | creator | pricing
  share_token text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_share ON scan_batches(share_token) WHERE share_token IS NOT NULL;

-- One row per identified card in the review queue. image_url / back_image_url
-- hold the BUCKET KEY (or URL) of the member's photo — the file itself lives in
-- object storage, never in Postgres. ai_confidence routes the item: >= threshold
-- auto-matches, else needs_review.
CREATE TABLE IF NOT EXISTS scan_items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id           bigint  NOT NULL REFERENCES scan_batches(id) ON DELETE CASCADE,
  seller_id          bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  raw_input          text    NOT NULL DEFAULT '',       -- the pasted line / recognizer reading / cert
  image_url          text,                              -- bucket key/URL of front photo
  back_image_url     text,                              -- bucket key/URL of back photo

  matched_card_id    bigint  REFERENCES cards(id) ON DELETE SET NULL,
  matched_variant_id bigint  REFERENCES card_variants(id) ON DELETE SET NULL,
  ai_confidence      double precision NOT NULL DEFAULT 0,  -- 0..1
  alternatives       jsonb   NOT NULL DEFAULT '[]'::jsonb, -- [{variant_id, card_id, label, score}]

  status             text    NOT NULL DEFAULT 'needs_review', -- matched | needs_review | failed | approved | skipped
  condition          text    NOT NULL DEFAULT 'NM',
  language           text    NOT NULL DEFAULT 'EN',
  quantity           integer NOT NULL DEFAULT 1,
  price_cents        integer,                            -- market value when identified (at the grade if any)
  paid_cents         integer,                            -- what the member paid (optional; carried into the collection)
  grade              text,                               -- "PSA 10" — graded slabs
  grader             text,
  cert               text,
  dup_of_item_id     bigint  REFERENCES scan_items(id) ON DELETE SET NULL, -- in-batch duplicate
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- The member's collection: confirmed cards, one row per (printing, condition,
-- language, grade), valued live from price_points at render time.
CREATE TABLE IF NOT EXISTS collection_items (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id      bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  card_id        bigint  NOT NULL REFERENCES cards(id),
  variant_id     bigint  NOT NULL REFERENCES card_variants(id),
  condition      text    NOT NULL DEFAULT 'NM',
  language       text    NOT NULL DEFAULT 'EN',
  quantity       integer NOT NULL DEFAULT 1,
  grader         text,
  grade          text,                                  -- "PSA 10" for slabs
  cert           text,
  paid_cents     integer,                               -- what the member paid, per copy
  notes          text,
  source_item_id bigint  REFERENCES scan_items(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coll_member  ON collection_items(seller_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_coll_variant ON collection_items(seller_id, variant_id, condition, language, grade);

-- The wishlist: printings a member wants, with an optional target price. After
-- each price sync, Pro members are emailed when market <= target
-- (app/collection.ts notifyWishlistAlerts); notified_at throttles repeats.
CREATE TABLE IF NOT EXISTS wishlist_items (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id    bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  card_id      bigint  NOT NULL REFERENCES cards(id),
  variant_id   bigint  NOT NULL REFERENCES card_variants(id),
  target_cents integer,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  notified_at  timestamptz,
  UNIQUE (seller_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_wish_member ON wishlist_items(seller_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_scanitems_batch  ON scan_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_scanitems_status ON scan_items(batch_id, status);
