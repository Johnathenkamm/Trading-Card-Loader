# Trading Card Marketplace Site — Research & Build Plan

Prepared for: Client website project (competitive reference: CardUploader.com)
Revised: **August 23, 2026** — competitor and integration facts updated from `carduploader-competitive-research-report.md` (first-hand inspection of CardUploader + verified web research). Every change is listed in §8.

---

## 1. Executive Summary

CardUploader.com is an AI-powered card-identification + listing tool for trading cards (Pokémon-first; it now claims 45–50+ TCG databases, up from about seven in Dec 2025). Its core loop is: **upload photos (or paste cert numbers) → AI image-matches the card against its internal catalog → auto-fills title, specifics and price → export listings** — as eBay-ready CSV or, newer, direct eBay API listing, plus CSV/XLSX exports for Shopify, Whatnot, TCGplayer, Mana Pool, Cardmarket (beta), Tradera and MercadoLibre. One flat plan: $9.99/month unlimited (fair use), 3-day trial with 100 credits.

The client's concept — a database customers can upload cards to and get price/info back — overlaps with CardUploader but is closer in spirit to a hybrid of CardUploader (upload → identify → list) and PriceCharting (public searchable price database). CardUploader has **no public catalog or card pages** (its database is only searchable inside the logged-in app), deliberately stores **no printing variants** (holo / reverse holo / 1st edition / stamped), and wires only reference prices into the listing flow (TCGplayer market × multiplier; ALT estimates for graded; "eBay Sold" is a link-out). PriceCharting has the public database and price history but no listing workflow. **Nobody yet combines a public, variant-aware price-history database with sold-comp evidence and an upload → review → list pipeline.** That hybrid is the opportunity.

---

## 2. Competitive Research

### 2.1 What CardUploader does well
- **Speed**: photos → matched, priced, titled rows in seconds; a Dec 2025 walkthrough puts a CSV batch live on eBay roughly 10–20 seconds after upload
- **Broad coverage (claimed)**: 45–50+ TCGs per its marketing; its >95% accuracy claim is scoped to standard English/Japanese Pokémon
- **Low barrier to entry**: $9.99/month flat, unlimited (fair-use policy), 3-day trial with 100 credits, phone photos or scanner images, web only
- **One flow instead of three**: identification + pricing + serious listing tooling — title-structure builder with 80-character optimizer, bulk edit, duplicate merge to quantity, scheduled and staggered listings, eBay variation listings, config profiles per TCG/store, graded cert lookup (PSA/CGC/BGS/TAG/ACE)
- **Export breadth**: ten formats; 20 eBay marketplaces with currency conversion; an eBay account connection (OAuth) with policy/category sync, "Check eBay Duplicates" against live listings, "List on eBay (via API)", and a beta inventory/orders layer (orders via the eBay Fulfillment API)
- **Free public "Sales Lookup"** (eBay/Goldin/Fanatics sold listings with "hidden Best Offer prices", affiliate-monetized) as an acquisition channel
- **Fast catalog curation loop** (report a missing card → credit refunded → added within 24–48 h) and an active Discord

### 2.2 Where it's weak
- **No public database, card pages or SEO** — the catalog sits behind login and credits; the public site is a marketing SPA
- **Variant-blind catalog** — holo / reverse holo / 1st edition / stamped are *not* separate records ("to reduce mismatches"); user-set variant tags only change the title, never the matched card or the price
- **Pricing is reference pricing, not evidence** — TCGplayer market × multiplier, the user's previous price, an "eBay Listed" active-comps modal; "eBay Sold" just opens eBay; the public Sales Lookup is keyword-matched raw listings not tied to a card (200-row cap, duplicate rows)
- **Bulk throughput, not bulk accuracy** — jobs are asynchronous and queue under load: a May 2026 creator reported being ~26th in a processing queue after ~500 of 5,000 cards in one evening. No priority tier, no progress/ETA, no per-card confidence, no review queue (corrections are manual via "View Alternatives" / search)
- **CSV-first for everything but eBay** — Shopify, Whatnot, TCGplayer, Mana Pool etc. are file exports with no live sync; the only troubleshooting article is "eBay CSV won't upload" (policy names must match exactly, postal code)
- **No hardware/feeder integration** — phone/scanner images only (TCG Automate ingests Roca/CardBot/PhyzBatch/Magic Sorter CSVs; SortSwift sells sorters)
- **Pokémon-first DNA**; fees non-refundable; uploads licensed to train their AI (opt-out by email); one account per business; no public API

