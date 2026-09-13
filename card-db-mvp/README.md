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

Data pipelines (run any time; both are re-runnable):

```bash
npm run sync:tcgcsv   # real TCGplayer market prices per PRINTING via the free TCGCSV daily
                      # mirror (~20:00 UTC refresh) + TCGplayer product ids/URLs on cards.
                      # Run daily (cron / Railway scheduled job) — each run adds a real
                      # price-history observation.
npm run import:sold -- <file.csv|json> [--source=<feed-id>] [--demo]
                      # land sold listings in the canonical sold_sales archive, deduped and
                      # CANONICALIZED to card/variant/grade via the identify() parser.
                      # Sample: npm run import:sold -- db/sold_sample.csv --source=sample --demo
npm run check:sold-links [-- --force | --limit=N]
                      # probe every archived listing URL and record its HTTP status on the
                      # row; Sales Lookup and card pages hide the link on 404/410 so no one
                      # lands on a dead listing (demo rows and malformed/eBay-search URLs
                      # are never linked, regardless). Re-run weekly alongside import:sold.
npm run hash:catalog  # build the photo-ID index: perceptual-hash every catalog reference
                      # image (re-run after adding sets; only new/changed cards fetch).
                      # Powers VISION_PROVIDER=hash — real photo identification, no API.
```

**TCGplayer on card pages**: the daily sync stores the full **price spread**
(low/mid/high next to market) per printing — shown keylessly on every card
page. `src/tcgplayer.ts` adds an env-gated **"TCGplayer by condition"** panel
(SKU-level NM/LP/MP/HP prices) for the one access route that exists:
TCGplayer's developer program is **closed to new applicants**, so
`TCGPLAYER_PUBLIC_KEY`/`TCGPLAYER_PRIVATE_KEY` only help if the client obtains
a grandfathered or partner keyset (JustTCG/Scrydex are the commercial
alternatives). `TCGPLAYER_MOCK=1` renders canned condition rows for UI testing;
unconfigured, the panel is hidden.

**Live eBay listings on card pages** (`src/ebay.ts`): register free at
[developer.ebay.com](https://developer.ebay.com), create an application keyset,
and set `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` in `.env` — card pages then get
a lazy-loaded **"Live on eBay"** panel driven by eBay's Browse API (self-serve,
no partnership needed; 5,000 calls/day to start, results cached 10 min).
`EBAY_MOCK=1` renders canned rows for UI testing without keys; with no config
the panel is hidden and the "eBay listed ↗" link-out remains. Sold prices are
**not** available this way (no open eBay API) — that's the archive above.

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
| Current market price per variant/printing | **TCGplayer via `sync:tcgcsv`** (TCGCSV daily mirror) | ✅ live, refresh daily |
| TCGplayer product ids + link-outs on card pages | `sync:tcgcsv` | ✅ live (affiliate-ready) |
| Price **history** | real observations accrue per `sync:tcgcsv` run; demo random-walk fills the chart until depth exists | ⚠️ mixed, flagged |
| Per-**grade** values (PSA 8/9/10, CGC, BGS) | synthesized (multipliers on raw price) | ⚠️ demo, flagged |
| **Sold comps** | `sold_sales` archive via `import:sold` (canonicalized to card/variant/grade); synthetic rows shown only where the archive is empty | ⚠️ per-card: real archive when present |

Demo data is generated deterministically and marked `is_demo = 1` in the database,
and every page that shows it carries a note. The data-sourcing research
(`../carduploader-data-sourcing-research.md`) sets the constraints these
pipelines encode: TCGplayer's API is closed to new developers (TCGCSV is the
sanctioned free mirror, product-level prices only — per-condition SKU prices
need a grandfathered key), and **there is no open eBay sold-data API** — sold
comps come from licensed feeds or accumulation, so the archive schema +
importer are built and waiting for whichever feed is licensed, and archiving
starts on day one because eBay only exposes ~90 days (CardUploader's own
archive reaches 2018 — bought, not built).

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

- **Dashboard** (`/app`) — plan card, stat tiles (inventory value vs. **market
  value**, cards in stock, cards awaiting review), quick actions, a
  getting-started checklist that ticks itself off, recent batches, and a
  how-it-works accordion.
- **Batches** (`/app/batches`) — every scan/paste with matched · review · failed
  counts, the value that reached inventory, and a one-click way back into review.
- **Graded cards** (`/app/graded`, `src/app/graded.ts`) — paste cert numbers or
  ranges per grader (PSA/CGC/BGS/SGC/TAG/ACE); each cert becomes an item carrying
  the cert, priced at the grade's catalog value when one exists, with a link-out
  to the grader's cert page. Cert lookup is provider-based (`CERT_PROVIDER=none|mock`;
  a PSA-API provider drops in). Grade/grader are editable in review and travel
  to inventory, titles, item specifics and every export.
- **Listing creator** (`/app/listing-creator`) — build listings from catalog
  stock images: browse a game → set and tick cards with quantities, or search
  and add; picks become confirmed review items. **Card search**
  (`/app/card-search`) is the same catalog with filters and prices plus a
  one-click "+ Add".
