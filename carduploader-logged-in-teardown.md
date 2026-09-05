# CardUploader — logged-in app teardown (Sept 3, 2026)

**Source:** six "Webpage, Complete" saves of the logged-in dashboard made by Johnathen from his own Free account, plus the ~60 unique Next.js/Turbopack JavaScript chunks those saves pulled down (`C:\Users\johnn\Downloads\Carduploader_code`). Pages: `/dashboard`, `/dashboard/orders`, `/dashboard/history`, `/dashboard/inventory`, `/dashboard/graded`, `/dashboard/configuration`. Six further saves (folders 4, 5, 7, 8, 10, 11) only kept their bundle folders, not the HTML.

**Method:** visible text + form controls extracted from each HTML; RSC payload decoded; all strings, endpoint paths and constants grepped out of the app chunks. Everything below is read straight from CardUploader's own shipped code or rendered UI, so it is first-hand (🟢F). Nothing was clicked, submitted, or scraped beyond the saved files.

This note **supplements** `carduploader-competitive-research-report.md` (Aug 23) and `carduploader-data-sourcing-research.md` (Sept 1). Where it contradicts them, this note is newer.

---

## 1. Headline changes vs. the Aug 23 report

| Report said | Code/UI now shows | Impact |
|---|---|---|
| One plan: "Unlimited" $9.99/mo, 3-day trial with 100 credits | **Five plans** in the pricing component: Gym Leader $9.99 (700 credits/mo after a 100-credit trial), Elite Four $24.99 (2,000), Champion $49.99 (5,000), Team Rocket $99.99 (12,000), **and** Unlimited $9.99. A signed-up account without a subscription sits on a **"Free" tier with 5 credits**. | Pricing is back to metered tiers alongside Unlimited. Our $15 Pro positioning should be checked against $9.99 Unlimited specifically. |
| Mana Pool = CSV export only | **Live Mana Pool API integration**: connect with credentials, fetch orders, auto mark-shipped when picked, fulfillment retry, sync anomalies, "CardUploader now manages your Mana Pool prices." Listed/Not listed/Sold in Inventory pushes quantity changes to the Mana Pool store. Magic cards only ("only Magic cards can be listed there"). | Second live-sync channel after eBay. |
| Shopify = CSV only, no store connection | **Shopify store linking exists** (`Install on Shopify`, `/shopify/connection`, `NEXT_PUBLIC_SHOPIFY_INSTALL_URL`), with an automatic-sync engine: duplicate-protection marker, SKU-keyed products, location stocking, "Shopify now manages your prices", retry-on-conflict. Orders tab shows "Shopify (soon)" disabled, so order sync is not live yet. | Shopify live sync is landing. The report's "Shopify Admin API sync as our differentiator" is no longer a gap. |
| Whether per-card confidence is shown: unknown | Results rows render `Math.round(confidence)` as a percentage, and there is an "Alternative Match Comparison" view. | Confidence IS shown. |
| No public storefront / buylist | **Storefront** (`/dashboard/storefront`, public `/store/{slug}`, buyer offers with minimum-offer %, "my purchases", picklist grouping by buyer) and **Buylist** (`/dashboard/buylist`, public `/buylist/{slug}`, per-TCG rules: flat % of market or price bands, cash vs. store-credit payout %, hot-list cards at higher %, max offer per card, max qty per card, conditions NM/LP/MP/HP/DMG, blocklist, submissions). Both are gated by `canConfigureStorefront` / `canConfigureBuylist` capability checks (likely tier or experimental flags). | CardUploader is expanding from listing tool into a **seller-hosted store + buylist platform**. |
| Referral: 10% mentioned in a video | Full referral program with payout requests, payout history, PayPal and Wise payout emails, admin payout queue, and "special" referral codes. | Affiliate/referral is a real growth channel for them. |

## 2. Logged-in navigation (14 routes)

