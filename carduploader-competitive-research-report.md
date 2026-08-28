# CardUploader.com Competitive Teardown & Build Recommendations

**Prepared for:** client trading-card site project (upload → identify → price, plus a searchable price database)
**Date:** August 23, 2026 · **Companion doc:** `card-site-research-and-build-plan.md` (this report corrects and extends it)
**Shareable version:** https://claude.ai/code/artifact/47c13db8-8f95-4564-8518-399c1bc9acf7

---

## 0. How this was researched, and how to read the markers

Three layers of evidence were combined:

1. **First-hand inspection (🟢 F)** — CardUploader.com was driven live in a browser on Aug 22–23, 2026: homepage, `/sales` (ran a real "Charizard PSA 10" search), `/pricing`, `/signup`, `/terms`, and **nine** guide pages — including five that are *not* in their sitemap (`configuration`, `listing-creator`, `inventory`, `orders`, `cardup-managed-inventory`, `duplicates`), found by reading the route list out of their JavaScript bundle. PriceCharting, Scryfall, TCGCSV and two YouTube critiques were also inspected live.
2. **Adversarial panel (🟢 P)** — the deep-research workflow fetched 22 sources → 101 claims, and ran 3-vote "try to refute" panels. Claims marked P survived (2–0 or better); claims the panel killed are listed as 🔴.
3. **Primary-source spot checks (🔵 S)** — API docs and pricing pages read directly (eBay, PriceCharting, Scryfall, TCGCSV, Pokémon TCG API via docs/search).
4. **Single secondary source (🟡)** — reported but not independently confirmed.

Everything below is current as of Aug 22–23, 2026 unless dated otherwise. CardUploader changes fast (its pricing model changed between Dec 2025 and Aug 2026), so re-verify before quoting to the client.

---

## 1. Executive summary

1. **CardUploader is a seller tool, not a price database.** Its catalog is an *internal matching database* used to identify photos and to build listings. It is searchable and browsable — but only **inside the logged-in app** (type-ahead "Card Search" + "Browse Sets" in the Listing Creator, 1 credit/card). There is **no public, SEO-indexable card catalog or card detail page**. 🟢F
2. **Its only public search is a sold-comp keyword lookup** (`/sales`, "eBay Sales History Lookup"): raw eBay/Goldin/Fanatics sold listings matched by *title keywords*, 200 results, last-sale / last-3-average stats, "hidden Best Offer" accepted prices, affiliate links. It is a search engine over listings, **not** an AI/semantic search and **not** canonicalized to a specific card. 🟢F
3. **Its AI is image matching, not OCR/LLM**: photo → vision match against the catalog → "View Alternatives" / manual search to correct. Claimed ">95% accuracy for standard English & Japanese Pokémon"; the FAQ and Terms still describe it as a *Pokémon* platform even though marketing says "45+ TCG databases" / "over 50 TCGs" (Dec 2025: ~7). 🟢F 🟢P
4. **The build plan's "eBay-only output" premise is wrong — and so is "CSV-only."** Exports go to eBay (fixed/auction/variation), Shopify, Whatnot, TCGplayer, Mana Pool, Cardmarket (via TCGPowerTools, beta), Tradera, MercadoLibre and generic CSV — all as files. **But eBay is now a real integration**: OAuth "Connect eBay Account", policy/store-category sync, a "List on eBay (via API)" button, "Automatic Inventory" (CardUploader creates listings), "Check eBay Duplicates" against live listings + revise, and a **beta Inventory/Orders layer** pulling orders via the eBay **Fulfillment API**. Non-eBay channels remain file exports with no sync. 🟢F 🟢P
5. **The "~500 cards then accuracy drops" complaint is a misreading.** The May 2026 video behind it says that after ~500 of 5,000 cards the creator was put **~26th in a processing queue** (server capacity on a $10 unlimited plan) — throughput, not accuracy. The reviewer still likes the product. 🟢F 🟢P
6. **Pricing: one flat plan — $9.99/month "Unlimited"** (fair-use policy), 3-day trial with 100 credits; outside a subscription, credits (1 ungraded, 2 graded, 1 BGS) that never expire. Stripe billing, Google or email login, non-refundable. Uploaded images are licensed to train their models. 🟢F 🟢P
7. **Its database deliberately excludes holo / reverse-holo / 1st-edition / stamped variants** ("to reduce mismatches"); users tag them as free-text "variants" that only go into the title. That means pricing and inventory can't be variant-precise — the single biggest data-model gap to exploit (the plan's `card_variants` table is exactly right). 🟢F
8. **Competitive reality:** TCG Automate (eBay API + eBay/Shopify cross-list & inventory sync on $40+ plans, hardware CSV connections) and SortSwift (26+ TCGs, 9 channels, POS/buylist, $8,999–$24,999 sorters) already own "multi-channel sync" and "hardware." SpeedyCardLister is sports-first and eBay-only. PriceCharting and Card Ladder own "searchable price history." **Nobody combines a public price-history database with upload→identify→list and variant-level pricing.** 🟢P 🟢F
9. **Integration constraints are real and shape the product:** eBay sold-comp data is *not* programmatically available to new developers (Finding API decommissioned Feb 2025; Marketplace Insights API restricted to approved partners; the API license even forbids deriving category average prices). TCGplayer's API is **closed to new developers** (use TCGCSV's free daily mirror). PriceCharting's API is $49/mo and returns **current values only — no history**. Pokémon TCG API and Scryfall are free. 🔵S 🟢P
10. **Recommended wedge:** a **public, SEO-first card database with variant-level price history + sold comps**, fed by a bulk upload → human review queue that *also* fixes CardUploader's three real pain points (variant precision, queue/throughput transparency, eBay-CSV rejection friction), with eBay API listing from day one and file exports for the long tail.

---

## 2. Corrections to the existing build plan

