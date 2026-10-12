# Current build status of the seller platform vs. the client's Sept 14 asks (verified 2026-09-28)

Scope note: code citations are repo-relative to `C:\Users\johnn\Antigravity_Files\Card_reader` and point at **commit `2c10f81` = current HEAD**. At session start, HEAD was `45cc4d9` and 11 files had uncommitted changes. During this research those exact changes were committed as `2c10f81` (same 11 files, +335/−63) and pushed to `origin/main`, so the working tree is now clean. Every line number below therefore holds for both the session-start working tree and HEAD. Production observations come from public pages and public GET endpoints of https://tradingcardloader.com, fetched 2026-09-28. No sign-in and no form submissions.

---

## 1. Ask-by-ask status (Tiers 0–3, §1 asks #1–29, §1b screens, §1c items A–M)

### Takeaway
Nearly everything the client walked through now exists in code, reachable in the `/app` UI. Most seller-workflow asks are **Done** or **Partial**. The biggest gap is not code: **production still runs the 607-card demo catalog** (2 Pokémon sets + 1 Magic set, no One Piece). Until the TCGCSV catalog import is run on production, the client's own Pokémon and One Piece scans cannot match there. The other blockers are the client's EPN campaign id (affiliate tagging is built but inert), the $7–10 price decision plus Stripe (no payment code exists), and a TCGplayer per-condition data decision. Items missing outright: Custom upload mode, eBay config extras (Best Offer %, price-range shipping, store-category sync), config presets, the batch gallery, "learns over time", the guides/Discord hub, and the referral program.

### Cited Findings