- **Blank listing creator** (`/app/blank-listing`) — catalog-less listings
  (sealed, lots, supplies) with item specifics; `listings.inventory_id` is
  nullable for these.
- **Pricing tool** (`/app/pricing-tool`) — free: upload or paste, get a priced
  list (no inventory), create a public **share link** (`/p/<token>`), or turn
  the batch into an inventory batch.
- **Orders** (`/app/orders`, `src/app/orders.ts`) — pending/picked/shipped per
  channel, manual orders, **TCGplayer pull-sheet CSV import** (matches by SKU,
  then name + number), per-item pick toggles, a printable **picklist** grouped
  by SKU, and "mark shipped" that decrements inventory (sold at zero). eBay /
  Mana Pool order fetching are labeled seams.
- **Automatic inventory** (`/app/inventory/automatic`) — exported / live
  listings per channel with mark-live / end controls (the engine-sync seam).
- **Inbox** (`/app/inbox`, `src/app/feedback.ts`) — feedback, bug and
  missing-card notes with replies.
- **eBay Sell APIs** (`src/app/ebay-sell.ts`) — Settings → eBay → **Connect eBay
  account** (OAuth authorization-code; tokens stored per seller and refreshed),
  **Sync policies** (Account API; shipping / payment / return chosen by ID with
  names mirrored into the CSV fields), a ship-from **location** (Inventory API,
  created on save), **Publish / Revise / End** on the listings page and "Save &
  publish" in the listing builder (Inventory item → offer → publish, with a
  pre-flight that reports every blocker at once), **Fetch eBay orders**
  (Fulfillment API, deduped), mark-shipped pushed back to eBay, and quantity
  sync to live listings when a non-eBay order ships. **Scheduled & spaced-out
  publishing**: select listings → "Schedule & space out" (start time + every N
  minutes, CardUploader's "Space Out"); an in-process runner publishes each one
  when due (every `SCHEDULER_INTERVAL_MS`, default 60 s; `SCHEDULER_DISABLED=1`
  on extra instances), parks a listing back as a draft after three failed
  attempts with the error on its row. Shipping takes a carrier + tracking
  number, which is passed to eBay. `EBAY_MOCK=1` runs the whole flow on canned
  responses; real use needs a keyset + RuName (see `.env.example`).
- **Multi-channel exports** (`src/app/exporters.ts`) — eBay File Exchange,
  TCGplayer inventory (ungraded only, optional My Store columns), Whatnot bulk
  listing and Shopify product CSVs from inventory rows and blank listings, with
  per-channel preferences from Settings → Shopify / Whatnot / TCGplayer / Mana Pool.
- **Scan / add** (`/app/scan`) — two entry paths, both feeding the review queue:
  - **Advanced matching options** on both forms: prioritize or exclude sets and
    keywords for the batch (`src/app/matching.ts`). Exclusions filter candidates
    before scoring; priorities add a bounded score boost so a card from a set
    you said you're scanning wins over the same name elsewhere. Savable as your
    defaults.
  - **Upload photos** (multipart → object storage): drag/drop or camera-capture
    card images, one item per photo, stored via the storage layer and shown in
    the queue. Batches are **chunked**: the dropzone script shrinks each photo
    on the device to 1600 px JPEG (`UPLOAD_MAX_EDGE`; a 12 MP phone photo goes
    from ~4 MB to ~300 KB, no accuracy cost for the hasher; undecodable formats
    such as HEIC are sent as-is), opens a batch
    (`/app/scan/upload/start`), sends the photos in groups of 20
    (`/app/scan/upload/:batch/chunk`, each under the 60 MB request limit) with
    a progress bar and resume-on-retry, then closes it (`…/finish`). Caps are
    **100 photos per batch on Free, 500 on Pro** (`src/upload.ts`; the owner's
    `/admin/upload` gets the Pro cap). Without script the form posts once.
    Identification runs through a **pluggable vision provider**
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
  recalled ("you listed at …"). **Automatic pricing preference** (Settings →
  Pricing): previous price first / rule only / previous only, plus a
  "never price below $X" floor applied to automatic prices (`src/app/pricing.ts`).
- **Inventory** (`/app/inventory`) — confirmed stock with auto-assigned SKUs
  (`PREFIX-000001`), value and market-value stats, status/search/sort filters,
  and a bulk toolbar (set condition/pricing, create listings, export CSV).
- **eBay listings** — a listing builder (`/app/list/:id`) that generates an
  ≤ 80-char optimized title, item specifics, and description, plus fixed-price /
  auction / scheduling fields; a listings view (`/app/listings`); and an **eBay
  File Exchange CSV** export (`/app/export/ebay.csv`).
- **Settings** (`/app/settings`) — sectioned like CardUploader's Configuration:
  shop & SKU scheme, default pricing + automatic-pricing preference + floor,
  default matching options, the visual title structure editor, **description
  templates** (up to three, one active, `{variables}` inserted at the cursor,
  live preview; the active template feeds the listing builder, bulk listing
  creation and the CSV export), and saved eBay listing preferences.
- **Accounts & login** (`/signup`, `/login`, `/logout`, `/reset-password`) —
  email + password sign-in (scrypt-hashed, HttpOnly `SameSite=Lax` session
  cookies stored in Postgres). Sign-up asks for a shop name, email and password
  (show-password toggle, rule shown inline); sign-in has a "Forgot?" link on the
  password row and offers the reset path in the error after a wrong password.
  **Password reset** is email → single-use link (sha256 of the token stored,
  60-minute expiry) → new password, which signs the user in and signs out every
  other session. Email goes through `src/app/mailer.ts`: `MAIL_PROVIDER=log`
  (default) prints the link to the server log so the flow works locally;
  `MAIL_PROVIDER=resend` + `RESEND_API_KEY` sends for real (set `APP_BASE_URL`
  behind a proxy). Deep links survive login via `?next=`, and a new signup lands
  on the dashboard with a welcome, never on a login screen. Every customer's
  inventory, scans, listings, and settings are private to their account — each
  store query is scoped to the logged-in seller. The first signup claims the
  legacy single-tenant data; every account after is isolated.
- **Free vs. Pro inside the workspace** — a Free account gets the dashboard,
  the ungraded pricing tool, card search, sales lookup, inbox and settings
  (CardUploader's free surface); anything that adds cards, manages stock or
  publishes is Pro and redirects to `/pricing?upgrade=1` (`proRequired()` in
  `server.ts`). The sidebar and dashboard tiles mark Pro pages with a "Pro"
  chip for Free accounts, and the header shows a plan pill on every page.
- **Add cards is one page with two outcomes** (`/app/scan?mode=price|inventory`).
  The old Scan page and Pricing tool shared the same forms and server code, so
  they are merged: the seller picks the outcome first, and each choice shows a
  small pipeline of what happens to the photos — *Price only* (Free: identified,
  priced at market, shareable list, photos kept only as thumbnails) or *Add to
  inventory* (Pro: review, SKUs, photos stored as listing images). Pro-only
  fields (pricing rule, SKU prefix) appear only for the inventory outcome; a
  Free account choosing it sees what Pro unlocks instead of a form that would
  bounce. `/app/pricing-tool` redirects to the price outcome.
- **Workspace navigation** — a sticky left sidebar grouped by what you do
  there: *Add cards* (Ungraded, Graded, Listing creator, Blank listing, Pricing
  tool), *Manage* (Batches, Inventory, Automatic inventory, Listings, Orders),
  *Look up* (Card search, Sales lookup — the public `/sales` rendered inside the
  workspace), *Account*. Pages that don't take cards in carry a persistent
  "+ Add cards" action; the rail collapses to icons (preference persisted per
  browser; forced collapsed on review pages, open on Settings).
- **Owner console / CRM** (`/admin`) — the operator's back-office, behind its
  **own login**: set `ADMIN_EMAIL` + `ADMIN_PASSWORD`, sign in at
  `/admin/login`, and the owner session (its own HttpOnly cookie, 24 h, 5
  failed attempts locks the IP for 15 min) unlocks the console. Customer
  accounts, Free or Pro, never get in — every `/admin` URL just shows the owner
  sign-in. The console shows every account with its **Free or Pro tier**, last
  login / last seen, 7-day activity and inventory counts; a per-user profile
  with an upgrade/downgrade button, usage stats, their batches, feedback and a
  full **activity timeline** (every login, page view and action is logged to
  `activity_log`); a site-wide activity feed; a feedback queue with replies that
  land in the user's inbox; and the owner's **personal uploader**
  (`/admin/upload`: upload photos or paste a list — same identify → review
  pipeline as the customer's scan page — into the **owner's own account**, a
  seller row flagged `sellers.is_owner` that is created on boot from
  `ADMIN_EMAIL`, hidden from the user lists, and never a customer's). With an
  owner session, `/app` is that own workspace (inventory, batches, listings,
  settings), so nothing the owner adds ever lands in someone else's account.
  "Open workspace" on a user's profile enters **owner mode**: the whole `/app`
  runs inside that customer's data scope with no paywall, a banner shows whose
  account it is, and every change is tagged "by owner" in the log.
  See `src/app/admin.ts` / `src/render/admin.ts`.

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
      auth.ts             password hashing (scrypt), sessions, account creation, password-reset tokens, cookies
      mailer.ts           outbound email (log | resend) for reset links
      admin.ts            owner login (ADMIN_EMAIL/ADMIN_PASSWORD, admin_sessions), activity log, cross-tenant CRM queries, owner-mode cookie
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
      admin.ts            owner console: overview, users, user profile, activity, feedback
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
  Password reset is done (email link via `src/app/mailer.ts`). Still a seam:
  Stripe billing checkout, email verification, Google sign-in, and per-request
  CSRF tokens (session cookies are `SameSite=Lax`).
- **Still to build**: graded-card slab scanner (OCR/QR + cert lookup), eBay
  variation listings, and the non-eBay marketplace exporters (TCGplayer, Whatnot,
  Shopify, …) — the inventory/listing records are already marketplace-agnostic.