| Build plan said | What the evidence shows | Implication |
|---|---|---|
| CardUploader is "eBay-only output — no native cross-listing to TCGplayer, Shopify, Whatnot" | File exports to 9+ channels; eBay has OAuth + API listing + order sync (beta). Shopify/Whatnot/TCGplayer are CSV/XLSX only. 🟢F | Reframe the gap as **"no live multi-channel inventory sync outside eBay"** — and note TCG Automate/SortSwift already sell that. |
| "Accuracy drops at volume (~500 cards/session)" | The 500-card story is a **processing queue** under load, not accuracy. Accuracy claim is scoped to standard EN/JP Pokémon. 🟢F 🟢P | Sell **throughput transparency** (progress, ETA, no hidden queue) and **non-Pokémon accuracy**, not "we're more accurate at 500 cards." |
| "30+ games" | Marketing now says "45+ TCG databases" / "40+ more" / FAQ "over 50"; meta tag still "30+"; Dec 2025 video listed ~7. 🟢F | Treat breadth as unverified marketing; accuracy outside Pokémon is unproven. |
| "Pricing is a suggestion, not sold-comp evidence" | In-app: TCGplayer market × multiplier, previous price, "eBay Listed" modal, and an "eBay Sold" button that merely **opens eBay**. Graded: ALT.xyz predicted value. But their separate public **Sales Lookup** *is* sold-comp evidence (raw, keyword-matched). 🟢F | The differentiator is **canonicalized, per-card, per-variant, per-grade sold comps wired into the listing flow**, not "sold comps exist." |
| "No hardware tier" | True — phone/scanner images only, no feeder/sorter integration (TCG Automate ingests Roca/CardBot/PhyzBatch/Magic Sorter CSVs; SortSwift sells sorters). 🟢F 🟢P | Accept scanner (ADF) input formats + sorter CSVs; don't build hardware. |
| SortSwift = "Pokémon-focused rival" | Multi-game (26+ TCGs) full card-shop platform. 🟢P | Update competitor table. |
| SpeedyCardLister = "sports-card focus, $1 trial" | Confirmed: sports-first (TCG secondary), $1 first month, eBay-only by its own FAQ. 🟢P | Keep. |
| PriceCharting = "search only, no upload" | It now has a **Photo Appraiser** (photo → match) and a paid API. 🔵S 🟢P | Hybrid is no longer unique by itself; win on *variant/grade precision + sold comps + listing*. |
| Roca "1,800 cards/hr" | Vendor spec for the **Roca Sifter** ($799 + $25/mo, ships Sept/Fall 2026, needs TCGplayer seller account); SortSwift Super Sorter claims 3,600/hr. 🟢P | Fine to cite as vendor-advertised. |
| "Free tier" | No free-forever plan: 3-day trial (100 credits), then $9.99/mo or pay-per-credit. Free items: Sales Lookup, binder pricing tool. 🟢F 🟢P | A genuine free tier (e.g., public database + N free identifications) beats them on entry. |

---

## 3. CardUploader teardown

### 3.1 Site map & information architecture 🟢F

**Public (no login):** `/` · `/pricing` · `/sales` (Sales Lookup) · `/guides` (+ `getting-started`, `ungraded`, `graded`, `faq`, `troubleshooting`, and unlisted `configuration`, `listing-creator`, `inventory`, `orders`, `cardup-managed-inventory`, `duplicates`) · `/contact` · `/signin` · `/signup` · `/terms` · `/privacy`. `/about` redirects to sign-in. Footer: Discord, Instagram. Top nav: Home · Dashboard (→ sign-in) · Guides · Pricing · Sales Lookup · Contact · theme toggle · Sign In · Register.

**App (from the JS route list):** `/dashboard/ungraded`, `/graded`, `/listing-creator`, `/blank-listing-creator`, `/card-search`, `/configuration`, `/history`, `/inbox`, `/inventory`, `/listings`, `/orders`, `/pricing`, `/pricing-graded`, `/sales`, `/settings` (+ `admin`, `moderator`).

Tech: Next.js SPA (WebFetch/crawlers see only a shell — **they forgo SEO on their own catalog**), Stripe (live key in bundle), Google OAuth + email/password signup (display name, email, password, optional referral code). No public API; Terms prohibit "abusing our APIs or backend systems."

### 3.2 How they use their database 🟢F

- **Purpose:** an internal **matching catalog** (per game "database": English Pokémon, Japanese Pokémon, Lorcana, One Piece, Riftbound, Yu-Gi-Oh, "+40 more"), with card images, set, number, rarity, language, artist, year, and a **TCGplayer SKU** (used to key TCGplayer/Mana Pool exports).
- **Deliberately collapsed variants:** *"We do not store stamped, first edition, holo, or reverse holo versions of cards in the database to reduce mismatches and improve identification accuracy."* Variants are user-defined labels (Stamped, First Edition, Holo, Reverse Holo, custom) that get injected into the title via `{variant}`; they do not change the catalog match or the auto-price. (Dec 2025 walkthrough: "we only have the one Base Set Blastoise… we don't have the first edition and the shadowless.")
- **Curation loop:** missing card → "Report Issue" in the replace modal → credit refunded → "generally added within 24 hours" (FAQ: 48 hours). Database photos are "updated every day."
- **Where the DB is exposed:** (a) the results page's **"Card Search"** (find/replace any card); (b) **Listing Creator** — "Add Cards from Database": type-ahead search ("results appear as you type"), **"Browse Sets"** tab per selected database, rarity filters, add whole sets (1 credit/card; credits only deducted if all cards can be added); (c) `/dashboard/card-search` (login). **Nowhere public.** The FAQ tells users to "search for it in Card Search" to check game support.
- **What they store about users' cards:** images (compressed, optional watermark, up to 12/card), title, price, condition, SKU, variants, item specifics, per-copy inventory rows with status *Not listed / Listed / Sold*, CS-catalog SKUs, eBay item IDs for revisions, job history (batches, listed/not listed, total value), saved "previous price" per card/condition.

### 3.3 Search: three different things 🟢F

