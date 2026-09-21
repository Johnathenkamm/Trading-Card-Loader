# Client walkthrough video (Sept 14, 2026) — what they want, what it takes, easiest → hardest

**Source:** `2026-09-14 20-47-22.mp4` (16 min, screen recording of the client's own CardUploader account, side by side with tradingcardloader.com). Transcript: `client-walkthrough-2026-09-14-transcript.txt`. Written Sept 19, 2026.

---

## 0. The one thing to settle first

**The client is asking for the SELLER workflow.** The whole video is CardUploader's scan → match → price → export-to-eBay pipeline, and the client says (0:04) "I do want it to be kind of similar to this", (1:00) "the scanning is key right now", and closes (14:05–15:57) with "if you don't feel like we can completely do all this, I need to know … if we can't do this then we need to stop."

**This repo deleted exactly that pipeline five days ago.** The buyer/collector overhaul (commits `f906942` … `3072dbc`, Sept 13 22:16 → Sept 14 11:52) removed ~4,500 lines: `store.ts`, `ebay-sell.ts`, `exporters.ts`, `listing.ts`, `orders.ts`, `pricing.ts`, `sku.ts`, `title.ts`, `compose.ts`, `render/app.ts`, `render/workspace2.ts`. The video was recorded at 20:47 the same day, after that deploy, and the client's browser shows the buyer site ("KNOW WHAT IT'S WORTH BEFORE YOU BUY").

**Nothing is lost.** The last seller-era commit is `2e6de1b` (Sept 13, 18:19). Every feature the client walks through in the video was built there and verified in the Sept 13 smoke test (178/180 requests; see `cardindex-feature-inventory.md`). Restoring is a `git checkout 2e6de1b -- <files>` plus reconciling with what changed since (session-context, feedback, billing, schema, and the uncommitted binder-page work in `render/collection.ts`). Estimate: **half a day to a day**, not a rebuild.

**Do not run `npm run db:drop-seller -- --yes` anywhere.** The old seller tables (`inventory`, `listings`, `orders`, `ebay_connections`, …) are what the restore needs. Verify on Railway that the script was never run.

**Answer for the client:** yes, everything in the walkthrough is doable and most of it already exists. The two things that need the client's own action are an eBay developer keyset (for the "eBay Listed" popup, eBay account link and policies) and their eBay Partner Network campaign ID (for affiliate links). The one genuinely hard part is scan accuracy on real phone photos across full Pokémon + One Piece catalogs (see §4).

---

## 1. Everything the client asked for (with timestamps)

| # | Ask | Where in video | Priority the client gave it |
|---|---|---|---|
| 1 | Home page: fine, cosmetics later ("functionality first") | 0:08–0:23 | none now |
| 2 | Dashboard sidebar like CardUploader: Dashboard · Orders · Previous Batches · Inventory · Ungraded · Graded · Listing Creator · Blank Listing Creator · Ungraded Pricing Tool · Card Search · Sales Lookup · Feedback · Inbox · Configuration · Account | frames 0:30–1:30 | implied |
| 3 | **Orders: NOT yet** ("very confusing for us") | 0:50–0:59 | later |
| 4 | **Previous Batches**: go back to old/unfinished batches, re-open, re-upload | 1:04–1:27 | wanted |
| 5 | Inventory: "eventually", linked to eBay, shows products / cards / your total price / market value; auto market-price updates (another site does it) | 1:28–2:12 | later |
| 6 | **Ungraded scanning = the key feature**; Graded also wanted ("I'll talk about that too") | 2:12–2:20 | **#1** |
| 7 | **Configuration → eBay**: link eBay account, it pulls payment/shipping/return **business policies**, pick defaults so uploads "already know" | 2:23–3:03 | wanted |
| 8 | Ungraded setup page: Config page · **Database** (card game) · **Platform** (eBay Fixed Price = main, TCGplayer = key, eBay Auctions optional) | 3:05–3:53 | wanted |
| 9 | **Games: Pokémon #1, One Piece #2** ("I want to focus on Pokemon and One Piece") | 3:16–3:34 | **core** |
| 10 | Chaos sorting / SKU-picked-at-order (another site does it; client will research) | 3:55–4:16 | later |
| 11 | Auto crop for phone images: skip | 4:17–4:22 | no |
| 12 | Advanced matching: prioritize a set / exclude keywords for accuracy | 4:26–4:57 | wanted |
| 13 | Listing defaults: **condition** (NM default), **start price** ($.99), **SKU prefix + increment** (PKJ-243 → 244 → 245…) or a plain box label without numbers | 5:05–5:44 | wanted |
| 14 | eBay **store category** (from the seller's own eBay store), secondary category (rarely), schedule upload time (never used) | 5:45–5:57 | store category wanted |
| 15 | **Upload: 1 image / 2 images / custom** — front+back pairs in upload order ("we need to be able to do that as well"); up to 500 cards / 1000 files | 5:59–6:42 | wanted |
| 16 | Process batch → results list per card: uploaded photo vs matched DB image, auto title (eBay style), name/type/set/year/rarity/illustrator, **variant picker** (Normal/Holo/Reverse), price, qty, SKU, condition, TCGplayer NM/LP/MP/HP, **previous price**, category 1/2, schedule; buttons Replace · eBay Listed · eBay Sold · TCGplayer · Options | 6:56–7:15, 8:36–10:24 | wanted |
| 17 | **Tools → Manage duplicates**: find same card in batch, combine into one listing with qty 2 ("I love that") | 7:15–7:42 | wanted |
| 18 | Check eBay duplicates (against live eBay listings): later, "confusing" | 7:42–7:59 | later |
| 19 | **Bulk edit**: set price for all · **disable Best Offer** (client always turns it off) · **edit SKU prefix / renumber** after de-duping | 8:01–8:34 | wanted |
| 20 | **Card Comparison & Search**: side-by-side your photo vs database card, confidence %, alternatives with %, search box to pick another card, Replace, continue to next | 9:00–9:28 | wanted |
| 21 | "It learns over time": confirmed matches improve future matching | 9:28–9:39 | wanted |
| 22 | Pricing from TCGplayer market; **eBay minimum $0.99 auto-applied**; **remembers what you priced the same card at before** | 9:41–10:24 | wanted |
| 23 | **"eBay Listed" popup**: live eBay listings for the card (50), each an affiliate link — "the ones I really want is this" | 10:28–10:41 | **high** |
| 24 | **Affiliate links**: client is an eBay Partner Network affiliate; every eBay link the site emits should carry their campaign so they earn commission ("that would be amazing") | 10:42–11:33 | **high, easy** |
| 25 | eBay Sold button: opens eBay sold search; often empty, users do their own research. Ambiguous "let's get rid of that" at 12:11 — most likely "close that tab", not "remove the button" (he calls it "super helpful" at 12:00). Confirm with client. | 11:34–12:11 | keep, confirm |
| 26 | TCGplayer button: opens the TCGplayer product page (their link is affiliate-tagged via Impact) | 12:11–12:32 | wanted |
| 27 | **List / Export**: "List on eBay via API" (eventually) · Add to inventory (beta, later) · **Export CSV → eBay Seller Hub → Reports → Uploads** = the main path today; site should link the user straight to the eBay upload page and explain the steps · Mark as listed | 12:39–14:03 | **core** |
| 28 | Business: membership at **$7–10/mo** (currently $15 Pro), Discord, other revenue; asks what scaling costs | 14:41–15:34 | decision |
| 29 | Feasibility: "let me know is this something we can do" | 14:05–14:16, 15:38 | answer needed |

---

## 1b. Second pass (Sept 20, 2026) — details the 10-second sampling missed

Re-read the transcript and pulled frames every 4 s through the setup (2:10–7:00) and results (7:00–14:10) sections. Nothing the client *said* was missed; what the finer frames add is how CardUploader's screens are laid out and which menu items exist. Built since: ✅ · partly: ◐ · not yet: ✖.

| Screen | Detail seen on screen | Ours |
|---|---|---|
| Configuration hub | Tiles in three groups + "Config page: Default" selector + "View Setup Guide"; extra tiles Misprint (beta), Extras (Trade Me), Personal: Automatic Inventory / Buylist / Storefront | ✅ hub (Sept 19) · ✖ config-page presets, setup guide |
| Configuration → eBay | Business policies synced from eBay with **Add Policy** per type and a default per type; Shipping settings (location, postal code, dispatch days); Auction settings (time zone, auction payment/shipping policy); **Best Offer settings** (allow, minimum %, auto-accept %); **Shipping by price range**; **Store categories** list with ids + drag order; Variation sort; Cross-border overrides (site id, country, currency); Subtitle; Automatic eBay Inventory toggle | ◐ policies + location + best-offer on/off · ✖ min/auto-accept %, price-range shipping, store-category sync, cross-border, subtitle |
| Ungraded setup | Config page · Database (≈40 games, searchable) · Platform (eBay Auctions / Fixed / Variation, Shopify, Whatnot, TCGplayer, Mana Pool, Misprint, Extras) · Auto Crop for Phone Images · Advanced matching with **saveable named templates** · Condition · Start price · SKU prefix + Increment · Store category · Secondary category · Schedule upload time · "Next: Upload One Piece English Cards" | ✅ database, platform, condition, start price, SKU + increment, store category, matching · ✖ named matching templates, secondary category, schedule time (per batch) |
| Upload | 1 Image / 2 Images / Custom · "Up to 500 cards or 1000 files, must be multiple of 2" · **Uploaded Cards grid** ("15 cards (15 images)", Card N label, per-card delete, Clear All, Swap All) · "Process 15 One Piece English Cards" · processing screen "Processing images → Verifying matches…", "Results open automatically when done — or find them in History" | ✅ 1/2 images, Swap all, clear, preview grid · ✖ Custom, per-card delete, processing screen |
| Results header | Configuration Page · Export Format · **Batch Name** (PKJ-243 – One Piece E) · **Total Cards / Price / TCGP Price** totals · Select Cards · Sort · Tools · Bulk Edit · refresh · List / Export | ◐ platform chip + export button · ✖ totals row, Sort, Select Cards |
| Results row | Uploaded vs Match thumbs (hover "Compare") · confidence "74/80" · name/type/set/year/rarity/illustrator · variant pill · Price + **Offers checkbox** · Quantity · SKU (combined "PKJ-244,PKJ-256") · Condition · TCG **NM/LP/MP/HP** + **Prev** column · Category 1/2 · Schedule · Replace / **eBay Listed** / eBay Sold / TCGplayer / Options | ✅ compare, confidence, variant, price, qty, SKU, condition, prev-price hint, link-outs, **eBay Listed popup (Sept 20)** · ✖ per-row Offers, NM/LP/MP/HP (needs TCGplayer SKU data), category selects |
| Tools menu | Create Lot · Manage Duplicates · Convert to Playset · Check eBay Duplicates (beta) · Refetch Pricing · Regen Titles · View Matches | ◐ duplicates merge on commit · ✖ lot, playset, refetch, regen-all, eBay duplicates |
| Bulk Edit menu | Prices (**Set Price for All** modal: base price, price filter, add/subtract, round, tiers, live preview) · Find & Replace · Use DB Image / Undo · Edit Best Offers · Schedule Upload Time · Edit Conditions · Quantity · Edit SKU · Edit Variants · Edit Store Categories · Edit Item Specifics | ✅ price-all, SKU, best offers (listings) · ✖ the rest |
| Duplicates modal | Groups with counts, click to cycle, "Multi-edit: apply price changes to all duplicates", **Combine All Duplicates** → one row, qty 2, SKUs joined | ◐ flagged + merged on commit · ✖ modal, combine-in-place |
| eBay Listings popup | "eBay Listings (50)", editable query, price **+ shipping**, condition, **country + seller**, "Affiliate link" per row, refresh, green "eBay" button | ✅ popup with price + shipping, condition, seller, country, affiliate rows, Open-on-eBay (Sept 20) · ✖ editable query, 50 default (ours 25) |
| Comparison modal | "1 of 14" · **Report Issue** · 2-column alternatives grid with % | ✅ · ✖ Report Issue |
| List / Export | List on eBay (via API) · Add to inventory (beta) · Export CSV → "Config: Default → Export eBay" · Mark as Listed · toast "Ungraded fixed price CSV exported successfully" · file name `pkj-01-pokemon-english_ebay_ungraded_fixed_price_<date>.csv` | ✅ all four paths exist (API needs keys) · ✖ menu form, file naming |
| Inventory | 4,148 products · 26,745 cards · Price / Market totals · tabs Inventory / Pricing Tool / Deleted · Reconcile with eBay · Grouped vs All copies · Hide empty · columns Status / Platform / User SKU / Catalog SKU / Variant / TCG / Price / Market / Qty / Added | ◐ stats, tabs, search · ✖ deleted tab, reconcile, grouped copies, platform column |
| Graded | Grader tiles PSA/CGC/BGS/TAG/ACE · **Scan with camera** · cert numbers 0/200 | ✅ paste certs · ✖ camera scan |

**eBay integration in the owner console (Sept 20):** `/admin/ebay` holds the developer keyset (console values override env, no redeploy), shows what each key unlocks, runs a live Browse-API search test, lists connected sellers and harvested sold sales; the review-row **eBay Listed** popup is live whenever a keyset (or mock mode) is present.

## 2. What already exists today vs. what is in git history

| Ask | In the current tree (buyer build) | In `2e6de1b` (seller build) |
|---|---|---|
| Photo upload, chunked, 500/batch, 1600 px shrink | ✅ `/collection/add` | ✅ |
| Binder-page multi-card detection | ✅ uncommitted work in `render/collection.ts` (keep it) | — |
| Photo ID (perceptual hash) + boot-time index | ✅ | ✅ |
| Advanced matching (prioritize / exclude) | ✅ `app/matching.ts` | ✅ |
| Review queue: alternatives, manual search, front/back per item, j/k/y/s keys | ✅ | ✅ |
| In-batch duplicates + merge on commit | ✅ | ✅ |
| Previous batches | ✅ as `/collection/uploads` | ✅ `/app/batches` |
| Graded (cert paste, grader/grade) | ✅ | ✅ |
| TCGplayer market price per printing (daily TCGCSV) | ✅ | ✅ |
| Variants (Normal / Holo / Reverse) | ✅ (better than CU) | ✅ |
| "Live on eBay" popup (Browse API) | ✅ code in `src/ebay.ts`, needs keys | ✅ |
| eBay sold ↗ / TCGplayer ↗ links | ✅ card pages | ✅ |
| SKU prefix + auto-increment | ❌ | ✅ `sku.ts`, settings |
| Start price / condition defaults, price floor, **previous-price memory** | ❌ | ✅ `pricing.ts`, `auto_price_pref` |
| Auto eBay title (80-char structure editor) | ❌ | ✅ `title.ts` |
| eBay File Exchange CSV (+ TCGplayer/Whatnot/Shopify) | ❌ | ✅ `exporters.ts` |
| Inventory, listings, bulk bar | ❌ | ✅ `store.ts`, `render/app.ts` |
| eBay OAuth connect + policy sync + publish | ❌ | ✅ `ebay-sell.ts` (needs keys; `EBAY_MOCK=1` runs it) |
| Orders / picklist | ❌ | ✅ (client: hide for now) |
| Config tabs (Shop, Pricing, Matching, Titles, eBay, channels) | partial (`/collection/settings`) | ✅ |
| Affiliate tagging of eBay / TCGplayer links | ❌ | ❌ |
| Front+back **pairing at upload** (1 / 2 images mode) | ❌ (back is set per item in review) | ❌ |
| Best Offer on/off (bulk) | ❌ | ❌ |
| Bulk "edit SKU prefix / renumber" | ❌ | ❌ (bulk pricing existed) |
| eBay store categories | ❌ | ❌ (free-text category only) |
| TCGplayer NM/LP/MP/HP per condition | low/mid/high/market only | same (SKU prices need a closed TCGplayer key) |
| One Piece catalog | ❌ | ❌ |
| Full Pokémon catalog | ❌ only Base Set + Vivid Voltage (2 sets) | same |
| Stripe checkout | ❌ | ❌ |

---

## 3. The plan, easiest → hardest

> **Status (Sept 19, 2026):** Tier 0 and Tier 1 are done (commit `2a1ec43`). Tier 2 items 8, 9, 10 and 11 are built (commit `f2ea460`: setup block, front/back pairing, comparison modal, results-row link-outs + per-batch export); item 12 waits on the client's eBay keyset and item 13 on the plan-price decision. Tier 3 item 14 is built: `npm run import:catalog` / owner console → Catalog imports **all Pokémon and all One Piece** from TCGCSV (category 3 / 68) straight into Postgres and hashes the images for photo ID; pokemontcg.io was returning HTTP 500 on Sept 19 so TCGCSV is the single source. Items 15–17 remain (embedding-based photo ID, client's eBay keys, JustTCG decision).

### Tier 0 — decision + restore (½–1 day)
**Restore the seller workspace from `2e6de1b`.** Bring back the modules listed in §0, re-add the `/app` routes and POST handlers in `server.ts`, keep the current `/collection` buyer pages if the user wants both (they share `scan_batches`/`scan_items`), and keep the uncommitted binder-page detector — it is exactly the "several cards per photo" upload the client will use. Hide **Orders** behind a flag (client: not yet). Re-run the Sept 13 smoke script.

### Tier 1 — hours each
1. **Affiliate-tag every eBay link** (ask #24). One helper `epnLink(url, customid)` appends `mkevt=1&mkcid=1&mkrid=711-53200-19255-0&campid=<EBAY_EPN_CAMPID>&toolid=10001&customid=<where-it-came-from>`; env var `EBAY_EPN_CAMPID` (10-digit, from the client's EPN account). Apply to eBay Sold ↗, eBay Listed ↗ and every row of the Live-on-eBay popup. Evidence of the exact format: the client's own video URL bar (`mkcid=1&mkrid=711-53200-19255-0&campid=5339141403&toolid=10001&customid=ebay-sold` — CardUploader's campaign). Sources: [EPN tracking link reference](https://developer.ebay.com/api-docs/buy/static/ref-epn-link.html), [EPN tracking parameters](https://partnernetwork.ebay.com/solutions/optimizing-using-tracking-parameters). **TCGplayer** links: CardUploader's carry `utm_source=impact&utm_medium=affiliate&utm_campaign=CARDUPLOADER&irclickid=…` — the TCGplayer affiliate program runs on Impact; client applies, we append their tracking template (`TCGPLAYER_AFFILIATE_QS` env).
2. **$0.99 eBay floor by default** (ask #22): default `price_floor_cents=99` and start price $0.99 for eBay-platform batches. Existing floor logic.
3. **Best Offer on/off** (ask #19): `listings.best_offer` boolean, default off, bulk toggle, `BestOfferEnabled` column in the eBay CSV.
4. **Export → eBay hand-off** (ask #27): after "Export eBay CSV", show a panel: step 1 download done · step 2 button **Open eBay uploads** → `https://www.ebay.com/sh/reports/uploads` · step 3 "Upload template → choose file → wait for Completed". Mark batch as listed. Source: [Seller Hub Reports uploads](https://pages.ebay.com/sh/reports/help/uploadable-file-feeds/), [bulk-listing guide](https://www.img.vision/handbook/ebay/bulk/seller-hub-reports/).
5. **Sidebar naming** to match CU (ask #2): rename/regroup the Sept 8 sidebar; Orders hidden; "Ungraded Pricing Tool" label.
6. **Bulk edit → Edit SKU prefix / renumber** (ask #19): renumber a batch's SKUs from a new prefix+start after de-duping (SKU allocation already exists; add the re-sequence action).
7. **Games first**: the Database selector lists only Pokémon, One Piece (once seeded), Magic — in that order.

### Tier 2 — a day or two each
8. **Per-batch setup block** (asks #8, #13, #14): Config page · Database (game) · Platform (eBay Fixed / eBay Auction / TCGplayer) · condition · start price · SKU prefix + "increment" checkbox · store category · secondary category · schedule. All fields exist in seller settings; surface them per batch with the saved defaults pre-filled and "save as default".
9. **Front + back pairing at upload** (ask #15): mode toggle *1 image / 2 images / custom*; in 2-image mode consecutive files pair as front/back in selection order (must be a multiple of 2, "Swap all" to flip), server ingests `back_image_url` at start, chunked upload preserves order (it already sends indexed groups of 20). Binder detector applies to front pages only.
10. **Card Comparison & Search modal** (asks #16, #20): the review queue already has alternatives + manual search; present it as CU's modal — your photo | matched DB image | alternatives with %, search box, Replace, "continue to next card", arrow keys.
11. **Results row parity** (ask #16): auto title from the title structure, illustrator/year/type from the catalog, variant picker, TCGplayer low/mid/high/market chips, "prev $x" from previous-price memory, Options menu (Replace · eBay Listed · eBay Sold · TCGplayer).
12. **Config → eBay business policies** (ask #7): `ebay-sell.ts` already does OAuth connect + `syncPolicies` + policy pickers + ship-from location. Add **eBay store categories** (Trading API `GetStore` → `CustomCategories`, ids go into the CSV `StoreCategory` column). Blocked only on the client's eBay developer keyset.
13. **Stripe at $7–10/mo** (ask #28): Checkout + customer portal + webhook → `plan_tier`. Price is a config. 1–2 days.

### Tier 3 — the hard, essential part (a week or more)
14. **Full Pokémon + One Piece catalogs** (ask #9). Today the catalog holds 2 Pokémon sets and 1 Magic set, so most real scans cannot match anything. Needed:
    - **Pokémon (all sets)**: pokemontcg.io already backs `seed.ts`; extend `POKEMON_SETS` to every set (~100+ sets, ~20k cards), then `hash:catalog` (hours, one-time, boot-time builder fills prod).
    - **One Piece**: no free official API. Use **TCGCSV category 68 "One Piece Card Game"** (verified Sept 19: `1 Magic · 3 Pokemon · 68 One Piece Card Game · 85 Pokemon Japan`): groups = sets, products carry name, number, rarity, image URL and `subTypeName` print variants (Normal / Foil / Parallel …), prices daily. Write `seed` support for category 68 (product `extendedData` has Number/Rarity/Color/Type), hash the product images for photo ID. Community sources for card text/artist: [Limitless One Piece DB](https://onepiece.limitlesstcg.com/cards), [onepiece.gg](https://onepiece.gg/cards/), [official card list](https://en.onepiece-cardgame.com/cardlist/). Sources: [TCGCSV](https://tcgcsv.com/), [TCGplayer One Piece price guides](https://www.tcgplayer.com/categories/trading-and-collectible-card-games/one-piece-card-game/price-guides).
    - `sync:tcgcsv` already writes market/low/mid/high per printing; point it at categories 3 and 68.
15. **Scan accuracy on real phone photos + "learns over time"** (asks #6, #21). Perceptual hashing matches clean scans and catalog-quality photos (500/500 on distinct cards Sept 13) but is fragile to glare, tilt and cropping on phone shots at 20k+ cards. The durable answer is an embedding retrieval index (CLIP-class model → pgvector, what CardUploader uses) fed by confirmed matches (training opt-in already logs them). Plan it as its own phase after the catalogs exist; hash stays the fallback. This is the honest risk to state to the client.
16. **eBay Listed popup + eBay account link** (asks #23, #7): code exists; needs the client to register at developer.ebay.com and get a **production keyset** (Browse API works with app keys only — no user login — so the popup can ship first; Sell/Account APIs need the OAuth RuName too). Set `EBAY_CLIENT_ID/SECRET` (+ `EBAY_RU_NAME`) on Railway.
17. **TCGplayer per-condition NM/LP/MP/HP** (ask #16): TCGCSV does not carry SKU-condition prices and TCGplayer's API is closed. Options: show market + low/mid/high (have), or [JustTCG](https://justtcg.com/) (paid, condition-level, One Piece supported). Client decision.
18. **Later, per the client**: Inventory synced with eBay (#5), Orders (#3), check-eBay-duplicates (#18), chaos sorting (#10), Graded polish, Discord.

### Scaling note for ask #28
Per 500-card batch: 500 image PUTs to the bucket (~150 KB each after the 1600 px shrink ≈ 75 MB) and 500 hash lookups against an in-memory index — seconds of CPU. At a few hundred sellers Railway + Postgres + S3 lands in the tens of dollars per month; the first real cost line is an embedding model host if #15 is built. A $7–10 plan clears that comfortably.

---

## 4. Questions to take back to the client
1. Confirm: **seller workflow is the product**; the buyer/collector pages either stay as a public price guide or go.
2. Their **EPN campaign ID** (10 digits) and whether they have (or will apply for) a TCGplayer/Impact affiliate account.
3. Register an **eBay developer account** (production keyset) — needed for eBay Listed and account linking.
4. "Let's get rid of that" at 12:11 — remove the eBay Sold button, or just close the tab?
5. Which One Piece sets first (English only?), and is Japanese Pokémon (TCGCSV 85) wanted.
6. Plan price: $7 or $10.
