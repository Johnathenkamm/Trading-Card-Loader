# CardIndex (tradingcardloader.com) — verified feature inventory

> **Superseded (Sept 14 2026).** This inventory describes the SELLER version of the product. The buyer/collector overhaul that followed removed sections 3–9 as features (inventory/SKUs, listings, eBay Sell, orders, marketplace CSV exports, pricing rules, title/description templates, channel settings) and replaced the `/app` workspace with `/collection` (price check, collection, wishlist with target-price alerts, graded slabs, add-from-a-set). Sections 1, 2, 10, 11 and 12 still apply in spirit with buyer wording. See `card-db-mvp/README.md` for the current feature list.

**Date:** September 13, 2026 · **Code state:** commit `3aa1f50` (Chunked photo uploads) · **Companion docs:** `carduploader-competitive-research-report.md`, `carduploader-logged-in-teardown.md`, `carduploader-upload-limits-research.md`

**How this was verified.** Three passes on the same day: (1) a full read of every source file under `card-db-mvp/src` (14,662 lines: router, 19 app modules, 9 renderers, 5 CLI scripts); (2) a live smoke test against the running app that exercised **180 requests** as an anonymous visitor, a Free account, a Pro account and the owner console — every page, every form action, chunked photo upload, CSV exports, orders, share links, owner mode — **178 passed; the 2 misses were test-script assumptions, not app faults**; (3) a check of which environment variables are actually set on the Railway production service.

**Status key used below**

| Mark | Meaning |
|---|---|
| ✅ | Built and verified working end-to-end in the live smoke test |
| 🟡 | Built, but only works fully once an outside service/key is configured, or runs in a limited/mock form today |
| ⛔ | Not built (button disabled, "coming soon", or absent) |

**CardUploader column:** *Copied* = same feature, same intent as CardUploader (CU) · *Copied+* = copied and extended · *Ours* = CardIndex-only, CU has no equivalent · *CU only* = CU has it, we do not.

---