| Surface | Type | Notes |
|---|---|---|
| Photo identification | **Computer-vision image match** against catalog | "Auto Crop for Phone Images" option; "View Alternatives" to fix misses; no confidence score shown to users in docs; duplicates detected by card ID + condition (+ variant + finish). |
| In-app Card Search / Listing Creator | **Keyword type-ahead** over the catalog + set browse + rarity filter | Conventional DB search. No natural-language or semantic layer. |
| Public **Sales Lookup** (`/sales`) | **Keyword search over raw sold listings** (eBay, Goldin, Fanatics) | Input "e.g. Charizard PSA 10" → 200 results; header stats **Last sale / Last-3 avg / Total sales**; filters Market (eBay·Goldin·Fanatics), Type (All·Auction·BIN), Currency, Sort (New·Bids); "Advanced Options": auto language filter, auto exact-grade filter ("Showing only PSA 10 — Disable Filter"), hide graded. Each row: title, price, *Listed $X (−Y%)* for **Best Offer Accepted** (the "hidden" price), EBAY badge, sale type, bids, date, "View listing" (eBay Partner Network link). Results for "Charizard PSA 10" mixed dozens of different cards and lots — **not normalized to a card**. |

**Verdict:** classic search engine + vision matching. No AI/LLM search. The obvious upgrade for the client: typo-tolerant structured search (name + set + number + language + variant + grade facets), query parsing ("charizard psa 10 base set" → filters), and sold comps attached to the *canonical card/variant*, not to a title string.

### 3.4 UI layout & user flow 🟢F

**Homepage (dark SaaS landing):** nav → hero ("List Your Trading Cards In Seconds, Not Hours" + sub-copy + *Start Uploading* / *Join Discord*) → "How It Works" 3 steps (Upload Photos · Check Matching · Autofilled Specifics) + "Ready to Export" → "Powerful Features" 6-card grid (AI Card Recognition w/ duplicate detection & merge; eBay Integration; Live Market Prices; **Free Pricing Tool** "price many cards from one binder photo… share links with buyers or vendors"; List Graded Cards; Saved Config Profiles) → Supported Card Types (6 games + "40+ more") → Graded (PSA/CGC/BGS/TAG/ACE) → Export Options grid (7 cards) → "Supported Marketplaces" (US, UK, All eBay Regions, eBay Global, Australia, Canada) → CTA → footer.

**App flow (Getting Started + guides):** create account (3-day trial) → **Configuration** (tabs General / eBay / Ungraded / Graded / Shopify; multiple "config pages" per TCG or store; description templates (HTML); up to 6 store images before/after card images; watermark; SKU auto-increment; eBay account connection; policies; shipping by price range; best-offer min/auto-accept %; store categories; cross-border; auto-crop; auto-pricing preference; title structure drag-and-drop with `{title} {set} {number} {condition} {rarity} {language} {variant}` and 80-char optimizer; Shopify vendor/locations/metafields) → **Dashboard → Ungraded** (drag-drop 1–12 images/card, JPG/PNG/WebP/JFIF, 10 MB, alphabetical ordering) or **Graded** (paste cert numbers, ranges like `12345678-12345690`, slab QR) → **Results page** (card rows: AI title, price, condition, images; click-to-edit; View Alternatives; Card Search replace; Manage Duplicates (merge → quantity); Check eBay Duplicates (live listings → revise); Multi-Edit; sort; **Bulk Edit** prices/conditions/SKU prefix/store categories/variants/item specifics; "eBay Listed" modal (click a price to fill); "eBay Sold" (opens eBay); warnings for empty price / >80-char titles / missing category) → **Export tabs** (eBay Fixed / Auctions / Variation, Shopify, Whatnot, TCGplayer, Mana Pool, Extras) with scheduled start + "Space Out" stagger → **History** (batches, listed/not listed, value) → **Inventory / Orders** (beta).

**Dec 2025 results-page layout (walkthrough):** left nav (Ungraded/Graded), dashboard with credits left + cards uploaded, results rows with *your photo left, matched database card right*.

### 3.5 Integrations (what actually exists) 🟢F

| Channel / service | Mechanism | Depth |
|---|---|---|
| **eBay** | OAuth "Connect eBay Account" (20 marketplaces: US, CA, UK, AU, DE, FR, IT, ES, NL, BE, AT, CH, IE, PL, SG, HK, MY, PH, IN, JP); "Sync from eBay" business policies & store categories; **"List on eBay (via API)"** button; **"Automatic Inventory"** (listings CardUploader creates automatically); Check eBay Duplicates against active listings + revise on export; **Orders: "Sync pulls unfulfilled orders via the Fulfillment API"**; plus the classic **eBay-ready CSV** (fixed/auction/variation) for File Exchange bulk upload. | Deepest. CSV path still primary in docs; API/Automatic Inventory newer. Troubleshooting guide = "eBay CSV won't upload" (policy names must match exactly; postal code). |
| **Shopify** | CSV: full product import (variants, vendor, 2 inventory locations, metafields) or inventory-update CSV. No store connection/OAuth. | File only; Managed Inventory "not recommended for Shopify yet." |
| **Whatnot** | CSV export | File only |
| **TCGplayer** | CSV (standard) and per-card CSV with custom SKUs, keyed by TCGplayer SKU; orders via uploaded **Pull Sheet CSV** | File only (TCGplayer has no seller write API) |
| **Mana Pool** | CSV keyed by TCGplayer SKU | File only |
| Cardmarket (via TCGPowerTools, beta), Tradera (XLSX), MercadoLibre (CSV), Basic CSV | Files | Long tail |
| **Pricing data** | TCGplayer market price (× user multiplier); user's previous prices; "eBay Listed" active comps modal; "eBay Sold" link-out; **ALT.xyz** predicted value (PSA w/ confidence, CGC alt value, none for BGS); homepage also names CardLadder for graded | Reference prices, converted to user currency |
| **Grading companies** | PSA, CGC, BGS (no images), TAG, ACE cert lookups | Cert → details, grade, images |
| **Sold data (public)** | Sales Lookup: eBay + Goldin + Fanatics sold listings, eBay Partner Network affiliate links | Source/provider undisclosed |
| **Billing / auth / community** | Stripe; Google OAuth + email; Discord; referral codes (10% of referred memberships in Dec 2025 video) | — |
| **Public API** | None | — |

### 3.6 Pricing & business model 🟢F 🟢P

