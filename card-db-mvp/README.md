# CardIndex — the trading-card price guide for buyers and collectors

Two halves of the product, sharing one database:

1. **Public, SEO-first price guide** (`/`) — a searchable, variant-aware catalog
   with live market prices, per-grade values, price history and real sold comps
   on every card page, plus a sold-price lookup across eBay, Goldin and Fanatics.
2. **Member area** (`/collection`) — a free **price check** (photograph or paste
   the cards you're holding or being offered; every one is identified against
   the catalog and priced, shareable by link), a **wishlist** with target-price
   alerts, and on Pro a private **collection**: add cards from photos, pasted
   lists, cert numbers or a set checklist, confirm them in a review queue, and
   see what you own against today's market and what you paid.

Until September 2026 this codebase was a seller tool (inventory, SKUs, eBay
listings, orders, marketplace CSV exports). All of that was removed in the
buyer/collector overhaul; `npm run db:drop-seller -- --yes` removes the leftover
tables once a deploy is verified (see `src/scripts/drop-seller-tables.ts`).

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
                      # (/sales shows real sales only and the server REMOVES sample rows at
                      # boot; SOLD_SAMPLE_ON_BOOT=1 on a demo deploy loads the sample instead)
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
| **Sold comps** | `sold_sales` archive, filled by feeds via `import:sold`; `/sales` shows real rows only (sample rows are removed at boot unless `SOLD_SAMPLE_ON_BOOT=1`) | ✅ real where a feed has been imported; empty until then |

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

### Member area (`/collection`)

Everything under `/collection` needs a member account; old `/app/*` links
redirect (301) to their `/collection` equivalents.

- **Collection home** (`/collection`) — plan card, stat tiles (collection value
  at market, cards owned, what you paid vs. market, wishlist count with
  targets hit), quick actions, a getting-started checklist that ticks itself
  off, recent uploads, and a how-it-works accordion.
- **Add cards** (`/collection/add?mode=price|collection`) — one page, two
  outcomes. *Just price them* (Free) identifies and values every card and
  shows a table you can share by link (`/p/<token>`); *Add to my collection*
  (Pro) sends the same cards through review into your collection, keeping the
  photo and what you paid. Both take **photos** (drag/drop or camera; chunked
  upload — shrunk on the device to 1600 px, sent in groups of 20 with a
  progress bar and resume-on-retry; caps **100 photos per upload on Free, 500
  on Pro**) or a **pasted list** (one per line: name, number `4/102`/`#119`,
  set, finish, condition, language, `3x` quantity). Identification runs
  through the pluggable vision provider (`VISION_PROVIDER`, `src/app/vision.ts`;
  `hash` is a real local perceptual-hash matcher) and the catalog matcher
  (`src/app/identify.ts`); ≥ 90% confidence auto-matches, the rest waits in
  review. **Advanced matching options** prioritize or exclude sets and
  keywords (`src/app/matching.ts`), savable as defaults.
- **Review queue** (`/collection/review/:id`) — progress bar with matched /
  needs-review / no-match counts and filter tabs; per-card editing of
  printing, condition, language, quantity, grader + grade and **what you
  paid**; alternative picks and a manual catalog search (`/api/identify`);
  in-batch duplicate detection; front and back photo per card; keyboard
  shortcuts (`j/k` move, `y` confirm, `s` skip). "Add N to my collection" (Pro)
  commits matched cards, optionally merging duplicate quantities.
- **Graded slabs** (`/collection/graded`, `src/app/graded.ts`) — paste cert
  numbers or ranges per grader (PSA/CGC/BGS/SGC/TAG/ACE); each cert becomes a
  review item valued at the grade's catalog value when one exists, with a
  link-out to the grader's cert page. Cert lookup is provider-based
  (`CERT_PROVIDER=none|mock`; a PSA-API provider drops in).