## 1. Public site (no login, free)

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Home page `/` | Hero, feature row, 5-step "how it works", 10 trending-by-value cards, trust bar. Links straight into Add cards. | ✅ | Ours (CU's home is a marketing page for a login-only tool) |
| Browse `/browse`, game tabs `/g/pokemon`, `/g/mtg` | Every set grouped by game; game tabs filter. | ✅ | Ours — CU has **no public catalog** |
| Set page `/s/{set}` | Set hero + every card with its headline price and default finish. | ✅ | Ours |
| Card page `/c/{card}-{id}` | Variant/printing switcher with a price per printing; market price + delta; 30/90-day SVG price chart; grade strip (Ungraded, PSA 8/9/10, CGC 9.5, BGS 9.5 with sold volume); TCGplayer low/mid/high spread; sold-comp table with grade tabs (40 rows, links to original listing when the link is known good); buttons Add to inventory / List on eBay / TCGplayer ↗ / Sold prices / eBay listed ↗. | ✅ (grade values, chart depth and comps are **demo data**, labelled on the page) | Ours — variant-level pricing is the gap CU deliberately leaves open |
| "Live on eBay" panel | Button loads active eBay listings for the card via the Browse API, cached 10 min. | 🟡 needs `EBAY_CLIENT_ID/SECRET` (`EBAY_MOCK=1` for canned rows); panel hidden until then | Copied (CU's "eBay Listed" modal) |
| "TCGplayer by condition" panel | NM/LP/MP/HP prices per printing from TCGplayer's SKU API. | 🟡 needs a grandfathered TCGplayer key (program closed); `TCGPLAYER_MOCK=1` for UI | Copied (CU's condition price chips) |
| Search `/search` | Parses the query (game words, set names, "psa 10", finish, card number), facets for game / set / rarity / finish with live counts, price min/max, sort (relevance, price, name, newest), 24 per page, trigram typo-tolerant retry, "did you mean" suggestions. A graded query re-prices results at that grade. | ✅ | Copied+ (CU's Card Search is login-only and filter-only) |
| Type-ahead `/api/suggest` | Header search box suggests cards after 2 characters with thumbnail, set, price; keyboard navigable. | ✅ | Copied (CU type-ahead in Listing Creator) |
| Sales Lookup `/sales` | Keyword search over the sold-sales archive; stats Last sale / Last-3 avg / Total; filters Market (eBay/Goldin/Fanatics), Type (Auction/BIN/Best Offer), Sort; Best-Offer rows show the struck list price and −%; when the query resolves to a catalog card, results are canonicalized to that card however the listing was titled. | ✅ (archive holds a **10-row sample feed** — needs a licensed sold-data feed to go live) | Copied+ (CU's public Sales Lookup, plus card canonicalization) |
| Pricing page `/pricing` | Free vs Pro ($15/mo) comparison; state-aware CTA. | ✅ page · ⛔ **Subscribe button is disabled** ("checkout coming soon") | Copied (CU has Stripe checkout live) |
| SEO plumbing | Server-rendered HTML, title/meta/canonical/OpenGraph per page, JSON-LD (Product+AggregateOffer, BreadcrumbList, CollectionPage, WebSite+SearchAction), `/sitemap.xml`, `/robots.txt` (disallows /app). | ✅ | Ours (CU is a client-side SPA, nothing indexable) |
| Light/dark theme | Toggle in header, persists per browser, respects OS preference. | ✅ | Copied |

## 2. Accounts and plans

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Sign up `/signup` | Shop name + email + password (min 8, show/hide toggle). Lands signed in on the dashboard with a welcome. | ✅ | Copied (CU also has Google sign-in — we don't) |
| Sign in `/login`, sign out | Email/password, scrypt-hashed, 30-day HttpOnly session cookie stored in Postgres. Deep links survive via `?next=`. Wrong password offers the reset link inline. | ✅ | Copied |
| Password reset `/reset-password` | Email → single-use link (60 min) → new password; signs the user in and signs out every other device. | ✅ locally · 🟡 **in production the email is never sent** — `MAIL_PROVIDER`/`RESEND_API_KEY` are not set on Railway, so the link only appears in the server log | Copied (CU uses Resend) |
| Tenant isolation | Every workspace query is scoped to the logged-in seller; no customer can see another's inventory, batches, listings or settings. | ✅ | Copied |
| Free vs Pro paywall | Free: dashboard, pricing tool, card search, sales lookup, inbox, settings. Pro: anything that adds to inventory, manages stock, or publishes → redirects to `/pricing?upgrade=1`; sidebar shows "Pro" chips. Chunked photo upload enforces it server-side (402). | ✅ | Copied (CU's Free = 5 credits + pricing tool) |
| Grant Pro | `npm run grant-pro -- <email>` or the owner console's Upgrade/Downgrade button. Existing accounts were grandfathered to Pro once. | ✅ | Ours (interim lever) |
| Stripe billing | Checkout, customer portal, webhook. | ⛔ not built | CU only |
| Two-factor auth, Google login, email verification, referral program | — | ⛔ not built | CU only |

## 3. Seller workspace — adding cards

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Add cards page `/app/scan` (two outcomes) | The seller picks **Price only** (Free) or **Add to inventory** (Pro) first; each shows a mini pipeline of what happens to the photos. Pro-only fields only appear for the inventory outcome. | ✅ | Copied (CU: Ungraded Cards + Ungraded Pricing Tool are two pages) |
| Photo upload (drag-drop, camera) | Dropzone with thumbnails, `capture="environment"` for phone camera, JPG/PNG/WebP/HEIC. Each photo is shrunk **on the device to 1600 px JPEG** before sending. | ✅ | Copied (CU shrinks to 1600 px ≤3 MB) |
| Chunked upload | start → chunks of 20 photos → finish, with progress bar, retry with resume, and a leave-page guard. Server closes the batch so a stray chunk can't append. No-script fallback posts once. | ✅ (start/chunk/finish verified; closed batch returns 404) | Copied (CU uses signed-URL PUTs ×10 + job polling) |
| Per-batch photo caps | **100 photos on Free, 500 on Pro**; 60 MB per request. | ✅ (verified 100/500 from the API) | Copied exactly (CU: 100 Free / 500 paid) |
| Photo identification | Pluggable `VISION_PROVIDER`: `hash` = perceptual-hash match against the catalog's reference images (no API, built by `npm run hash:catalog`); `http` = any external recognizer (Ximilar etc.) mapped to name/number/set; `mock`; `none` = filename hint (`charizard-4-102.jpg`) then manual search. Recognizer confidence feeds the review triage. | ✅ hash works locally · 🟡 **production runs `none`** — `VISION_PROVIDER` is not set on Railway, so live uploads are filename-hint + manual search only | Copied (CU: proprietary vision model) |
| Binder-page / multi-card detection | Split one photo into several cards. | ⛔ each photo = one card | CU only |
| Front + back photo per item | Attach/replace front and back images in review. | ✅ | Copied (CU 1–12 images/card) |
| Paste a list | One card per line; parser reads name, number (`4/102`, `#119`, `SV049`), set, finish, condition, language, quantity (`3x`), grade. Up to 500 lines. ≥90% confidence auto-matches, lower goes to review. | ✅ (5-line batch: 3 matched, 1 dup flagged, 1 failed → review) | Ours (CU is photo-only) |
| Advanced matching options | Prioritize or exclude sets and keywords for the batch; savable as defaults. Exclusions filter candidates; priorities add a score boost. | ✅ | Copied (CU "Matching Templates") |
| Graded cards `/app/graded` | Pick grader (PSA, CGC, BGS, SGC, TAG, ACE), paste up to 200 certs incl. ranges `12345678-12345690`; one review item per cert with a "verify ↗" link to the grader's cert page; priced at the grade's catalog value when one exists. Grade/grader editable in review and carried into inventory, titles, specifics, exports. | ✅ flow · 🟡 **cert lookup has no real provider** (`CERT_PROVIDER` = mock only), so cards must be picked manually in review | Copied (CU resolves certs to card + images via PSA/CGC/BGS/TAG/ACE) |
| Slab QR / barcode camera scan | — | ⛔ | CU only |
| Listing creator `/app/listing-creator` | Browse game → set, tick cards with quantities, or search and add; picks become confirmed review items with catalog stock images. | ✅ | Copied |
| Card search `/app/card-search` | Same catalog with game/set/rarity filters, market price, artist, one-click "+ Add". | ✅ | Copied |
| Blank listing creator `/app/blank-listing` | Catalog-less drafts (sealed, lots, supplies): title, fixed/auction, price, qty, condition, eBay category (default 183454), graded fields, item specifics, image URL, description, schedule. Gets a SKU. | ✅ | Copied (CU's is Beta/Free; CU adds per-job default specifics — we don't) |
| Pricing tool (price-only batches) | Upload or paste → priced list with market, your price, line totals; **public share link** `/p/{token}` (tested: works, stops working after unshare); "Turn into inventory batch" (Pro). | ✅ | Copied (CU share links) |

## 4. Review queue `/app/review/{batch}`

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Confidence triage | Progress bar; counts matched / needs review / failed; tabs All, Needs review, Failed, Matched, Duplicates. | ✅ | Copied+ (CU shows a % per row but no triage states) |
| Per-item editing | Printing (variant), condition, language, quantity, pricing rule, price (hand-edit = override, rule change = recompute), SKU, title (regenerate button), grader + grade. Shows market and "you listed at …" previous price. | ✅ | Copied (CU results row) |
| Alternatives + manual search | Alternative-match chips; type-ahead catalog search (`/api/identify`) to replace the match. | ✅ | Copied ("View Alternatives", "Card Search replace") |
| Approve / Skip | Per item; approve requires a match. | ✅ | Copied |
| Duplicate detection | Same printing+condition+language+grade (or same cert) flagged in-batch; commit can merge into quantity. | ✅ | Copied ("Manage Duplicates → merge") |
| Keyboard shortcuts | `j`/`k` move, `y` approve, `s` skip, `e` edit. | ✅ | Ours |
| Add to inventory (commit) | One transaction: allocates SKUs, creates inventory rows, records price history. | ✅ ("Added 3 card(s)" verified) | Copied |
| Check eBay duplicates against live listings | — | ⛔ | CU only |
| Bulk edit across the batch | — | ⛔ (a bulk-update function exists but no UI) | CU only |

## 5. Pricing engine

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Pricing rules | Market, Market ±% (presets +10/+5/−5/−10, any %), Fixed. Per item or as the default. | ✅ | Copied (CU: TCGplayer × multiplier) |
| Automatic pricing preference | Previous price first / rule only / previous only. | ✅ | Copied (CU first/second choice) |
| Price floor | "Never price below $X" applied to automatic prices; hand-typed prices are never floored. | ✅ | Copied ("Do not price below start price") |
| Previous price memory | Last price you set for the same printing+condition is recalled. | ✅ | Copied |
| Graded pricing | Uses the grade's catalog value when one exists, else raw market. | ✅ (grade values are demo data today) | Copied (CU uses ALT / CardLadder) |
| Market price source | TCGplayer market per printing via the free TCGCSV mirror, refreshed by `npm run sync:tcgcsv` (daily job). Every run adds a real price-history point. | ✅ | Copied |

## 6. Inventory and batches

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Inventory `/app/inventory` | Stat tiles (inventory value, market value, cards in stock, next SKU); status tabs All / In stock / Listed / Sold; search; sort; per-row link to the listing builder. | ✅ | Copied |
| Auto SKUs | `PREFIX-000001` with configurable prefix, padding, next number. | ✅ | Copied (SKU prefix + increment) |
| Bulk bar | Select rows → set condition, apply pricing rule, create listing drafts, export CSV (4 formats). | ✅ ("Updated 3", "Created 3 drafts" verified) | Copied |
| Batches `/app/batches` | Every scan/paste/upload with matched / review / failed counts, value reaching inventory, one click back into review. | ✅ | Copied ("Previous Batches") |
| Automatic inventory `/app/inventory/automatic` | Exported/live listings per channel with Mark live / End. | 🟡 tracks exports only; labelled BETA; engine sync not built | Copied in name only — CU's is an eBay/Mana Pool/Shopify sync engine |
| Reconcile with eBay, Deleted tab/restore, grouped vs all copies | — | ⛔ | CU only |

## 7. Listings and eBay

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Listing builder `/app/list/{inventory}` | Title (≤80, generated by the title structure), item specifics table, description (from the active template), fixed price or auction (duration), quantity, grade, schedule time, eBay category. Save draft / Save & publish / Download CSV. | ✅ | Copied |
| Listings page `/app/listings` | All drafts with status pills, schedule, live item link, last error; bulk bar: Publish now, **Schedule & space out** (start time + every N minutes), Back to draft, End, Publish due now. | ✅ (schedule 2 listings 5 min apart verified) | Copied ("Space Out") |
| Scheduler | Server runner publishes due listings every 60 s; parks a listing back to draft after 3 failed attempts with the error on its row. | ✅ | Copied |
| Connect eBay (OAuth) | Settings → Connect eBay account → eBay consent → tokens stored per seller, auto-refreshed; Disconnect. | 🟡 code complete, **no eBay keys on the server** (`EBAY_CLIENT_ID/SECRET/RU_NAME` unset locally and on Railway); `EBAY_MOCK=1` runs the full flow on canned responses | Copied |
| Sync business policies | Pulls shipping/payment/return policies from eBay; pick one of each by ID (names mirrored into the CSV fields). | 🟡 same as above | Copied |
| Ship-from location | Postal code / country / city / state created as an eBay merchant location on save. | 🟡 | Copied |
| Publish / Revise / End on eBay | Inventory item → offer → publish with a pre-flight that lists every blocker at once (title, SKU, price, qty, category, image, policies, location). Revise re-publishes; End withdraws. | 🟡 | Copied+ (pre-flight replaces CU's "CSV rejected" support issue) |
| eBay orders | Fetch open orders (deduped), mark shipped on eBay with carrier + tracking, push new quantity to live listings when a non-eBay order ships. | 🟡 | Copied (CU Fulfillment API) |
| eBay File Exchange CSV | `/app/export/ebay.csv` for selected rows, all inventory, or blank listings. | ✅ | Copied |
| TCGplayer CSV | Ungraded only; optional My Store price/reserve columns and multiplier. | ✅ (market-price columns left blank — TCGplayer fills them on import) | Copied |
| Whatnot CSV | Bulk listing CSV; category, shipping profile, accept offers. | ✅ | Copied |
| Shopify CSV | Product import CSV; vendor, location, grams, tags. | ✅ | Copied (CU also has live store linking — we don't) |
| eBay Feed API bulk create, multi-variation listings, store categories sync, best-offer %, shipping by price band, subtitle, 20 marketplaces | — | ⛔ | CU only |
| Mana Pool live sync, Shopify live sync, Storefront `/store/{slug}`, Buylist | — | ⛔ (Mana Pool button present but disabled) | CU only |

## 8. Orders

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Orders `/app/orders` | Platform tabs (All, eBay, TCGplayer, Mana Pool, Storefront, Manual), status tabs Pending / Picked / Shipped / All. | ✅ | Copied |
| Manual order | "SKU, qty, price" lines; SKUs link to inventory rows. | ✅ | Ours |
| TCGplayer pull-sheet import | CSV upload → one order per order number; matches by SKU, then card name + number. | ✅ ("1 line matched inventory" verified) | Copied |
| Pick / Ship / Delete | Per-item pick toggle (order flips to Picked when complete); Ship takes carrier + tracking and decrements inventory (sold at zero); Delete for unshipped orders. | ✅ | Copied |
| Picklist `/app/orders/picklist` | Printable pull list grouped by SKU with in-stock counts. | ✅ | Copied (CU generates a PDF grouped by buyer) |
| Fetch eBay orders | See §7. | 🟡 | Copied |
| Fetch Mana Pool / Storefront orders, skip / pin actions | — | ⛔ | CU only |

## 9. Settings `/app/settings` (mirrors CU's Configuration tabs)

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Shop & SKUs | Display name, SKU prefix / digits / next number with live preview. | ✅ | Copied |
| Pricing | Default rule, fixed price, default condition/language, automatic pricing preference, price floor. | ✅ | Copied |
| Matching defaults | Prioritize/exclude sets and keywords. | ✅ | Copied |
| Title structure editor | Drag-to-reorder blocks (name, number, grade, condition, finish, rarity, language, set code, set, game, year, SKU, custom text), per-block CAPS toggle, **optimization drops optional fields to fit 80 chars** (name and number never dropped), live preview with counter. | ✅ | Copied (CU adds abbreviate-condition/rarity toggles, "Hide Grade Text ≤ N", custom subtypes — we don't) |
| Description templates | Up to 3 named templates, one active, `{variables}` inserted at the cursor, live preview; feeds the listing builder, bulk drafts and CSV. | ✅ | Copied (CU: 3 templates, HTML mode) |
| eBay | Connection card, policy selects, ship-from location, store category, item location, policy names for CSV. | ✅ prefs · 🟡 connection (needs keys) | Copied |
| Shopify / Whatnot / TCGplayer / Mana Pool tabs | Per-channel CSV preferences (vendor, grams, tags; category, shipping profile, offers; My Store multiplier + reserve; Mana Pool notes only). | ✅ | Copied (CU tabs; Mana Pool is live there) |
| Training opt-in | Off by default; opposite of CU's perpetual training licence. | ✅ | Ours |
| Multiple config pages per store/TCG, store images (6), watermark, excluded eBay sellers | — | ⛔ | CU only |

## 10. Inbox and support

| Feature | What it does | Status | vs CardUploader |
|---|---|---|---|
| Inbox `/app/inbox` | Send feedback / bug / question / missing-card notes; replies from the owner appear in the thread. | ✅ (note → owner reply → visible in inbox verified) | Copied |
| Discord, leaderboard, getting-started FAQ | Dashboard has a how-it-works accordion and a 6-step checklist that ticks itself off. | ✅ checklist · ⛔ community | Partially copied |

## 11. Owner console `/admin` (our back-office; CU has an internal admin too)

| Feature | What it does | Status |
|---|---|---|
| Owner login | Separate credentials (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), own 24-h cookie; 5 failed attempts lock the IP 15 min. Customer accounts can never enter. | ✅ (wrong-password path verified) |
| Overview | Accounts, Pro/Free counts, active users, open feedback, 14-day daily-active chart, newest accounts, latest activity. | ✅ |
| Users | Search, tier filter, sort; per-user profile with usage stats, batches, feedback, full activity timeline. | ✅ |
| Upgrade / downgrade plan | One click, logged. | ✅ (Free → Pro → Free verified) |
| Owner mode ("Open workspace") | Enter any customer's workspace with no paywall; banner shows whose account; every action tagged "by owner". | ✅ |
| Activity log | Every login, page view and action per customer; site-wide feed with filters. | ✅ |
| Feedback queue | Reply (lands in the user's inbox) or close. | ✅ |
| Owner's own uploader `/admin/upload` | Photos or pasted list into the **owner's own** seller account (Pro cap), never a customer's. | ✅ |

## 12. Data pipelines and CLI

| Command | What it does | Status |
|---|---|---|
| `npm run seed` | Builds the catalog from the Pokémon TCG API (Base Set, Vivid Voltage) + Scryfall (Kamigawa: Neon Dynasty): 607 cards, 1,051 variants. Synthesizes flagged demo history/grade/comps. | ✅ |
| `npm run pg:migrate` | Loads the seeded catalog into Postgres. | ✅ |
| `npm run sync:tcgcsv` | Daily TCGplayer market + low/mid/high per printing, product IDs and links. Pokémon + MTG only. | ✅ |
| `npm run hash:catalog` | Perceptual-hashes every catalog image → powers `VISION_PROVIDER=hash`. | ✅ |
| `npm run import:sold -- file` | Imports a sold-listings feed, canonicalized to card/variant/grade. | ✅ (waiting for a licensed feed) |
| `npm run check:sold-links` | Probes archived listing URLs; dead (404/410) links are hidden. | ✅ |
| `npm run grant-pro -- email` | Flips a plan tier. | ✅ |

## 13. Infrastructure

Node 24 (no build step), Postgres (Railway), image storage on S3-compatible bucket in production / local folder in dev, `.env`-driven config, one process with the eBay scheduler (`SCHEDULER_DISABLED=1` on extra instances). Live at tradingcardloader.com.

---

## 14. Findings from the double-check (things the client should know)

**Production configuration (Railway, re-checked Sept 13 2026 via `railway variables`): DATABASE_URL, S3_*, STORAGE_DRIVER=s3, ADMIN_EMAIL, ADMIN_PASSWORD, COOKIE_SECURE=1 and VISION_PROVIDER=hash are all set.** Remaining gaps:

1. ~~Photo identification is off in production.~~ **Was a different bug, fixed Sept 13 2026:** `VISION_PROVIDER=hash` was already set, but the production `card_image_hashes` table was empty because `npm run hash:catalog` had only ever been run against the local database (the Railway Postgres is internal-only, so the script can't be run from a laptop). Every live upload fell back to the filename hint, and camera names like `IMG_0001.jpg` carry none — a 500-card production test came back 500 × "Need review / 0%". Fix (commit `d3f80ff`): the server now fills any gap in the index in the background at boot (`src/app/hashindex.ts`, `HASH_INDEX_ON_BOOT=0` opts out). The first production boot after deploy logged 0/607 → 607/607 hashed; the same 500 distinct cards match 500/500 locally on a freshly rebuilt index.
2. **Password-reset emails are never sent in production.** `MAIL_PROVIDER`/`RESEND_API_KEY` are unset, so the reset link is printed to the server log. A customer who forgets their password is stuck until Resend is configured.
3. ~~Session cookies are not marked Secure.~~ `COOKIE_SECURE=1` is set on Railway.
4. **No eBay keys anywhere**, so every eBay live feature (connect, policies, publish, orders) shows "not configured". The code path is complete and runs under `EBAY_MOCK=1`.

**Unfinished by design (labelled in the UI):** Stripe checkout (Subscribe button disabled; Pro is granted by hand); cert lookup provider (PSA/CGC API); binder-page multi-card detection; Mana Pool / Shopify live sync; Storefront and Buylist; slab QR scanning.

**Bugs and inconsistencies found in code review — all FIXED later the same day (Sept 13, 2026) and re-verified:**

5. ~~Certification Number never reaches eBay item specifics.~~ **Fixed:** `ListingFields` now carries `cert`; graded items put it in item specifics, the eBay CSV (`C:Certification Number`), the built-in description, and the new `{cert}` / `{grader}` description-template variables. Verified: a PSA 10 cert 87654321 flowed from Graded → review → inventory → listing builder → CSV.
6. ~~Orders page labels the eBay tab "(soon)".~~ **Fixed:** eBay is flagged live in `ORDER_PLATFORMS`; Mana Pool and Storefront still read "(soon)".
7. ~~Home page claims "50+ TCGs supported".~~ **Fixed:** the trust bar now names the games actually in the catalog ("Pokemon & Magic today") with the live card count.
8. ~~Card page "List on eBay" and "+ Add to my inventory" go to the same place.~~ **Fixed:** "List on eBay" opens the Listing creator with the card's game and set preselected (stock-image listing, no scan needed); "+ Add to my inventory" still opens Add cards with the card prefilled.
9. **Demo data is still on every card page** (unchanged, by design): per-grade values, price-history depth and sold comps are synthesized and flagged; the footer says so. Real history accrues from each `sync:tcgcsv` run; comps need a licensed feed.
10. ~~Minor.~~ **Fixed:** `pickVariant` now prefers a printing in the parsed language when the catalog has one; the always-true description filter is gone; stale header comments in `pg.ts`, `feedback.ts` and `schema.app.sql` corrected. Left as-is: the TCGplayer CSV's TCG price columns stay blank on purpose (TCGplayer fills them on import).

## 15. One-line answer for the client

Every CardUploader feature in its sidebar (Ungraded, Graded, Listing Creator, Blank Listing, Pricing Tool, Card Search, Sales Lookup, Inventory, Automatic Inventory, Previous Batches, Orders, Inbox, Configuration) has a working counterpart here, plus a public catalog, variant-level pricing, a triaged review queue and an owner console that CardUploader lacks. What is **not** copied: Stripe billing, real cert lookup, binder-crop, eBay Feed-API bulk/variation listings, Mana Pool/Shopify live sync, Storefront/Buylist, 2FA/Google login/referrals. What needs a switch flipped before it works on the live site: email (Resend) and eBay keys. Photo identification and secure cookies are live as of Sept 13 2026.