- **Aug 2026:** one plan, **"Unlimited" $9.99/month** (ungraded + graded processing, variation listings, listing creator from database), 3-day free trial with 100 credits, "subject to our fair use policy" (no account sharing, no reselling processing, no bots; throttle/suspend at their discretion). Off-subscription credits: ungraded & listing-creator 1, graded 2 (BGS 1), pricing-only lookups free, never expire. All fees non-refundable (EU/UK statutory rights noted).
- **Dec 2025 (walkthrough):** credit packs and memberships (e.g., "Elite 4" = 2,000 credits/month), referral bonuses. → The model simplified to flat unlimited in 2026; third-party reviews still say "pricing in flux."
- **Terms:** uploaded images licensed worldwide/perpetual for service, **AI training**, and marketing; affiliate disclosure; Terms last updated Apr 13, 2026.
- No priority-processing or higher tier exists (the queue complaint's author suggested one).

### 3.7 Stack, operations and trust signals 🟢F *(from inspection of bundles, network calls and legal pages)*

| Layer | What they use | Evidence |
|---|---|---|
| Front end | Next.js App Router + Turbopack, Tailwind/shadcn-style tokens, Nuqs (URL-synced state); Inter + Nacelle; dark-first, indigo accents, centered 3-column card grids, pill sticky nav | bundle chunks, body classes |
| Hosting / analytics | Vercel (+ Analytics, Speed Insights), GA4, Sentry | script tags |
| Auth | Firebase Authentication (email/password + Google), reCAPTCHA Enterprise | privacy policy; bundle |
| **Primary database** | **Supabase (Postgres)** | privacy policy: "Supabase, Inc. — primary application database" |
| Images | Cloudinary-class host; auto-compression + optional watermark | bundle; ungraded guide |
| Payments / email | Stripe (checkout + customer portal at `/backend/stripe/*`); Resend (verification, resets, **job-completion emails**) | network; privacy policy |
| Backend | Separate service proxied at `/backend/*` (e.g. `/backend/sales/search?q=`, `/backend/exchange-rates`); Next route handlers `/api/geo`, `/api/consent`; robots.txt disallows `/backend/` and `/api/` | network log |
| AI | Proprietary card-ID model "trained on hundreds of thousands of Pokemon cards"; Terms also name OCR, autocrop, condition-assessment and pricing models | FAQ, Terms |

- **Jobs are asynchronous** (job-completion emails, `/dashboard/history`) — which is why a busy evening becomes a visible queue.
- **Sales Lookup rows** come back shaped like `{title, price, listPrice, saleType: fixedprice|bestoffer|auction, source, date, bids, image, url}` — raw listings; the same eBay item was observed twice under two IDs. No card-ID normalization.
- **Results editor row (product screenshot):** uploaded thumb | matched thumb · title field with live /80 counter · item specifics (character, set, rarity, illustrator, finish, specialty, year, type) · variant toggles (Unlimited / 1st Edition / Reverse Holo) · price + Best-Offer checkbox + **condition price chips (HP/LP/MP/NM) from TCGplayer** · quantity · condition · SKU · store categories · schedule time · actions **Compare · Alt Match · Replace · eBay Listed · eBay Sold · Delete**; top bar: export-mode tabs, Bulk Edit, Check Duplicates, sort, warnings count, Save Changes. Results link to `tcgplayer.com/product/{id}` via affiliate links.
- **Community & growth loops:** Discord (~2,470 members at time of check) is the primary support channel; email support 24–48 h; a public **leaderboard** (display name + cards processed); referral codes at signup; affiliate revenue from TCGplayer links and the eBay Partner Network on Sales Lookup.
- **Trust posture:** Terms (Apr 13, 2026) and Privacy (May 26, 2026): 18+; **one account per person or business**; perpetual licence to train AI on uploaded images (opt-out only by contacting them); images retained for the life of the account; UK/EU GDPR + CCPA language. Web only — no mobile app, no public API.

**Still needs a trial account to confirm:** how far "List on eBay (via API)" and "Automatic Inventory" go (publish without CSV? revisions? variation listings?), whether any per-card confidence is shown, binder-photo multi-card detection quality, the leaderboard, and accuracy on a 100–500-card batch across non-Pokémon games.

---

## 4. What CardUploader does great (copy these)

1. **Radically simple offer** — one price, unlimited, 3-day trial, ~$10/mo; creators call it "an amazing deal." 🟢F 🟢P
2. **Speed of the core loop** — photos → matched rows → exported file; Dec 2025 demo puts a CSV batch live on eBay in ~10–20 s after upload. 🟡
3. **Listing-quality tooling sellers actually need:** title-structure builder with 80-char optimizer, condition abbreviations, description templates, store images, watermarking, SKU auto-increment, best-offer defaults, shipping policy by price band, store categories, scheduled + staggered start times, variation listings, multiple config profiles per TCG/store. 🟢F
4. **Graded-card path** — cert numbers/ranges/QR → PSA/CGC/BGS/TAG/ACE lookup with images + ALT predicted prices. 🟢F
5. **Duplicate handling** — in-batch merge to multi-quantity, **and** reconciliation against live eBay listings (revise instead of relist). 🟢F
6. **Breadth of export targets** (10 formats) and 20 eBay marketplaces with currency conversion. 🟢F
7. **A free, public sold-comp lookup with "hidden Best Offer prices"** — good top-of-funnel, affiliate-monetized. 🟢F
8. **Fast catalog curation loop** (report → refund → added within 24–48 h) and an active Discord. 🟢F
9. **Emerging inventory/orders layer** (catalog SKUs, chaos-sort pick lists, FIFO allocation, picklist PDF). 🟢F

## 5. Where it's weak (exploit these)

| Weakness | Evidence | Opportunity |
|---|---|---|
| **No variant precision** in catalog (holo/RH/1st ed/stamped collapsed) → wrong auto-prices for the most valuable printings; variant only in title | Ungraded guide, FAQ, Dec 2025 video 🟢F | Variant-level catalog + pricing + inventory; "which printing is this?" disambiguation in review. |
| **No public catalog / card pages / SEO** — SPA, catalog behind login & credits | 🟢F | Public, indexable card & set pages with price history = organic acquisition engine they can't match without re-architecting. |
| **Sold comps are raw keyword matches**, not tied to a card; in-app "eBay Sold" is just a link-out; pricing = TCGplayer market × multiplier | 🟢F | Canonical sold comps per card/variant/grade inside the pricing step; show the evidence (n, dates, sources) next to the suggested price. |
| **Throughput queueing under load**, no progress/ETA transparency, no priority tier | May 2026 creator video 🟢F 🟢P | Async batch jobs with visible progress, priority lanes, per-image retry. |
| **Accuracy scoped to Pokémon**; FAQ/Terms still say "Pokemon card sellers"; Dec 2025 had ~7 DBs | 🟢F | Lead with MTG/Yu-Gi-Oh/Lorcana/One Piece/sports where their DB is newest. |
| **eBay path still CSV-first**; #1 support issue is eBay rejecting the CSV (policy names, postal codes) | Troubleshooting guide 🟢F | API-first eBay publishing with pre-flight validation; never make users open Excel. |
| **No live sync to Shopify/Whatnot/TCGplayer**; Managed Inventory beta only for eBay/TCGplayer/Mana Pool | 🟢F | Shopify Admin API (real sync) as phase-2 differentiator — TCG Automate/SortSwift prove demand. |
| **No hardware/feeder input path** | 🟢F 🟢P | Accept ADF-scanner folders, Roca/CardBot/PhyzBatch CSVs (as TCG Automate does). |
| **No confidence scores / human review queue per se** — everything lands on one results page; corrections are manual | Guides 🟢F | Triage by confidence (auto-accept / review / failed) — the plan's review-queue page. |
| **Trust & terms:** non-refundable, images licensed for AI training, fair-use throttling at "sole discretion" | Terms 🟢F | Clear data policy ("we don't train on your photos without opt-in") as a selling point for shops. |
| **Pokémon-style naming (`{title}` etc.) and SKU model** built for eBay; TCGplayer exports only for ungraded | Guides 🟢F | Graded TCGplayer/Whatnot flows. |

---

## 6. Competitive landscape (verified)

| Player | What it is | Pricing | Channels / integration | Gap vs. the client's concept |
|---|---|---|---|---|
| **CardUploader** | Photo → AI match → price → export; Sales Lookup; beta inventory/orders | $9.99/mo unlimited; 3-day trial | eBay API+CSV; 9 file exports; Stripe; no public API | No public DB, no variants, keyword sold search 🟢F |
| **TCG Automate** 🟢P | Scan → match → price → publish; eBay API listing + CSV; cross-list eBay+Shopify(+Square) with quantity sync on Pro+; hardware CSV connections (CardBot, PhyzBatch, Roca, Magic Sorter); "30 TCGs" + sports | $10/$19/$40/$90/$175/$200 per mo, scan-metered, 7-day trial, no free plan | TCGplayer via CSV; Whatnot "listing support"; TCGplayer-market pricing | Seller-only; no public DB; market-price not sold-comp |
| **SortSwift** 🟢P | Full card-shop platform: scanning (26+ TCGs, unlimited free; 99.9% paid add-on), inventory, POS, buylist, repricer (7 sources, 535k prices/12 h, 92M SKUs), 9-channel sync (Shopify, eBay, TCGplayer*, CardTrader, ManaPool, Square, Misprint, WooCommerce†, Walmart†), Super Sorter hardware (3,600/hr; $8,999/$24,999 + $199/mo) | Free → $499/mo; eBay sync & inventory API only on Core Max $499; $0 commission | *TCGplayer semi-sync (Chrome ext + CSV); †beta | Store back-office; no public price history |
| **SpeedyCardLister** 🟢P | Sports-first AI lister (TCG secondary), scanner/flatbed/phone input, human review step | $1 first month, then $5–$125/mo (500–27,500 scans) | eBay only (own FAQ) | Sports, eBay-only |
| **Card Dealer Pro** 🟡 | AI matching → eBay/Shopify/CollX; manual pricing; Ricoh fi-8170 partner | $9/$19/$59/mo + credits | Direct publish | No pricing intelligence |
| **Heystack** 🟡 | Device-agnostic capture (Heystack One, Ricoh, flatbed, phone), "98% match," Release-Day Matching | credits | eBay, Shopify, CollX | Identification vendor |
| **RocketVault** 🟡 | Sports bulk lister (OCR + Gemini Vision), inline "attention chips" review, 500-card batches | Free/$14.99/$39.99/$99.99/$199.99 | eBay only | Good review-queue pattern |
| **TCGplayer Roca Sifter** 🟢P | Hardware sorter: 400-card hopper, 3×250 bins, "up to 1,800 cards/hr" (vendor spec), foil detection; feeds TCGplayer Scan & Identify/Quicklist | $799 + $25/mo ($300/yr); ships Sept/Fall 2026; requires TCGplayer seller account | TCGplayer ecosystem | Locked to TCGplayer |
| **TCGVerifier X1PRO** 🟡 | $199 feeder, 2-way sort (vendor's own blog) | $199 | phone/webcam app | — |
| **PriceCharting** 🔵S | Public price DB (cards, games, comics): card pages with Highcharts history (6m/1y/5y/All), per-grade price table + volume, per-grade sold-listing tabs (eBay + TCGplayer), **Photo Appraiser**, API | Free / $6 / **$49 Legendary** (API + CSV) | API 1 req/s; **no history via API**; affiliate | Consumer lookup; no listing/selling flow |
| **Card Ladder** 🟡/🟢P | Sports-first sold-comp DB (eBay, Goldin, Heritage, Fanatics; "100M+ sales"), indexes, pop reports; Sales History behind Pro (~$15/mo hist.) | Pro subscription | No public API | Sports-first |
| **CardWiki** 🟡 | Public browsable catalog + sales history + portfolio, crowdsourced, public beta (sports) | Free | — | Sports; no TCG |
| **AI graders** 🟢P/🟡 | Binder AI (subscription; web/iPhone), CardGrade (free first grade, $4.99/mo), SnapGradeAI ($2/grade; self-reported 87% ±0.5), PreGradeCards (batch 20 + eBay listing gen), CGA (one-time) — none independently benchmarked | low | — | Unbundled from listing tools |
| **Ximilar** 🟡 | Card-recognition API vendor ("99%" MTG/Pokémon/YGO), grading & slab OCR, pricing | quote | — | Build-vs-buy option for the AI core |

**Who owns what:** multi-channel sync → TCG Automate / SortSwift; hardware → Roca / SortSwift; price history → PriceCharting / Card Ladder; public catalog → PriceCharting / CardWiki (sports). **Open lane:** TCG-first public catalog with variant-level history + sold comps **and** an upload→review→list pipeline.

---

## 7. Where to compete — ranked

**Positioning in one line:** *"The card price database you can upload to."* Public, evidence-backed prices on every card page; upload a photo (single or binder page) to land on the right card instantly; keep a collection; when you're ready to sell, list anywhere in one click. (Do **not** copy: the variant-blind catalog, CSV-first publishing, the opt-out AI-training licence, the Pokémon-only voice, the seller-only scope.)

**Table stakes (copy CardUploader):** phone-photo upload, instant match with alternatives, auto-priced rows, bulk edit, duplicates→quantity, graded cert lookup, title builder + 80-char optimizer, eBay fixed/auction/variation, scheduled/staggered listings, config profiles, simple pricing, Discord.

**Differentiators, in order of leverage:**

1. **Public card database with SEO pages** (game → set → card → variant) showing price history, per-grade values, and sold comps. CardUploader has zero public catalog; PriceCharting is the benchmark for the page pattern. This is the acquisition engine *and* the client's stated concept.
2. **Variant-level data model** (`cards` → `card_variants` → prices/inventory), with a disambiguation step in review ("holo or reverse holo?") — fixes CardUploader's deliberate blind spot and makes prices credible on the cards that matter.
3. **Sold comps as evidence, not a link**: per card/variant/grade, with n, date range, source, median/last-3 — shown beside the suggested price and on the public page. (Sourcing constraints in §8 — plan for a partner feed or licensed data; keep eBay data off the public aggregate page unless licensed.)
4. **Bulk upload + human review queue** with confidence triage, per-row states, filter-to-errors, inline edit, batch tags — the hardest page, and where CardUploader's one-big-results-page and queueing feel weakest.
5. **eBay API-first publishing** (Inventory + Offer + Fulfillment) with pre-flight validation; CSV/XLSX for the long tail (Whatnot, TCGplayer, Mana Pool, Cardmarket, Tradera, MercadoLibre) from day one.
6. **Throughput transparency & priority lane** — progress, ETA, retries; a paid priority tier (the exact feature the queue complaint asked for).
7. **Collection/portfolio value over time** for collectors (PriceCharting/CardWiki pattern) — broadens the audience beyond sellers.
8. **Scanner/sorter ingestion** (folders from ADF scanners; Roca/CardBot/PhyzBatch CSVs) without building hardware.
9. **Optional AI condition estimate** (build or license; label it as an estimate, publish your own error stats — nobody does).
10. **Clean data policy** (no training on user photos without opt-in) and a transparent fair-use policy.

---

## 8. Integrations — verified access constraints

| Integration | What you get | Access / cost | Limits & caveats | Status |
|---|---|---|---|---|
| **Pokémon TCG API** (pokemontcg.io v2) | Cards, sets, images, TCGplayer & Cardmarket prices | Free; key via dev.pokemontcg.io | No key: 1,000 req/day, 30/min; key: 20,000/day (higher on request). Community-run; alternatives: TCGdex, PokéWallet, Scrydex. | 🔵S |
| **Scryfall API** (MTG) | Cards, sets, images, daily prices (TCGplayer/Cardmarket/Cardhoarder), bulk JSON | Free, no key; must send `User-Agent` + `Accept` | Hard limits: `/cards/search`, `/named`, `/random`, `/collection` 2 req/s; others 10 req/s; 429 → 30 s lockout. Prices update once/day; use **bulk data** for mass lookups. **Must not paywall Scryfall data**; no repackaging; image rules (no crop/watermark). | 🔵S |
| **TCGplayer API** | Catalog + market prices + store authorization | **Closed: "We are no longer granting new API access at this time."** Existing keys only (v1.39, client-credentials, 14-day tokens; store-auth flow for seller inventory) | Plan on **no** official access; affiliate program still open. | 🟢P |
| **TCGCSV** (tcgcsv.com) | Free mirror of TCGplayer categories → groups (sets) → products (+extendedData) → market prices; ~90 categories incl. Pokémon, Pokémon Japan, MTG, YGO, One Piece, Lorcana, Riftbound… | Free files | **No SKU-level (condition/printing) prices** — product-level only; refresh cadence daily (per site; verify) | 🔵S |
| **PriceCharting API / CSV** | Current values per grade (loose=ungraded, graded-price=9, manual-only=PSA 10, bgs-10, CGC 10, SGC 10, TAG 10, ACE 10…), sales-volume, ePID/UPC, full-text `q` search, Photo Appraiser on site | **$49/mo "Legendary"** (API + daily CSV); $6 Collector has no API | 1 req/s; CSV 1 per 10 min, regenerated daily; **"Historic prices and historic sales are not supported"** → you must snapshot daily to build history | 🔵S 🟢P |
| **eBay Sell APIs** (Inventory, Offer, Fulfillment, Account) | Create/revise listings (`createOrReplaceInventoryItem` → `createOffer` → `publishOffer`), orders, business policies | Free developer program (business email, ~1 day approval; production keyset enabled after account-deletion-notification compliance) | OAuth authorization-code user tokens (`sell.inventory`, `sell.fulfillment`…); seller must opt in to Business Policies and have an inventory location; call limits raised via free "application growth check"; Traditional/SOAP APIs being deprecated | 🔵S 🟢P |
| **eBay Browse API** (incl. `searchByImage`) | **Active** listings only (and image search against them) | Generally available; growth check for scale | No sold/final prices | 🟢P |
| **eBay sold comps** | Finding API `findCompletedItems` — **decommissioned Feb 2025** (restricted since 2020, deprecated Jan 2024). **Marketplace Insights API** — last 90 days of sold data, **Limited Release, approved partners only** ("not open to new users"; developers report silence/denial). | — | **API License Agreement** forbids deriving average selling price/GMV per category or collecting statistical data about eBay → a public eBay-based price index is a licensing question even with access. | 🔵S 🟢P |
| Third-party sold data | SoldComps (live scraping API; free 100 req/mo; 4–6 s latency; ToS risk), Card Ladder (no public API), 130point (UI), Terapeak (eBay Seller Hub UI), ALT.xyz (used by CardUploader for graded), Goldin/Fanatics/Heritage auction archives | varies | Choose: (a) apply for Marketplace Insights with a real business case, (b) license an aggregator, (c) user-contributed "mark as sold" + own marketplace data. Label sources. | 🟡 |
| **Shopify Admin API** | Products/variants/inventory/orders; true two-way sync | Free; build a Shopify app (OAuth install); GraphQL-first (REST is legacy for new apps) | Query-cost rate limits; merchants install your app | 🟡 (standard) |
| **Stripe Billing** | Subscriptions, trials, credit packs, usage-based | Standard card fees + Billing fee | — | 🟡 (standard) |
| **OAuth seller linking** | eBay (user-consent flow, no password collection), Shopify app install, Google/Apple login | Free | eBay tokens short-lived; store refresh tokens | 🔵S |
| **Grading lookups** | PSA cert API (public, free tier), CGC/BGS/TAG/ACE lookups via their sites | PSA: API key; others: scrape/partner | CardUploader gets images for PSA/CGC/TAG/ACE, not BGS | 🟡 |
| **Identification AI** | Build (fine-tune vision model on catalog images + confirmed matches) or buy (Ximilar; PriceCharting Photo Appraiser; eBay `searchByImage` as a hint) | — | Confidence thresholds → review queue; log corrections as training data | 🟡 |

**Data strategy that survives these constraints:**
- **Catalog:** seed Pokémon (pokemontcg.io + TCGCSV), MTG (Scryfall bulk), everything else (TCGCSV groups/products). Build your own `card_variants` (finish, language, edition) — TCGCSV's product-level data plus set knowledge; crowdsource corrections like CardUploader's report loop.
- **Current prices:** TCGCSV market prices (product-level) + PriceCharting snapshots (per grade) → store every observation with `source` (the plan's `price_history` table) so **history accrues from day one**, which PriceCharting's API won't give you.
- **Sold comps:** start with licensed/partner or user-contributed sales; pursue Marketplace Insights in parallel; keep eBay-derived aggregates private to the user until licensing is clear.
- **Listing:** eBay Inventory/Offer APIs first; files for the rest; Shopify Admin API in phase 2.

---

## 9. Recommended page & layout set (with the best-practice evidence)

Baymard's 2026 benchmark finds 52% of desktop and 62% of mobile e-commerce product pages "mediocre or worse" — a well-built card page is a real differentiator. Patterns below come from Baymard (product pages), Smart Interface Design Patterns (bulk import), Pencil & Paper (data tables), Eleken (pricing pages), and the PriceCharting / Card Ladder / CardUploader benchmarks.

1. **Homepage** — hero with a single search box *and* an "Upload a photo" button (CardUploader has only upload); "How it works" 3-step; trending/recently-priced cards; browse by game; trust (data sources, n sold comps, no-training-on-your-photos); one price plan teaser. Copy CardUploader's theme toggle + Discord link.
2. **Browse: Game → Set → Card (public, SEO)** — set pages with checklist tables (number, name, rarity, variants, ungraded/PSA 10 prices); sticky header, sortable, right-aligned tabular numbers.
3. **Search results** — typo-tolerant, facets (game, set, rarity, language, variant/finish, grade, price range), grid/list toggle, each hit shows canonical card + variant chips + market price + sold-comp count. Parse grade/language keywords like CardUploader's Sales Lookup does. Benchmark: PriceCharting's results table ("found 100 items · You own 0/100") with sort by alphabetical / popularity / price / biggest change, facets for category, set, include/exclude variants, region, and columns thumbnail · title · set · ungraded · key grades · + Collection / + Wishlist.
4. **Card detail (the PriceCharting pattern, improved)** — image(s) + variant switcher; price history chart with range toggles (6m/1y/5y/All) and per-grade series; per-grade price table with Δ and sales volume; **sold listings tabs per grade with source filter and dates**; "Add to collection / I own this"; guest save/wishlist (89% of sites fail this — Baymard); total-cost/fee estimate near the "List it" CTA (67% fail); related variants/reprints; report-data-issue link. Keep the page indexable (SSR).
5. **Sales / sold-comp lookup (public)** — like CardUploader's `/sales` but canonicalized: results grouped by card/variant/grade, with raw listings expandable; summary stats; affiliate links if desired.
6. **Single upload** — drag/drop or camera; front required/back optional; auto-crop; **show confidence + top-3 alternatives**; "not right? search"; variant disambiguation prompt; result = market price + sold comps + condition field → "Add to collection" / "Create listing."
7. **Bulk upload + review queue** — the 5-stage bulk pattern: *pre-import* (guidance, templates, scanner-folder/CSV options) → *upload* (per-file state queued/processing/done/failed, retryable; real progress/ETA, no hidden queue) → *mapping/match* (auto-accept ≥ threshold, review band, failed) → *repair* (filter to "needs review," inline edit, duplicate confirmation, bulk actions in a floating toolbar that appears on selection, hover checkboxes, sticky first column, row-density switch 40/48/56 px) → *commit* (summary, batch tags/source, undo window). Borrow RocketVault's inline "attention chips."
8. **Collection / inventory dashboard** — portfolio value over time; table with statuses (not listed / listed / sold), per-copy SKUs, condition, cost basis, market value, Δ; filters + saved views; bulk list/reprice/export; grouped multi-quantity rows (CardUploader's CS-SKU idea).
9. **Listings & orders** — marketplace connections (eBay OAuth, Shopify app), pre-flight validation, publish/revise, order sync with pick suggestions (CardUploader beta pattern), picklist PDF.
10. **Pricing / plans** — ≤3 tiers, highlight "most popular," 2–3 scannable features each, monthly/annual toggle, feature table below the fold, "contact us" for shops; consider *Free* (public DB + N identifications) / *Pro* (unlimited + API listing) / *Shop* (sync + priority lane).
11. **Account / configuration** — connected accounts, business policies sync, title templates with variables + 80-char optimizer, description templates, store images, watermark, SKU scheme, config profiles per game/store (CardUploader's best idea).
12. **Public API page (later)** — CardUploader has none; even a read-only price API with attribution rules (à la Scryfall) is a moat.

---

## 10. Build-phasing adjustments (vs. the plan)

- **Phase 1 — Database & public search (unchanged, now clearly the wedge):** catalog + variants, SSR card/set pages, price snapshots from day one (TCGCSV + PriceCharting), sold-comp module with a data-source plan.
- **Phase 2 — Single upload:** confidence-scored vision match + alternatives + variant disambiguation; free tier.
- **Phase 3 — Bulk + review queue + collection:** asynchronous jobs with visible progress and priority lane; scanner-folder and sorter-CSV ingestion.
- **Phase 4 — Listing export:** eBay **API** (Inventory/Offer/Fulfillment) first, with CSV/XLSX exports for Whatnot/TCGplayer/Mana Pool/Cardmarket/Tradera/MercadoLibre; pre-flight validation to kill the "CSV won't upload" class of errors.
- **Phase 5 — Shopify sync, grading estimate, portfolio analytics, public API.**

---

## 11. Sources (accessed Aug 22–23, 2026)

**CardUploader (primary, inspected live 🟢F):** https://carduploader.com/ · /pricing · /sales (live search) · /signup · /signin · /terms (fair use, refunds, IP/AI-training license) · /guides/getting-started · /guides/ungraded · /guides/graded · /guides/faq · /guides/troubleshooting · /guides/configuration · /guides/listing-creator · /guides/inventory · /guides/orders · /guides/cardup-managed-inventory · /guides/duplicates · sitemap.xml · JS route list.
**Independent on CardUploader:** YouTube Short "The Downside of CardUploader.com Nobody Talks About" (Hobby Over Hype, May 22, 2026 — queue after ~500 of 5,000 cards) https://www.youtube.com/shorts/a7blPEkZRzA · "I Was Wrong About CardUploader…" (Old Skool Pokemon, Jun 19, 2026) https://www.youtube.com/watch?v=lTKUoyqcFi4 · "Automated Trading Card Listing is Here! (Carduploader Setup & Walkthrough)" (Dec 3, 2025; CSV mechanism, credits/Elite 4, ~7 databases, results layout) https://www.youtube.com/watch?v=luSdX4LOcII · Nerdbeak "Best Scanners for Selling Pokemon and Trading Cards 2026" (Jun 10, 2026) https://www.nerdbeak.com/news/best-scanners-selling-pokemon-trading-cards-2026
**Rivals (primary):** https://www.tcgautomate.com/ (+ /ebay-card-listing-software; Shopify App Store listing apps.shopify.com/tcg-automate-2) · https://sortswift.com/ (+ /features/syncing, /docs/integrations) · https://speedycardlister.ai/ (+ /faq, /features) · Nerdbeak "TCGplayer Roca Sifter" (Mar 6, 2026) https://www.nerdbeak.com/news/tcgplayer-roca-sifter-card-sorting-robot-march-2026 · TCGVerifier sorter comparison (Jul 28, 2026) https://www.tcgverifier.com/blog/automatic-tcg-card-sorters-compared · RocketVault bulk-listing playbook (May–Jul 2026) https://rocketvault.io/blog/bulk-list-sports-cards-ebay · Card Ladder Sales History https://www.cardladder.com/pro-features/sales-history · CardWiki https://www.cardwiki.ai/ · cardgrade.io "Best AI Card Grading Apps 2026" https://cardgrade.io/best-ai-card-grading-apps · Ximilar tools roundup (May 2024) https://www.ximilar.com/blog/the-best-online-tools-apps-and-services-for-card-collectors/ · Ball Card Genius bulk-tools post (Apr 30, 2025; Card Dealer Pro $9/500 scans) https://ballcardgenius.substack.com/p/from-card-clutter-to-cash-bulk-card
**PriceCharting (primary, live 🔵S):** https://www.pricecharting.com/api-documentation · https://www.pricecharting.com/pricecharting-pro ($0/$6/$49) · https://www.pricecharting.com/game/pokemon-base-set/charizard-4 (card-page pattern)
**Integration docs (primary):** eBay "Get started with eBay APIs" https://developer.ebay.com/develop/guides/sell/get-started-with-ebay-apis · eBay community "Finding API and Shopping API to be decommissioned in 2025" https://community.ebay.com/t5/Traditional-APIs-Search/Alert-Finding-API-and-Shopping-API-to-be-decommissioned-in-2025/td-p/34222062 · eBay community "Access to sold/completed listing data — options for non-partner developers" (≈Dec 2025) https://community.ebay.com/t5/eBay-APIs-Talk-to-your-fellow/Access-to-sold-completed-listing-data-what-options-do-non/td-p/35398955 · SoldComps developer page https://sold-comps.com/use-cases/developer-integration · TCGplayer docs (getting-started notice "no longer granting new API access"; announcements) https://docs.tcgplayer.com/docs/getting-started · https://docs.tcgplayer.com/docs/announcements · TCGplayer-API-alternatives roundups (tcgapi.dev, cardgrader.ai, tcgapis.com, justtcg.com) · TCGCSV https://tcgcsv.com/ · Scryfall API https://scryfall.com/docs/api and /docs/api/rate-limits · Pokémon TCG API docs https://docs.pokemontcg.io/ (rate limits, authentication) and ScrapingBee "Best Pokemon Card APIs in 2026" https://www.scrapingbee.com/blog/pokemon-card-api/
**UX best practices:** Baymard "Product Page UX" (updated Mar 18, 2026) https://baymard.com/blog/current-state-ecommerce-product-page-ux · Smart Interface Design Patterns "Bulk Import UX" (Oct 6, 2025) https://smart-interface-design-patterns.com/articles/bulk-ux/ · Pencil & Paper "Enterprise Data Tables" (Feb 23, 2026) https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables · Eleken "SaaS Pricing Page Design" (Jan 30, 2026) https://www.eleken.co/blog-posts/saas-pricing-page-design-8-best-practices-with-examples · Qubstudio "Marketplace UI/UX" (2019) https://qubstudio.com/blog/marketplace-ui-ux-design-best-practices-and-features/

**Refuted during verification (do not repeat):** "CardUploader's only entry path is image recognition / no keyword search" (🔴 — Sales Lookup, Listing Creator search/browse, cert-number entry all exist); "SpeedyCardLister is not sports-focused" (🔴 — it is sports-first); "SortSwift natively syncs all nine channels" (🔴 partial — TCGplayer is semi-sync, WooCommerce/Walmart beta).