Dashboard · Orders · Previous Batches (`/history`) · **Inventory:** All Inventory, Automatic Inventory (`/inventory/automatic`, BETA badge) · **List Cards:** Ungraded, Graded, Listing Creator, Blank Listing Creator · **Tools:** Ungraded Pricing Tool (`/pricing`), Card Search, Sales Lookup · **Feedback:** Inbox · Configuration. Also present in code but not in the sidebar: `/dashboard/storefront`, `/dashboard/buylist`, `/dashboard/history/pricing/{job}`.

## 3. Page-by-page

**Dashboard home.** Plan card (Plan: Free · Active · Pricing link), Credits Left, Cards Uploaded Total, Community & Support (Discord, email), Getting Started Tutorial, 5-question FAQ (CSV upload failures, card not in database, identification accuracy, supported cards, how credits work).

**Orders.** Buttons: Fetch eBay Orders · Fetch Mana Pool · Upload TCGplayer CSV (hidden `.csv` input, the "pull sheet") · Picklist (PDF, generated client-side with jsPDF, groups orders from the same buyer). Channel tabs: All / eBay / TCGplayer / Mana Pool / Storefront / Shopify (soon, disabled). Status filter (Pending default), Newest sort, search. Endpoints: `/orders/list`, `/orders/complete`, `/orders/skip`, `/orders/skip-remainder`, `/orders/unskip`, `/orders/pins`, `/orders/picklist`, `/ebay/orders?includeShipped=true`, `/manapool/orders`.

**Previous Batches.** Empty-state list of jobs; jobs have `results`, `data`, `config-page`, `platform`, `share-link?mode=`, `combine`, `bulk-delete`.

**Inventory.** Header stats "N products · N cards · Price $ · Market $" (Market = cached TCGplayer USD price × quantity). Buttons: Reconcile with eBay · Export CSV. Tabs: Inventory / Pricing Tool / Deleted. Filters: status (Listed / Not listed / Sold), Hide/Show empty, Grouped vs All copies, sort by Date Added. Marking Listed/Not listed/Sold drives the sync engines (eBay Automatic Inventory, Mana Pool, Shopify). Endpoints: `/inventory/list`, `/inventory/cards`, `/inventory/update`, `/inventory/update-targets`, `/inventory/platforms`, `/inventory/platforms/state`, `/inventory/reconcile`, `/inventory/active-ebay-listings`, `/inventory/export`, `/inventory/delete`, `/inventory/restore`, `/inventory/permanent-delete`, `/inventory/unmark-sold`, `/listings/mark-listed`, `/listings/quantity(-bulk)`, `/listings/combine`, `/listings/uncombine`, `/listings/set-ebay-listing`.

**Graded Cards.** "2 credits per card · PSA/CGC/BGS/TAG/ACE · 2 credits per PSA/CGC/TAG/ACE card, 1 per BGS." Setup: Config Page selector, Platform (eBay Fixed Price / eBay Auctions / Shopify / Whatnot / Extras), Grading Company (PSA, CGC, BGS, TAG, ACE; a CBCS logo asset also exists), cert-number textarea (0/200 limit) + "Scan with camera" QR/barcode scanner (ZXing-style PDF417/QR decoder is bundled), Listing Defaults (start price, SKU prefix + increment), Store Category / Secondary Category, Schedule Upload Time. Cert lookups link out to psacard.com/cert, cgccards.com/certlookup, beckett.com card-lookup, my.taggrading.com, acegrading.com. Pricing endpoints: `/card-price/psa/{cert}`, `/card-price/cert?…`.

