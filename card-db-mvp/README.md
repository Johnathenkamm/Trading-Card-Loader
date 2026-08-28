# CardIndex — MVP

Two halves of the product from the build plan, sharing one database:

1. **Public, SEO-first card price database** (`/`) — a searchable, variant-aware
   catalog with per-grade values, price history, and sold comps on every card
   page. The "wedge" CardUploader doesn't offer (its catalog lives behind a login
   with no public pages).
2. **Seller workspace** (`/app`) — the scan → identify → review → price →
   list-to-eBay pipeline from `tcg-card-scanner-platform.md`: paste/scan a list of
   cards, match them against the catalog with a confidence score, correct and
   price them in a review queue, commit to SKU'd inventory, and generate eBay
   listings + a File Exchange CSV.

Built to run with **zero external dependencies and zero build step**: TypeScript
executed directly by Node 24, `node:sqlite` for storage, and Node's built-in HTTP
server. The schema is standard SQL that lifts to Postgres/Supabase, and the pages
are already server-rendered with JSON-LD — so this maps cleanly onto the intended
Next.js + Supabase production stack.

## Run it

The app now serves from **Postgres** (with an S3-compatible image bucket). Both
run locally in Docker; see [`db/README.md`](db/README.md) for the full setup.

```bash
cd card-db-mvp
npm install         # installs the pg driver
npm run db:up       # start Postgres + image bucket (schema auto-applies)
npm run seed        # build data/catalog.db from the Pokemon TCG API + Scryfall (~15s, needs internet)
npm run pg:migrate  # load the catalog into Postgres
npm start           # serves http://localhost:5173
```

`npm run dev` runs the server with `--watch` (auto-restart on edits). Requires
**Node 24+** (TypeScript type-stripping) and Docker (for Postgres). Configuration
is read from `.env` (copied from `.env.example`); point `DATABASE_URL` at
Supabase/Neon to run against hosted Postgres with no code changes.

> Data flow: `seed` builds a local SQLite file from the card APIs, then
> `pg:migrate` copies it into Postgres. The running server reads/writes Postgres
> only; SQLite is just the seed staging file.

## What's real vs. demo data

| Data | Source | Real? |
|---|---|---|
| Cards, sets, images, rarities, artists | Pokémon TCG API, Scryfall | ✅ live |
| Variant finishes (holo, reverse holo, foil, etched…) | Pokémon TCG API, Scryfall | ✅ live |
| Current market price per variant | TCGplayer (via Pokémon TCG API) & Scryfall | ✅ live |
| 90-day price **history** | synthesized (random walk to current price) | ⚠️ demo, flagged |
| Per-**grade** values (PSA 8/9/10, CGC, BGS) | synthesized (multipliers on raw price) | ⚠️ demo, flagged |
| **Sold comps** | synthesized | ⚠️ demo, flagged |

Demo data is generated deterministically and marked `is_demo = 1` in the database,
and every page that shows it carries a note. This mirrors the real integration
constraints from the research report: a single API call has no price history
(you accrue it from daily snapshots), and **eBay sold-comp data is gated to
approved partners** — so those feeds are stubbed until a data source is secured.

Seeded sets: Pokémon **Base Set** + **Vivid Voltage**, Magic **Kamigawa: Neon
Dynasty** (~607 cards, ~1,050 variants). Edit `POKEMON_SETS` / `MAGIC_SETS` at the
top of `src/seed.ts` to change them.

## Features

- **Public, indexable pages** — home, browse (game → set → card), card detail,
  faceted search. Server-rendered HTML, `<title>`/meta/canonical/OpenGraph per
  page, JSON-LD (`Product` + `AggregateOffer`, `BreadcrumbList`, `CollectionPage`,
  `WebSite` + `SearchAction`), plus `/sitemap.xml` and `/robots.txt`.
- **Variant-aware** — prices and history hang off `card_variants`, not the bare
  card (the table CardUploader deliberately omits). The card page has a variant
  switcher; search has a Finish facet.