### 2.3 Competitive landscape

| Tool | Angle | Notable gap |
|---|---|---|
| CardUploader | Photo/cert → identify → price → export; eBay API + CSV; public Sales Lookup; beta inventory/orders; $9.99/mo flat | No public DB, no variants, keyword sold search, CSV-first outside eBay |
| TCG Automate | eBay API listing + CSV; cross-list eBay + Shopify (+ Square) with quantity sync on Pro ($40/mo) and up; TCGplayer via CSV; sorter CSV connections (CardBot, PhyzBatch, Roca, Magic Sorter); 30 TCGs + sports; $10–$200/mo scan-metered, no free plan | Metered pricing; TCGplayer-market pricing, not sold comps; no public DB |
| SortSwift | Multi-game (26+ TCGs) full card-shop platform: scanning, inventory, POS, buylist, repricer, nine-channel sync (five native two-way; TCGplayer semi-sync), Super Sorter hardware ($8,999–$24,999 + $199/mo); Free → $499/mo | Heavy back-office tool; no public price history |
| SpeedyCardLister | Sports-first AI lister (TCG secondary); $1 first month then $5–$125/mo scan-metered; scanner/flatbed/phone input | eBay-only (its own FAQ) |
| TCGplayer Pro / Roca Sifter | Scan & Identify bundled with selling on TCGplayer; Roca Sifter $799 + $25/mo, vendor-spec 1,800 cards/hr, ships Sept/Fall 2026 | Locked into TCGplayer's marketplace |
| Card Dealer Pro / Heystack / RocketVault | Other AI identify → list tools (eBay/Shopify/CollX; RocketVault is sports, 500-card batches, inline "attention chip" review) | Seller-only, no database |
| PSA app / Binder AI / CardGrade / SnapGradeAI / CGA | Photo-based condition/grade estimates; none independently benchmarked | No listing/marketplace layer |
| PriceCharting | Public searchable price database: price-history charts, per-grade prices with volume, sold comps by grade (eBay + TCGplayer), collection tracker, new Photo Appraiser; API $49/mo | No listing workflow; API returns current values only (no history) |
| Card Ladder / CardWiki | Sold-comp database (sports-first, Pro paywall) / public crowdsourced catalog (sports, beta) | Sports-first; no TCG upload → list |

### 2.4 The gap worth building into