**Configuration.** Config-page selector ("Default", multiple pages) · View Setup Guide · Save Settings. Tabs: General / Ungraded / Graded / eBay / Shopify / Whatnot / TCGplayer / Mana Pool. General tab content:
- **Description Templates** — up to 3 tabs, Preview/Code, HTML insert, variable chips: Title, Card Name, Card Number, Set Code, Set Name, Rarity, Condition, Year, Language, Card Game, SKU, Finish, Artist, Specialty, Character, Stage, Type, Variant, Subtype; graded-only: Grade Company, Grade Number, Grade Text, Cert Last 3, Certification Number.
- **Listing Image Settings** — up to 6 store images, each positioned first / 2nd / last, enable toggle.
- **CardUploader-Managed Inventory** — per-platform toggles (eBay, Shopify, Whatnot, Extras; TCGplayer and Mana Pool "Always on" because those platforms key on TCGplayer SKU). Purpose: "detect duplicates and identify the correct item to pick for each order (intended for chaos sort with multi-quantity listings)."
- **Watermark**, **Excluded eBay Sellers** (hidden from the eBay Listed dropdown), **SKU auto-increment**, **eBay Links: Prefer Your Location**.
- eBay tab (from code): business policies (payment/shipping/return, all three required), shipping policy **by price band** with overlap validation, auction payment policy, store categories with parent/sub, site override ("list on eBay US"), min-offer % and auto-accept %, TCGplayer multiplier + "my store price" multiplier + reserve quantity.
- Shopify tab: vendor, two inventory locations, variant grams, tag attributes (kebab-case option), metafields (`product.metafields.shopify.grading`, `.rarity`, plus artist/cardGame/cardNumber/certNumber/character/condition/grade/gradingCompany/language/setCode/setNumber/stage/type/variant/year).
- Whatnot tab: shipping profile, type.

## 4. eBay depth (now clearer)

- **"List on eBay (via API)" uses the eBay Feed API** for bulk create: `/ebay/list-with-feed`, `/ebay/feed-task?id=`, `/ebay/feed-active`, toast "Feed complete — N listed, M failed", error copy about "eBay's feed parser". Plus `/ebay/connect`, `/ebay/disconnect`, `/ebay/status`, `/ebay/sync-policies`, `/ebay/sync-store-categories`, `/ebay/active-listings`, `/ebay/listed?keyword=` (active comps), `/ebay/variation-details`.
- **Automatic Inventory** = engine-owned listings: fixed-price and **multi-variation** ("cards enroll into one multi-variation eBay listing per batch, synced automatically"); cannot schedule; duplicates go through Revise-not-Add. Admin sees `ebay-automatic-health`, `ebay-feed-tasks`, `ebay-rate-limits`, `ebay-usage/window`, `ebay-uncataloged-failures`.
- Sync-engine abstraction: `ENGINE_SOURCES_BY_PLATFORM` covering ebay / manapool / shopify, with admin views `sync-engine-summary`, `sync-activity?engine=`, `sync-top-users`, `sync-waiting-reasons`.

## 5. Pricing & identification internals

- Pricing call: `POST /cards/pricing/unified {card_id, tcg, skus}` and `/unified/batch`; `/cards/pricing/tcgplayer-details?product_id=`, `/cards/pricing/tcgplayer-set-search`. Sources surfaced in UI: TCGplayer market (per condition, "% table fills any gaps"), previous export prices, eBay Listed (active) and eBay Sold (link-out, affiliate), ALT predicted/alt value (PSA, CGC), **CardLadder values for BGS and TAG**, "Price + Shipping (Lowest)".
- Identification: `/cards/match-all`, `/card-search-v2?q=`, `/cards/public-search` + `/facets`, `/cards/check-product-ids`, `/cards/add-to-listing`. Cards carry `productId` (TCGplayer), `cardmarketId`, `cardtraderId`, `scryfallId`. Confidence % and `alternativeMatches` per card. Auto-crop toggle; **binder-crop** multi-card detection (sample assets `/images/bindercrop/*`, `binderCropOriginalUrls` on results). Ungraded pricing tool caps at **100 images on Free, 500 on any paid tier**.
- Uploads go **direct to storage via signed URLs** (`/upload-card-image/signed-url`, `/upload-card-pair/batch-signed-urls`, `/upload-image/signed-url`), served from `images.carduploader.com`. Jobs are async with status polling (`useJobStatusPolling`).
- Sports cards are supported as a category (item specifics Player/Athlete, Team, League, Season, Parallel/Variety).

## 6. Stack / ops confirmations