- **Card detail** — variant switcher, SVG price-history chart with 30/90-day
  range toggle and up/down coloring, per-grade value strip with sold volume, and
  sold-comp tabs filterable by grade with source chips.
- **Search** — keyword search with query parsing (detects game keywords and
  grade tokens like "psa 10"), faceted filtering (game, set, rarity, finish,
  price range) with live per-facet counts, sorting (relevance/price/name/newest),
  pagination, type-ahead suggestions (`/api/suggest`), and a Levenshtein
  "did you mean?" fallback.
- **Light + dark themes** via CSS tokens (respects `prefers-color-scheme`, with a
  toggle that persists to `localStorage`).

### Seller workspace (`/app`)

- **Scan / add** (`/app/scan`) — two entry paths, both feeding the review queue:
  - **Upload photos** (multipart → object storage): drag/drop or camera-capture
    card images, one item per photo, stored via the storage layer and shown in
    the queue. Identification runs through a **pluggable vision provider**
    (`VISION_PROVIDER`, `src/app/vision.ts`) — a recognizer's labels resolve
    against the catalog exactly like typed input; with none configured it falls
    back to a filename hint (`charizard-4-102.jpg`), then manual search. Front
    **and** back per item (`/app/review/:b/item/:i/image`).
  - **Paste a list** (one per line): each line is parsed for name, number
    (`4/102` or `#119`), set, finish, condition, language, and quantity (`3x`),
    then matched against the catalog. Matches ≥ 90% auto-confirm; lower ones route
    to review with alternatives.
- **Review queue** (`/app/review/:id`) — batch progress bar with matched / needs-
  review / failed counts and filter tabs; per-card editing of printing, condition,
  language, quantity, pricing rule, price, SKU, and generated title; alternative
  picks and a manual catalog search (`/api/identify`); in-batch **duplicate
  detection**; keyboard shortcuts (`j/k` move, `y` approve, `s` skip). "Add N to
  inventory" commits matched cards, optionally merging duplicate quantities.
- **Pricing** — rules per item or as a default: Market, Market ± %, or Fixed;
  manual override always wins; previous list price for the same printing is
  recalled ("you listed at …").
- **Inventory** (`/app`) — confirmed stock with auto-assigned SKUs
  (`PREFIX-000001`), value/units stats, status/search/sort filters, and a bulk
  toolbar (set condition/pricing, create listings, export CSV).
- **eBay listings** — a listing builder (`/app/list/:id`) that generates an
  ≤ 80-char optimized title, item specifics, and description, plus fixed-price /
  auction / scheduling fields; a listings view (`/app/listings`); and an **eBay
  File Exchange CSV** export (`/app/export/ebay.csv`).
- **Settings** (`/app/settings`) — SKU scheme, default pricing/condition/language,
  title template, and saved eBay listing preferences (policies, location).
- **Accounts & login** (`/signup`, `/login`, `/logout`) — email + password
  sign-in (scrypt-hashed, HttpOnly `SameSite=Lax` session cookies stored in
  Postgres). The whole workspace is gated; the public catalog stays open for SEO.
  Every customer's inventory, scans, listings, and settings are private to their
  account — each store query is scoped to the logged-in seller. The first signup
  claims the legacy single-tenant data; every account after is isolated.

Photo **upload, storage, review, and a pluggable vision hook** work end-to-end.
Vision recognition is provider-based (`VISION_PROVIDER=none|mock|http`, see
`src/app/vision.ts`): point `http` at a real recognizer (Ximilar, a self-hosted
model, eBay `searchByImage`) and its labels resolve to a priced catalog variant
through the same `identify()` contract; the offline default is filename-hint +
manual search, and `mock` proves the pipeline with no external service. Remaining
**seams** (labeled in the UI): the recognizer endpoint itself (needs an API
key/model), graded-slab OCR/QR + cert lookup, live eBay Sell-API publish (OAuth),
and Stripe billing.

## Layout

