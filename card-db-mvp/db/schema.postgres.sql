-- CardIndex — production Postgres schema.
--
-- Idiomatic translation of the MVP's portable SQL (src/schema.sql +
-- src/schema.app.sql) to Postgres/Supabase. Applied automatically on first
-- `docker compose up` (mounted into /docker-entrypoint-initdb.d) and re-runnable
-- with `npm run db:schema`.
--
-- What changed from the SQLite schema, and why:
--   * INTEGER PRIMARY KEY AUTOINCREMENT -> bigint GENERATED ALWAYS AS IDENTITY
--   * 0/1 integer flags               -> boolean          (is_default, is_demo, ...)
--   * ISO date/datetime TEXT          -> date / timestamptz
--   * JSON stored as TEXT             -> jsonb            (alternatives, item_specifics, title_structure)
--   * real foreign keys with ON DELETE behavior on every reference
--   * pg_trgm trigram index for fuzzy search (replaces the MVP's Levenshtein fallback)
--
-- Money stays as integer cents (price_cents) — the correct pattern for currency;
-- never floats.

-- Idempotent: safe to re-run. Drops nothing; creates only if missing.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ===========================================================================
-- Phase 1 — public catalog + pricing
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
  external_id  text                        -- e.g. "base1" (pokemontcg) or "neo" (scryfall)
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
  search_text  text   NOT NULL DEFAULT ''  -- normalized: name + set + number + game + rarity + artist
);

-- The table CardUploader deliberately omits: printing/finish variants of a card.
-- Pricing and inventory always hang off the VARIANT, never the bare card.
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
-- generated for the demo and flagged is_demo=true (real sold data is gated).
CREATE TABLE IF NOT EXISTS price_points (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id   bigint  NOT NULL REFERENCES card_variants(id) ON DELETE CASCADE,
  source       text    NOT NULL,           -- tcgplayer | cardmarket | scryfall | ebay | goldin | synthetic
  kind         text    NOT NULL,           -- market | sold | history
  grade        text,                       -- NULL for raw; else "PSA 10", "CGC 9.5", ...
  condition    text,                       -- raw condition when relevant, e.g. "NM"
  currency     text    NOT NULL DEFAULT 'USD',
  price_cents  integer NOT NULL,
  observed_on  date    NOT NULL,
  is_demo      boolean NOT NULL DEFAULT false,
  external_ref text
);