- Backend proxied at `/backend/*` (Stripe checkout + portal, `sales/search`, `storefront/public/{slug}`, `buylist/public/{slug}`); Next route handlers `/api/geo`, `/api/consent`, `/api/banner`, `/api/progress-tips?surface=`.
- Firebase Auth incl. **MFA/2FA enrollment** (Identity Toolkit `mfaEnrollment:start/finalize`), AppCheck; Stripe live publishable key in bundle; Sentry; Vercel Analytics/Speed Insights; GA4 with consent-mode defaults denied.
- Admin console in the same bundle: users (ban, role, experimental flags, release-slot, remove-mfa, verify-email, impersonate), jobs force-fail, workers pause / restart-all / spare-instance, system-health, metrics (active/new users, uploads), audit logs, affiliate data, messages, payouts. "release-slot" + "spare-instance" imply a **per-user processing slot / worker pool**, which matches the queue complaints in the report.
- Feedback → `/feedback` with title/body limits; Inbox surfaces replies.

## 6b. Second batch (same day): ten more pages

Saved later on Sept 3: `/dashboard/ungraded`, `/dashboard/pricing`, `/dashboard/inventory/automatic`, `/dashboard/listing-creator`, `/dashboard/blank-listing-creator`, `/dashboard/card-search`, and Configuration tabs `?tab=ungraded`, `?tab=graded`, `?tab=ebay`, `?tab=tcgplayer`. Not saved (user chose not to): Configuration Shopify / Whatnot / Mana Pool tabs, Inbox, in-app Sales Lookup, account menu, Storefront, Buylist.

**Ungraded Cards (1 credit/card).** Setup form: Config Page · Database (default "English Pokemon") · Platform (default eBay Fixed Price) · **Auto Crop for Phone Images** toggle · **Advanced Matching Options** ("Prioritize or exclude specific sets and keywords during matching": prioritize sets, exclude sets, prioritize keywords, exclude keywords; savable as a **Matching Template** reusable across config pages) · Listing Defaults (Condition default NM, Start Price, SKU Prefix + Increment) · Store Category / Secondary Category · Schedule Upload Time · "Next: Upload English Pokemon Cards". Upload step enforces "multiple of N images" where N = images per card (default 2).

**Ungraded Pricing Tool (Free, no credits).** "Prices based on TCGplayer market data." Accepts single cards, binder pages, or loose cards on a surface; each card is auto-detected, cropped, matched, priced. Example modes: Full page · Partial page · Scan · Loose cards · Single card. Database + Advanced Matching Options. Upload: click / drag-drop / **camera capture** (`capture="environment"`), "100 files Maximum" on Free. Alternative: "Start with an empty batch — add cards from the database using search". Results land at `/dashboard/history/pricing/{job}`.

**Automatic Inventory page.** Export CSV; status filter (Listed); Hide/Show empty; Grouped / All copies; Date Added sort. Empty state on this account: "No cards on Mana Pool yet. Use Add to Mana Pool on a job's Mana Pool export tab to publish cards." So the page is the engine-owned inventory view across eBay + Mana Pool (+ Shopify).

**Listing Creator (1 credit/card).** "Create listings using stock images from our database." Same setup form as Ungraded minus auto-crop/matching; "Start adding English Pokemon cards" opens the database picker.

**Blank Listing Creator (Beta, Free).** "Add items manually, no database lookup required." Setup: Config Page · Platform · **eBay category (default 183454 – TCG Cards)** · Listing Type (Singles ungraded / Graded) · Listing Defaults · **Default Item Specifics** applied to all items · categories / scheduling.

**Card Search (`/dashboard/card-search`).** Database selector (English Pokemon) · Grouped toggle · filters Name, Set Name, Rarity, Artist, Year · "All prices shown are TCGplayer NM Market Price" · eBay Partner affiliate disclosure. This is the only browsable view of their catalog and it is behind login.

