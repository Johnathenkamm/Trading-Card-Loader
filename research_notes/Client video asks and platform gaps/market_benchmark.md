# Market benchmark: seller tools for ungraded Pokémon and One Piece singles (as of Sept 28, 2026)

Scope: tools that help sellers of ungraded TCG singles scan/identify, price, list, crosslist and manage inventory/orders on eBay and other channels, benchmarked against the client's asks (Pokémon first, One Piece second; eBay CSV to Seller Hub as the main listing path, API "eventually"; no order handling yet; $7–10/month; scanning is a go/no-go).

Method: vendor pricing, help and feature pages plus App Store listings fetched on Sept 28, 2026. CardUploader was rendered live in the built-in browser on Sept 28, 2026 (pricing, home, FAQ, guides, /sales) and compared with the local reports (Aug 23, Sept 1, Sept 3, Sept 8, Sept 13, and the Sept 14 client-video notes). YouTube metadata, comments and one transcript were read in the browser. **Access limits:** Reddit was blocked for the web-search and fetch tools and for the in-app browser, and Discord servers can't be read without an account, so community sentiment comes from App Store reviews, forums (Elite Fourum, eBay Community, Blowout via an aggregator), YouTube, and vendor pages. Facts reused from the local reports without re-checking them are labelled *(local report, not re-checked)*. Unless another date is given, every price below was checked on **Sept 28, 2026**.

---

## Q1. Which tools compete in this space in 2026, and what does each offer (scan/ID, pricing data, listing, crosslisting, inventory sync/delisting, orders, labels, analytics)?

### Takeaway
The market splits into four groups:
1. **Dedicated scan-to-list tools** (CardUploader, TCG Automate, Card Dealer Pro, CardLuma, Kronozio NEXT, plus newer entrants). All of them identify cards from photos or scans, price from TCGplayer-style market data, and list through an eBay CSV and/or the eBay API. Live multi-channel inventory sync with auto-delist is now where they compete.
2. **Marketplaces' own tools.** The most important is **eBay's free, unlimited in-app Price Guide**, which scans Pokémon (English and Japanese) and One Piece cards, shows two years of eBay sold comps including Best Offer prices, and can start a listing draft.
3. **Collector scan-and-price apps** (Collectr, Ludex, CollX, a crop of One Piece apps). They make scan-and-price a commodity, but mostly don't do bulk eBay listing.
4. **Generic crosslisters** (Vendoo, List Perfectly, Crosslist). They sync and auto-delist across marketplaces but have no card identification or card pricing.

### Cited Findings

#### A. Dedicated scan → price → list tools (closest to the client's product)