```
card-db-mvp/
  src/
    schema.sql            catalog + pricing DDL (Postgres-portable)
    schema.app.sql        seller workspace DDL (sellers, batches, items, inventory, listings)
    db.ts                 connection + typed catalog query functions
    seed.ts               fetches Pokemon TCG API + Scryfall; synthesizes demo pricing
    search.ts             query parsing, faceted SQL, facet counts, fuzzy fallback, type-ahead
    server.ts             node:http router (public site + auth + /app workspace + POST handling)
    util.ts               esc/slug/money/rng/levenshtein helpers
    app/                  seller workspace logic
      auth.ts             password hashing (scrypt), sessions, account creation, cookies
      session-context.ts  request-scoped seller + account (AsyncLocalStorage) for tenant isolation
      identify.ts         parse a card line → catalog match + alternatives + confidence
      pricing.ts          pricing rules (market / ±% / fixed), conditions, languages
      sku.ts              SKU formatting (PREFIX-000001)
      listing.ts          eBay title / item specifics / description / File Exchange CSV
      store.ts            workspace data layer (per-seller: batches, inventory, listings)
      compose.ts          cross-cutting: titles, listing previews, CSV rows
    render/
      layout.ts           HTML shell, <head>/SEO, brand mark, theme + type-ahead JS
      components.ts        card tile, SVG price chart, chips, pager, breadcrumb
      pages.ts            home, browse, set, card, search renderers + sitemap
      app.ts              inventory, scan, review, listing builder, listings, settings
      auth.ts             login + signup pages
  public/styles.css       design system (dark-navy default, cobalt-blue accent, Bricolage/IBM Plex)
  data/catalog.db         generated by `npm run seed`
```

## Mapping to production (later phases)

- **Database** → Postgres + bucket: **done — the app serves entirely from
  Postgres.** See [`db/README.md`](db/README.md). `npm run db:up` starts Postgres
  and an S3-compatible image bucket in Docker; `db/schema.postgres.sql` is the
  idiomatic translation of the two SQLite schemas; `npm run pg:migrate` loads the
  seeded catalog. `src/pg.ts` is the async Postgres data layer (public catalog,
  search, and the seller workspace all run through it); `src/storage.ts` handles
  image files (local dir or any S3-compatible bucket — MinIO/S3/R2/Supabase).
  Host-agnostic: point `DATABASE_URL` at Supabase/Neon to go to production.
  `src/db.ts` remains only as the SQLite seed-staging layer for `seed.ts`.
- **Rendering** → Next.js App Router: the `render/*` functions are pure
  string→HTML and already emit SSR-friendly, JSON-LD-annotated markup.
- **Price history** → keep the daily-snapshot job writing `price_points`
  (`kind='history'`) so real history accrues from day one.
- **Sold comps** → replace the synthesized rows with a licensed/partner feed or
  user-contributed sales (see the research report's integrations section).
- **Identification** → swap the catalog matcher in `app/identify.ts` for a
  vision/retrieval model behind the same `IdentifyResult` contract; the review
  queue and everything downstream stay unchanged. Log confirmed matches as
  training data (gated by `sellers.training_opt_in`, off by default).
- **eBay** → replace the File Exchange CSV export with the eBay Sell API
  (Inventory → Offer → publishOffer) once OAuth + a production keyset are in
  place; the listing drafts, scheduling times, and item specifics already exist.
- **Accounts** → **done — real email + password accounts with sessions.** Each
  `sellers` row is a customer (workspace tables already carried `seller_id`);
  `src/app/auth.ts` handles scrypt hashing, sessions, and cookies, and
  `src/app/session-context.ts` scopes every query to the logged-in seller.
  Still a seam: Stripe billing/plan tiers, email verification + password reset,
  OAuth sign-in, and per-request CSRF tokens (session cookies are `SameSite=Lax`).
- **Still to build**: graded-card slab scanner (OCR/QR + cert lookup), eBay
  variation listings, and the non-eBay marketplace exporters (TCGplayer, Whatnot,
  Shopify, …) — the inventory/listing records are already marketplace-agnostic.