-- Catalog gap reports (the "report a missing/wrong card" loop).
CREATE TABLE IF NOT EXISTS catalog_issue_reports (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id    bigint REFERENCES cards(id) ON DELETE SET NULL,
  note       text,
  status     text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Bookkeeping for reproducible seeds.
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
-- Phase 2-4 — seller workspace (scan -> review -> price -> inventory -> list)
-- ===========================================================================

-- One seller for the MVP (id=1). Becomes real users with Stripe billing later;
-- every workspace table already carries seller_id.
CREATE TABLE IF NOT EXISTS sellers (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email             text,
  password_hash     text,                              -- scrypt:salt:hash; NULL = legacy passwordless seller
  last_login_at     timestamptz,
  display_name      text    NOT NULL DEFAULT 'My card shop',
  plan_tier         text    NOT NULL DEFAULT 'free',   -- free | pro
  training_opt_in   boolean NOT NULL DEFAULT false,

  -- SKU scheme: PREFIX-000001, auto-incrementing, custom prefix.
  sku_prefix        text    NOT NULL DEFAULT 'CARD',
  sku_pad           integer NOT NULL DEFAULT 6,
  sku_next          integer NOT NULL DEFAULT 1,

  -- Default pricing rule: market, market +/- %, or fixed.
  price_mode        text    NOT NULL DEFAULT 'market', -- market | pct | fixed
  price_pct         integer NOT NULL DEFAULT 0,        -- signed, used when mode = 'pct'
  price_fixed_cents integer,                            -- used when mode = 'fixed'

  default_condition text    NOT NULL DEFAULT 'NM',     -- NM | LP | MP | HP | DMG
  default_language  text    NOT NULL DEFAULT 'EN',

  -- eBay listing preferences: saved once, reused on every listing.
  ebay_connected       boolean NOT NULL DEFAULT false,
  ebay_store_category  text,
  ebay_shipping_policy text,
  ebay_return_policy   text,
  ebay_payment_policy  text,
  item_location        text,
  title_template       text,                            -- NULL = built-in template
  title_structure      jsonb,                           -- NULL = none; visual Title Structure Editor

  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One account per email (case-insensitive), among real (password-bearing) accounts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sellers_email ON sellers (lower(email)) WHERE email IS NOT NULL;

-- Login sessions: opaque random token -> seller. Cookie carries the token only.
CREATE TABLE IF NOT EXISTS sessions (
  token       text        PRIMARY KEY,
  seller_id   bigint      NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_seller ON sessions(seller_id);

-- One row per scan/upload batch; drives the review-queue progress UI.
CREATE TABLE IF NOT EXISTS scan_batches (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  source      text    NOT NULL DEFAULT 'paste',        -- paste | sample | upload
  label       text,
  status      text    NOT NULL DEFAULT 'processing',   -- processing | done
  total       integer NOT NULL DEFAULT 0,
  processed   integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- One row per scanned card. image_url / back_image_url hold the BUCKET KEY (or
-- URL) of the seller's uploaded photo — the file itself lives in object storage,
-- never in Postgres. ai_confidence routes the item: >= threshold auto-matches.
CREATE TABLE IF NOT EXISTS scan_items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id           bigint  NOT NULL REFERENCES scan_batches(id) ON DELETE CASCADE,
  seller_id          bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  raw_input          text    NOT NULL DEFAULT '',       -- the pasted line / scan token
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

  price_mode         text    NOT NULL DEFAULT 'market',
  price_pct          integer NOT NULL DEFAULT 0,
  price_cents        integer,                            -- resolved listing price
  price_overridden   boolean NOT NULL DEFAULT false,     -- user typed an exact price
  prev_price_cents   integer,                            -- "you listed this before at ..."

  sku                text,
  title              text,                               -- generated marketplace title
  dup_of_item_id     bigint  REFERENCES scan_items(id) ON DELETE SET NULL, -- in-batch duplicate
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Confirmed stock. Every physical card gets a unique SKU per seller.
CREATE TABLE IF NOT EXISTS inventory (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id      bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  card_id        bigint  NOT NULL REFERENCES cards(id),
  variant_id     bigint  NOT NULL REFERENCES card_variants(id),
  sku            text    NOT NULL,
  condition      text    NOT NULL DEFAULT 'NM',
  language       text    NOT NULL DEFAULT 'EN',
  quantity       integer NOT NULL DEFAULT 1,

  price_mode     text    NOT NULL DEFAULT 'market',
  price_pct      integer NOT NULL DEFAULT 0,
  price_cents    integer,
  acquired_cents integer,

  status         text    NOT NULL DEFAULT 'in_stock',   -- in_stock | listed | sold
  source_item_id bigint  REFERENCES scan_items(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_id, sku)
);

-- "Remember previous prices." One row per (variant, condition) sale/list event.
CREATE TABLE IF NOT EXISTS inventory_price_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  variant_id  bigint  NOT NULL REFERENCES card_variants(id),
  condition   text    NOT NULL DEFAULT 'NM',
  price_cents integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Generated marketplace listings (eBay first; same shape formats to other channels).
CREATE TABLE IF NOT EXISTS listings (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id      bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  inventory_id   bigint  NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  marketplace    text    NOT NULL DEFAULT 'ebay',       -- ebay | tcgplayer | whatnot | shopify | csv ...
  format         text    NOT NULL DEFAULT 'fixed',      -- fixed | auction
  title          text    NOT NULL,
  description    text    NOT NULL DEFAULT '',
  category_id    text,
  price_cents    integer,                               -- Buy It Now / fixed price
  start_cents    integer,                               -- auction start
  duration_days  integer,                               -- auction duration
  quantity       integer NOT NULL DEFAULT 1,
  sku            text,
  item_specifics jsonb   NOT NULL DEFAULT '{}'::jsonb,  -- name -> value
  scheduled_at   timestamptz,                           -- NULL = list immediately
  status         text    NOT NULL DEFAULT 'draft',      -- draft | scheduled | exported | published
  external_ref   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scanitems_batch  ON scan_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_scanitems_status ON scan_items(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_seller       ON inventory(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_variant      ON inventory(seller_id, variant_id, condition, language);
CREATE INDEX IF NOT EXISTS idx_iph_lookup       ON inventory_price_history(seller_id, variant_id, condition, recorded_at);
CREATE INDEX IF NOT EXISTS idx_listings_inv     ON listings(inventory_id);

-- Bootstrap a single passwordless "legacy" seller (id=1). The MVP wrote all its
-- data under this row; the FIRST account created via /signup claims it (attaches
-- an email + password), so existing inventory/scans/settings move behind login.
-- Every later signup is an isolated new seller. No-op on re-run.
INSERT INTO sellers (display_name)
SELECT 'My card shop'
WHERE NOT EXISTS (SELECT 1 FROM sellers);