**§1 asks (#1–29)**

| # | Ask | Status | Evidence | Reachable | Notes / blocker |
|---|---|---|---|---|---|
| 1 | Home page (cosmetics later) | Done | route [server.ts:1429](card-db-mvp/src/server.ts#L1429); live hero "Scan once. List everywhere." and "Pokemon & Magic today", "607 cards" — [tradingcardloader.com](https://tradingcardloader.com/) | Public | Cosmetic work deferred by client |
| 2 | CardUploader-style sidebar | Done | groups Dashboard · List cards (Ungraded cards, Graded cards, Listing creator, Blank listing creator) · Manage (Previous batches, Inventory, Automatic inventory, Listings, Orders only when enabled) · Tools (Ungraded pricing tool, Card search, Sales lookup) · Account (Inbox, Configuration) — [render/app.ts:165-196](card-db-mvp/src/render/app.ts#L165) | UI | Feedback is folded into Inbox; no separate "Account" page |
| 3 | Orders: not yet | Done (hidden) | `ordersEnabled()` reads `ORDERS_ENABLED==="1"` [render/app.ts:161-163](card-db-mvp/src/render/app.ts#L161); sidebar push only when enabled [render/app.ts:174](card-db-mvp/src/render/app.ts#L174); routes still live [server.ts:2134](card-db-mvp/src/server.ts#L2134), [server.ts:2257-2261](card-db-mvp/src/server.ts#L2257) | Hidden from sidebar | **Leak:** the dashboard quick grid always shows an "Orders" tile linking to `/app/orders` — [render/app.ts:251](card-db-mvp/src/render/app.ts#L251) |
| 4 | Previous batches: reopen / re-upload | Partial | plain table with Review/Open and a per-batch CSV link — [render/app.ts:311-350](card-db-mvp/src/render/app.ts#L311), [render/app.ts:332-334](card-db-mvp/src/render/app.ts#L332); closed batches can't take more photos (`status==='processing'` required) — [server.ts:693-696](card-db-mvp/src/server.ts#L693) | UI | Reopen yes; re-upload into an old batch, delete, and gallery (§1c H) are not built |
| 5 | Inventory linked to eBay, totals, auto market updates | Partial | one-line summary "products · cards · Price · Market" (2c10f81) — [render/app.ts:494](card-db-mvp/src/render/app.ts#L494), [store.ts:785-801](card-db-mvp/src/app/store.ts#L785); stat tiles, tabs All/In stock/Listed/Sold, search, sort — [render/app.ts:387-450](card-db-mvp/src/render/app.ts#L387) | UI | No eBay sync/reconcile. Market values move only when prices are refreshed; there is no in-process daily price sync (only the publish scheduler and sold-harvest timers exist: [ebay-sell.ts:137-155](card-db-mvp/src/app/ebay-sell.ts#L137), [soldharvest.ts:113-133](card-db-mvp/src/app/soldharvest.ts#L113)) |
| 6 | Ungraded scanning (#1 priority); Graded too | Partial / **Blocked on prod catalog import** | photo pipeline [server.ts:657-677](card-db-mvp/src/server.ts#L657), [vision.ts:119-172](card-db-mvp/src/app/vision.ts#L119); prod catalog is 3 sets with no One Piece — [/browse](https://tradingcardloader.com/browse), [/g/onepiece → 404](https://tradingcardloader.com/g/onepiece); Graded: cert paste works, but the cert lookup provider is only `none`/`mock` — [graded.ts:83-95](card-db-mvp/src/app/graded.ts#L83) | UI | Works locally on the imported catalog. On prod the client's cards aren't in the catalog. No graded camera scan |
| 7 | Configuration → eBay: link account, pull business policies, pick defaults | Done in code; live use unverified | OAuth scopes [ebay-sell.ts:30-35](card-db-mvp/src/app/ebay-sell.ts#L30); connect/callback [server.ts:2263-2296](card-db-mvp/src/server.ts#L2263); `syncPolicies` [ebay-sell.ts:332-341](card-db-mvp/src/app/ebay-sell.ts#L332); policy selects + ship-from [render/app.ts:1416-1440](card-db-mvp/src/render/app.ts#L1416) | UI (Configuration → eBay) | "Connect" needs client id + secret + **RuName** ([ebay-sell.ts:40-43](card-db-mvp/src/app/ebay-sell.ts#L40)). Prod has a working keyset (see §5), but whether a RuName is set can't be seen from public pages |
| 8 | Ungraded setup: Config page · Database · Platform | Partial | Database select [render/app.ts:614](card-db-mvp/src/render/app.ts#L614); Platform eBay Fixed / eBay Auctions / TCGplayer [render/app.ts:634](card-db-mvp/src/render/app.ts#L634); stamped on the batch [server.ts:352-357](card-db-mvp/src/server.ts#L352) | UI | No "Config page" presets (§1c J) |
| 9 | Pokémon #1, One Piece #2 | Partial / **Blocked on prod import** | importer for TCGCSV categories 3 / 68 / 1 [catalog-import.ts:32-36](card-db-mvp/src/app/catalog-import.ts#L32); Database order Pokémon → One Piece → Magic, and One Piece shows as a disabled "coming soon" when the catalog lacks it [render/app.ts:58-72](card-db-mvp/src/render/app.ts#L58) | UI + owner console | On prod, One Piece is currently unselectable ("coming soon") and Pokémon is 2 sets |
| 10 | Chaos sorting | Missing | no code (client deferred) | — | Client: "I'm going to research" |
| 11 | Auto crop for phone images | Missing (by design) | client said skip (plan §1c) | — | The "several cards per photo" mode does crop on the device, but that's a different feature |
| 12 | Advanced matching (prioritize/exclude) | Done | panel [render/app.ts:523-538](card-db-mvp/src/render/app.ts#L523); applied in matcher [identify.ts:405-410](card-db-mvp/src/app/identify.ts#L405); saved defaults [render/app.ts:1339-1349](card-db-mvp/src/render/app.ts#L1339) | UI | Named, saveable matching templates not built |
| 13 | Defaults: condition NM, start price $.99, SKU prefix + increment / box label | Done | NM default [schema.app.sql:37](card-db-mvp/src/schema.app.sql#L37); start price field [render/app.ts:636](card-db-mvp/src/render/app.ts#L636) → fixed price for every card [server.ts:361-364](card-db-mvp/src/server.ts#L361); prefix + Increment, unticked = bare prefix [render/app.ts:639-644](card-db-mvp/src/render/app.ts#L639), [server.ts:358-359](card-db-mvp/src/server.ts#L358) | UI | Start price is blank by default (placeholder 0.99); the $0.99 floor still applies (#22) |
| 14 | eBay store category; secondary category; schedule | Partial | store category is a typed numeric id per batch [render/app.ts:640](card-db-mvp/src/render/app.ts#L640) and in settings [render/app.ts:1445](card-db-mvp/src/render/app.ts#L1445); batch value overrides the default in the CSV [server.ts:1244](card-db-mvp/src/server.ts#L1244), [exporters.ts:211](card-db-mvp/src/app/exporters.ts#L211) | UI | No sync of the seller's eBay store categories (no GetStore call anywhere in [ebay-sell.ts](card-db-mvp/src/app/ebay-sell.ts)); not sent on API publish (offer has no store-category field, [ebay-sell.ts:508-528](card-db-mvp/src/app/ebay-sell.ts#L508)); no secondary category; no per-batch schedule (per-listing schedule/space-out exists: [render/app.ts:1186-1188](card-db-mvp/src/render/app.ts#L1186)) |
| 15 | Upload 1 image / 2 images / custom; 500 cards / 1000 files | Partial | layouts "1 image", "2 images" (with Swap all), "Several cards per photo" [render/app.ts:1637-1639](card-db-mvp/src/render/app.ts#L1637); pairing [server.ts:640-650](card-db-mvp/src/server.ts#L640); pairs count as one card toward the cap [render/app.ts:1693-1701](card-db-mvp/src/render/app.ts#L1693); caps shown [render/app.ts:1631](card-db-mvp/src/render/app.ts#L1631) | UI | "Custom" mode not built; 500 cards on Pro, 100 on Free |
| 16 | Results row per card | Partial | photo vs catalog thumb + Compare [render/app.ts:826-839](card-db-mvp/src/render/app.ts#L826), [render/app.ts:899](card-db-mvp/src/render/app.ts#L899); variant picker with market per printing [render/app.ts:914-921](card-db-mvp/src/render/app.ts#L914); condition / qty / price / SKU [render/app.ts:924-931](card-db-mvp/src/render/app.ts#L924); auto title with live counter [render/app.ts:933-935](card-db-mvp/src/render/app.ts#L933); "you listed at" previous price [render/app.ts:879](card-db-mvp/src/render/app.ts#L879); eBay Listed / eBay Sold / TCGplayer [render/app.ts:841-860](card-db-mvp/src/render/app.ts#L841) | UI | Row shows name / set / number only, not type / year / rarity / illustrator (imported cards store `artist` as NULL: [catalog-import.ts:245-247](card-db-mvp/src/app/catalog-import.ts#L245)); no TCG NM/LP/MP/HP; no per-row category, schedule or Options menu |
| 17 | Manage duplicates → combine to qty 2 | Partial | flagged in batch [store.ts:614](card-db-mvp/src/app/store.ts#L614); merge on commit [store.ts:640-658](card-db-mvp/src/app/store.ts#L640), checkbox [render/app.ts:1049](card-db-mvp/src/render/app.ts#L1049); per-row note [render/app.ts:818-820](card-db-mvp/src/render/app.ts#L818) | UI | No duplicates modal, no combine-in-place, no joined SKUs |
| 18 | Check eBay duplicates | Missing | no code | — | Client: later |
| 19 | Bulk edit: price all · disable Best Offer · renumber SKUs | Done | price-all [render/app.ts:1005-1012](card-db-mvp/src/render/app.ts#L1005), [server.ts:900-905](card-db-mvp/src/server.ts#L900); SKU renumber [render/app.ts:1013-1019](card-db-mvp/src/render/app.ts#L1013), [server.ts:906-914](card-db-mvp/src/server.ts#L906); Best Offer default off [store.ts:74-75](card-db-mvp/src/app/store.ts#L74), bulk Offers on/off on Listings [render/app.ts:1190-1191](card-db-mvp/src/render/app.ts#L1190), [server.ts:1007-1009](card-db-mvp/src/server.ts#L1007) | UI | Best Offer is toggled on the Listings page, not the review page; price-all is a flat value (no filter / add-subtract / round / tiers) |
| 20 | Card Comparison & Search modal | Done | data attrs [render/app.ts:881-893](card-db-mvp/src/render/app.ts#L881); modal JS [render/app.ts:2065-2124](card-db-mvp/src/render/app.ts#L2065) | UI | No "Report Issue" (grep finds none) |
| 21 | "It learns over time" | Missing | only an opt-in flag: [render/app.ts:1482](card-db-mvp/src/render/app.ts#L1482), [server.ts:1157](card-db-mvp/src/server.ts#L1157), [schema.app.sql:25](card-db-mvp/src/schema.app.sql#L25); no code reads confirmed matches back into matching (grep for `training_opt_in` finds only these) | — | — |
| 22 | TCGplayer market; $0.99 floor; remember previous price | Done | market/low/mid/high written by import [catalog-import.ts:253-291](card-db-mvp/src/app/catalog-import.ts#L253); floor falls back to 99¢ [pricing.ts:82-88](card-db-mvp/src/app/pricing.ts#L82); previous price [store.ts:315](card-db-mvp/src/app/store.ts#L315), [store.ts:363-365](card-db-mvp/src/app/store.ts#L363) | UI | Prices refresh only on re-import or a CLI `sync:tcgcsv` (no scheduler) |
| 23 | "eBay Listed" popup (live listings, affiliate rows) | Done, **live on prod** | button vs link-out [render/app.ts:852-854](card-db-mvp/src/render/app.ts#L852); popup JS with editable query [render/app.ts:2024-2033](card-db-mvp/src/render/app.ts#L2024); API [server.ts:1380-1398](card-db-mvp/src/server.ts#L1380); prod returned real listings — [/api/ebay/listed?card=4](https://tradingcardloader.com/api/ebay/listed?card=4&limit=5) | UI (review rows) + public card page | Fetches 25 rows ([render/app.ts:2033](card-db-mvp/src/render/app.ts#L2033)); CardUploader shows 50; server caps at 50 ([server.ts:1390](card-db-mvp/src/server.ts#L1390)) |
| 24 | Affiliate links on every eBay link | Done in code / **Blocked on the client's EPN campaign id** | `ebayLink` [affiliate.ts:42-60](card-db-mvp/src/affiliate.ts#L42); id from console or env [ebay-config.ts:62-80](card-db-mvp/src/app/ebay-config.ts#L62); console field [render/admin.ts:633-634](card-db-mvp/src/render/admin.ts#L633); prod links carry no `campid` — [/c/charizard-4-102-4](https://tradingcardloader.com/c/charizard-4-102-4) | Automatic | TCGplayer tagging needs `TCGPLAYER_AFFILIATE_QS` (env only, [affiliate.ts:32](card-db-mvp/src/affiliate.ts#L32)) → blocked on the client's Impact account |
| 25 | eBay Sold button | Done | review row [render/app.ts:857](card-db-mvp/src/render/app.ts#L857); query is name + number in category 183454 (2c10f81, live on prod card page) | UI + public | Confirm with the client that the button stays |
| 26 | TCGplayer button | Done in code; Partial on prod | condition/language pre-filter [affiliate.ts:139-150](card-db-mvp/src/affiliate.ts#L139), used at [render/app.ts:849](card-db-mvp/src/render/app.ts#L849) | UI | On the prod card page "View on TCGplayer" is absent (demo cards lack `tcgplayer_url`) |
| 27 | List / Export: API · Add to inventory · CSV → Seller Hub with guidance · Mark listed | Partial | CSV [server.ts:1228-1268](card-db-mvp/src/server.ts#L1228), [exporters.ts:196-219](card-db-mvp/src/app/exporters.ts#L196); hand-off panel with "Open eBay → Reports → Uploads" [render/app.ts:33-51](card-db-mvp/src/render/app.ts#L33); Mark as listed [render/app.ts:460](card-db-mvp/src/render/app.ts#L460), [render/app.ts:1192](card-db-mvp/src/render/app.ts#L1192); commit to inventory [server.ts:2206-2210](card-db-mvp/src/server.ts#L2206); API publish [ebay-sell.ts:479-547](card-db-mvp/src/app/ebay-sell.ts#L479) | UI | API publish needs a connected account and sends **no trading-card condition descriptors** ([ebay-sell.ts:502-506](card-db-mvp/src/app/ebay-sell.ts#L502)); the CSV has no `CD:` descriptor columns (see §5) |
| 28 | Membership $7–10/mo; scaling costs | **Blocked on price decision + Stripe** | $15 hard-coded [billing.ts:17-19](card-db-mvp/src/app/billing.ts#L17); Stripe named as "next seam" only [billing.ts:9-12](card-db-mvp/src/app/billing.ts#L9) | Public pricing page | See §6 |
| 29 | "Can we do this?" | n/a | answer, not a build item | — | — |

**Tier plan items (plan §3)**

| Item | Status | Evidence |
|---|---|---|
| Tier 0: restore seller workspace from `2e6de1b`, Orders behind a flag, keep binder detector | Done | commit `2a1ec43` (47 files, +8,399/−3,362; restores store/ebay-sell/exporters/listing/orders/pricing/sku/title/compose/render/app/workspace2, deletes `/collection` pages) — [git show --stat 2a1ec43](git:2a1ec43); flag [render/app.ts:161-174](card-db-mvp/src/render/app.ts#L161); detector in dropzone [render/app.ts:1745-1752](card-db-mvp/src/render/app.ts#L1745) |
| T1-1 affiliate tagging | Done / blocked on EPN id | [affiliate.ts:22-60](card-db-mvp/src/affiliate.ts#L22) |
| T1-2 $0.99 floor | Done | [pricing.ts:82-88](card-db-mvp/src/app/pricing.ts#L82) (fallback floor, not a column default) |
| T1-3 Best Offer on/off + CSV column | Done | [store.ts:74-75](card-db-mvp/src/app/store.ts#L74); `BestOfferEnabled` [exporters.ts:204](card-db-mvp/src/app/exporters.ts#L204), [exporters.ts:213](card-db-mvp/src/app/exporters.ts#L213); settings default [render/app.ts:1448](card-db-mvp/src/render/app.ts#L1448); API `bestOfferTerms` [ebay-sell.ts:520](card-db-mvp/src/app/ebay-sell.ts#L520) |
| T1-4 eBay Seller Hub hand-off panel | Done | [render/app.ts:33-51](card-db-mvp/src/render/app.ts#L33) (shown at [render/app.ts:473](card-db-mvp/src/render/app.ts#L473), [render/app.ts:1197](card-db-mvp/src/render/app.ts#L1197)) |
| T1-5 sidebar naming | Done | [render/app.ts:165-196](card-db-mvp/src/render/app.ts#L165) |
| T1-6 renumber SKUs | Done | [server.ts:895-914](card-db-mvp/src/server.ts#L895) |
| T1-7 games first | Done | [render/app.ts:58-72](card-db-mvp/src/render/app.ts#L58) |
| T2-8 per-batch setup block | Partial | [render/app.ts:629-647](card-db-mvp/src/render/app.ts#L629); no config presets, secondary category or schedule |
| T2-9 front+back pairing | Done (no Custom) | [server.ts:640-650](card-db-mvp/src/server.ts#L640), [render/app.ts:1638](card-db-mvp/src/render/app.ts#L1638) |
| T2-10 comparison modal | Done | [render/app.ts:2065-2124](card-db-mvp/src/render/app.ts#L2065) |
| T2-11 results-row parity | Partial | see #16 |
| T2-12 Config → eBay policies + store categories | Partial | policies done ([ebay-sell.ts:332-341](card-db-mvp/src/app/ebay-sell.ts#L332)); store-category sync not built at all |
| T2-13 Stripe at $7–10 | Missing (blocked on price decision) | no Stripe code or env var anywhere in `src` (grep: comments only) |
| T3-14 full Pokémon + One Piece catalogs | Done in code; **not run on production** | [catalog-import.ts:172-330](card-db-mvp/src/app/catalog-import.ts#L172); owner console trigger [server.ts:1832-1842](card-db-mvp/src/server.ts#L1832); prod: 3 sets — [/browse](https://tradingcardloader.com/browse) |
| T3-15 embedding photo ID + learning | Missing | hash only ([vision.ts:119-172](card-db-mvp/src/app/vision.ts#L119)) |
| T3-16 eBay Listed popup + account link | Popup live on prod; account link code-ready | [prod API](https://tradingcardloader.com/api/ebay/listed?card=4&limit=5); [ebay-sell.ts:213-270](card-db-mvp/src/app/ebay-sell.ts#L213) |
| T3-17 TCGplayer NM/LP/MP/HP | Missing (blocked on client's JustTCG/data decision) | condition endpoint needs closed TCGplayer API keys [server.ts:1403-1426](card-db-mvp/src/server.ts#L1403), [.env.example:141-151](card-db-mvp/.env.example#L141) |
| T3-18 later items (eBay inventory sync, Orders, eBay-dup check, chaos sort, Discord) | Missing (deferred) | none in code (grep: no Discord / referral / chaos code) |

**§1b screen-level details**

| Screen | Built | Not built | Evidence |
|---|---|---|---|
| Configuration hub | Tile hub (Card settings / Platform settings / Account), one page per section | Config-page presets, setup guide | [render/app.ts:1224-1308](card-db-mvp/src/render/app.ts#L1224) |
| Configuration → eBay | Connect card, policy sync + pick per type, ship-from, store category id, item location, Best Offer on/off, policy names for CSV | Add Policy, dispatch time, auction settings, Best Offer min / auto-accept %, shipping by price range, store-category list sync / order, variation sort, cross-border, subtitle, automatic-inventory toggle | [render/app.ts:1412-1454](card-db-mvp/src/render/app.ts#L1412) |
| Ungraded setup | Database, Platform (3 options), condition, start price, SKU + Increment, store category, matching | Named matching templates, secondary category, schedule, config page; CU's ~40 games (we import 3: [catalog-import.ts:32-36](card-db-mvp/src/app/catalog-import.ts#L32)) | [render/app.ts:629-669](card-db-mvp/src/render/app.ts#L629) |
| Upload | 1 / 2 images, several-per-photo, Swap all, Clear, preview grid (first 24 thumbs), chunked progress | Custom mode, per-card delete, "Card N" labels, dedicated processing screen | [render/app.ts:1719-1739](card-db-mvp/src/render/app.ts#L1719) |
| Results header | Default batch name (first SKU + game + language), totals (cards · your price · TCGplayer market), platform chip, Export batch, merge-on-commit | Select Cards, Sort, Tools menu, refresh, export-format picker | [server.ts:375-384](card-db-mvp/src/server.ts#L375), [render/app.ts:989-1051](card-db-mvp/src/render/app.ts#L989) |
| Results row | See #16; live title counter | Per-row Offers, NM/LP/MP/HP, category selects, schedule, Options menu | [render/app.ts:801-945](card-db-mvp/src/render/app.ts#L801) |
| Tools menu | Duplicate merge on commit; per-row "↻ Title" | Create Lot, Convert to Playset, Check eBay Duplicates, Refetch Pricing, bulk Regen Titles, View Matches | [render/app.ts:939](card-db-mvp/src/render/app.ts#L939); grep finds no lot / playset / refetch |
| Bulk Edit menu | Set price for all (flat), Edit SKU prefix, Best Offer (Listings page), condition + rule (inventory bulk bar) | Find & Replace, Use DB image / undo, schedule, quantity, variants, store categories, item specifics, price filters / tiers / preview | [render/app.ts:455-460](card-db-mvp/src/render/app.ts#L455), [render/app.ts:1005-1019](card-db-mvp/src/render/app.ts#L1005) |
| Duplicates modal | Flag + merge | Modal, combine-in-place, multi-edit | [store.ts:614-658](card-db-mvp/src/app/store.ts#L614) |
| eBay Listings popup | Price + shipping, condition, seller, country, Open on eBay, editable query (2c10f81) | 50-row default (ours 25) | [render/app.ts:2024-2033](card-db-mvp/src/render/app.ts#L2024) |
| Comparison modal | Photo vs match, %, alternatives with %, search, Replace, arrow keys | Report Issue | [render/app.ts:2065-2124](card-db-mvp/src/render/app.ts#L2065) |
| List / Export | CSV + hand-off + Mark as listed + API publish code + CU-style file names | One combined "List / Export" menu | [server.ts:1217-1226](card-db-mvp/src/server.ts#L1217) |
| Inventory | Summary line, tiles, status tabs, search, sort | Deleted tab, Reconcile with eBay, grouped vs all copies, platform column, hide empty | [render/app.ts:387-494](card-db-mvp/src/render/app.ts#L387) |
| Graded | Paste certs (grader, grade) | Camera scan, real cert lookup | [graded.ts:83-95](card-db-mvp/src/app/graded.ts#L83) |

**§1c third-pass items**

| Item | Status | Evidence |
|---|---|---|
| A — EPN disclosure line | Done (shows only when links are tagged; none on prod today) | [affiliate.ts:106-116](card-db-mvp/src/affiliate.ts#L106); used at [render/app.ts:1042](card-db-mvp/src/render/app.ts#L1042), [render/pages.ts:487](card-db-mvp/src/render/pages.ts#L487), [render/sales.ts:145](card-db-mvp/src/render/sales.ts#L145) |
| B — name + number query, category 183454 | Done, live on prod | [affiliate.ts:71-84](card-db-mvp/src/affiliate.ts#L71); prod card page eBay link `…/sch/183454/i.html?_dcat=183454&_nkw=Charizard%204%2F102` — [/c/charizard-4-102-4](https://tradingcardloader.com/c/charizard-4-102-4) |
| C — TCGplayer Condition / Language params | Done | [affiliate.ts:139-150](card-db-mvp/src/affiliate.ts#L139) |
| D — batch totals | Done | [render/app.ts:989-1002](card-db-mvp/src/render/app.ts#L989) |
| E — live title counter | Done | [render/app.ts:933-935](card-db-mvp/src/render/app.ts#L933), [render/app.ts:2004-2011](card-db-mvp/src/render/app.ts#L2004) |
| F — default batch name + matching CSV file name | Done | [server.ts:375-384](card-db-mvp/src/server.ts#L375), [server.ts:1217-1226](card-db-mvp/src/server.ts#L1217), [server.ts:1264](card-db-mvp/src/server.ts#L1264) |
| G — inventory summary line | Done | [render/app.ts:494](card-db-mvp/src/render/app.ts#L494) |
| H — batches gallery / delete / prune | Missing | table only [render/app.ts:311-350](card-db-mvp/src/render/app.ts#L311); no batch-delete route in [server.ts](card-db-mvp/src/server.ts) |
| I — eBay config extras | Missing | [render/app.ts:1442-1454](card-db-mvp/src/render/app.ts#L1442) has none of them |
| J — config presets | Missing | no preset concept in code |
| K — guides / Discord hub | Missing | dashboard has only a checklist + help accordion [render/app.ts:255-283](card-db-mvp/src/render/app.ts#L255); grep finds no Discord / tutorial / changelog |
| L — referral program | Missing | grep finds no referral code |
| M — auto market updates, chaos sorting | Missing (client deferred) | — |

### Inferences
- Measured by the client's own priority list (#6 scanning, #9 games, #23 eBay Listed, #24 affiliate, #27 export), the product is code-complete except for Stripe and eBay store-category sync. What the client experiences on the live site, though, is mostly decided by one owner action: running the catalog import at `/admin/catalog`. Until then, the Sept 14 test (15 scans, all Unmatched) would fail the same way today.
- The Orders tile leak ([render/app.ts:251](card-db-mvp/src/render/app.ts#L251)) contradicts the client's "not yet" request, and it is a Pro-gated page, so Free users get bounced to pricing when they click it.

### Gaps
- Whether the plan doc's smoke results (e.g. "Tier 1 37/37, Configuration 29/29, affiliate 8/8, 27-check smoke") still pass was not re-run: static reading only.
- Logged-in pages on production (/app, /admin/ebay, /admin/catalog) were not inspected (no sign-in), so live readiness of Connect eBay (RuName) and the import progress are unknown.

---

## 2. What the session-start uncommitted changes did, and were they finished?

### Takeaway
The 11 modified files were a complete, coherent batch: §1c items A–G plus four matcher fixes, with CSS, README and plan-doc updates. Nothing was half-edited. During this research they were committed as `2c10f81` "Quick batch from the third video pass, plus One Piece matching fixes" and pushed to `origin/main`, and production already serves that behavior.

### Cited Findings
- `2c10f81` touches exactly the 11 files listed at session start (README, styles.css, affiliate.ts, identify.ts, store.ts, ebay.ts, render/app.ts, render/pages.ts, render/sales.ts, server.ts, plan doc), +335/−63, identical to the session-start diffstat. `main` and `origin/main` both point at `2c10f81`, and `git status` is now clean — [git show --stat 2c10f81](git:2c10f81).
- **Link-outs (affiliate.ts).**
  - New `ebayCardQuery` builds name + collector number only and strips parenthesised catalog suffixes that eBay reads as OR groups — [affiliate.ts:71-79](card-db-mvp/src/affiliate.ts#L71).
  - `ebayCategoryFor` scopes searches to 183454, or 38292 for Magic — [affiliate.ts:82-84](card-db-mvp/src/affiliate.ts#L82), [listing.ts:18-26](card-db-mvp/src/app/listing.ts#L18).
  - `affiliateDisclosure()` returns an empty string unless EPN or TCGplayer tagging is configured — [affiliate.ts:106-116](card-db-mvp/src/affiliate.ts#L106).
  - `tcgplayerProductUrl` gains `Condition=`/`Language=` — [affiliate.ts:139-150](card-db-mvp/src/affiliate.ts#L139).
- **Browse API (ebay.ts):** `searchListed` accepts `categoryId` and passes `category_ids` — [ebay.ts:98-118](card-db-mvp/src/ebay.ts#L98). The `/api/ebay/listed` endpoint accepts a user-edited `q` of up to 120 chars — [server.ts:1385-1393](card-db-mvp/src/server.ts#L1385).
- **Review page:** batch totals [render/app.ts:989-1002](card-db-mvp/src/render/app.ts#L989); disclosure [render/app.ts:1042](card-db-mvp/src/render/app.ts#L1042); live title counter [render/app.ts:933](card-db-mvp/src/render/app.ts#L933) and [render/app.ts:2004-2011](card-db-mvp/src/render/app.ts#L2004); editable popup query [render/app.ts:2024-2033](card-db-mvp/src/render/app.ts#L2024).
- **Inventory:** summary line [render/app.ts:494](card-db-mvp/src/render/app.ts#L494) backed by new `stock_products` / `stock_cards` [store.ts:785-801](card-db-mvp/src/app/store.ts#L785).
- **Naming:** default batch label [server.ts:375-384](card-db-mvp/src/server.ts#L375), wired into paste [server.ts:436](card-db-mvp/src/server.ts#L436) and photo batches [server.ts:628-632](card-db-mvp/src/server.ts#L628); export file names [server.ts:1217-1226](card-db-mvp/src/server.ts#L1217), [server.ts:1264](card-db-mvp/src/server.ts#L1264).
- **Matcher fixes (identify.ts):**
  - `numberMatch` compares numbers in full, so ST01-005 ≠ ST29-005 and 4/102 ≠ 4/130 — [identify.ts:211-229](card-db-mvp/src/app/identify.ts#L211).
  - Same-number printings are kept past the 80-row cap — [identify.ts:262-273](card-db-mvp/src/app/identify.ts#L262).
  - Set-prefixed numbers skip set-name detection — [identify.ts:375-378](card-db-mvp/src/app/identify.ts#L375).
  - A wrong set guess is dropped when no card in it carries the typed number — [identify.ts:391-401](card-db-mvp/src/app/identify.ts#L391).
  - In store.ts, a condition typed on a pasted line beats the batch default — [store.ts:453](card-db-mvp/src/app/store.ts#L453).
- The plan-doc edit in that batch adds §1c (third pass) and corrects the "74/80" wording (it is title length, not confidence) — [client-video-2026-09-14-asks-and-plan.md §1c](client-video-2026-09-14-asks-and-plan.md).
- **Production already reflects `2c10f81`:**
  - The live card page's eBay links use the new format `https://www.ebay.com/sch/183454/i.html?_dcat=183454&_nkw=Charizard%204%2F102` — [/c/charizard-4-102-4](https://tradingcardloader.com/c/charizard-4-102-4).
  - The live API echoes `"query": "Charizard 4/102"` with a `/sch/183454/` search_url — [/api/ebay/listed](https://tradingcardloader.com/api/ebay/listed?card=4&limit=5).

### Inferences
- The changes read as finished work: every helper added in affiliate.ts has call sites in render/app.ts, render/pages.ts, render/sales.ts and server.ts, the CSS classes they use exist in styles.css, and README and plan doc describe the result. No TODOs, dead branches or half-wired features appear in the diff.
- One side effect worth a follow-up: `/api/ebay/listed` is public and unauthenticated ([server.ts:1380-1398](card-db-mvp/src/server.ts#L1380)), and since `2c10f81` it accepts arbitrary query text (`q`). That turns it into an open proxy onto the site's Browse-API quota. Mitigating factors: results are cached 10 minutes per query ([ebay.ts:86](card-db-mvp/src/ebay.ts#L86)) and a valid `card` id is required.

### Gaps
- Deploy mechanism not verified. Railway may auto-deploy from GitHub `main` or be deployed via the CLI; either way, production matched `2c10f81` behavior when fetched.

---

## 3. Commits since Sept 19 and which asks they addressed

### Takeaway
Ten commits in three bursts: Sept 19 (restore + Tiers 1–2), Sept 21 (catalogs, Configuration hub, eBay console), and Sept 28 (eBay production-keyset prerequisites, privacy, sold harvest, then the §1c batch). Nothing was committed between Sept 21 and Sept 28.

### Cited Findings
- `2a1ec43` 2026-09-19 12:27 "Restore the seller workspace and ship the client's Tier 1 asks". Covers Tier 0, affiliate tagging (#24), $0.99 floor (#22), Best Offer (#19), Seller Hub hand-off + Mark as listed (#27), CU sidebar labels with Orders behind `ORDERS_ENABLED` (#2, #3), price-all + renumber SKUs (#19), the Database select (#8, #9), and the binder detector port (#15). 47 files, +8,399/−3,362 — [git log](git:2a1ec43).
- `f2ea460` 2026-09-19 12:40 "Tier 2: per-batch setup, front/back pairs, comparison modal, batch export". Covers #8, #13, #14, #15, #16, #20, #27. SKUs made non-unique so an unticked Increment gives every card the bare prefix — [git log](git:f2ea460).
- `25d64f6` 2026-09-21 10:39 "Full Pokémon + One Piece catalogs, Configuration hub, eBay in the owner console". Adds catalog-import.ts plus `npm run import:catalog` and `/admin/catalog` (#9, #6); One Piece number parsing and "one piece" as a search word; `sync:tcgcsv` maps onepiece; Configuration hub (#7); `/admin/ebay` keyset console with live Browse test and EPN id field (#23, #24); eBay Listed popup on review rows (#23). 21 files, +1,441/−295 — [git log](git:25d64f6).
- `4e889ae` 2026-09-28 18:36 "eBay Marketplace Account Deletion endpoint". Commit message: "eBay won't enable a Production keyset until the app subscribes to account deletion notifications". It also strips seller/buyer fields from imported sold rows. Enabler for #7 and #23 — [git log](git:4e889ae).
- `d36da67` 19:40 "Add a /privacy page". Message: eBay needs a live privacy-policy URL on the RuName. Enabler for #7 — [git log](git:d36da67).
- `83129b6` 19:43. Deletion notices also null the buyer and ship-to on pulled eBay orders; privacy text corrected — [git log](git:83129b6).
- `87a16a4` 19:44. Sold-sales harvest starts right after OAuth connect instead of at the next 6-hour tick — [git log](git:87a16a4).
- `e372c01` 19:50 "Keep mock-mode sales out of the public sold archive". Message: a mock-mode harvest's canned "Sample card $12.50" line "showed on /sales in production"; mock harvests are now `is_demo` and boot deletes unflagged `MOCK-` rows — [git log](git:e372c01).
- `45cc4d9` 20:07. Logs eBay connect outcomes (success / mock / missing code / error) — [git log](git:45cc4d9), [server.ts:2271](card-db-mvp/src/server.ts#L2271), [server.ts:2276](card-db-mvp/src/server.ts#L2276), [server.ts:2293](card-db-mvp/src/server.ts#L2293).
- `2c10f81` 21:00. The §1c A–G batch plus matcher fixes; see section 2 — [git log](git:2c10f81).
- `stash@{0}` "buyer-build binder-page detector WIP (before seller restore, Sept 19)" still exists — [git stash list](git:stash).

### Inferences
- The Sept 28 sequence (deletion endpoint → privacy page → mock-sale cleanup → connect logging) is the checklist for getting an eBay production keyset approved and testing Connect. `e372c01` implies someone connected eBay in **mock mode on production** on Sept 28. By the time of this research, production's Browse API returned real listings, so mock mode is off now (see section 5).

### Gaps
- None material. Commit bodies were read in full.

---

## 4. Scanning / identification today

### Takeaway
Photos are identified by a **local perceptual-hash matcher** (dHash + aHash on the full frame and an 8% inset) against catalog reference images, then resolved through the text matcher, which applies the batch's game filter and prioritize/exclude options. Multi-card photos are split **on the device** by a canvas segmenter. Front/back pairs are supported, but only the front is identified. One Piece numbers (OP11-117, EB02-005, ST01-001) parse and compare correctly. There is no embedding model and no learning. Accuracy on real phone photos is the known risk, and on production the matcher can only find the 607 demo cards.

### Cited Findings
- **Providers.** `VISION_PROVIDER` selects `hash`, `mock`, `http` / `custom` / `ximilar`, or `none`. The code default is `none` ([vision.ts:258-285](card-db-mvp/src/app/vision.ts#L258)); `.env.example` sets `hash` ([.env.example:39-55](card-db-mvp/.env.example#L39)). Production had `VISION_PROVIDER=hash` per the Sept 13 Railway check ([cardindex-feature-inventory.md §14](cardindex-feature-inventory.md)).
- **Hash method.**
  - 64-bit dHash (9×8 gradient) plus 64-bit aHash, each on the full frame and an 8% inset crop — [imagehash.ts:10-15](card-db-mvp/src/imagehash.ts#L10), [imagehash.ts:57-68](card-db-mvp/src/imagehash.ts#L57).
  - Distance is the best of four frame pairings, dHash + 0.5·aHash — [imagehash.ts:85-98](card-db-mvp/src/imagehash.ts#L85).
- **Matching.**
  - Linear scan over the entire in-memory index, reloaded every 10 minutes — [vision.ts:89-117](card-db-mvp/src/app/vision.ts#L89), [vision.ts:140-148](card-db-mvp/src/app/vision.ts#L140).
  - Distance → confidence: ≤6 → 0.97, ≤10 → 0.90, ≤14 → 0.75, ≤18 → 0.55, above that no match. A near-tie (<2) with a different card caps confidence at 0.70 — [vision.ts:153-157](card-db-mvp/src/app/vision.ts#L153).
  - The hit's name / number / set becomes a text hint resolved by `identify()`, with the provider's confidence folded in — [vision.ts:308-329](card-db-mvp/src/app/vision.ts#L308). Auto-match at ≥0.90 — [identify.ts:56](card-db-mvp/src/app/identify.ts#L56).
  - Otherwise it falls back to a filename hint — [vision.ts:331-334](card-db-mvp/src/app/vision.ts#L331). Unmatched uploads become "needs review", not failures — [server.ts:671](card-db-mvp/src/server.ts#L671).
- **Index upkeep.** Built at boot when coverage lags the catalog — [hashindex.ts:126-143](card-db-mvp/src/app/hashindex.ts#L126); after each catalog import — [catalog-import.ts:315-320](card-db-mvp/src/app/catalog-import.ts#L315); and on demand from `/admin/catalog` "Rebuild photo-ID index" — [render/admin.ts:589](card-db-mvp/src/render/admin.ts#L589), [server.ts:1839-1842](card-db-mvp/src/server.ts#L1839). Reference images are TCGplayer CDN 200w images for imported cards — [catalog-import.ts:79-84](card-db-mvp/src/app/catalog-import.ts#L79).
- **Multiple cards per photo.** "Several cards per photo" mode, for binder pages or loose cards on a plain background — [render/app.ts:1639](card-db-mvp/src/render/app.ts#L1639).
  - Runs on the device: estimate the background from the border, Otsu threshold, erode, label connected blobs, split bridged blobs, keep card-shaped rectangles (~0.71 / ~1.4 aspect). Fewer than two cards found means the whole photo is sent as one card — [render/app.ts:1745-1752](card-db-mvp/src/render/app.ts#L1745).
  - Requires canvas `createImageBitmap` / `toBlob` support — [render/app.ts:1663](card-db-mvp/src/render/app.ts#L1663), [render/app.ts:1678](card-db-mvp/src/render/app.ts#L1678). No server-side detection.
- **Front/back.** "2 images" pairs consecutive photos, with Swap all — [render/app.ts:1679-1682](card-db-mvp/src/render/app.ts#L1679), [render/app.ts:1887-1892](card-db-mvp/src/render/app.ts#L1887), [server.ts:640-650](card-db-mvp/src/server.ts#L640). Only the front is identified. The back is stored as `back_image_url` (condition photo) — [server.ts:664-673](card-db-mvp/src/server.ts#L664). Backs can also be set per item in review — [render/app.ts:783-799](card-db-mvp/src/render/app.ts#L783).
- **Game filter.** The batch's Database value becomes `opts.game` — [server.ts:387-390](card-db-mvp/src/server.ts#L387). It filters text-matcher candidates — [identify.ts:409-410](card-db-mvp/src/app/identify.ts#L409). The hash scan itself is not game-filtered — [vision.ts:140](card-db-mvp/src/app/vision.ts#L140).
- **One Piece numbers.**
  - Parser accepts `OP11-117` / `EB02-005` / `ST01-001` (1–3 letters, 1–2 digits, dash, 3 digits) — [identify.ts:168-175](card-db-mvp/src/app/identify.ts#L168).
  - Sort key is the index after the dash — [util.ts:95-100](card-db-mvp/src/util.ts#L95).
  - Full-string comparison with a partial score for a prefix mismatch — [identify.ts:220-229](card-db-mvp/src/app/identify.ts#L220). Set-prefixed numbers skip set-name detection — [identify.ts:378](card-db-mvp/src/app/identify.ts#L378).
  - Parallel / alternate-art One Piece printings are imported as separate cards with a "(Parallel)"-style name — [catalog-import.ts:21-23](card-db-mvp/src/app/catalog-import.ts#L21).
- **Learning.** None; only an opt-in flag (section 1, #21).
- **Production reality.** Searching the live site for "OP11-117" returns two unrelated #117 cards (Kamigawa "Okiba Reckoner Raid // Nezumi Road Captain" $0.30; Metang Vivid Voltage #117/185 $0.24) — [/search?q=OP11-117](https://tradingcardloader.com/search?q=OP11-117). The plan doc records the client's Sept 14 live test of 15 scans as all Unmatched for the same reason — [plan §1c](client-video-2026-09-14-asks-and-plan.md).
- The plan itself states hashing "is fragile to glare, tilt and cropping on phone shots at 20k+ cards" and that embeddings (CLIP → pgvector) are the durable fix — [plan §3 Tier 3 #15](client-video-2026-09-14-asks-and-plan.md).

### Inferences
- **Game filter can backfire.** Because the hash scan ignores the game, a Pokémon-batch photo whose nearest hash is a One Piece card produces a One Piece hint that the game filter then discards. The item drops to text matching or review instead of the right Pokémon card. Worth a fix: filter the hash index by game.
- **Scanner margins.** The inset crop is only 8%. The client uses a scanner (file names like `20260914204009_0001.jpg`), and scans with wide margins or a colored bed could miss unless cards fill the frame. There is no auto-trim in 1-image mode, since the client chose to skip auto crop.
- **Promo numbers.** Numbers like "P-001" don't fit the set-prefixed regex and would fall through to a bare "001". Minor for singles, but notable for promos.
- **Scaling.** The per-photo cost is a full linear scan of the index. With the full catalogs (the plan estimates ~20k Pokémon cards plus One Piece), this scales linearly. No measurement was found in the repo.

### Gaps
- No accuracy numbers on real phone or scanner photos across the full catalogs. The plan cites 500/500 on catalog images of 607 distinct cards (Sept 13), which says little about the full catalogs.
- Production `VISION_PROVIDER` was verified Sept 13, not today. Public pages can't show it.

---

## 5. eBay: mock vs. real keys, feature by feature; CSV vs. Seller Hub template

### Takeaway
All eBay features have a mock path (`EBAY_MOCK=1` or the console toggle). With real keys, the Browse API ("eBay Listed" popup, "Live on eBay" panel) needs only app keys and **is working on production now with real listings**. Connect, policies, publish and orders additionally need a RuName and a connected seller. The Inventory-API publish and the CSV both lack eBay's trading-card **condition descriptors**, and store categories are a typed id only (no sync, not sent via API).

### Cited Findings
- **Configuration source.** Owner-console values in the `meta` table override env — [ebay-config.ts:1-12](card-db-mvp/src/app/ebay-config.ts#L1), [ebay-config.ts:81-93](card-db-mvp/src/app/ebay-config.ts#L81). `ebayConfigured()` means mock mode or client id + secret — [ebay.ts:53-56](card-db-mvp/src/ebay.ts#L53). `ebaySellConfigured()` also needs the RuName — [ebay-sell.ts:40-43](card-db-mvp/src/app/ebay-sell.ts#L40).
- **Browse API (listed lookups).** App token via client_credentials — [ebay.ts:62-76](card-db-mvp/src/ebay.ts#L62). Search with a 10-minute cache — [ebay.ts:86-146](card-db-mvp/src/ebay.ts#L86). Mock returns canned "mock listing" rows — [ebay.ts:101](card-db-mvp/src/ebay.ts#L101), [ebay.ts:164-184](card-db-mvp/src/ebay.ts#L164).
- **Browse API on production.** `/api/ebay/listed?card=4&limit=5` returned `configured: true` and 5 real listings, e.g. item 227542012200, seller "phantomich", $281.20 + $1.49 shipping, "Best Offer". Item URLs carry no affiliate campaign — [prod API](https://tradingcardloader.com/api/ebay/listed?card=4&limit=5). The public card page shows the "Live on eBay" panel ("Load live listings"), which renders only when `ebayConfigured()` is true — [/c/charizard-4-102-4](https://tradingcardloader.com/c/charizard-4-102-4), [render/pages.ts:507-511](card-db-mvp/src/render/pages.ts#L507).
- **OAuth connect.** Scopes api_scope, sell.inventory, sell.account, sell.fulfillment, commerce.identity.readonly — [ebay-sell.ts:30-35](card-db-mvp/src/app/ebay-sell.ts#L30). Mock short-circuits the consent step and tokens — [ebay-sell.ts:218](card-db-mvp/src/app/ebay-sell.ts#L218), [ebay-sell.ts:250](card-db-mvp/src/app/ebay-sell.ts#L250), [ebay-sell.ts:264](card-db-mvp/src/app/ebay-sell.ts#L264). Callback syncs policies and starts the sold harvest — [server.ts:2267-2296](card-db-mvp/src/server.ts#L2267).
- **Business policies.** Account API fulfillment / payment / return; mock returns canned policies — [ebay-sell.ts:332-341](card-db-mvp/src/app/ebay-sell.ts#L332). Ship-from location via the Inventory API — [ebay-sell.ts:379-388](card-db-mvp/src/app/ebay-sell.ts#L379).
- **Inventory API listing.**
  - Pre-flight checks title ≤80, SKU, price, qty, category, https image, policies, location — [ebay-sell.ts:415-465](card-db-mvp/src/app/ebay-sell.ts#L415).
  - Publish creates the inventory item, then the offer, then publishes; Revise and End exist; mock marks rows published — [ebay-sell.ts:479-554](card-db-mvp/src/app/ebay-sell.ts#L479). The scheduler publishes due listings every 60 s — [ebay-sell.ts:137-155](card-db-mvp/src/app/ebay-sell.ts#L137).
  - The inventory item sends `condition: LIKE_NEW` (graded) or `USED_VERY_GOOD` (ungraded) and **no `conditionDescriptors`** — [ebay-sell.ts:502-506](card-db-mvp/src/app/ebay-sell.ts#L502).
  - The offer has no store-category field — [ebay-sell.ts:508-528](card-db-mvp/src/app/ebay-sell.ts#L508).
- **eBay's requirement.**
  - eBay's `createOrReplaceInventoryItem` docs (as surfaced in search) say the ConditionDescriptors container "must be used to provide applicable information about Graded and Ungraded single trading cards" — [eBay createOrReplaceInventoryItem](https://entwickler.ebay.de/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem).
  - New CCG single listings must use condition 2750 (Graded) or 4000 (Ungraded) — [eBay listing creation guide](https://developer.ebay.com/develop/guides/sell/listing-creation).
  - Descriptor ids come from the Metadata API `getItemConditionPolicies` — [eBay ItemConditionDescriptor](https://developer.ebay.com/api-docs/sell/metadata/types/sel:ItemConditionDescriptor).
- **Store categories.** Free-text numeric id in settings and per batch — [render/app.ts:1445](card-db-mvp/src/render/app.ts#L1445), [render/app.ts:640](card-db-mvp/src/render/app.ts#L640). It rides only in the CSV `StoreCategory` column — [exporters.ts:203](card-db-mvp/src/app/exporters.ts#L203), [exporters.ts:211](card-db-mvp/src/app/exporters.ts#L211). No GetStore / CustomCategories call exists in [ebay-sell.ts](card-db-mvp/src/app/ebay-sell.ts).
- **Sold lookups.** No eBay sold API is used. The "eBay sold" link-out opens eBay's completed search — [affiliate.ts:86-104](card-db-mvp/src/affiliate.ts#L86). The archive is fed by connected sellers' own paid orders via the Fulfillment API: 730-day backfill, every 6 h, mock rows flagged demo — [soldharvest.ts:26-27](card-db-mvp/src/app/soldharvest.ts#L26), [soldharvest.ts:56-77](card-db-mvp/src/app/soldharvest.ts#L56), [soldharvest.ts:113-133](card-db-mvp/src/app/soldharvest.ts#L113), [ebay-sell.ts:656-682](card-db-mvp/src/app/ebay-sell.ts#L656). Production `/sales` shows "No archived sales" — [/sales](https://tradingcardloader.com/sales).
- **Order pulls.** Open orders — [ebay-sell.ts:596-614](card-db-mvp/src/app/ebay-sell.ts#L596). Mark shipped with tracking — [ebay-sell.ts:712-716](card-db-mvp/src/app/ebay-sell.ts#L712). Quantity sync — [ebay-sell.ts:562-572](card-db-mvp/src/app/ebay-sell.ts#L562). The Orders page is hidden unless `ORDERS_ENABLED=1` (section 1, #3).
- **Marketplace Account Deletion.**
  - `GET /ebay/account-deletion?challenge_code=` returns SHA-256(code + token + endpoint) — [server.ts:1310-1315](card-db-mvp/src/server.ts#L1310), [ebay-deletion.ts:103-110](card-db-mvp/src/app/ebay-deletion.ts#L103).
  - POST verifies `X-EBAY-SIGNATURE` against eBay's Notification API public key, which needs an app token — [ebay-deletion.ts:123-141](card-db-mvp/src/app/ebay-deletion.ts#L123).
  - It deletes the matching `ebay_connections` and nulls the buyer and ship-to on orders — [ebay-deletion.ts:192-210](card-db-mvp/src/app/ebay-deletion.ts#L192).
  - The endpoint URL honors `APP_BASE_URL` / `X-Forwarded-Proto` / `EBAY_DELETION_ENDPOINT` — [ebay-deletion.ts:94-105](card-db-mvp/src/app/ebay-deletion.ts#L94). The token is shown in `/admin/ebay` — [render/admin.ts:709](card-db-mvp/src/render/admin.ts#L709).
  - Deployed on production: a bare GET returns HTTP 400, the missing-challenge branch, not 404 — [/ebay/account-deletion](https://tradingcardloader.com/ebay/account-deletion).
- **CSV columns produced** — [exporters.ts:202-216](card-db-mvp/src/app/exporters.ts#L202):
  - Header: `*Action(SiteID=US|Country=US|Currency=USD|Version=1193)`, `CustomLabel`, `*Category`, `StoreCategory`, `*Title`, `*Description`, `*ConditionID`, `PicURL`, `*Format`, `*Duration`, `*StartPrice`, `BestOfferEnabled`, `*Quantity`, `*Location`, `ShippingProfileName`, `ReturnProfileName`, `PaymentProfileName`, then `C:<item specific>` columns.
  - Values: Action `Add`; ConditionID `2750` if graded, else `4000`; Format `FixedPrice` / `Auction`; Duration `GTC` or `Days_N`; BestOfferEnabled `1` / `0`; Location defaults to "United States".
  - Category comes from the game map (183454 Pokémon / One Piece, 38292 Magic) — [listing.ts:18-26](card-db-mvp/src/app/listing.ts#L18).
- **Seller Hub trading-card descriptor columns.** For ungraded cards (ConditionID 4000) the header is `CD:Card Condition - (ID: 40001)` with named values (e.g. "Near mint or better"; CCG adds Lightly / Moderately / Heavily played). For graded cards (2750) the headers are `CD:Professional Grader - (ID: 27501)`, `CD:Grade - (ID: 27502)` and `CDA:Certification Number - (ID: 27503)` — [ShipScript 2024 condition descriptors](https://shipscript.com/ebayhelp/sellerhub/example_card_revisions.htm). Community threads show upload errors tied to these descriptors — [eBay Community: descriptor not valid for 40001](https://community.ebay.com/t5/Seller-Tools/error-message-Error-The-Condition-descriptor-Near-Mint-or-Better/m-p/34228025/highlight/true).

### Inferences
- **CSV vs template.** Our CSV matches the File Exchange / Seller Hub flat-file layout for the core columns and gets ConditionID right (2750 / 4000). It does **not** carry the `CD:` / `CDA:` descriptor columns eBay's trading-card condition model uses, so rows may be rejected or land with incomplete condition data. The same gap on the API side will likely make `publishListing` fail for CCG singles. Both are small, well-defined fixes, and the first real upload with the client's account is the test.
- **Store category.** A batch's store category reaches eBay only through the CSV path, never through API publish.

### Gaps
- Whose keyset is live on production (the developer's or the client's) and whether a RuName is configured can't be determined from public pages. `/admin/ebay` would show it.
- eBay's docs pages rendered as navigation shells in WebFetch, so "required" for `conditionDescriptors` rests on eBay doc excerpts surfaced by search, not a full-page read. Whether Seller Hub hard-rejects rows missing `CD:Card Condition` is unverified.
- The exact current Seller Hub template header string (e.g. whether `|CC=UTF-8` is expected in the Action cell) was not verified against a freshly downloaded template.

---

## 6. Plans and paywall

### Takeaway
Two tiers: Free and Pro at **$15/month**, hard-coded. Pro gates everything under `/app` that adds stock, lists or exports. **There is no payment integration at all**: no Stripe code, no env var, no webhook. Pro is granted by hand from a CLI script or the owner console. Signed-in Free users see a disabled "Subscribe" button, but logged-out visitors see "$15/month · cancel anytime".

### Cited Findings
- Price constants `PRO_PRICE_CENTS = 1500`, "$15", "month" — [billing.ts:17-19](card-db-mvp/src/app/billing.ts#L17). Stripe Checkout + webhook is "the next seam"; Pro is "granted operationally" — [billing.ts:8-12](card-db-mvp/src/app/billing.ts#L8), [billing.ts:33-39](card-db-mvp/src/app/billing.ts#L33). A grep of `src` for stripe / checkout finds only comments and copy.
- **Free surface:** `/app` dashboard, `/app/scan` (price-only outcome), pricing tool and uploads, card search, sales lookup, inbox, every `/app/settings/*` page, priced lists and share links. Everything else under `/app` redirects to `/pricing?upgrade=1` — [server.ts:1979-1985](card-db-mvp/src/server.ts#L1979), [server.ts:1995-2021](card-db-mvp/src/server.ts#L1995).
- Starting an inventory upload on Free returns 402 — [server.ts:2089-2096](card-db-mvp/src/server.ts#L2089). Paste gating — [server.ts:2126-2130](card-db-mvp/src/server.ts#L2126). Sidebar "Pro" markers — [render/app.ts:104-106](card-db-mvp/src/render/app.ts#L104).
- Per-batch photo cap is 100 on Free and 500 on Pro — [render/app.ts:1631](card-db-mvp/src/render/app.ts#L1631) (constants in upload.ts). CSV exports (`/app/export/*.csv`) are not in the Free list, so they are Pro — [server.ts:2066](card-db-mvp/src/server.ts#L2066), [server.ts:1995-2010](card-db-mvp/src/server.ts#L1995).
- **Granting Pro:** `npm run grant-pro -- <email>` — [scripts/grant-pro.ts:2](card-db-mvp/src/scripts/grant-pro.ts#L2), or the owner-console plan toggle — [server.ts:1857-1873](card-db-mvp/src/server.ts#L1857). Accounts that existed when the paywall shipped were grandfathered to Pro once — [billing.ts:48-55](card-db-mvp/src/app/billing.ts#L48). Owner mode bypasses the paywall — [server.ts:399-401](card-db-mvp/src/server.ts#L399).
- **Pricing page:** signed-in Free users see a disabled "Subscribe — $15/month" and "Secure online checkout is coming soon — contact us" — [render/pricing.ts:64-72](card-db-mvp/src/render/pricing.ts#L64). Logged-out production view: Free "$0/ forever", Pro "$15/ month", CTA "Create your account", note "$15/month · cancel anytime" — [/pricing](https://tradingcardloader.com/pricing). The Configuration "Your plan" tile says "Billing management is coming soon" — [render/app.ts:1291](card-db-mvp/src/render/app.ts#L1291).
- The client asked for $7–10/month; the plan lists the price as an open question — [plan §1 #28, §4 Q6](client-video-2026-09-14-asks-and-plan.md).

### Inferences
- Moving to $7–10 is a one-constant change. The real work is Stripe (Checkout, customer portal, webhook calling `setPlanTier`), which the plan estimates at 1–2 days. The public page's "cancel anytime" promises self-serve cancellation that doesn't exist yet.

### Gaps
- None; fully visible in code and on the public page.

---

## 7. What production shows publicly today

### Takeaway
tradingcardloader.com is live with the seller-era public site, the new `/privacy` page, the account-deletion endpoint and the `2c10f81` link-out changes, plus a **working eBay Browse keyset**. The catalog is still the **607-card demo** (Pokémon Base + Vivid Voltage, Magic Kamigawa: Neon Dynasty). **No One Piece** and no full Pokémon import.

### Cited Findings
- **Home.** Title "CardIndex — scan, price & list your trading cards", hero "Scan once. List everywhere.", "Backed by a live price catalog of 607 cards", "Pokemon & Magic today"; the footer includes a Privacy link — [tradingcardloader.com](https://tradingcardloader.com/).
- **Browse.** Pokémon has 2 sets (Vivid Voltage 2020, Base 1999) and Magic has 1 (Kamigawa: Neon Dynasty 2022); One Piece is absent — [/browse](https://tradingcardloader.com/browse). `/g/onepiece` returns 404 — [/g/onepiece](https://tradingcardloader.com/g/onepiece).
- **Sitemap.** About 607 URLs; game pages only `/g/pokemon` and `/g/mtg`; 3 set pages. Every `<loc>` uses `http://` rather than https — [/sitemap.xml](https://tradingcardloader.com/sitemap.xml). The sitemap and robots are built from `url.origin` — [server.ts:1293-1305](card-db-mvp/src/server.ts#L1293).
- **Search** for "OP11-117" returns 2 unrelated #117 cards — [/search?q=OP11-117](https://tradingcardloader.com/search?q=OP11-117).
- **Card page (Charizard Base 4/102):** eBay listed / sold links use the new category-183454 name + number query with no `campid`; a "Live on eBay" panel is present; no "View on TCGplayer" button; no "TCGplayer by condition" panel; demo-data notices; no EPN disclosure — [/c/charizard-4-102-4](https://tradingcardloader.com/c/charizard-4-102-4).
- **Live listings API** returns real eBay listings — [/api/ebay/listed](https://tradingcardloader.com/api/ebay/listed?card=4&limit=5).
- **Sales lookup:** "No archived sales — The archive grows as connected sellers' eBay sales come in and with every imported feed", plus a demo-data footer — [/sales](https://tradingcardloader.com/sales).
- **Privacy:** HTTP 200, "Privacy policy | Trading Card Loader", last updated September 28, 2026. Covers deletion notices and the buyer ship-to data kept on pulled orders — [/privacy](https://tradingcardloader.com/privacy).
- **Pricing:** $15 Pro, "cancel anytime" — [/pricing](https://tradingcardloader.com/pricing).
- **Account-deletion endpoint** is deployed (HTTP 400 on a bare GET) — [/ebay/account-deletion](https://tradingcardloader.com/ebay/account-deletion).

### Inferences
- **The catalog import has not been run on production.** Consequences:
  - The Database select there shows One Piece as a disabled "coming soon" ([render/app.ts:65](card-db-mvp/src/render/app.ts#L65)).
  - The photo-ID index covers only the demo cards.
  - TCGplayer product links are missing on demo cards.
- The fix is an owner action in `/admin/catalog` (import Pokémon, then One Piece; the hash index builds afterward, [catalog-import.ts:315-320](card-db-mvp/src/app/catalog-import.ts#L315)). No deploy is needed.
- The absent TCGplayer button on demo cards suggests `sync:tcgcsv` has never linked products on the production database, consistent with the memory note that the production DB is internal-only and CLI scripts can't reach it.
- Brand naming is split between "CardIndex" (home title) and "Trading Card Loader" (privacy title). That's a wording issue for the UI-copy researcher.

### Gaps
- Logged-in pages weren't checked (no sign-in), so workspace state, `/admin/catalog` progress and Connect-eBay readiness are unknown.

---

## 8. Configuration prerequisites referenced in code but likely unset

### Takeaway
Confirmed unset on production (from public evidence): **EBAY_EPN_CAMPID** (or its console equivalent) and **TCGPLAYER_AFFILIATE_QS**, TCGplayer API keys, and any Stripe setting (none exists in code). Confirmed set: an eBay Browse keyset (env or console). Unknown from outside, likely still unset: **EBAY_RU_NAME**, **MAIL_PROVIDER / RESEND_API_KEY / MAIL_FROM / APP_BASE_URL**, **ORDERS_ENABLED** (deliberately off), **CERT_PROVIDER** (no real provider exists).

### Cited Findings

| Setting | Read at | Effect when unset | Production status |
|---|---|---|---|
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` (or console) | [ebay-config.ts:54-64](card-db-mvp/src/app/ebay-config.ts#L54) | Browse popup / panel hidden | **Set**: real listings returned — [prod API](https://tradingcardloader.com/api/ebay/listed?card=4&limit=5) |
| `EBAY_RU_NAME` | [ebay-config.ts:58](card-db-mvp/src/app/ebay-config.ts#L58), [ebay-sell.ts:40-43](card-db-mvp/src/app/ebay-sell.ts#L40) | "Connect eBay" says not configured ([server.ts:2263-2265](card-db-mvp/src/server.ts#L2263)) | Unknown |
| `EBAY_MOCK` | [ebay-config.ts:61](card-db-mvp/src/app/ebay-config.ts#L61) | — | Off now (real results); was on during Sept 28 per `e372c01` message |
| `EBAY_EPN_CAMPID` (or console `epn_campid`) | [ebay-config.ts:62-69](card-db-mvp/src/app/ebay-config.ts#L62), [affiliate.ts:22](card-db-mvp/src/affiliate.ts#L22) | eBay links untagged, no disclosure | **Unset**: prod links carry no `campid` and no disclosure appears ([/c/charizard-4-102-4](https://tradingcardloader.com/c/charizard-4-102-4)) |
| `TCGPLAYER_AFFILIATE_QS` | [affiliate.ts:32](card-db-mvp/src/affiliate.ts#L32), [affiliate.ts:117](card-db-mvp/src/affiliate.ts#L117) | TCGplayer links untagged | **Unset**: the disclosure would also appear if this alone were set ([affiliate.ts:106-116](card-db-mvp/src/affiliate.ts#L106)); none on card page or `/sales` |
| `EBAY_DELETION_TOKEN` / `EBAY_DELETION_ENDPOINT` / `APP_BASE_URL` | [ebay-deletion.ts:90-105](card-db-mvp/src/app/ebay-deletion.ts#L90) | Token auto-generated; endpoint derived from the forwarded host / proto | Endpoint live (400 on bare GET) |
| `MAIL_PROVIDER` / `RESEND_API_KEY` / `MAIL_FROM` | [mailer.ts:14-41](card-db-mvp/src/app/mailer.ts#L14), [.env.example:166-176](card-db-mvp/.env.example#L166) | Reset links only logged to the server console | Unset on Sept 13 per [inventory §14](cardindex-feature-inventory.md); not re-verifiable publicly |
| `ORDERS_ENABLED` | [render/app.ts:161-163](card-db-mvp/src/render/app.ts#L161) | Orders hidden from sidebar | Intentionally off per client |
| `CERT_PROVIDER` | [graded.ts:83-95](card-db-mvp/src/app/graded.ts#L83) | No cert → card lookup (only `mock` exists) | No real provider in code |
| `TCGPLAYER_PUBLIC_KEY` / `PRIVATE_KEY` | [tcgplayer.ts:25-28](card-db-mvp/src/tcgplayer.ts#L25) | No per-condition prices | Unset (no condition panel on prod card page; program closed per [.env.example:141-151](card-db-mvp/.env.example#L141)) |
| `VISION_PROVIDER` | [vision.ts:259](card-db-mvp/src/app/vision.ts#L259) | Default `none` = filename hints only | `hash` per Sept 13 check |
| `COOKIE_SECURE`, `ADMIN_EMAIL` / `ADMIN_PASSWORD`, `DATABASE_URL`, `S3_*` / `STORAGE_DRIVER` | [auth.ts:264](card-db-mvp/src/app/auth.ts#L264), [admin.ts:61](card-db-mvp/src/app/admin.ts#L61), [storage.ts:116-147](card-db-mvp/src/storage.ts#L116) | — | Set per Sept 13 check; site works |
| Stripe (any) | none in code | No checkout | Not implemented |

### Inferences
- Launch-blocking configuration still owed by the client:
  - EPN campaign id (pasteable in `/admin/ebay`, [render/admin.ts:633-634](card-db-mvp/src/render/admin.ts#L633)).
  - TCGplayer/Impact query string (env only).
  - A RuName on the production keyset, with the privacy URL, if Connect is wanted.
- Owed by the operator: Resend email, a production catalog import, and a recurring price refresh (none is scheduled in-process).

### Gaps
- Railway variables weren't read (no CLI access used, per constraints). Rows marked Unknown need a `railway variables` check or a look at `/admin/ebay`.

---

## 9. Stale or wrong claims in the Sept 13 inventory and the plan doc

### Takeaway
The Sept 13 inventory is largely obsolete in both directions. Its "superseded by the buyer overhaul" banner is itself superseded, and several ⛔/🟡 rows are now built or live. The plan doc's §2 table and parts of §3 are Sept 19 snapshots. It also overstates two things: that the eBay Listed popup waits on the client's keyset (a keyset is already live) and that opt-in "already logs" confirmed matches (nothing logs them). It also records the catalog import as built, which is true only in code; production still has the demo catalog.

### Cited Findings

**Plan doc (`client-video-2026-09-14-asks-and-plan.md`)**
- §0, §4 Q3 and Tier 3 #16 say the eBay Listed popup needs the client to obtain a production keyset. **Stale:** production already returns real Browse-API listings — [prod API](https://tradingcardloader.com/api/ebay/listed?card=4&limit=5).
- Tier 2 #12: "Blocked only on the client's eBay developer keyset". **Wrong:** eBay store-category sync isn't built at all; there is no GetStore call in [ebay-sell.ts](card-db-mvp/src/app/ebay-sell.ts).
- Tier 3 #15: "training opt-in already logs them". **Wrong:** only the flag is stored ([server.ts:1157](card-db-mvp/src/server.ts#L1157)) and nothing reads it for matching.
- §3 status note and §1c: "Tier 3 item 14 is built". True in code, but the import **has not been run on production** (3 sets, no One Piece) — [/browse](https://tradingcardloader.com/browse). The §1c action "Run the catalog import on production" is still open.
- §2 table ("In the current tree (buyer build)") is a Sept 19 snapshot. Now built: SKU prefix / increment, start price, floor, previous-price memory, title, CSV, inventory, OAuth / policies, config tabs, affiliate tagging, front/back pairing, Best Offer, bulk renumber, One Piece / full-Pokémon import code. Still true: Stripe ❌, TCGplayer NM/LP/MP/HP ❌, store-category sync ❌ — [render/app.ts](card-db-mvp/src/render/app.ts), [catalog-import.ts](card-db-mvp/src/app/catalog-import.ts).
- §2 row "Binder-page multi-card detection — uncommitted work in `render/collection.ts`". **Stale:** collection.ts was deleted in `2a1ec43`; the detector lives in the render/app.ts dropzone ([render/app.ts:1745-1752](card-db-mvp/src/render/app.ts#L1745)). The old WIP is only in `stash@{0}`.
- §1b rows now superseded by `2c10f81`:
  - Results header "✖ totals row" → built ([render/app.ts:989-1002](card-db-mvp/src/render/app.ts#L989)).
  - eBay Listings popup "✖ editable query" → built ([render/app.ts:2024-2029](card-db-mvp/src/render/app.ts#L2024)).
  - Inventory now has the summary line ([render/app.ts:494](card-db-mvp/src/render/app.ts#L494)).
  - Only the 74/80 wording was corrected in §1b.
- Tier 1 #2 "start price $0.99 for eBay-platform batches". **Partly inaccurate:** the floor falls back to 99¢ ([pricing.ts:86-88](card-db-mvp/src/app/pricing.ts#L86)), but the start-price field is blank by default ([render/app.ts:636](card-db-mvp/src/render/app.ts#L636)).
- §1b "eBay integration in the owner console (Sept 20)". The commit is dated Sept 21 10:39 — [git log](git:25d64f6) (minor).

**Sept 13 inventory (`cardindex-feature-inventory.md`)**
- Banner "Superseded (Sept 14)… replaced the /app workspace with /collection". **Reversed** on Sept 19: `/app` restored and `/collection` deleted in `2a1ec43` — [git log](git:2a1ec43).
- §1 "Live on eBay 🟡 … panel hidden until then" and §14 #4 "No eBay keys anywhere". **Stale:** panel live with real keys on prod — [/c/charizard-4-102-4](https://tradingcardloader.com/c/charizard-4-102-4).
- §3 and §14 "Binder-page / multi-card detection ⛔". **Stale:** built (client-side) — [render/app.ts:1639](card-db-mvp/src/render/app.ts#L1639).
- §4 "Bulk edit across the batch ⛔". **Stale:** batch tools exist — [render/app.ts:1005-1019](card-db-mvp/src/render/app.ts#L1005).
- §7 "best-offer %, store categories sync … ⛔". Partly stale: Best Offer on/off built ([store.ts:74-75](card-db-mvp/src/app/store.ts#L74)); % and sync still missing.
- §7 eBay CSV description: now adds `StoreCategory` / `BestOfferEnabled` columns and CU-style file names — [exporters.ts:202-206](card-db-mvp/src/app/exporters.ts#L202), [server.ts:1217-1226](card-db-mvp/src/server.ts#L1217).
- §9 Settings as tabs on one page. **Stale:** now a tile hub with one page per section at `/app/settings/<key>` — [render/app.ts:1224-1308](card-db-mvp/src/render/app.ts#L1224).
- §12 `sync:tcgcsv` "Pokémon + MTG only" and `seed` as the catalog path. **Stale:** onepiece mapping and the TCGCSV importer added in `25d64f6` — [git log](git:25d64f6), [catalog-import.ts:1-23](card-db-mvp/src/app/catalog-import.ts#L1).
- §8 / §15 Orders as a visible sidebar feature. **Stale:** hidden unless `ORDERS_ENABLED` — [render/app.ts:161-174](card-db-mvp/src/render/app.ts#L161).
- §3 "production runs `none`" was already contradicted by its own §14 (hash set Sept 13) — [cardindex-feature-inventory.md §14](cardindex-feature-inventory.md).
- Still accurate: Stripe not built; the Subscribe button is disabled for signed-in users ([render/pricing.ts:71-72](card-db-mvp/src/render/pricing.ts#L71)); cert lookup has no real provider ([graded.ts:83-95](card-db-mvp/src/app/graded.ts#L83)); demo data on card pages ([/c/charizard-4-102-4](https://tradingcardloader.com/c/charizard-4-102-4)).

**Stale copy inside the app itself** (for the UI-wording researcher)
- Scan page aside says binder detection isn't available and "today each photo is treated as one card" — [render/app.ts:729](card-db-mvp/src/render/app.ts#L729). It also calls reading cards from pixels "the remaining seam" — [render/app.ts:737](card-db-mvp/src/render/app.ts#L737).
- Dashboard help calls eBay publishing the "next integration" — [render/app.ts:281](card-db-mvp/src/render/app.ts#L281).
- Dashboard Orders tile ignores `ORDERS_ENABLED` — [render/app.ts:251](card-db-mvp/src/render/app.ts#L251).
- Public pricing page advertises "AI card identification" and "cancel anytime" — [/pricing](https://tradingcardloader.com/pricing).

### Inferences
- A fresh inventory should replace the Sept 13 document rather than patch it. The most consequential corrections for the client conversation:
  1. The eBay Listed popup is already live on production.
  2. The full catalogs exist in code but not on the live site.
  3. "Learns over time" isn't started.
  4. API listing and CSV both need trading-card condition descriptors before real eBay uploads.

### Gaps
- Claims about test pass counts in both documents (178/180; 37/37; 29/29; 8/8; 27 checks) weren't re-verified (no test runs allowed).