No single competitor combines all of these:
1. A **public, SEO-indexed price database** with card and set pages (PriceCharting's strength; CardUploader has none)
2. A **variant-aware catalog and price model** — holo vs. non-holo vs. 1st edition priced separately (CardUploader's deliberate blind spot)
3. **Sold-comp evidence per card / variant / grade** wired into the suggested price, clearly labelled and sourced (CardUploader links out to eBay; TCG Automate uses market price) — with a realistic data-source plan, because eBay's sold-data APIs are closed to new developers (see §6.3)
4. A **bulk upload + confidence-routed human review queue** with visible progress and a priority lane (CardUploader: one results page, queueing under load, no confidence)
5. **Direct eBay API publishing with pre-flight validation** (removes the incumbent's #1 support issue) plus file exports for the long tail; Shopify sync in a later phase — note that TCG Automate and SortSwift already sell multi-channel sync, so this is parity, not the wedge
6. A **collector layer** (collection value over time, wishlists, price alerts, shareable binder links) — CardUploader is seller-only
7. An optional **condition/grade estimate**, and **trust defaults** (no AI training on uploads without opt-in)

---

## 3. Site Architecture

```
Home
├── Search Results (card lookup, facets)
├── Browse by Game → Set → Card (public, SEO)
├── Card Detail Page (variants, price history, per-grade prices, sold comps)
├── Sales Lookup (public sold-comp search, canonicalized to cards)
├── Upload & Identify
│   ├── Single Card Upload
│   └── Bulk Upload + Review Queue
├── My Collection / Dashboard
│   ├── Inventory (value over time)
│   ├── Uploaded Cards (pending review)
│   ├── Listings (published to marketplaces)
│   └── Orders (synced from eBay; pick lists)
├── Pricing / Plans
├── Guides / Docs
├── API (read-only price data with attribution) — later
└── Account / Settings (marketplace connections, config profiles, privacy controls)
```

---

## 4. Page Wireframes

### 4.1 Homepage
```
┌──────────────────────────────────────────────────────────┐
│ LOGO   [ Search any card...        ] [Search] [📷 Upload] │
│                              Browse | Sales | Log In       │
├──────────────────────────────────────────────────────────┤
│              "Upload a card. Get the price                │
│               and info instantly."                        │
│         [ Upload Photo ]      [ Browse by Game ]           │
│   sources: TCGplayer · PriceCharting · sold comps (n)      │
├──────────────────────────────────────────────────────────┤
│  Trending Cards            Recently Priced                 │
│  [img][img][img][img]      [img][img][img][img]            │
├──────────────────────────────────────────────────────────┤
│  Browse by Game:                                           │
│  Pokémon | MTG | One Piece | Yu-Gi-Oh | Sports | Lorcana…  │
├──────────────────────────────────────────────────────────┤
│  Footer: About | API | Pricing | Guides | Discord | Terms  │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Search Results Page
```
┌──────────────────────────────────────────────────────────┐
│ Search: "charizard psa 10" [Search]   Filters ▾            │
│ ┌ Game ▾ Set ▾ Rarity ▾ Variant ▾ Language ▾ Grade ▾ $ ▾ ┐ │
├──────────────────────────────────────────────────────────┤
│ [img] Charizard VMAX  | Darkness Ablaze | #020/189          │
│       [Holo] [Rainbow]  Market $84.50 · 31 sold (30d) [View]│
├──────────────────────────────────────────────────────────┤
│ [img] Charizard Base Set | Base | #4/102                    │
│       [Unlimited] [Shadowless] [1st Ed] Market $215 [View]  │
├──────────────────────────────────────────────────────────┤
│ ... (paginated)   Can't find it? [ Upload a photo ]          │
└──────────────────────────────────────────────────────────┘
```

### 4.3 Card Detail Page
```
┌──────────────────────────────────────────────────────────┐
│ Pokémon › Base Set › Charizard #4/102                      │
│ [ Card Image ]     Charizard #4/102 — Base Set, Holo Rare  │
│ [front][back]      Variant: [Unlimited] [Shadowless] [1st] │
│                                                              │
│                     Market Price: $215.00  (▲ +4% 30d)     │
│                     ▁▂▃▅▇▆▅▃▂  6m | 1y | 5y | All           │
│                     Ungraded $215 · PSA 8 $1,298 · PSA 9 … │
│                     · PSA 10 $28,097   (volume per grade)   │
│                                                              │
│                     [ + Collection ] [ ♡ Save ] [ Sell it ] │
│                     (save works as a guest)                  │
├──────────────────────────────────────────────────────────┤
│  Sold comps — tabs: Ungraded | 7 | 8 | 9 | PSA 10            │
│  Source ▾ (all / eBay / TCGplayer / Goldin)  Report a row    │
│  eBay  $303  Aug 22 | TCGplayer $948 Aug 18 | eBay $415 …   │
├──────────────────────────────────────────────────────────┤
│  Other variants / reprints      IDs: TCGplayer · ePID · pop  │
│  [img][img][img][img]                                       │
└──────────────────────────────────────────────────────────┘
```

### 4.4 Upload & Identify (single card)
```
┌──────────────────────────────────────────────────────────┐
│  Drag & drop or [ Choose Photo ] or [ 📷 Camera ]           │
│  (front required, back optional; auto-crop on)              │
│                                                              │
│  [ preview thumbnail ]                                       │
│                                                              │
│  Analyzing... → Match found:                                 │
│  "Charizard VMAX #020/189 — Darkness Ablaze"  (92% confident)│
│  Which printing?  (•) Holo  ( ) Rainbow Rare  ( ) Not sure   │
│  [ Confirm ]  [ Alternatives (3) ]  [ Not right? Search ]    │
│                                                              │
│  → Market price: $84.50 · last 3 sold: $82, $89, $80        │
│  [ Add to Collection ]  [ Create Listing ]                   │
└──────────────────────────────────────────────────────────┘
```

### 4.5 Bulk Upload + Review Queue
*(The page competitors under-build: CardUploader puts everything on one results page with no confidence routing, and its jobs queue silently under load. Invest here.)*
```
┌──────────────────────────────────────────────────────────┐
│  Batch #214: 47 images · 47 processed · ETA done            │
│  ████████████████████░░  (live progress, retry failed)      │
│  ✅ 38 auto-matched (≥90%)  ⚠ 7 need review  ✖ 2 failed     │
│  Show: [ all | needs review | failed ]   [ Bulk edit ▾ ]    │
├──────────────────────────────────────────────────────────┤
│  Review Queue (7)                                            │
│  ┌────────────┐  Suggested: "Blastoise #009"  Confidence 61% │
│  │ [thumbnail] │  Printing? [Holo] [Reverse] [Unlimited]      │
│  │             │  [ Confirm ]  [ Pick alternative ]  [ Search ]│
│  └────────────┘  [ Skip ]        (keyboard: Y / A / S / N)    │
│  ⚠ Duplicate of row 12 — merge into quantity? [Yes] [Keep]   │
├──────────────────────────────────────────────────────────┤
│  [ Approve all matched → Add to Collection ]  Tag batch: [ ] │
└──────────────────────────────────────────────────────────┘
```

### 4.6 My Collection / Dashboard
```
┌──────────────────────────────────────────────────────────┐
│  My Collection     Total value: $4,281.50   ▁▃▅▆▇ (90d)     │
│  Tabs: [ Inventory ] [ Pending Review ] [ Listings ] [ Orders ]│
├──────────────────────────────────────────────────────────┤
│  Sort: Value ▾  Filter: Game ▾ Status ▾   [ + Add Cards ]    │
├──────────────────────────────────────────────────────────┤
│  ☐ [img] Charizard VMAX Holo  Qty 1  $84.50  Listed  [Edit] │
│  ☐ [img] Pikachu Promo        Qty 3  $12.00  Not listed [List]│
│  ...   (select rows → bulk toolbar: List · Reprice · Export)  │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Database Schema

```sql
-- Reference / catalog data
games (
  id, name, slug, created_at
)

sets (
  id, game_id FK, name, code, release_date, tcgplayer_group_id NULLABLE
)

cards (                    -- canonical card record (not variant-specific)
  id, set_id FK, name, card_number, rarity, description,
  canonical_image_url, tcgplayer_product_id NULLABLE, created_at
)

card_variants (             -- foil/holo/language/edition splits of a card
  id, card_id FK, finish ENUM('normal','holo','reverse_holo','foil','1st_edition','shadowless','stamped', ...),
  language, edition_note, tcgplayer_sku NULLABLE
)

-- Pricing
price_history (             -- every observation, tagged by source; snapshot daily
  id, card_variant_id FK,
  source ENUM('tcgcsv','pricecharting','ebay_sold','goldin','fanatics','alt','user_sale','internal'),
  kind ENUM('market','sold'), price DECIMAL, condition_grade, currency,
  sold_at NULLABLE, recorded_at, external_ref NULLABLE
)

-- Users & jobs
users (
  id, email, password_hash, plan_tier, training_opt_in BOOL DEFAULT false, created_at
)

upload_jobs (               -- one per batch; drives the progress UI and priority lane
  id, user_id FK, status ENUM('queued','processing','done','failed'),
  total, processed, priority, created_at, finished_at
)

uploads (
  id, job_id FK, user_id FK, image_url, back_image_url,
  status ENUM('pending','matched','needs_review','rejected'),
  matched_card_variant_id FK NULLABLE,
  ai_confidence DECIMAL, alternatives JSON, created_at
)

catalog_issue_reports (     -- the "report a missing/wrong card" loop
  id, user_id FK, upload_id FK NULLABLE, card_id FK NULLABLE, note, status, created_at
)

grading_estimates (         -- optional differentiator
  id, upload_id FK, predicted_grade DECIMAL,
  centering_score, corners_score, edges_score, surface_score
)

user_inventory (
  id, user_id FK, card_variant_id FK, upload_id FK NULLABLE,
  condition, quantity, acquired_price NULLABLE, sku, added_at
)

marketplace_connections (   -- OAuth links to seller accounts
  id, user_id FK, marketplace ENUM('ebay','shopify'), external_account, tokens_encrypted, connected_at
)

listings (
  id, user_inventory_id FK,
  marketplace ENUM('ebay','shopify','tcgplayer','whatnot','manapool','cardmarket','csv'),
  external_listing_id NULLABLE, price, status ENUM('draft','published','sold','ended'),
  published_at
)
```

**Design notes:**
- Keep `cards` (canonical identity) separate from `card_variants` (finish/edition/language) — pricing and inventory always hang off the *variant*, never the bare card, since a holo and non-holo of the same card can differ 10×. **CardUploader's single biggest structural weakness is the absence of exactly this table** — it collapses all printings into one record and pushes the distinction into a title tag.
- `uploads` is decoupled from `user_inventory` so a photo can sit in "needs review" without polluting the user's confirmed collection; `upload_jobs` exists because bulk processing must be asynchronous *and visible* (the incumbent's queueing complaint).
- `price_history` stores every observation with a `source` and `kind` — this lets the card page show sold comps by source and compute your own aggregate rather than trusting one feed. It also means **history accrues from day one**, which matters because PriceCharting's API returns current values only and TCGCSV is a daily snapshot.
- Carry `tcgplayer_product_id` / `tcgplayer_sku` where known: TCGplayer, Mana Pool and CardUploader-style CSV exports are keyed by TCGplayer SKU.
- `users.training_opt_in` defaults to false — the opposite of CardUploader's perpetual AI-training licence.

---

## 6. APIs & Integrations

### 6.1 Card identification (the AI core)
- Build: fine-tune a vision/retrieval model on catalog images, then improve with confirmed matches from the review queue. Buy: Ximilar offers a card-recognition API (self-reported ~99% on MTG/Pokémon/YGO) with grading and slab OCR; eBay's Browse API `searchByImage` (active listings) and PriceCharting's Photo Appraiser show image matching is now commodity.
- Confidence-score every match; anything below the threshold routes to the review queue rather than auto-confirming; ask "which printing?" when a card has multiple variants. Log every correction as training data.

### 6.2 Card master/catalog data
- **Pokémon TCG API** (pokemontcg.io v2) — free; no key: 1,000 req/day, 30/min; free key: 20,000/day. Cards, sets, images, TCGplayer and Cardmarket prices. Alternatives: TCGdex, PokéWallet.
- **Scryfall API** (MTG) — free, no key; hard limits (2 req/s on `/cards/search`, `/named`, `/collection`; 10 req/s elsewhere); daily bulk-data files for mass lookups; prices update once a day; **must not paywall Scryfall data**; image rules (no cropping/watermarking).
- **TCGplayer API — closed to new developers** ("We are no longer granting new API access at this time"). Do not plan on it. Use **TCGCSV** (tcgcsv.com): free daily mirror of TCGplayer categories → groups (sets) → products (+ extendedData) → market prices, ~90 categories incl. Pokémon, Pokémon Japan, MTG, YGO, One Piece, Lorcana, Riftbound. Caveat: product-level prices only (no per-condition/printing SKUs) — build `card_variants` yourself.
- These seed the canonical `cards` / `card_variants` tables; add a crowdsourced "report a missing card" loop like CardUploader's.

### 6.3 Pricing data
- **PriceCharting API** — paid only: **$49/mo "Legendary"** (API + daily CSV); 1 request/second; current values per grade (ungraded, 7–9.5, PSA/BGS/CGC/SGC/TAG/ACE 10) plus sales volume and ePID; **"Historic prices and historic sales are not supported"** → snapshot daily into `price_history`.
- **TCGCSV** market prices (product level) — free daily; same snapshot approach.
- **eBay sold comps — the hard one.** The Finding API (`findCompletedItems`) was decommissioned in Feb 2025; the replacement, the **Marketplace Insights API** (last 90 days of sold data), is a Limited Release for approved partners only — independent developers report being told access "can't be granted"; the API licence also forbids deriving average selling prices per category. Options: (a) apply for Marketplace Insights with a real business case; (b) license an aggregator (Card Ladder, ALT for graded); (c) third-party scraping APIs (SoldComps: free 100 req/mo, 4–6 s latency, ToS risk) for prototyping only; (d) collect your own observations — every sale your users make through direct publishing, plus user-contributed "mark as sold". Label the source on every number; keep eBay-derived aggregates private to the user until licensing is clear. **Do not promise "eBay sold comps" as a headline feature until one of these is secured.**
- Graded values: ALT.xyz (CardUploader's source), PriceCharting per-grade values, PSA/CGC population reports where accessible.

### 6.4 Marketplace publishing (listing export)
- **eBay Sell APIs** — free developer program (business email, ~1 business day approval; production keyset enabled after account-deletion-notification compliance). Inventory API (`createOrReplaceInventoryItem` → `createOffer` → `publishOffer`), Account API (business policies), Fulfillment API (orders). OAuth authorization-code user tokens (`sell.inventory`, `sell.fulfillment`); sellers must opt in to Business Policies and have an inventory location; higher call limits via the free "application growth check". Build this first — it removes CardUploader's #1 support issue (rejected CSVs). Keep the eBay CSV (File Exchange) format as a fallback.
- **Shopify Admin API** — build a Shopify app (OAuth install); GraphQL-first (REST is legacy for new apps); true two-way product/inventory/order sync. Phase 2.
- **TCGplayer** — no seller write API for new apps; export CSV keyed by TCGplayer SKU (standard + per-card custom-SKU formats, as CardUploader does); import order pull-sheet CSVs.
- **Whatnot, Mana Pool, Cardmarket, Tradera, MercadoLibre** — CSV/XLSX exports matching the incumbent's formats.

### 6.5 Grading context (optional differentiator)
- PSA cert API (public, free tier) for cert lookup; CGC/BGS/TAG/ACE lookups via their sites (BGS provides no images); PSA population data where accessible to show "X PSA 10s exist" alongside price.
- AI condition estimate: build or license; label it an estimate and publish your own error statistics (no competitor does).

### 6.6 Infrastructure
- **Stripe** — subscription + credit-pack billing (the flat $9.99-style plan plus a priority/shop tier)
- **OAuth** — eBay and Shopify seller-account linking; Google/Apple login
- Postgres (e.g., Supabase) + object storage/CDN for images; transactional email for job-completion notices; async job queue with visible progress

---

## 7. Suggested Build Phasing

1. **Phase 1 — Database & public search (MVP, the wedge)**: canonical cards + variants seeded from Pokémon TCG API, Scryfall and TCGCSV; server-rendered, indexable set and card pages with per-grade prices; daily price snapshots (TCGCSV + PriceCharting) so history accrues from launch; a sold-comp module with a decided data source. This alone matches PriceCharting's core value — which CardUploader does not offer at all — and can launch fast.
2. **Phase 2 — Single upload**: photo → confidence-scored AI match with alternatives and a "which printing?" prompt → price + comps; free tier with a monthly upload allowance (rather than CardUploader's 3-day trial).
3. **Phase 3 — Bulk upload + review queue + collection dashboard**: asynchronous jobs with visible progress, priority lane, per-image retry; confidence-routed review queue; duplicate merge; collection value over time. Accept scanner-folder and sorter-CSV input.
4. **Phase 4 — Marketplace listing**: eBay Sell APIs first (publish, revise, orders) with pre-flight validation; CSV/XLSX exports for Whatnot, TCGplayer, Mana Pool, Cardmarket, Tradera, MercadoLibre; then Shopify Admin API sync.
5. **Phase 5 — Grading estimate, portfolio analytics, public read API, team seats for shops.**

---

## 8. Change log — Aug 23, 2026 revision

Facts updated from `carduploader-competitive-research-report.md` (§ numbers refer to that report):

| Was | Now | Why |
|---|---|---|
| "eBay-only output — no native cross-listing" | Ten file-export formats + an eBay OAuth/API integration (listing, duplicate check, orders); no live sync to non-eBay channels | First-hand: homepage, ungraded guide, configuration/orders/duplicates guides (report §3.5) |
| "Accuracy drops at volume (~500 cards)" | ~500 cards → a processing **queue** (throughput), not accuracy; accuracy claim is >95% on standard EN/JP Pokémon | Hobby Over Hype short, May 2026 (report §5) |
| "30+ games" | 45–50+ claimed (Dec 2025: ~7); treat as marketing | Homepage vs FAQ vs Dec 2025 walkthrough (report §3.3) |
| "Free tier" | 3-day trial (100 credits), then $9.99/mo flat unlimited or pay-per-credit | Pricing page (report §3.6) |
| SortSwift "Pokémon-focused" | 26+ TCGs, full shop platform, nine channels, hardware | Verified panel (report §6) |
| SpeedyCardLister "sports focus, $1 trial" | Confirmed; also eBay-only by its own FAQ | Verified panel (report §6) |
| PriceCharting "search only, no upload" | Has a Photo Appraiser and a $49/mo API (current values only) | First-hand + API docs (report §8) |
| Roca "1,800 cards/hr" | Roca **Sifter** vendor spec; $799 + $25/mo; ships Sept/Fall 2026 | Nerdbeak / TCGVerifier (report §6) |
| Gap list | Added public catalog/SEO, variant-aware pricing, visible job progress, collector layer, trust defaults; demoted multi-marketplace export (incumbent already does CSV breadth; TCG Automate/SortSwift do sync) | Report §7 |
| §6 integrations | TCGplayer API closed → TCGCSV; PriceCharting price + no history; eBay sold-data reality and options; eBay Sell API details; Shopify GraphQL; Scryfall/Pokémon limits and terms | Report §8 |
| Schema | Added `upload_jobs`, `marketplace_connections`, `catalog_issue_reports`, TCGplayer IDs, `price_history.kind/source`, `users.training_opt_in`; more variant finishes | Report §3.2, §5 |
| Wireframes | Added variant switcher/prompt, per-grade prices and sold-comp tabs with source, progress/ETA and filter-to-errors in the review queue, guest save, Orders tab | Report §9 (PriceCharting page pattern, bulk-import and data-table patterns) |