**Configuration → Ungraded tab.** *Image Settings:* Listing Image Types = Original images only / Combined image only / Both — combined first / Both — original first; Include database image (Disabled / …). *Automatic Pricing:* first and second choice from **Previous price · TCGPlayer (with multiplier) · None**; "Do not price below start price". *Title Generation:* toggles Capitalize Titles · Abbreviate Condition · Abbreviate Rarity · Use NM/M in Titles · Artist Last Name Only · **Title Optimization** ("titles over 80 characters are automatically shortened by removing optional fields (year, rarity, etc.)"); variables Title, Card Number, Set Code, Set Name, Finish, Rarity, Condition, Year, Language, Card Game, Artist, SKU, Variant, Subtype, Player/Athlete, Team, Parallel/Variety, each with an **AA force-uppercase** toggle; Custom Text chips; drag-to-reorder Structure (default: Title · Card Number · Finish · Rarity · Set Name · Card Game · Language · Variant · Subtype · Condition); live preview "Charizard 4/102 Rare Base Set Pokemon Japanese Holo subtype Near Mint"; Advanced edit. *Subtypes:* custom extra subtypes (e.g. Stamped, Promo) that appear in results and bulk edit. *Matching Templates* list (saves immediately).

**Configuration → Graded tab.** Title Generation only: Capitalize · Title Optimization · **Hide Grade Text ≤ N** (drop "Gem Mint" below a grade); variables add Cert Last 3, Grade Company, Grade Number, Grade Text; default structure Title · Card Number · Rarity · Set Name · Card Game · Language · Grade Company · Grade Number · Grade Text; preview "Pikachu 01/25 Holo Celebrations Pokemon Japanese PSA 10 Gem Mint".

**Configuration → eBay tab (verified, not just from code).** *eBay Account:* "Connect eBay Account — Required for eBay upload". Red checklist: "eBay CSV upload will not work until… Add and select all 3 policies: Payment, Shipping, Return · Add your postal code". *Business Policies:* Payment / Shipping / Return lists with Add Policy (manual) or Sync from eBay; *Set Default Policies* (three required selects). *Shipping Settings:* Location (United States), Postal Code (required), Dispatch Time (days). *Auction Settings:* time zone, auction payment policy, auction shipping policy. *Best Offer:* allow offers, Minimum Offer %, Auto Accept %. *Shipping by Price Range:* price bands → shipping profile, no overlaps. *Store Categories* (requires eBay store): add manually with eBay category ID + parent, or Sync from eBay. *Variation Listings:* sort variations by Card number. *Cross-Border and Override Settings* (locked): Automatic Inventory Ship-From Country; Listing via CSV or API → Site ID / Country / Currency / Extra Location. *Subtitle* (paid eBay fee, 55 chars).

**Configuration → TCGplayer tab.** Only "My Store Channel (Pro Seller)": Populate My Store Price and Populate My Store Reserve Quantity columns in the TCGplayer CSV (respected only with the My Store Channel on a Pro Seller account).

**Database list (from the eBay-category map keyed by database):** pokemon english, pokemon japanese, digimon, english yugioh, riftbound, lorcana, metazoo, one piece english, mtg, dragon ball super english, akora, flesh and blood, kryptik, gundam, universus, union arena, weiss schwarz, sorcery — **18 databases** (plus a "test chinese" Pokémon entry). Marketing says "45+" / "over 50 TCGs"; the code that maps databases to eBay categories knows 18.

## 7. What this means for our build (delta only)

1. **Price against $9.99 Unlimited, not the tier ladder.** Their tiered plans exist but Unlimited at the same $9.99 makes the ladder mostly a credit-pack story. A $15 Pro needs a visible reason (public catalog + sold archive + multi-channel sync).
2. **Shopify and Mana Pool live sync are no longer open gaps.** The remaining live-sync gaps are TCGplayer (no seller API for anyone) and Whatnot.
3. **Storefront + buylist is their next platform move.** If the client wants a "shop" surface, it now has a direct competitor feature to benchmark: buyer offers, min-offer %, buylist % of market with cash/credit split.
4. **Feed API is how they bulk-list.** For our eBay publish seam, Feed API (bulk) vs Inventory/Offer (per item) is a real design choice; they chose Feed for batches and an engine for ongoing sync.
5. **Still unverified:** actual match accuracy on a real batch, binder-crop quality, queue times, whether Storefront/Buylist are tier-gated or experimental-only (`experimental` admin flag exists), and Stripe price IDs per tier.