- **Add from a set** (`/collection/from-set`) — a set checklist: pick a game →
  set, see which cards you already own and the set completion, tick the rest
  with quantities, or search and add; picks land in review as confirmed matches.
- **Collection** (`/collection/cards`, Pro) — every confirmed card with its
  printing, condition/grade, quantity, paid price and today's market value
  (gain/loss per row and in the stat tiles); filter by game, search, sort by
  value/name/set/paid; inline edit per row (qty, paid, condition); bulk set
  condition or remove; **CSV export** (`/collection/export.csv`).
- **Wishlist** (`/collection/wishlist`) — press **♡ Wishlist** on any card
  page (optionally with a target price). The list shows market vs. target and
  flags cards at or below target; the card page shows "on your wishlist" and
  "you own N". Free accounts keep up to 25 cards; Pro is unlimited and gets
  **email alerts** after each price sync (`notifyWishlistAlerts` in
  `src/app/collection.ts`, called at the end of `npm run sync:tcgcsv`).
- **Uploads** (`/collection/uploads`) — every upload with matched · review ·
  no-match counts, its value, and a one-click way back into review.
- **Inbox** (`/collection/inbox`, `src/app/feedback.ts`) — questions, bug
  reports and missing-card notes with replies from the owner.
- **Settings** (`/collection/settings`) — display name, default condition /
  language for uploads, default matching options, training opt-in (off by
  default), plan.
- **Accounts & login** (`/signup`, `/login`, `/logout`, `/reset-password`) —
  email + password sign-in (scrypt-hashed, HttpOnly `SameSite=Lax` session
  cookies stored in Postgres). Sign-up asks for a display name, email and
  password; sign-in has a "Forgot?" link and offers the reset path after a
  wrong password. **Password reset** is email → single-use link (60-minute
  expiry) → new password, which signs the user in and signs out every other
  session. Email goes through `src/app/mailer.ts` (`MAIL_PROVIDER=log|resend`).
  Every member's collection, wishlist, uploads and settings are private to
  their account — each query is scoped to the signed-in member
  (`src/app/session-context.ts`).
- **Free vs. Pro** — Free: the whole public price guide, price checks with
  share links, uploads history, a 25-card wishlist, inbox, settings. Pro
  ($15/mo): the collection (adding to it, browsing it, exporting it), the
  collection outcome of add/upload, graded slabs, add-from-a-set, unlimited
  wishlist with alerts. Enforced by `proRequired()` in `server.ts` plus
  outcome-level checks; Pro pages carry a "Pro" chip for Free accounts and the
  header shows a plan pill. Checkout is not wired; Pro is granted with
  `npm run grant-pro -- <email>` or the owner console.
- **Owner console** (`/admin`) — the operator's back office behind its **own
  login** (`ADMIN_EMAIL` + `ADMIN_PASSWORD`, `/admin/login`, own cookie, IP
  lockout after 5 failures). Members never get in. It shows every member with
  plan tier, last seen, 7-day activity, uploads, collection and wishlist
  counts; a per-member profile with upgrade/downgrade, usage, uploads,
  feedback and the full **activity timeline**; a site-wide feed; a feedback
  queue whose replies land in the member's inbox; and the owner's **personal
  uploader** (`/admin/upload`) into the owner's own account (`sellers.is_owner`,
  created on boot from `ADMIN_EMAIL`, hidden from the member list). "Open
  collection" on a profile enters **owner mode**: `/collection` runs inside
  that member's data scope with no paywall, a banner says whose account it is,
  and every change is tagged "by owner". See `src/app/admin.ts` /
  `src/render/admin.ts`.

Remaining **seams** (labeled in the UI): a hosted recognizer endpoint behind
`VISION_PROVIDER=http`, graded-slab OCR/QR + a real cert-lookup provider,
binder-page multi-card detection, Stripe billing.

## Layout