**CardUploader** (full teardown in the local reports; Sept 28 state below; changes are covered in Q5)
- Scan/ID: photo or scanner images, 1–12 images per card, front/back, auto-crop, matching templates; claims over 95% accuracy on standard English and Japanese cards; supports "over 50 TCGs" (FAQ) and "45+ TCG databases" (homepage) — [FAQ](https://carduploader.com/guides/faq), [home](https://carduploader.com/), [getting started](https://carduploader.com/guides/getting-started) (rendered Sept 28, 2026).
- Pricing data: TCGplayer and eBay "live market prices", memory of previous prices; graded via Alt value, CardLadder and eBay — [home](https://carduploader.com/). In-app pricing is TCGplayer market × multiplier plus an active-listings "eBay Listed" popup; "eBay Sold" only opens eBay — [local Aug 23 report §3.5](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md) *(local report, not re-checked)*.
- Listing: eBay CSV (fixed/auction/variation), **List on eBay via API** with a review dialog and per-card errors, TCGplayer CSV (incl. per-card SKU version), Mana Pool CSV, Shopify product/inventory CSV, Whatnot CSV, Cardmarket via TCGPowerTools (beta), Tradera XLSX, MercadoLibre CSV, Trade Me via Tradevine CSV — [getting started](https://carduploader.com/guides/getting-started).
- Crosslisting / sync / delist: **Automatic Inventory** lists, updates quantity and price, delists and pulls orders for eBay, Mana Pool and Misprint; "one stock on all three at once" (beta) — [getting started](https://carduploader.com/guides/getting-started), [cross-listing guide](https://carduploader.com/guides/cross-listing), [Misprint guide](https://carduploader.com/guides/automatic-misprint-inventory).
- Orders: eBay, Mana Pool, Misprint and storefront orders on one page with per-copy pick suggestions; TCGplayer via pull-sheet upload; picklist CSV — [getting started](https://carduploader.com/guides/getting-started). No shipping labels found in the docs.
- Other: storefront + buylist (beta, per-account), graded cert lookup (PSA/CGC/BGS/TAG/ACE), Create Lot, Convert to Playset, Check eBay Duplicates — [getting started](https://carduploader.com/guides/getting-started), [storefront/buylist guide](https://carduploader.com/guides/storefront-buylist).

**TCG Automate**
- Six tiers metered by scans (500 → 30,000/month) with rollover. Standard+ adds PSA and CGC listings with cert lookup. **Pro+ ($40) adds cross-listing to eBay and Shopify, automated managed inventory for API-listed batches, and automated repricing (beta)**. All tiers mention eBay, TCGplayer, Shopify, Square and Whatnot listing support — [pricing](https://www.tcgautomate.com/pricing).
- Models trained on English and Japanese Pokémon sets; the docs don't name the pricing source ("market-aware pricing") — [Japanese Pokémon docs](https://www.tcgautomate.com/docs/tcgs/pokemon-japan).
- eBay CSVs carry item specifics (set, game, rarity, number) and honor policy profiles (vendor blog, Aug 25, 2025) — [TCG Automate blog](https://www.tcgautomate.com/blog/card-dealer-pro-alternative).
- Hardware-sorter CSV connections (CardBot, PhyzBatch, Roca, Magic Sorter) and TCGplayer-market pricing — [local Aug 23 report §6](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md) *(local report, not re-checked)*.
- A seller on X runs TCG Automate with a Ricoh fi-8170 scanner, uploading batches of 200–250 cards — [@SakurasCardShop on X](https://x.com/SakurasCardShop/status/2012900450606211468) (post date not shown).

**Card Dealer Pro (CDP)** (owned by CollX since June 20, 2022 — [Technical.ly](https://technical.ly/startups/collx-acquired-card-dealer-pro/))
- Visual-search AI against a database of 20 million card records; a Windows/Mac desktop scanner app with auto-crop; lists to CollX, eBay, Shopify and Whatnot, plus CSV export; 7-day trial — [carddealerpro.com](https://www.carddealerpro.com/).
- Rival CardLuma (June 2026) credits CDP with up to 70 cards/min on supported scanners, bulk slab cert lookup and marketplace templates, and says CDP's public pages don't document eBay item-specifics depth or scheduling — [CardLuma vs CDP](https://www.cardluma.com/cardluma_vs_carddealerpro.html).
- Help articles cover bulk-listing to Whatnot and bulk-uploading to TCGplayer (file-based) — [CDP: Whatnot](https://support.carddealerpro.com/hc/en-us/articles/39222218298523-Bulk-List-Cards-to-Whatnot-from-Card-Dealer-Pro), [CDP: TCGplayer](https://support.carddealerpro.com/hc/en-us/articles/cdp-136-Bulk-Uploading-Inventory-to-TCGplayer) (titles from search results).
- Pricing is manual ("no pricing intelligence") per the Aug report's secondary source — [local Aug 23 report §6](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md) *(single secondary source, not re-checked)*. Its TCG coverage (Pokémon/One Piece) is not stated on the homepage.

**CardLuma** (new since the August report)
- eBay item-specifics auto-fill (20+ fields), AI card ID, title/description automation, reusable listing rules, **sold-comp pricing**, scheduled listings, inventory, profit tracking; claims "165+ TCG/CCG titles" plus sports; browser batch upload and QR phone upload; **direct eBay publishing + eBay CSV**, plus a Whatnot-ready CSV; page last reviewed June 2026 — [CardLuma vs CDP](https://www.cardluma.com/cardluma_vs_carddealerpro.html), [CardLuma Whatnot page](https://www.cardluma.com/features/whatnot-card-inventory/).
- Creators demo it for Pokémon-to-eBay listing — [YouTube: "List your Pokemon cards to eBay using CardLuma!"](https://www.youtube.com/watch?v=f5LFFislgSo).

**Kronozio NEXT** (formerly Kronocard; long-time sports inventory software)
- Paid plans start at $10/month, tiered by items added per month (500 to 100,000+); 7-day trial for up to 50 items with no card required — [pricing](https://kronozio.com/pricing).
- Claims 92% AI identification accuracy, covers trading cards plus coins, stamps and comics, and advertises order review, shipping management and "AI agents"; publishes a tutorial for migrating from Card Dealer Pro — [kronozio.com](https://kronozio.com/). Covers sports and TCG, and users request missing sets in-app — [AI coverage](https://kronozio.com/ai-coverage).
- Search snippets for the legacy Kronocard claim AI processing takes 30 s to 4 h depending on load, eBay listing of 10,000+ cards at once, and bidirectional eBay sync — [Kronozio search result](https://home.kronozio.com/) *(unverified; the pages now redirect to NEXT)*.

**Smaller or newer entrants seen in 2026**
- **NeoSatoshi:** photo → eBay listing for Pokémon, priced from Cardmarket data plus live competing eBay listings; publishes via the eBay API or a Seller Hub CSV; 14 eBay marketplaces; One Piece tools advertised — [NeoSatoshi](https://neosatoshi.com/ebay-pokemon-card-listing-tool).
- **CardPulse:** collection tool with an AI scanner and an "Export for eBay" CSV (Apr 2026 blog) — [CardPulse](https://www.cardpulse.club/blog/how-to-bulk-list-trading-cards-on-ebay).
- **Double Holo Vendor OS:** the vendor's own 2026 article claims multi-channel sync across Double Holo, Shopify, eBay and TCGplayer, with repricing, price-label printing and QuickBooks — [Double Holo article (search excerpt; page returned 403)](https://doubleholo.com/articles/best-software-for-pokemon-card-sellers).
- **SortSwift:** full shop platform — scanning, POS, buylist, repricer, 9-channel sync, sorter hardware; Free → $499/mo — [sortswift.com](https://sortswift.com/) *(local report, not re-checked)*.
- **SpeedyCardLister:** sports-first, eBay-only; $1 first month, then $5–$125/mo — [speedycardlister.ai](https://speedycardlister.ai/) *(local report, not re-checked)*.
- **RocketVault:** sports bulk lister with inline "attention chip" review; Free/$14.99–$199.99 — [RocketVault blog](https://rocketvault.io/blog/bulk-list-sports-cards-ebay) *(local report, not re-checked)*.
- **Heystack:** device-agnostic capture, credits that never expire — [local Aug 23 report §6](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md) *(local report, not re-checked)*.
- **Stowdesk:** its founder describes it in a YouTube comment as handling cost basis, physical storage, order pulling and realized profit alongside a lister like CardUploader — [comment on ItsPhantomCards video](https://www.youtube.com/watch?v=I6JOS75MT3Y) *(self-promotion; unverified)*.

#### B. Marketplace-native tools

**eBay**
- **Price Guide with card scanning:** covers sports cards plus Pokémon (English and Japanese), MTG, Yu-Gi-Oh!, One Piece and Lorcana. It shows up to two years of eBay sales using Best Offer accepted prices, PSA/CGC pop reports and the Card Ladder Index. A scan identifies raw or graded cards, and from there the user can add the card to My Collection or **start a listing draft in the same flow**. Free with no usage limits; US only on the US page — [pages.ebay.com/price-guide](https://pages.ebay.com/price-guide/).
- **Timeline:** Early Access launched Nov 19, 2025 — [SI](https://www.si.com/collectibles/ebay-introduces-an-all-new-price-guide-for-trading-cards); the first coverage framed it around sports cards — [Sports Collectors Daily headline](https://www.sportscollectorsdaily.com/ebay-launches-new-sports-card-price-guide-feature-for-app-users/). The June 2026 Seller Center news says it is available to all US sellers in the app, with "See insights" on card listings — [eBay Seller Center, June 2026](https://www.ebay.com/sellercenter/news/2026-june/trading-card-price-tool). The UK rollout with the five TCGs began **Sept 1, 2026** — [eBay Inc. UK press release](https://www.ebayinc.com/stories/press-room/uk/ebay-launches-price-guide-for-trading-cards-in-the-uk/).
- **Scan to list** (app only, not desktop or mobile web): creates a pre-filled draft for sports and CCG cards that the seller reviews; up to 24 photos; foils require picking the foil match — [eBay help](https://www.ebay.com/help/selling/listings/creating-managing-listings/scan-list-tool?id=5279). eBay has offered it for MTG/Pokémon/YGO since 2021 (game, title, set, number, rarity pre-filled; seller adds photos, condition and price) — [eBay Inc., Mar 24, 2021](https://www.ebayinc.com/stories/news/new-ebay-scanning-tool-to-cut-listing-time-in-half-for-trading-card-sellers/) *(old)*. One eBay Community user reported the scan button had vanished about nine months before Sept 2026 (relative date only; single report) — [eBay Community](https://community.ebay.com/t5/Ask-a-Mentor/Scan-to-list-tool-is-gone/td-p/35407419/).
- **Upload your collection:** desktop CSV into My Collection, up to 1,000 items, list later — [eBay help (search excerpt; page behind bot check)](https://www.ebay.com/help/selling/trading-cards-listing-tools/upload-collection?id=5290).
- **Bulk CSV (Seller Hub Reports) and condition rules:** since Oct 23, 2023 trading cards use Graded/Ungraded conditions with descriptors — [eBay Seller Center](https://www.ebay.com/sellercenter/selling/what-to-sell/selling-trading-cards). In CSVs, ungraded uses ConditionID 4000 plus a card-condition descriptor, and existing listings had to comply by Jan 22, 2024 — [eBay Community (search excerpt)](https://community.ebay.com/t5/Seller-Tools/How-to-update-Card-Condition-requirements-for-eBay-2023/td-p/34037857). A 2025 post reports bulk uploads failing with "card condition is required" and got no replies — [eBay Community](https://community.ebay.com/t5/Report-eBay-Technical-Issues/Error-for-Conditions-when-bulk-listing-trading-cards/td-p/35141503).
- **Shipping and trust for singles:** eBay Standard Envelope costs $0.63 / $0.87 / $1.11 (1/2/3 oz) with protection for single cards up to $20 and multi-card up to $50; raw and graded cards over $250 go through Authenticity Guarantee — [eBay Seller Center](https://www.ebay.com/sellercenter/selling/what-to-sell/selling-trading-cards) (page partly stale: it still says image scan is MTG/Pokémon/YGO only). Standard Envelope covers raw cards up to 3 oz priced $20 or less — [eBay help](https://www.ebay.com/help/selling/listings/creating-managing-listings/scan-list-tool?id=5279).

**TCGplayer**
- The 2026 seller roadmap (Feb 18, 2026) covers: rebuilding TCGplayer Direct; a Managed Inventory pilot by end of Q2 2026; minimum pricing for low-value cards (already introduced); a per-card fee replacing shipping replacement costs in mid-2026; an inventory import/export and bulk-actions pilot; app scanner usability fixes; Scan & Identify/Roca expanding to more TCGs; richer seller pages; package-forwarder partners in Asia — [TCGplayer blog](https://seller.tcgplayer.com/blog/our-commitment-to-sellers-building-and-delivering-in-2026-and-beyond).
- **Pro** requires Level 4 marketplace sellers (not available to "sync sellers"). It includes Quicklist scanning software, MassPrice scheduled repricing, Scan & Identify (Live Scan, mass image import, bulk actions, batch pricing), an in-store kiosk and a Pro website — [TCGplayer Pro](https://seller.tcgplayer.com/pro).
- Scan & Identify supports MTG, Pokémon, YGO, One Piece and Lorcana — [TCGplayer help (search excerpt; page 403)](https://help.tcgplayer.com/hc/en-us/articles/27302442668695-Scan-Identify-FAQ). App versions below 5.0 were unsupported from March 12, 2026 — [TCGplayer blog (search excerpt)](https://seller.tcgplayer.com/blog/important-update-to-the-tcgplayer-mobile-app).
- The Roca Sifter sorter costs $799 + $25/mo (vendor spec up to 1,800 cards/hr) and requires a TCGplayer seller account — [Nerdbeak](https://www.nerdbeak.com/news/tcgplayer-roca-sifter-card-sorting-robot-march-2026) *(local report, not re-checked)*.
- TCGplayer has **no seller write API for new developers**, so third-party tools feed it by CSV — [local Aug 23 report §8](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md).

**Whatnot**
- CSV import from Seller Hub → Inventory lands as drafts, and each listing needs at least one image before it can be published — [Whatnot help (search excerpt)](https://help.whatnot.com/hc/en-us/articles/7440530071821-Bulk-import-products-from-a-CSV-file). The import is built around a Google Sheets template with up to 8 image URLs per item — [Shelf-Snap guide (search excerpt)](https://shelf-snap.com/resources/whatnot-bulk-upload-csv/).
- June 2024 updates: drafts across web/iOS/Android, QR "mobile capture" of photos into drafts, faster CSV uploads with bulk edit, and private SKU and COGS fields — [Value Added Resource, Jun 7, 2024](https://www.valueaddedresource.net/whatnot-drafts-inventory-dashboard-updates/) *(possibly stale)*.
- Native scanning targets barcodes and graded slabs, not raw cards — [Whatnot help article title](https://help.whatnot.com/hc/en-us/articles/12884437766413-Scan-a-barcode-or-slab-to-list-your-item). Raw-card ID reaches Whatnot through third-party CSVs (CardLuma, CDP, TCG Automate, CardUploader) — sources above.

**Misprint** (new channel relevant to the client)
- A bid/ask marketplace for Pokémon and One Piece. It started with graded cards and now also sells ungraded and sealed — [Misprint bid/ask post](https://www.misprint.com/posts/how-misprint-bid-ask-pricing-works-one-piece), [Misprint best-places post (search excerpt)](https://www.misprint.com/posts/best-places-to-sell-pokemon-cards).
- Fees: 7% commission, falling to as low as 5% through quarterly Seller Rewards, plus 3% + 30¢ processing; shipping fee $2.50 base + $2.50 per graded/sealed item. Five lifetime seller levels, e.g. Level 1 = 500 live asks / $2,500 total value / $1,000 per item — [Misprint seller levels](https://www.misprint.com/help/seller-levels).
- Sellers can create read/write API keys, and CardUploader now syncs to it (Pokémon and One Piece, USD, ungraded only) — [CardUploader Misprint guide](https://carduploader.com/guides/automatic-misprint-inventory).

**Mana Pool**
- Magic-only marketplace (homepage, Sept 28, 2026) with seller API docs — [manapool.com](https://manapool.com/). Fees: 5% marketplace (capped at $50/item) + 2.9% + $0.30 processing — [Mana Pool support (search excerpt)](https://support.manapool.com/hc/en-us/articles/31270101309719-Marketplace-Fees).
- CardUploader's cross-listing notes confirm Mana Pool is Magic-only and US-only — [cross-listing guide](https://carduploader.com/guides/cross-listing).
- Irrelevant to a Pokémon/One Piece seller today.

**CollX marketplace**
- CollX Pro ($9.99/mo) bundles 500 "Scan+" credits, a $10 monthly marketplace credit, Easy Price bulk pricing, featured listings, "who viewed my card", CSV export, unlimited collections (free accounts are capped below 500) and **a free 90-day Card Dealer Pro subscription** — [CollX Pro](https://collx.app/collx-pro).
- Prices come from crawling auction and marketplace sold data, as the median of the last 10 sales within six months, updated daily — [CollX FAQ](https://collx.app/faq).
- The App Store description covers sports plus Pokémon, MTG and One Piece — [App Store](https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444?see-all=reviews).

#### C. Collector scan/price apps (compete for "scan + price", not for bulk listing)
- **Collectr:** free tier with unlimited scanning across 25+ TCGs; Pro adds 5+ years of price history, filters and export; sports "coming soon" — [Collectr Pro](https://getcollectr.com/pro). Scans Pokémon, Magic, YGO, One Piece and Lorcana (+20 more) and has no eBay listing or marketplace-selling features — [getcollectr.com](https://getcollectr.com/). Had 4 million users and eight-figure ARR (Aug 13, 2025) — [BetaKit](https://betakit.com/how-collectr-bootstrapped-a-trading-card-hobby-into-an-eight-figure-business/).
- **Ludex:** scan + price from completed sales, collection, and **eBay listing publishing capped per tier** (Free 5/month, Lite and Standard 50, Pro 250) — [Ludex membership](https://www.ludex.com/membership/), [ludex.com](https://www.ludex.com/).
- **Card Index (cardindex.com):** a Pokémon/One Piece/sports price and valuation site with sold comps, pop counts, a free app and a Sell section — [cardindex.com](https://cardindex.com/). Also a Chrome extension that identifies cards in Whatnot streams and suggests a max bid (free 3 scans/day; Pro unlimited; 351 users; updated Sept 7, 2026; publisher Consultech Ventures LLC) — [Chrome Web Store](https://chromewebstore.google.com/detail/card-index-%E2%80%94-whatnot-card/impoppkbagmiajilcfbnbepdohahjmff).
- **Free scanners proliferating:** Guardian TCG (free, 14+ games incl. One Piece; TCGplayer, eBay and Cardmarket values) — [Guardian TCG (search excerpt)](https://guardiantcg.app/onepiece-card-grading). Shiny (unlimited scanning; Pokémon, One Piece, MTG, YGO, Gundam, Riftbound, Lorcana…) — [Google Play (search excerpt)](https://play.google.com/store/apps/details?id=io.getshiny.shiny&hl=en_US). One Piece-specific apps are covered in Q7.

#### D. Generic crosslisters (sync and delist, but no card ID or card pricing)
- **Vendoo:**
  - Starter $14.99 ($12.49 billed annually), Growth $29.99 ($24.99), Pro $59.99 ($49.99), Enterprise custom; unlimited items on all paid plans; sale detection + auto-delist (Poshmark, eBay, Mercari, Depop, Whatnot, Etsy); AI listing enhancement from Growth; 14-day trial — [Vendoo pricing](https://www.vendoo.co/pricing).
  - Free plan of 5 items — [Vendoo blog (search excerpt)](https://blog.vendoo.co/how-much-is-crosslist).
  - Marketplaces: 11, including Whatnot (beta). **TCGplayer is not in Vendoo's marketplace list** — [Vendoo marketplaces (search excerpt)](https://www.vendoo.co/marketplaces). This conflicts with a fetch summary of the pricing page that mentioned TCGplayer; treat TCGplayer support as unconfirmed.
- **List Perfectly:**
  - Simple $29, Business $49, Pro $69, Pro Plus $99+; auto-delist only on Pro Plus ("mark sold" delisting on Pro); AI listing and barcode credits per tier; 100-free-listing money-back guarantee — [List Perfectly pricing](https://listperfectly.com/pricing/).
  - Marketplaces: eBay, Mercari, Poshmark, Depop, Etsy, Facebook, Grailed, Vestiaire, Vinted — **no Whatnot or TCGplayer listed**.
- **Crosslist:** Bronze $29.99 (200 listings), Silver $34.99 (500), Gold $39.99 (1,000), Diamond $44.99 (unlimited); AI add-on +$4.99; one-click delist/relist; trial of 3 days or 20 listings — [Crosslist pricing](https://crosslist.com/pricing/).

#### E. Capability matrix (checked Sept 28, 2026 unless noted)

| Tool | Scan / ID | Pricing data | Listing path | Crosslist / sync / delist | Orders | Labels |
|---|---|---|---|---|---|---|
| CardUploader | Photo/scanner, 50+ TCGs, EN+JP Pokémon; One Piece English only in DB keys (Sept 3) | TCGplayer market, prev. price, active eBay listings; Alt/CardLadder graded | eBay CSV + eBay API + 10 file exports | Beta auto-sync eBay + Mana Pool (MTG) + Misprint (Pokémon/OP) | Yes (eBay, Mana Pool, Misprint, storefront; TCGplayer pull sheet) | Not found |
| TCG Automate | Photo/scanner, ~30 TCGs + sports, EN+JP Pokémon | "Market" (TCGplayer per Aug report) | eBay API + CSV; TCGplayer/Whatnot/Shopify/Square | Pro+ ($40) eBay + Shopify managed inventory, repricing beta | Not documented | Not found |
| Card Dealer Pro | Desktop scanner app + visual AI, 20M records | Manual (secondary source) | eBay, Shopify, CollX, Whatnot, CSV | Not documented | Not documented | Not found |
| CardLuma | Browser batch + QR phone upload, 165+ TCGs claimed | Sold comps (claimed) | Direct eBay + eBay CSV + Whatnot CSV | Not documented | Not documented | Not found |
| Kronozio NEXT | AI ID (92% claimed), sports + TCG | Not stated | eBay (+ others) | Bidirectional eBay (legacy claim) | Order review, shipping mgmt (claimed) | Claimed |
| eBay app | Scan (Pokémon EN/JP, OP, MTG, YGO, Lorcana) | eBay 2-yr sold incl. Best Offer | Native draft; Seller Hub CSV | n/a | Native | Native |
| TCGplayer | App + Quicklist + Scan & Identify (+ Roca) | TCGplayer market | Native; CSV import | n/a | Native | Native (Direct) |
| Ludex | Scan, sports + TCG | Completed sales | eBay publish, 5–250/mo cap | No | No | No |
| Collectr | Scan, 25+ TCGs | "Real sales", 5+ yr history | None | No | No | No |
| Vendoo / List Perfectly / Crosslist | None (generic AI listing) | None card-specific | Browser-extension crossposting | Auto-delist (tier-gated) | No | No |

Sources: rows as cited above; CardUploader DB keys from the [local Sept 3 teardown](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-logged-in-teardown.md).

### Inferences
- The client's product sits in group A. Its real benchmark set is CardUploader (unlimited, $9.99), TCG Automate (metered, $9–10 entry), Card Dealer Pro ($9 entry, CollX-bundled), CardLuma ($10 for 1,000 scans) and Kronozio NEXT ($10 entry). Collector apps and eBay's scanner compete for the "scan + price" moment that happens before listing.
- eBay's free Price Guide (unlimited scans, two years of first-party sold comps incl. Best Offer, Pokémon EN/JP and One Piece, list-draft hand-off) makes "scan a card and see its price" worthless as a paid feature on its own. A paid seller tool has to win on **bulk** throughput (hundreds of cards per batch, scanner input), listing quality (titles, specifics, condition descriptors, policies) and hand-off to Seller Hub or the API. eBay's own scan-to-list is one card at a time in the app.
- Listing tools don't sell shipping labels; marketplaces own labels (eBay, TCGplayer, Whatnot). The client's "no order handling yet" stance matches the entry segment, where only CardUploader (beta) and Kronozio go into orders.
- **Naming risk:** a live product called **Card Index** (cardindex.com, Pokémon/One Piece pricing plus a Whatnot scanner extension updated Sept 7, 2026) overlaps with the client app's "CardIndex" naming used internally. Worth a trademark/brand check (the legal researcher may cover this).

### Gaps
- Card Dealer Pro's and CardLuma's exact TCG coverage for **One Piece and Japanese** cards, and their pricing sources, are not stated on pages I could read.
- TCG Automate's pricing source for Japanese cards is not documented.
- Kronozio NEXT's current eBay sync and order features are unverified (only legacy Kronocard claims were visible).
- Whatnot, TCGplayer and Mana Pool full help pages returned 403, so some details rely on search excerpts.
- I found no source on whether eBay's US Price Guide covers **Japanese One Piece**; the page lists "One Piece" without a language, while Pokémon is marked English and Japanese.
- Exact date that US eBay Price Guide added TCGs: not found (between the Nov 2025 early access and the Sept 2026 UK launch).

---

## Q2. What does each tool charge, and how does $7–10/month compare?

### Takeaway
$7–10/month is the crowded entry price for this category. CardUploader's **$9.99 unlimited** is the anchor. Metered rivals give 500–1,000 scans for $9–10 (CDP $9/500, TCG Automate $10/500, CardLuma $10/1,000, Kronozio from $10). Collector apps run $4.99–9.99, and eBay's scanner is free. At $7 the client would undercut every eBay-listing tool found. At $10 the client must match "unlimited" or it looks worse than CardUploader.

### Cited Findings

| Tool | Entry price | What entry buys | Higher tiers | Free tier / trial | Source (date) |
|---|---|---|---|---|---|
| CardUploader | $9.99/mo | Unlimited ungraded + graded processing, variation listings, listing creator (fair use) | Code-level ladder $9.99–$99.99 (not public) | 3-day trial, 100 credits; credits 1/card ungraded, 2 graded; free pricing tool | [pricing](https://carduploader.com/pricing) (Sept 28, 2026); ladder: [local Sept 3 teardown](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md) |
| TCG Automate | $10/mo ($9/mo annual, $108/yr) | 500 scans/mo, rollover | $19 (1,000), $40 (3,000; cross-list + managed inventory), $90 (10,000), $175 (20,000), $200 (30,000) | 7-day Beginner trial | [pricing](https://www.tcgautomate.com/pricing) |
| Card Dealer Pro | $9/mo ($8 annual) | 500 AI credits | $19 (1,100; $16 annual), $59 (5,000; $49 annual); +1,000 scans from $19.99 | 7-day trial | [homepage](https://www.carddealerpro.com/); annual/add-on: [CDP support (search excerpt)](https://support.carddealerpro.com/hc/en-us/articles/20929845276187-Subscription-plans-overview) |
| CardLuma | $10/mo | 1,000 scans | $20 (2,500), $38 (5,000), $71 (10,000), $99 (15,000) | Not stated | [CardLuma](https://www.cardluma.com/cardluma_vs_carddealerpro.html) (reviewed June 2026) |
| Kronozio NEXT | from $10/mo | Tiered by items added per month (500 to 100,000+) | Custom | 7-day trial, 50 items, no card | [pricing](https://kronozio.com/pricing) |
| Ludex | $4.99/mo Lite ($44.99/yr) | Unlimited scans in 1 category + 200 others; 50 eBay listings/mo | Standard $9.99 ($89.99/yr): unlimited scans, 50 eBay listings; Pro $24.99 ($239.99/yr): 250 eBay listings | Free: unlimited scans, save 60, 5 eBay listings/mo; 1-week trials | [membership](https://www.ludex.com/membership/) |
| CollX Pro | $9.99/mo ($99.99/yr) | 500 Scan+ credits, $10/mo marketplace credit, 90-day CDP | CollX Gold (details not found) | Free (<500-card collection) | [CollX Pro](https://collx.app/collx-pro) |
| Collectr Pro | $7.99/mo ($59.99/yr = $4.99/mo) | History, filters, export | — | Free: unlimited scanning | [Collectr Pro](https://getcollectr.com/pro) |
| eBay Price Guide | Free | Unlimited scans, 2-yr sold comps, list draft | — | — | [eBay](https://pages.ebay.com/price-guide/) |
| TCGplayer app / Pro | Free app; Pro needs Level 4 | Scanner, Quicklist, MassPrice | — | Marketplace fees apply | [TCGplayer Pro](https://seller.tcgplayer.com/pro) |
| Vendoo | $14.99/mo | Unlimited items, auto-delist | $29.99, $59.99 | 14-day trial; free 5 items | [Vendoo](https://www.vendoo.co/pricing) |
| List Perfectly | $29/mo | Crosslisting + templates | $49, $69, $99+ | Money-back guarantee (100 listings) | [List Perfectly](https://listperfectly.com/pricing/) |
| Crosslist | $29.99/mo | 200 listings | $34.99–$44.99 | 3 days / 20 listings | [Crosslist](https://crosslist.com/pricing/) |
| SortSwift | Free → $499/mo | — | eBay sync only on $499 tier | Free scanning | [sortswift.com](https://sortswift.com/) *(local report, Aug 2026)* |
| SpeedyCardLister | $1 first month, then $5–$125/mo | 500–27,500 scans | — | — | [speedycardlister.ai](https://speedycardlister.ai/) *(local report, Aug 2026)* |

Channel fees for context (not tool subscriptions):
- Misprint: 7% → 5% commission + 3% + 30¢ — [Misprint](https://www.misprint.com/help/seller-levels).
- Mana Pool: 5% (cap $50) + 2.9% + 30¢ — [Mana Pool (search excerpt)](https://support.manapool.com/hc/en-us/articles/31270101309719-Marketplace-Fees).
- Misprint's own Aug 17, 2026 guide puts TCGplayer at ~13% all-in and eBay at ~13.25% + $0.30 (a competitor's claim) — [Misprint One Piece guide](https://www.misprint.com/posts/how-to-sell-one-piece-card-collection).

### Inferences
- **Per-card economics at ~$10:** CDP ≈ $1.80 per 100 scans, TCG Automate ≈ $2.00 (≈ $1.80 annual), CardLuma ≈ $1.00. CardUploader has no marginal cost, but there is a per-job cap of 500 cards and a processing queue (local reports). Unlimited at $9.99 is the strongest value claim in the segment. The client's own "500 per batch" matches it.
- **$7 plan:** below every listing tool's monthly entry price. It sits next to Collectr Pro monthly ($7.99) and above Ludex Lite ($4.99). This is plausible as a volume-limited "starter" (e.g., capped cards/month, CSV only) with a $10–15 unlimited/API tier. A flat $7 unlimited would also undercut CardUploader, but leaves little margin for an embedding-model host (see the scaling note in the client-video doc).
- **Annual discounts are standard** (TCG Automate ~10%, CDP ~11–17%, Collectr ~38%, Ludex ~25%). CardUploader shows no annual option on its public page, which is an opening.
- Crosslisters ($15–$99) sit above the client's price and don't identify cards, so they aren't price competitors. They only matter for sellers who already crosslist non-card goods.

### Gaps
- CollX Gold pricing and benefits were not found.
- Card Dealer Pro's annual and add-on prices come from a search excerpt (the support page body didn't render).
- Whether CardUploader's hidden credit ladder is live for any users is unknown (not on the public page Sept 28).
- Kronozio's exact card count at the $10 entry tier isn't stated.
- The EPN commission rate for trading cards is only available from a secondary source ("3–4%", [commissiondex](https://commissiondex.com/program/ebay-partner/)); the official rate card was behind a bot check.

---

## Q3. Which features are table stakes for this audience, and which are real differentiators?

### Takeaway
Table stakes in 2026 are:
- bulk photo/scan identification with alternatives;
- variant pick;
- auto 80-character titles with eBay item specifics **and eBay's Ungraded condition descriptors**;
- TCGplayer-market pricing with floors and remembered prices;
- eBay CSV export for Seller Hub, with fixed-price and auction formats;
- bulk edit, duplicate merge, SKUs and graded cert lookup;
- a short free trial, guides and a Discord.

Differentiators now are:
- **live multi-channel inventory sync with auto-delist**;
- **sold-comp evidence** (not just market price) in the listing flow;
- **Japanese and One Piece depth**;
- scanner/hardware throughput;
- repricing;
- a flat unlimited price.

### Cited Findings
Evidence of how common each capability is:
- **Bulk photo/scan ID** appears in every group-A tool: CardUploader, TCG Automate, CDP (desktop scanner app), CardLuma, Kronozio, NeoSatoshi — sources in Q1.
- CardUploader caps a job at 500 cards / 1,000 files — [local Sept 13 report](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-upload-limits-research.md).
- The hobby-standard scanner for ungraded singles is the Ricoh fi-8170 (with scratch-line risk from the feed rollers) — [Elite Fourum, Feb 10, 2025](https://www.elitefourum.com/t/pokemon-card-scanner-for-singles/52997) *(possibly stale)*.
- **eBay CSV / Seller Hub** is offered by CardUploader, TCG Automate, CardLuma, NeoSatoshi and CardPulse — sources in Q1.
- eBay's CCG condition model (Ungraded plus descriptor) has been mandatory since Oct 2023 — [eBay Seller Center](https://www.ebay.com/sellercenter/selling/what-to-sell/selling-trading-cards). Getting it wrong causes upload failures — [eBay Community](https://community.ebay.com/t5/Report-eBay-Technical-Issues/Error-for-Conditions-when-bulk-listing-trading-cards/td-p/35141503). Some 2026 guides still give generic Used/New condition IDs — [CardPulse, Apr 2026](https://www.cardpulse.club/blog/how-to-bulk-list-trading-cards-on-ebay).
- **eBay API publishing** is offered by CardUploader, TCG Automate, CDP, CardLuma, NeoSatoshi, Ludex (capped) and Kronozio — sources in Q1.
- **Item specifics and title templates:** CardLuma fills 20+ eBay specifics — [CardLuma](https://www.cardluma.com/cardluma_vs_carddealerpro.html). TCG Automate CSVs include set/game/rarity/number — [TCG Automate blog](https://www.tcgautomate.com/blog/card-dealer-pro-alternative). CardUploader has a title builder with 80-character optimization — [getting started](https://carduploader.com/guides/getting-started).
- **Graded cert lookup:** CardUploader (PSA/CGC/BGS/TAG/ACE), TCG Automate (PSA/CGC on Standard+), CDP (bulk slab cert lookup per CardLuma) — sources in Q1.
- **Multi-export files** (TCGplayer, Whatnot, Shopify): CardUploader, TCG Automate, CDP, CardLuma — sources in Q1.
- **Live sync with auto-delist** is limited to a few tools and gated:
  - CardUploader: eBay + Mana Pool + Misprint, beta; Mana Pool Magic-only and US-only; no variation listings — [cross-listing guide](https://carduploader.com/guides/cross-listing).
  - TCG Automate: Pro+ at $40 — [pricing](https://www.tcgautomate.com/pricing).
  - SortSwift: eBay sync only on the $499 tier — *(local report)*.
  - Crosslisters: auto-delist but no card data — [Vendoo](https://www.vendoo.co/pricing), [List Perfectly](https://listperfectly.com/pricing/).
- **Sold comps vs market price:**
  - eBay (2-year first-party sold data incl. Best Offer) — [eBay](https://pages.ebay.com/price-guide/)
  - Ludex (completed sales) — [ludex.com](https://www.ludex.com/)
  - CollX (median of the last 10 sales in 6 months) — [CollX FAQ](https://collx.app/faq)
  - CardLuma (sold-comp pricing claimed) — [CardLuma](https://www.cardluma.com/cardluma_vs_carddealerpro.html)
  - Most listers price from TCGplayer market (CardUploader, TCG Automate per the Aug report).
  - CardUploader's public sold-comp lookup is now gone (Q5).
  - Misprint tells One Piece sellers to price on actual sold data, not asking prices — [Misprint, Aug 17, 2026](https://www.misprint.com/posts/how-to-sell-one-piece-card-collection).
- **Repricing:** TCG Automate repricing (beta, Pro+) — [pricing](https://www.tcgautomate.com/pricing); CollX Easy Price — [CollX Pro](https://collx.app/collx-pro); TCGplayer MassPrice — [TCGplayer Pro](https://seller.tcgplayer.com/pro); CardUploader's roadmap has scheduled price updates in automated inventory — [YouTube, Aug 11, 2026](https://www.youtube.com/watch?v=qXXryu2JU9Q).
- **Throughput/hardware:** CDP claims up to 70 cards/min on supported scanners — [CardLuma](https://www.cardluma.com/cardluma_vs_carddealerpro.html). Kronozio's legacy AI queue ran 30 s–4 h depending on load — [search excerpt](https://home.kronozio.com/). CardUploader's per-user slot queue was a public complaint — [local Sept 13 report](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-upload-limits-research.md).
- **Free trial lengths:** 3 days (CardUploader), 7 days (TCG Automate, CDP, Kronozio), 14 days (Vendoo); free tiers at Ludex, Collectr, CollX, eBay — Q2 table.

### Inferences
**Table stakes** (what a new seller platform must have on day one):
1. Batch photo/scanner upload (≥500 cards/job), front/back pairing, alternatives + confidence, manual search/replace.
2. Variant/printing selection (holo/reverse/parallel), because price depends on it.
3. Auto titles (80-character optimizer) and eBay item specifics including **ConditionID 4000 + ungraded card-condition descriptor**, business policies, store categories, SKU scheme.
4. Suggested price from TCGplayer market with multiplier, floor ($0.99) and remembered previous price; bulk price edit.
5. eBay File Exchange / Seller Hub CSV (fixed price + auction; variation is a plus) with pre-flight validation.
6. Duplicate merge to quantity, bulk edit, batch history.
7. Graded cert entry (at least PSA/CGC).
8. A trial or free tier, guides and a Discord.

**Real differentiators** (ranked for this client):
1. **Sold-comp evidence at the moment of pricing.** Canonical per card/variant, showing n, dates and source. The rival that most needs this is CardUploader, which now has only TCGplayer market plus active listings publicly. eBay's own guide sets buyer expectations for Best-Offer-true prices.
2. **Japanese and One Piece depth** (Q7).
3. **Queue-free throughput and scanner-folder ingestion** (Ricoh fi-8170 users).
4. **eBay API publishing with validation** (eliminating CSV rejections) — the client wants this "eventually".
5. **Live sync + auto-delist** across eBay/TCGplayer-file/Misprint. It's a differentiator mostly for multi-channel sellers, and the client doesn't want orders yet, so it's lower priority.
6. **Flat unlimited price at or below $10.** Only CardUploader offers this today.
7. **Repricing** and **storefront/buylist** are niche for this client.

### Gaps
- No independent accuracy benchmark compares these tools on the same card set (all accuracy numbers are vendor claims: CardUploader over 95%, Kronozio 92%, Eyevo 96%).
- How many sellers actually use API vs CSV is unknown.

---

## Q4. What do sellers complain about or praise?

### Takeaway
Across App Store reviews, forums and YouTube, the recurring complaints are:
- **scan misses** on promos, foils/holos, parallels, vintage and non-English cards;
- **prices that don't match eBay reality** (market-price or aggregate numbers);
- **paywalls and caps** (collection size, scans, listings);
- **processing queues and slow uploads**;
- **eBay CSV/condition errors**;
- **missing front/back and duplicate handling**;
- **login and stability problems**.

The praise is consistent too:
- **time saved** (hundreds of cards per hour vs dozens);
- **accurate Pokémon ID**;
- **fast, human support**;
- **a cheap flat price**;
- **duplicate merging**.

### Cited Findings
**Scan accuracy**
- The TCGplayer app scanner is described as working about half the time and as far worse than Collectr's; it struggles with foils and borderless or etched cards and needs a white background and tripod — [App Store reviews, 4.2★ / 16K](https://apps.apple.com/us/app/tcgplayer/id1247645833?see-all=reviews) (reviews 2024–2026).
- Collectr's scanner struggles with promos and Cosmos holos, and Korean/Chinese cards are missing — [App Store reviews, 4.9★ / 66K](https://apps.apple.com/us/app/collectr-tcg-collector-app/id1603892248?see-all=reviews).
- CollX users report frequent misidentification of modern variants and vintage cards, and missing newer inserts — [App Store reviews, 4.6★ / 49K](https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444?see-all=reviews).
- Ludex is praised for ~98% success on ~7k cards (May 2024), but its Pokémon database is called incomplete (Jun 2024) and it can't tell signed from unsigned cards — [App Store reviews, 4.7★ / 28K](https://apps.apple.com/us/app/ludex-sports-card-scanner-tcg/id1616691213?see-all=reviews) *(some reviews 2023–2024, possibly stale)*.
- A scanner vendor's blog says every app struggles with vintage and Japanese cards, often defaulting to newer reprints or English versions — [Eyevo (search excerpt; vendor)](https://eyevotcg.com/blog/best-pokemon-card-scanner-apps-2026).

**Price accuracy**
- Collectr prices can be anywhere from slightly to far off — [App Store](https://apps.apple.com/us/app/collectr-tcg-collector-app/id1603892248?see-all=reviews).
- CollX's eBay-based pricing is called very inaccurate — [App Store](https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444?see-all=reviews).
- A Ludex user found a card valued at $65–117 selling for $0.99 on eBay (Oct 2025) — [App Store](https://apps.apple.com/us/app/ludex-sports-card-scanner-tcg/id1616691213?see-all=reviews).
- TCGplayer's app redesign removed condition-based pricing (Jul 2025) — [App Store](https://apps.apple.com/us/app/tcgplayer/id1247645833?see-all=reviews).

**Paywalls and caps**
- Ludex free is capped at 60 saved cards, and a later reviewer says cards can't be added without upgrading (Dec 2025) — [App Store](https://apps.apple.com/us/app/ludex-sports-card-scanner-tcg/id1616691213?see-all=reviews).
- Collectr users say the best features are behind Pro and that scans were limited without it — [App Store](https://apps.apple.com/us/app/collectr-tcg-collector-app/id1603892248?see-all=reviews).
- CollX free is capped at 500 cards, with aggressive upgrade prompts — [App Store](https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444?see-all=reviews).

**Throughput and queues**
- CardUploader: after ~500 of 5,000 cards the creator was about 26th in a processing queue (May 22, 2026) — [YouTube Short](https://www.youtube.com/shorts/a7blPEkZRzA) *(local report)*.
- Card Dealer Pro: slow with large uploads, 300 dpi scans darken glossy cards, spreadsheet view reloads and loses scroll position, and CSV import errors — [tenereteam review aggregator](https://card-dealer-pro.tenereteam.com/) *(aggregator of unclear quality; undated)*.

**eBay CSV friction**
- CardUploader's #1 troubleshooting item is the eBay CSV not uploading (policy names must match exactly, postal code) — [local Sept 8 report §5](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-login-nav-research.md).
- eBay Community reports "card condition is required" errors on bulk uploads — [eBay Community](https://community.ebay.com/t5/Report-eBay-Technical-Issues/Error-for-Conditions-when-bulk-listing-trading-cards/td-p/35141503).

**Workflow gaps**
- Ludex reviewers want front-and-back scanning, eBay-format export and duplicate alerts — [App Store](https://apps.apple.com/us/app/ludex-sports-card-scanner-tcg/id1616691213?see-all=reviews).
- TCGplayer's seller upload lacks quantity selection, so each listing must be edited after upload — [App Store](https://apps.apple.com/us/app/tcgplayer/id1247645833?see-all=reviews) *(2019 review, stale)*.
- Collectr's web version lags the app (no condition/quantity editing) — [App Store](https://apps.apple.com/us/app/collectr-tcg-collector-app/id1603892248?see-all=reviews).

**Stability and login**
- The TCGplayer app forces a login every session and loses unsaved work (Dec 2024) — [App Store](https://apps.apple.com/us/app/tcgplayer/id1247645833?see-all=reviews).
- CollX has freezing, photo-retake data loss, slow support, payout delays and complaints about lost shipments on CollX labels — [App Store](https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444?see-all=reviews).

**Hardware**
- The Ricoh fi-8170 can leave scratch lines or indents, mostly on English cards per one poster — [Elite Fourum, Feb 2025](https://www.elitefourum.com/t/pokemon-card-scanner-for-singles/52997).

**Praise**
- TCG Automate's curated testimonials claim listing speed rose from 50 to 500+ cards per hour and describe it as very accurate on Pokémon — [TCG Automate reviews (search excerpt; vendor-curated)](https://www.tcgautomate.com/reviews). A YouTube commenter says it looks "too clean" (i.e., polished) — [ItsPhantomCards comments](https://www.youtube.com/watch?v=I6JOS75MT3Y).
- CardUploader: a positive creator review (Old Skool Pokemon, Jun 19, 2026), and the flat price is framed as the upside of the queue trade-off — [local Aug 23 report §11](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md). The client said "I love that" about duplicate merging — [client-video notes §1 #17](C:\Users\johnn\Antigravity_Files\Card_reader\client-video-2026-09-14-asks-and-plan.md).
- Support speed is praised: Ludex answers within ~24 h — [App Store](https://apps.apple.com/us/app/ludex-sports-card-scanner-tcg/id1616691213?see-all=reviews); TCG Automate's owner claims 30-minute responses — [TCG Automate blog](https://www.tcgautomate.com/blog/card-dealer-pro-alternative).
- Card Dealer Pro users report big sales jumps (e.g., 100–150 cards in 90 days → 2,500+) — [tenereteam aggregator](https://card-dealer-pro.tenereteam.com/) *(unverified)*.
- In the Feb 17, 2026 comparison video (11.9k views), commenters lean toward SortSwift and TCG Automate, and a commenter notes the creator keeps TCGplayer and eBay inventory separate — [ItsPhantomCards](https://www.youtube.com/watch?v=I6JOS75MT3Y).

### Inferences
- The complaint pattern maps onto the client's go/no-go: scan accuracy on real photos, especially promos, holo/reverse, One Piece parallels and Japanese prints, is where every competitor gets criticized. Visible confidence plus fast alternatives and manual search is the minimum defense.
- **Price trust** is the second most common complaint. Showing *why* a price was suggested (source, n, dates, last sold) addresses both the "prices way off" complaint and the eBay-reality mismatch.
- **Caps and paywalls** annoy collectors, but sellers accept metering if it's clear. A generous free taster (e.g., CardUploader's free pricing tool) converts better than a hard wall.
- **CSV errors** are a support cost every CSV-first tool pays. Pre-flight validation (policies, condition descriptors, image URLs, 80 characters) is a cheap differentiator for a CSV-first product like the client's.

### Gaps
- **Reddit (r/PokemonTCG, r/OnePieceTCG, r/pokemoncardcollectors, r/Flipping, r/eBay, r/tcgplayer) and Discord communities could not be read** (blocked for all available tools), so subreddit-level sentiment is missing. That is the biggest hole in this section.
- No transcript was obtainable for the Feb 2026 three-way comparison video (the transcript panel didn't load), so its verdict is unknown.
- Pokemon Steven's Apr 11, 2026 video "Someone tried to destroy CardUploader. We caught them." — the incident isn't described in the text I could read — [YouTube](https://www.youtube.com/watch?v=IREBoZSWjyU).
- App Store reviews skew toward collectors, not high-volume sellers.

---

## Q5. Has CardUploader changed features, plans or pricing since early September 2026?

### Takeaway
**Pricing is unchanged:** $9.99/mo Unlimited, a 3-day trial with 100 credits, 1 credit per ungraded card and 2 per graded. **Features moved significantly** toward multi-channel inventory:
- a **Misprint** auto-sync for **Pokémon and One Piece**;
- a public **cross-listing** guide (shared stock eBay + Mana Pool, beta);
- **Trade Me** exports;
- a **Graded Pricing Tool**;
- publicly documented **Storefront + Buylist** (beta, per-account, no fees).

The **public Sales Lookup is gone**: `/sales` returns 404 and the header link was removed. The site's title line names eBay, TCGplayer and Mana Pool (earlier reports didn't record the title, so whether this is new is unknown).

### Cited Findings
- **Pricing (Sept 28, 2026):** the public page still shows only $9.99 Unlimited (no credits, no caps, fair use), a 3-day trial with 100 credits, credits never expiring, 1 per ungraded and 2 per graded — [pricing](https://carduploader.com/pricing). This matches the Aug 23 / Sept 8 / Sept 13 reports — [local Sept 8 report](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-login-nav-research.md). The FAQ credit table is unchanged (BGS 1 credit per cert; pricing-only lookups free) — [FAQ](https://carduploader.com/guides/faq).
- **Sales Lookup removed from the public site:** carduploader.com/sales rendered a 404 page on Sept 28, 2026 (observed in the built-in browser), and the logged-out header is now Home · Dashboard · Guides · Pricing · Contact, with no Sales Lookup item — [carduploader.com/sales](https://carduploader.com/sales), [guides header](https://carduploader.com/guides/getting-started). On Sept 8 the header had Sales Lookup → /sales — [local Sept 8 report §3](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-login-nav-research.md). Whether the in-app Sales Lookup survives could not be checked without signing in.
- **New: Misprint automatic inventory (beta):**
  - What it covers: Pokémon and One Piece (the catalogs Misprint carries), USD only, ungraded batches and the Listing Creator only (no graded).
  - How it works: matched via TCGplayer product + printing + condition; connected with a Misprint API key and Seller ID; respects Misprint seller-level caps; pulls Misprint orders into Orders.
  - Warning shown: listings at or below the current best bid sell immediately.
  - Source: [Misprint guide](https://carduploader.com/guides/automatic-misprint-inventory).
  - History: not in the Sept 3 teardown — [local Sept 3 teardown](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-logged-in-teardown.md); a "Misprint (beta)" tile was visible in the client's Sept 14 recording — [client-video notes §1b](C:\Users\johnn\Antigravity_Files\Card_reader\client-video-2026-09-14-asks-and-plan.md).
- **New public guide: cross-listing (beta):**
  - One shared stock across eBay and Mana Pool; a sale on one lowers the other within minutes; picking the order settles inventory.
  - Limits: Mana Pool is Magic-only and US-only; eBay variation listings don't cross-list yet; one price per card on every platform; two near-simultaneous sales of the last copy can both go through.
  - The Manage Platforms sheet shows Off/Manual/Automatic per platform: eBay, TCGplayer, Mana Pool, Shopify (connect first), Misprint, Whatnot, Storefront, Extras.
  - Source: [cross-listing guide](https://carduploader.com/guides/cross-listing).
- **New or now public: Storefront and Buylist (beta):**
  - Enabled per account on request.
  - No fees to CardUploader; payment is arranged off-platform.
  - The storefront shows automatic-inventory cards at your price or a TCGplayer-market-derived price, with shipping rules, discount codes and pickup.
  - The buylist offers a % of TCGplayer market per game, with value bands, separate cash/credit %, hot and block lists, limits, a quote mode and condition scaling.
  - Source: [storefront/buylist guide](https://carduploader.com/guides/storefront-buylist).
  - On Sept 3 these were code-only routes gated by capability flags — [local Aug 23/Sept 3 report §3.5](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md).
- **Other additions seen in the guides:**
  - Trade Me via Tradevine CSV.
  - A "Graded Pricing Tool" alongside the Ungraded one (both shareable by link).
  - Bulk-edit items Edit Category & Game, Auction Settings and price templates.
  - Tools Create Lot and Convert to Playset.
  - 11 per-platform upload guides (eBay, TCGplayer, Mana Pool, Shopify, Whatnot, Misprint, storefront, Cardmarket, Tradera, MercadoLibre, Trade Me).
  - Source: [getting started](https://carduploader.com/guides/getting-started).
- **Messaging (Sept 28 wording; only the accuracy line is a confirmed change):**
  - The home page title reads "card scanner and bulk listing tool for eBay, TCGplayer and Mana Pool" (not recorded in earlier reports) — [home](https://carduploader.com/).
  - The accuracy line now reads over 95% on standard English and Japanese *cards*; the Aug report quoted English and Japanese *Pokémon* — [FAQ](https://carduploader.com/guides/faq) vs [local Aug 23 report §1](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md).
  - The homepage states that English Pokémon covers all sets including Topps Pokémon (whether this wording is new is unknown) — [home](https://carduploader.com/).
- **First-party roadmap (Aug 11, 2026, "Carduploader 6 Month Update", Pokemon Steven, 4.5k views):**
  - Priority is the inventory system with automatic eBay + Mana Pool sync, Shopify next, then a CardUploader store, and a buylist.
  - Automated inventory beta at roughly 90–95%, recruiting testers through Discord tickets.
  - Everything stays inside the ~$10/month plan with no add-ons.
  - A **creator fund** will pay content creators directly, outside the affiliate program.
  - Source: [YouTube](https://www.youtube.com/watch?v=qXXryu2JU9Q).
  - Storefront and buylist are now documented, so that roadmap is largely shipped in beta.
- **Still true:** Mana Pool Magic-only; TCGplayer and Whatnot are file exports in the guides — [getting started](https://carduploader.com/guides/getting-started). Shopify appears as product/inventory CSVs publicly, while the automatic engine covers eBay, Mana Pool and Misprint.

### Inferences
- CardUploader is moving from "listing tool" to "inventory hub" (sync, orders, storefront, buylist) while holding $9.99. The client explicitly doesn't want orders yet, so competing on that axis now is unnecessary. But the gap between the two products widens if the client stays CSV-only.
- **The Misprint sync matters for this client specifically** because it covers Pokémon and One Piece, the client's two games. It also shows that marketplaces with open seller APIs (Misprint, Mana Pool) are where live sync is feasible for small tools, unlike TCGplayer (closed API).
- Removing the public Sales Lookup takes away CardUploader's only public sold-comp surface. Plausible reasons: eBay data licensing risk, the cost of the licensed archive, or bot abuse. The Apr 2026 "Someone tried to destroy CardUploader" video might be related, but that is unverified speculation. Either way it reopens "public, canonical sold comps" as a differentiator, and it also makes eBay's free Price Guide the default sold-comp tool.
- The storefront's "no fees to us" and "everything under $10" message sets a buyer expectation that add-ons won't cost extra. A $7–10 competitor charging for exports or integrations would be compared unfavorably.

### Gaps
- The logged-in app wasn't inspected (no sign-in allowed), so in-app changes (Sales Lookup survival, Shopify engine status, referral terms) are unconfirmed.
- The exact dates each guide went live are unknown.
- Whether Misprint sync is on for all accounts or per-account beta isn't stated; the guide carries a BETA tag.

---

## Q6. What growth and retention tactics do these tools use?

### Takeaway
The winning playbook in this niche is **creator-led acquisition** (affiliate codes, bonus credits, recurring commissions, and now a paid creator fund), **free "taster" tools** (free pricing tool, free scanning, free listings per month), **Discord-centric support and feature voting**, **bundling** (CollX Pro + Card Dealer Pro) and **organic community launches** (Collectr hit 4M users and eight-figure ARR with no ad spend). The client's stated plan (teaching audience, Discord, referrals) fits the category norm.

### Cited Findings
- **Referral codes + bonus credits:**
  - CardUploader signup takes a referral code, `?ref=` pre-fills it, and creators promote "bonus free credits" links — [local Sept 8 report §2.2](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-login-nav-research.md); [Pokemon Steven video description, Apr 11, 2026](https://www.youtube.com/watch?v=IREBoZSWjyU).
  - The client's own CardUploader account shows a 10% recurring commission affiliate dashboard (16 referrals, $20 earned) — [client-video notes §1c item L](C:\Users\johnn\Antigravity_Files\Card_reader\client-video-2026-09-14-asks-and-plan.md).
  - Payout via PayPal/Wise exists in code — [local Aug 23/Sept 3 report §3.5](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md).
- **Creator fund:** CardUploader plans a monthly budget paid directly to creators making reels and videos about it, outside the affiliate program — [YouTube, Aug 11, 2026](https://www.youtube.com/watch?v=qXXryu2JU9Q).
- **Company-affiliated creators:** Pokemon Steven says on camera that he works with carduploader.com, and his videos carry the ref=STEVE link — [YouTube](https://www.youtube.com/watch?v=qXXryu2JU9Q).
- **Affiliate programs:**
  - TCG Automate pays 50% commission up to $50 per referred user, apparently one-time, for approved applicants — [TCG Automate affiliate](https://www.tcgautomate.com/affiliate).
  - Card Dealer Pro uses creator promo codes (e.g., a code giving 500 free cards after the trial, Feb 2024) — [TCG Bulk Kings](https://tcgbulkkings.com/2024/02/15/card-dealer-pro-affiliate/) *(possibly stale)*.
  - Creators stack codes for competing tools in one video (TCG Automate code, CardUploader ref, SortSwift ref) — [ItsPhantomCards description, Feb 17, 2026](https://www.youtube.com/watch?v=I6JOS75MT3Y).
- **Free taster tools:**
  - CardUploader's free Ungraded (and now Graded) Pricing Tool with shareable links — [getting started](https://carduploader.com/guides/getting-started); 100 images on Free, 500 paid — [local Sept 13 report](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-upload-limits-research.md).
  - Ludex free tier includes 5 eBay listings/month — [Ludex](https://www.ludex.com/membership/).
  - Collectr free tier includes unlimited scanning — [Collectr Pro](https://getcollectr.com/pro).
  - eBay's Price Guide is free with no limits — [eBay](https://pages.ebay.com/price-guide/).
  - Kronozio: 7-day, 50-item trial with no card — [Kronozio](https://kronozio.com/pricing).
  - Crosslist: 3 days or 20 listings — [Crosslist](https://crosslist.com/pricing/).
  - List Perfectly: 100-listing money-back guarantee — [List Perfectly](https://listperfectly.com/pricing/).
- **Discord and community:**
  - CardUploader: Discord is the main support channel (~2,470 members in Aug 2026) plus a public leaderboard — [local Aug 23 report §3.7](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md); beta testers recruited via Discord tickets, and users' requests shipped fast ("bang, done" framing) — [YouTube, Aug 11, 2026](https://www.youtube.com/watch?v=qXXryu2JU9Q).
  - Collectr runs an official Discord — [discord.com/invite/collectr (search result)](https://discord.com/invite/collectr).
  - Creators run their own Discords alongside affiliate links — [ItsPhantomCards](https://www.youtube.com/watch?v=I6JOS75MT3Y).
- **Organic launch and no ad spend:** Collectr launched with Reddit posts (claimed 5,000 users in 24 h), reached 4M+ users, went from five-figure to eight-figure ARR within ~6 months of launching Pro at $7.99, with five people and no advertising (Aug 13, 2025) — [BetaKit](https://betakit.com/how-collectr-bootstrapped-a-trading-card-hobby-into-an-eight-figure-business/). Fintech.ca (May 2025) reported 4M+ users and 600M products tracked — [Fintech.ca (search excerpt)](https://www.fintech.ca/2025/05/22/collectr-worlds-fastest-growing-collectibles-app/). Larger figures (6M or 8M users) appeared in search summaries without a clear source *(unverified)*.
- **Bundling and credits that offset price:** CollX Pro includes a $10/month marketplace credit (users say it offsets the $9.99 fee) and a free 90-day Card Dealer Pro subscription — [CollX Pro](https://collx.app/collx-pro), [App Store](https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444?see-all=reviews).
- **Loyalty mechanics:** TCG Automate rolls over unused scans and, after one year, adds 10% of rollover to a reserve (capped at 1,000 per cycle) — [TCG Automate pricing](https://www.tcgautomate.com/pricing).
- **Affiliate monetization of lookups:**
  - CardUploader and CollX monetize click-outs through the eBay Partner Network and TCGplayer (Impact) affiliate links — [local Aug 23 report §3.7](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md); [search result: CollX affiliate disclosure](https://ballcardgenius.com/blog/comparing-sports-card-value-scanners-collx-and-ludex/).
  - EPN pays about 3–4% on collectibles per a secondary source — [commissiondex](https://commissiondex.com/program/ebay-partner/) *(unverified)*.
- **Content/SEO:**
  - Vendors publish per-game landing pages and "best apps" roundups: TCG Automate per-TCG docs ([Japanese Pokémon](https://www.tcgautomate.com/docs/tcgs/pokemon-japan)), Misprint seller guides ([One Piece](https://www.misprint.com/posts/how-to-sell-one-piece-card-collection)), Haki's comparison ([Haki](https://hakitcg.com/blog/best-one-piece-card-scanner-apps-2026)).
  - Vendors publish migration guides from rivals: Kronozio's Card Dealer Pro migration tutorial — [Kronozio](https://kronozio.com/).
- **Marketplace partnerships:** Misprint's API-key screen asks what the key is for and attributes synced listings to the chosen tool — [CardUploader Misprint guide](https://carduploader.com/guides/automatic-misprint-inventory).

### Inferences
- The client's advantage is **being the teacher**. Tactics that fit a $7–10 product with a creator-founder:
  - referral codes with bonus credits plus a recurring commission (CardUploader pays 10%);
  - a free pricing/scan taster with a shareable link;
  - a Discord with a public changelog and feature voting;
  - guide content that doubles as SEO;
  - EPN-tagged lookups as a revenue line from free users.
- A one-time bounty like TCG Automate's (50% up to $50) is easier to fund than recurring commission at $7. Recurring 10% of $7 is $0.70/month per referral, which is weak for creators. CardUploader's creator fund suggests affiliate percentages alone weren't moving creators.
- Retention levers in the category are sunk-in configuration (policies, templates, SKUs), batch history, remembered prices and inventory. The more of the seller's setup lives in the tool, the stickier it is.

### Gaps
- Current Discord member counts for CardUploader, TCG Automate and Collectr couldn't be retrieved (the CardUploader site shell doesn't expose the invite; Discord not readable).
- Referral terms for Ludex and Collectr were not found.
- CardUploader's creator-fund size and launch status are unknown.

---

## Q7. Are there One Piece-specific or Japanese-card-specific gaps a newcomer could fill?

### Takeaway
Yes. The seller-tool layer is **English-and-TCGplayer-centric**:
- TCGplayer has a Pokémon Japan catalog but **no Japanese One Piece category**, so there's no TCGplayer market price feed for JP One Piece.
- CardUploader's catalog keys list only **One Piece English**.
- TCGplayer's own scanners couldn't identify Japanese Pokémon (as of 2024).

Meanwhile a crop of **One Piece collector apps** (Haki, OP.TCG, Bounty, Kaizoku) already handle Japanese prints, parallels (-v1/-v2) and non-US price sources (Cardmarket, Yuyu-tei, eBay sold). **None of them offers bulk eBay listing.** A seller tool that combines One Piece variant precision, Japanese catalogs and eBay/Misprint listing has little direct competition.

### Cited Findings
- **TCGplayer catalogs (via the TCGCSV mirror, fetched Sept 28, 2026):** category 3 Pokemon, 85 Pokemon Japan, 68 One Piece Card Game; **no separate Japanese One Piece category** — [TCGCSV categories](https://tcgcsv.com/tcgplayer/categories).
- **TCGplayer Japanese Pokémon (Sept 16, 2024):**
  - Sellers can list under "Pokemon Japan" and sets are added gradually; the TCGplayer app, Quicklist and Roca could not identify Japanese Pokémon then; Japanese and English sets are not 1:1 — [TCGplayer blog](https://seller.tcgplayer.com/blog/articles/now-available-to-list-japanese-pok%C3%A9mon) *(2024, possibly stale)*.
  - Japanese cards without a catalog entry must be listed "with photos" under English entries — [TCGplayer help (search excerpt)](https://help.tcgplayer.com/hc/en-us/articles/26336064030615-Listing-Japanese-Pokemon-Products-FAQ).
- **CardUploader catalog:** the database keys in its bundle include `pokemon english`, `pokemon japanese` and `one piece english`, with **no Japanese One Piece** — [local Sept 3 teardown](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-competitive-research-report.md). It admits TCGplayer pricing "is only really relevant for English cards" (Dec 2025 walkthrough) — [local Sept 1 report §4](C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-data-sourcing-research.md). The homepage lists One Piece without a language — [home](https://carduploader.com/).
- **TCG Automate:** trained on English and Japanese Pokémon; no Japanese One Piece specifics documented — [TCG Automate docs](https://www.tcgautomate.com/docs/tcgs/pokemon-japan).
- **eBay Price Guide:** Pokémon marked English and Japanese; One Piece listed without a language — [eBay](https://pages.ebay.com/price-guide/).
- **One Piece collector apps (2026):**
  - **Haki:** English and Japanese, tracks -v1/-v2 parallels separately, prices from TCGplayer (EN), Cardmarket (EN+JP) and eBay sold (JP), CSV export and eBay search with condition presets. Its Aug 6, 2026 comparison rates Collectr's Japanese support "limited" and TCGplayer's/Ludex's "no" — [Haki blog](https://hakitcg.com/blog/best-one-piece-card-scanner-apps-2026), [Haki (search excerpt)](https://hakitcg.com/).
  - **OP.TCG:** 200K+ collectors, 20,000+ cards and sealed items in FR/EN/JP/CN, prices from Cardmarket, TCGplayer, eBay and PSA — [optcg.app (search excerpt)](https://optcg.app/).
  - **Bounty:** scans by exact variant, prices Japanese cards separately with live Yuyu-tei prices in yen — [Bounty (search excerpt)](https://www.bountytcg.app/en).
  - Also **Kaizoku** and **TCG Stacked** — [kaizoku.app](https://www.kaizoku.app/), [TCG Stacked](https://www.tcgstacked.com/onepiece/card-scanner-app).
  - Haki's author says no app integrates Yuyu-tei, which Bounty's page contradicts — [Haki blog](https://hakitcg.com/blog/best-one-piece-card-scanner-apps-2026) vs [Bounty](https://www.bountytcg.app/en).
- **Market divergence:** the same alt-art card can sit ~30% apart between TCGplayer and Cardmarket — [Haki blog](https://hakitcg.com/blog/best-one-piece-card-scanner-apps-2026).
- **Where One Piece value concentrates:** alternate arts and manga rares; Misprint advises pricing on sold data, not asks — [Misprint, Aug 17, 2026](https://www.misprint.com/posts/how-to-sell-one-piece-card-collection).
- **New US channel for One Piece:** Misprint carries Pokémon and One Piece, and CardUploader syncs ungraded One Piece to it via TCGplayer product IDs. That means Japanese One Piece (no TCGplayer product) would be skipped — [CardUploader Misprint guide](https://carduploader.com/guides/automatic-misprint-inventory).
- **Language gaps in collector apps:** Collectr users report missing Korean and Chinese cards — [App Store](https://apps.apple.com/us/app/collectr-tcg-collector-app/id1603892248?see-all=reviews). A vendor blog says 2026 collection trackers are unreliable for Japanese Pokémon (JP-exclusive sets often show no price or an English equivalent) — [Eyevo (search excerpt; vendor)](https://eyevotcg.com/blog/best-pokemon-card-scanner-apps-2026).
- **One Piece catalog sourcing:** there's no free official One Piece API; TCGCSV category 68 gives products with print variants (Normal/Foil/Parallel), and community databases exist (Limitless, onepiece.gg, the official card list) — [client-video notes §3 Tier 3](C:\Users\johnn\Antigravity_Files\Card_reader\client-video-2026-09-14-asks-and-plan.md).

### Inferences
Gaps a newcomer could fill, easiest first:
1. **One Piece variant precision.** Normal vs parallel (-v1/-v2), alt art, manga rare, SP, promo stamps, each with its own price and eBay title/specifics. CardUploader deliberately collapses Pokémon holo/reverse variants (local report), and One Piece parallels carry most of the value.
2. **Japanese Pokémon done right.** Use JP set codes and numbers in titles, price from TCGplayer Pokemon Japan (category 85) where it exists, and fall back to eBay sold. This is where "all scanners struggle" per the vendor blog.
3. **Japanese One Piece catalog + pricing.** TCGplayer has no category, so pricing needs another source: Yuyu-tei, Cardmarket JP, or the seller's own/eBay sold comps. Listing JP One Piece to eBay with correct item specifics (Language: Japanese) is unserved by the seller tools reviewed.
4. **Dual-market price display** (US TCGplayer vs EU Cardmarket vs JP retail) for sellers who import JP product.

For this client (English Pokémon first, One Piece second, US eBay), #1 and #2 are the realistic near-term wins. #3 is a later differentiator that also depends on catalog sourcing work (covered by the scanning/catalog researchers).

### Gaps
- No quantitative data on the share of One Piece eBay sales that are Japanese vs English.
- Yuyu-tei, Cardmarket and Snkrdunk data-access terms were not researched (out of scope).
- Whether eBay's Price Guide identifies Japanese One Piece prints is unknown.
- Card Dealer Pro's, CardLuma's and Kronozio's One Piece/Japanese coverage could not be confirmed.