```
card-db-mvp/
  src/
    schema.sql            catalog + pricing DDL (Postgres-portable)
    schema.app.sql        member-area DDL (sellers = accounts, batches, items, collection, wishlist) — SQLite mirror
    db.ts                 SQLite seed-staging layer + shared types
    pg.ts                 Postgres data layer (catalog queries; pool helpers)
    seed.ts               fetches Pokemon TCG API + Scryfall; synthesizes demo pricing
    search.ts             query parsing, faceted SQL, facet counts, fuzzy fallback, type-ahead
    sales.ts              sold-sales archive search (public /sales)
    server.ts             node:http router (public site + auth + /collection + /admin + POST handling)
    upload.ts / storage.ts   multipart parsing, upload caps; local or S3-compatible image storage
    util.ts               esc/slug/money/rng/levenshtein helpers
    app/                  member-area logic
      auth.ts             password hashing (scrypt), sessions, account creation, password-reset tokens, cookies
      billing.ts          Free vs Pro plan tier
      mailer.ts           outbound email (log | resend): reset links, wishlist alerts
      admin.ts            owner login, activity log, cross-tenant console queries, owner-mode cookie
      session-context.ts  request-scoped member + account (AsyncLocalStorage) for tenant isolation
      identify.ts         parse a card line → catalog match + alternatives + confidence
      vision.ts / hashindex.ts   photo → card (perceptual-hash matcher and the boot-time index builder)
      matching.ts         Advanced matching options (prioritize / exclude sets and keywords)
      graded.ts           graders, cert parsing/lookup, grade values
      conditions.ts       condition + language vocabularies
      collection.ts       data layer: member prefs, uploads + review items, collection, wishlist, alerts
      feedback.ts         inbox notes + owner replies
      soldimport.ts       sold-sales feed importer (+ sample housekeeping at boot)
    render/
      layout.ts           HTML shell, <head>/SEO, brand mark, theme + type-ahead JS
      components.ts       card tile, SVG price chart, chips, pager, breadcrumb
      pages.ts            home, browse, set, card, search renderers + sitemap
      sales.ts            sold-price lookup page
      pricing.ts          Free vs Pro plans page
      collection.ts       member chrome (sidebar, head, APP_JS) + home, collection, wishlist, uploads, inbox, settings
      collection-add.ts   add cards, review queue, graded slabs, add from a set, priced list / share page
      admin.ts            owner console: overview, members, profile, uploader, activity, feedback
      auth.ts             login, signup, password reset pages
    scripts/              sync:tcgcsv, hash:catalog, import:sold, check:sold-links, grant-pro, db:drop-seller
  public/styles.css       design system (dark-navy default, cobalt-blue accent, Bricolage/IBM Plex)
  data/catalog.db         generated by `npm run seed`
```

## Mapping to production (later phases)

- **Database** → Postgres + bucket: **done — the app serves entirely from
  Postgres.** See [`db/README.md`](db/README.md). `npm run db:up` starts Postgres
  and an S3-compatible image bucket in Docker; `db/schema.postgres.sql` is the
  idiomatic translation of the two SQLite schemas; `npm run pg:migrate` loads the
  seeded catalog. `src/pg.ts` is the async Postgres data layer (public catalog,
  search, and the member area all run through it); `src/storage.ts` handles
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
- **Accounts** → **done — real email + password accounts with sessions.** Each
  `sellers` row is a member (the table keeps its old name; every member table
  carries `seller_id`); `src/app/auth.ts` handles scrypt hashing, sessions, and
  cookies, and `src/app/session-context.ts` scopes every query to the signed-in
  member. Password reset is done (email link via `src/app/mailer.ts`). Still a
  seam: Stripe billing checkout, email verification, Google sign-in, and
  per-request CSRF tokens (session cookies are `SameSite=Lax`).
- **Still to build**: graded-slab scanner (OCR/QR + a real cert-lookup
  provider), binder-page multi-card detection, and a licensed sold-sales feed
  to fill the archive at scale.
