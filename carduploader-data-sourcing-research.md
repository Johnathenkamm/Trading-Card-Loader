# CardUploader: How It Gets eBay & TCGplayer Data, and How Its Card Database Works

**Prepared for:** client trading-card site project · **Date:** September 1, 2026
**Companion docs:** `carduploader-competitive-research-report.md` (Aug 23, 2026 teardown — the "what"; this report is the "how")
**Shareable version:** https://claude.ai/code/artifact/64683a3a-25a4-4550-aa40-74730f7ce00b

---

## 0. Method & how to read the markers

This report answers two questions the Aug 23 teardown left open: **(A)** what mechanisms CardUploader uses (or could use) to pull eBay and TCGplayer data, and **(B)** how its internal card catalog is built, searched, and updated — AI search vs. conventional search.

A deep-research workflow ran 34 agents: 6 search fan-outs and 28 source-fetch agents that extracted quote-backed claims from primary documentation (eBay Developers Program, TCGplayer docs, TCGCSV, Supabase, CardUploader's own FAQ, a first-party YouTube walkthrough) and secondary sources. **Caveat:** the workflow's final adversarial-verification stage (3-vote refutation panels) was interrupted before running, so unlike the Aug 23 report there is no 🟢P marker here. Confidence is marked by source class instead:

- 🔵 **Primary documentation** — eBay/TCGplayer/Supabase/TCGCSV official pages, read directly (some via Wayback where live pages are bot-walled).
- 🟢F **First-party CardUploader statement** — their FAQ/site, or the official Dec 3, 2025 walkthrough video made with the developer's cooperation.
- 🟡 **Single secondary source** — vendor blogs (JustTCG, SoldComps, CardGrader), forum threads; reported, not independently confirmed.
- ⚪ **Inference** — my conclusion from the evidence; the reasoning is stated where used.

---

## 1. Executive summary

1. **CardUploader does not "search the internet" for cards. It searches three closed data pools it maintains or licenses:** an aggregated sold-listings pool (eBay/Goldin/Fanatics), an active-eBay-listings lookup, and TCGplayer price tables keyed to its own catalog. Nothing is crawled live from the open web at query time. ⚪ (from the mechanism analysis below)
2. **eBay *sold* data cannot come from any open eBay API.** The Finding API (the last self-serve sold-listings route) was decommissioned Feb 4, 2025; the only official replacement, the Marketplace Insights API, is limited-release, gated behind eBay's manual "application growth check," closed to new users, and returns only ~90 days of history. eBay's API license even scrutinizes apps that "derive average selling price… for any eBay category" — which is literally what CardUploader's last-3-average stat does. 🔵 **Most plausible sold pipe: a licensed third-party sold-data feed (possibly plus scraping), not an eBay partnership.** ⚪ **Live test (Sept 1, 2026): a `/sales` search for "Tropical Mega Battle" returned 184 sales spanning Aug 24, 2026 back to Dec 16, 2018 — ~8 years of history, far beyond eBay's ~90-day window and predating CardUploader's own existence.** The pool is a purchased/licensed historical archive, not live-window sourcing. 🟢F
3. **For graded cards this is confirmed first-party: CardUploader pulls valuation from Alt (alt.xyz)**, which itself aggregates sold listings "from a whole bunch of other places" and averages them monthly into a predicted price. So at least part of its sold-price stack is a licensed third-party feed, not eBay API access. 🟢F
4. **The eBay *seller* integration needs no special partnership** — everything observed maps onto standard, self-serve eBay Sell APIs: OAuth authorization-code grant ("Connect eBay Account"), Inventory API createOffer→publishOffer ("List on eBay (via API)"), Fulfillment API getOrders (order sync), Browse API (active-listing comps, with eBay Partner Network affiliate fields built in). 🔵 Also: as of the official Dec 3, 2025 walkthrough the eBay path was **CSV-only**; the OAuth/API flow shipped between Dec 2025 and Aug 2026. 🟢F
5. **TCGplayer's API has been closed to new developers for years** ("We are no longer granting new API access at this time," API in maintenance mode at v1.39.0 since 2023) — but grandfathered keys keep working indefinitely. CardUploader's per-condition price chips (NM/LP/MP/HP) match the shape of TCGplayer's SKU-level pricing endpoint, which **TCGCSV's free daily mirror explicitly cannot supply** ("this project does not share information about SKUs"). ⚪ **So its TCGplayer data most plausibly comes from a grandfathered/partner API key (or scraping), not from the public mirror.** The TCGplayer affiliate program (which CardUploader belongs to) provides monetized links only — no data feed. 🔵
6. **The catalog is a manually curated matching database, not a synced mirror.** First-party origin story: the entire product began when a card-selling friend asked the developer to "make me some sort of image-matching thing," and the per-game databases were built to serve that matcher. Variants (holo/reverse/1st-ed/stamped) are deliberately collapsed into one base row "to stop mismatches." Gaps are fixed by a crowd-report → human-fix loop ("usually within 48 hours"). 🟢F The 24–48h new-set/missing-card cadence is the industry norm — Scrydex (pokemontcg.io's successor) promises exactly "within 24-48 hours of official release." 🔵
7. **There is no AI/LLM/semantic search anywhere in CardUploader.** Its three search surfaces are: (a) computer-vision **image retrieval** for photos (a trained model matching against reference images — the standard embedding/reverse-image-search architecture, *not* a generative model), (b) conventional keyword type-ahead over the catalog, (c) keyword matching over sold-listing titles. The 38-minute official walkthrough describes no LLM component anywhere. 🟢F ⚪ Its known Supabase stack natively supports the pgvector/CLIP image-search pattern, and commercial benchmarks (Ximilar) hit 97%+ with exactly this retrieval architecture. 🔵
8. **Changes since the Aug 23 teardown (checked Sept 1):** the FAQ no longer claims "database photos updated every day," now claims **"over 50 TCGs"** (was "45+"), and states Card Search is the authoritative support test; missing-card turnaround is now quoted as "48 hours" flat. 🟢F

---

## 2. Angle 1 — Where the eBay sold-comps data comes from

### What's ruled out 🔵

| Route | Status | Evidence |
|---|---|---|
| **Finding API** (`findCompletedItems`) | Dead. Deprecated Jan 2024, decommissioned **Feb 4, 2025**; the sold-listings call had been restricted since late 2020. | eBay developer program updates; [SoldComps survey](https://sold-comps.com/alternatives) 🟡 |
| **Marketplace Insights API** | The only official sold-data API. **Limited release, "restricted and not open to new users."** Production access requires eBay's manual **application growth check** ("The check is done by the eBay team as a final step before allowing your Production keyset to access restricted APIs"). Returns only **~90 days** of history. Small developers in eBay's own forum couldn't even find where to apply; one abandoned the "long process." | [eBay growth-check doc](https://developer.ebay.com/api-docs/static/gs_use-the-application-growth.html) 🔵; [eBay dev forum](https://community.ebay.com/t5/eBay-APIs-Talk-to-your-fellow/Marketplace-Insights-API-query-about-small-project/td-p/34802982) 🟡 |
| **Terapeak** | ~3 years of history but **aggregated analytics inside Seller Hub only — no API returns Terapeak data as JSON**. Cannot back a per-listing lookup. | 🟡 SoldComps survey |
| **Browse API** | Active listings **only** — no sold/completed parameter exists. | [item_summary/search docs](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search) 🔵 |
| **Fulfillment API** | Returns only the *connected seller's own* orders (2-year horizon, PII masked after 90 days). Cannot produce market-wide comps. | [Fulfillment API docs](https://developer.ebay.com/develop/api/sell/fulfillment_api) 🔵 |

Two more official constraints matter:

- **eBay's API License Agreement compliance review explicitly scrutinizes apps that "collect statistical data about eBay" or "derive average selling price or gross merchandise value for any eBay category."** CardUploader's Sales Lookup computes last-sale / last-3-average stats — an activity that would be license-restricted if it ran on official eBay APIs. 🔵
- **Every API-based sold-data option inherits the ~90-day window** — which makes result-date depth a discriminator between live-window sourcing and archives. 🟡 **Test executed Sept 1, 2026** 🟢F: searching `/sales` for "Tropical Mega Battle" (a slow-velocity vintage promo) returned **184 sales dated Aug 24, 2026 → Dec 16, 2018** — roughly **eight years** of per-listing history across eBay, Goldin, and Fanatics, including Best-Offer-accepted rows with revealed prices throughout. Two conclusions follow: (a) this is a **long-horizon archive**, categorically not a live eBay query; (b) the archive **predates the product** (CardUploader is a ~2024/25-era tool), so the history was almost certainly **bought or licensed, not self-accumulated**. The marketplace mix (eBay + Goldin + Fanatics with 2018+ depth) most resembles Card Ladder-class or Alt-class aggregated datasets — and CardUploader is already confirmed to license Alt data for graded valuations. ⚪

### What's left (the plausible mechanisms) ⚪

1. **Scraping eBay's public sold-listings pages** — described in eBay's own developer forum as the practical fallback ("Consider using web scraping techniques to gather sold price data" 🟡), and per a 2026 survey "what most resellers use." Requires residential proxy pools against CAPTCHAs; fragile but common.
2. **A third-party aggregated sold-data feed.** A whole vendor class now sells per-listing eBay sold comps as hosted REST APIs (e.g., SoldComps: free tier then $9–79/mo, 8 eBay sites 🟡). CardUploader's coverage fingerprint — **eBay + Goldin + Fanatics in one result set** — looks like an aggregator's output, not an eBay integration. And for graded cards CardUploader states on camera that it pulls from **Alt (alt.xyz)**: "They also have sold listings from like a whole bunch of other places. They put them all into one and average them out over a month." 🟢F So a feed relationship demonstrably exists for part of the stack.
3. **The Best Offer wrinkle.** eBay itself shows only the crossed-out list price on best-offer sales; 130point is the public exemplar that reveals the true accepted price, and CardUploader's Sales Lookup reproduces exactly that output format (struck list price + actual price). **Nobody publicly documents how this data escapes eBay**: 130point's About page names the eBay Partner Network as an *affiliate* (commission) relationship and says nothing about data access; forum lore says such sites "use certain eBay developer's API calls," naming none; eBay front-line support disavows them ("they don't have legitimacy… eBay is not responsible for those sites"). 130point is a hobbyist-founded Australian Pty Ltd, which makes a restricted enterprise data partnership less plausible; its site is aggressively Cloudflare-walled against scraping of its own pages. 🔵🟡
4. **What EPN is and isn't.** The eBay Partner Network affiliate links on CardUploader's (and 130point's) results monetize click-outs — the Browse API even has affiliate fields built in (`itemAffiliateWebUrl`) — but EPN is a *commission* program, not a sold-data feed. Affiliate membership explains the links, not the data. 🔵

**Bottom line:** CardUploader's sold pipe is undisclosed, but the constraint set (no open API, license restrictions on exactly its stats, multi-marketplace coverage, hidden best-offer prices, a confirmed Alt.xyz feed for graded) points to **licensed third-party aggregation and/or scraping — the same black-box category as 130point — rather than any sanctioned eBay data partnership.** ⚪

---

## 3. Angle 2 — The eBay seller-side integration (all standard APIs)

Every observed feature maps onto eBay's ordinary, self-serve developer program — no partner tier required for any of it: 🔵

| CardUploader feature | eBay mechanism | Notes |
|---|---|---|
| "Connect eBay Account" | **OAuth 2.0 authorization-code grant** — app redirects to eBay's consent page with scopes (e.g. `sell.inventory`, `sell.fulfillment`), exchanges the code for a ~2h user token + ~18-month refresh token. Collecting eBay passwords is forbidden; OAuth is the sanctioned route. | One connect → long-lived sync. [Docs](https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html) |
| "List on eBay (via API)" | **Sell Inventory API**: create SKU-keyed `inventoryItem` → `createOffer` → `publishOffer`. Requires the seller opted into business policies (matches CardUploader's policy-sync step). | **Gotcha worth copying into our plan:** Inventory-API listings *cannot be revised in Seller Hub* — all revisions must go through the API. This is a known reason some tools list via the legacy Trading API instead. [Docs](https://developer.ebay.com/api-docs/sell/inventory/static/overview.html) |
| "Check eBay Duplicates" / revise | `getInventoryItems`/`getOffers` (or legacy Trading `GetMyeBaySelling`) over the connected seller's live listings. | Seller-scoped, standard. |
| "eBay Listed" comps modal | **Browse API** `item_summary/search` — keyword search over *active* listings; only needs a client-credentials app token with the basic scope. Default returns fixed-price only (auctions need the `buyingOptions` filter); 10,000-item ceiling. In the Dec 2025 video it's literally a regional keyword search ("I'm in Australia, this is searching eBay Australia"). 🟢F | Note an internal inconsistency in eBay's docs: the Buy-API program page frames Buy APIs as partner-approved, while the Browse search method itself documents only the standard scope. In practice basic Browse access is broadly available. 🔵 |
| Orders sync (beta) | **Sell Fulfillment API** `getOrders` — completed-checkout orders only; actively maintained (v1.20.7, July 17, 2025). | Confirms the teardown's attribution. |
| Rate limits | Every keyset starts at **5,000 calls/day**; higher limits (and any restricted API) require the free growth-check review. | A tool at CardUploader's scale has necessarily passed a growth check for limits — but that's routine and does **not** imply Marketplace Insights access. 🔵⚪ |

**Timeline confirmation** 🟢F: the official Dec 3, 2025 walkthrough shows the eBay path as **CSV export → manual Seller Hub bulk upload** ("Carduploader utilizes eBay's CSV uploading tool"). The OAuth/API listing flow the Aug 2026 teardown observed was therefore added in the intervening ~8 months — consistent with the teardown's read that CSV is still the documented primary path and the API layer is new.

---

## 4. Angle 3 — Where the TCGplayer prices and SKUs come from

### The access landscape in 2025–26 🔵

- **The developer API is closed:** "We are no longer granting new API access at this time" (official docs). Effectively closed since ~late 2023/2024; maintenance mode at v1.39.0 (older versions cut off Aug 1, 2023; newest dated announcements are from 2023). Post-eBay-acquisition, access is limited to existing key holders, large sellers, and approved partners. 🔵🟡
- **Grandfathered keys keep working indefinitely** — long-lived PUBLIC/PRIVATE key pairs exchanged for ~14-day bearer tokens; no re-application process is documented. 🔵
- **[TCGCSV.com](https://tcgcsv.com/)** — the standard no-API route: a free, donation-funded daily mirror (~20:00 UTC) of TCGplayer categories/groups/products/prices across 89+ games, with product `extendedData` (rarity, number) and image URLs. **But:** "this project does not share information about SKUs. This means that you will not be able to get prices for each condition of a card." 🔵
- **Per-condition prices are SKU-level data:** TCGplayer's `pricing/sku/{skuIds}` endpoint returns `marketPrice` per SKU, where **SKU = productConditionId** (product × condition), batchable. This is exactly the shape of CardUploader's NM/LP/MP/HP chips. 🔵
- **The affiliate program** (runs on Impact; first-click, 48h attribution) provides monetized product links — matching CardUploader's `tcgplayer.com/product/{id}` link-outs — but **no data feed or API access**. 🔵
- **Third-party alternatives** now exist: JustTCG (condition-level prices, multi-game incl. Japanese Pokémon, but no documented TCGplayer-SKU mapping), Scrydex (catalog + prices refreshed at least daily, from unnamed "various market sources"), TCGdex (free, multilingual Pokémon catalog, minimal pricing). Scraping TCGplayer violates its ToS ("not to crawl, scrape, or spider"). 🟡🔵

### What CardUploader most plausibly does ⚪

Its observed data shape — **market price × user multiplier, per-condition chips, exports keyed by TCGplayer SKU, prices converted to the user's currency, English-only relevance** ("You can fill from TCGplayer. It's only really relevant for English cards" 🟢F) — matches the TCGplayer API's own data model at SKU granularity. TCGCSV alone can't produce the condition chips, and the affiliate program can't produce any of it. That leaves three candidates, in descending plausibility:

1. **A grandfathered or partner API key** (cleanest fit for SKU-level market prices; the product predates nothing that rules this out),
2. **Scraping product pages** (ToS-violating, fragile, but yields per-condition data),
3. **A hybrid:** TCGCSV/Scrydex-class feed for catalog + product-level prices, with condition chips derived by heuristic (e.g., condition multipliers off NM) — possible, but the Dec 2025 video presents the condition prices as pulled, not derived. 🟢F

**Freshness:** whatever the route, the observable cadence is daily-ish — consistent with either a nightly API sync or the mirror's 20:00 UTC refresh; nothing suggests real-time pricing. ⚪

---

## 5. Angle 4 — How the catalog database is built and updated

**It's a hand-curated matching catalog with a crowd-sourced error loop — closer to "wiki with one librarian" than to an automated sync.** The evidence:

- **Origin** 🟢F: "I asked my friend, the developer of CardUploader… 'can you make me some sort of image-matching thing'… and he made it for me" (Dec 2025 walkthrough). The catalog exists to serve the matcher, which explains its defining choice:
- **Deliberate variant collapse** 🟢F: "We do not store [reverse holo, holo, first edition, stamped] as separate database entries to reduce mismatches" (FAQ, still current Sept 1); "we only have the one Base Set Blastoise… just to stop mismatches" (video). Variants are user-tagged labels injected into titles — they never change the match or the auto-price. (This remains the client's single biggest exploitable gap; unchanged since the teardown.)
- **The update loop** 🟢F: missing/wrong card → in-app "Report Issue" (wrong match / duplicate entry / not in database) → credit refunded → team fixes "usually within 48 hours." On camera: "We can't have everything, but… with your guys' help we can all work together and get it done." That is a human-in-the-loop pipeline on a ~2-day cycle, fed by paying users.
- **Why 24–48h set support is achievable without retraining** 🔵: in the standard card-ID architecture, the "model" is a feature extractor; the catalog is a **retrieval index of reference images**. Supporting a new set = ingest its images and metadata into the index — no model retraining (Ximilar describes exactly this; their models even span CardUploader's game lineup). This matches the FAQ's daily-photo-update language (now removed, see §7) and the 48h missing-card turnaround.
- **Plausible upstream sources** ⚪🔵: TCGplayer catalog data (products, sets, numbers, rarities, images — via TCGCSV or an API key; also the natural origin of the stored TCGplayer SKU per card), plus per-game catalog APIs: **Scrydex** (pokemontcg.io's commercial successor; roster overlaps CardUploader's almost exactly — Pokémon EN+JP, Lorcana, One Piece, Riftbound, MTG, Gundam; new expansions "within 24-48 hours of official release"; pokemontcg.io now announces "Now part of Scrydex"), **TCGdex** (free, open, the strongest open source for *Japanese* Pokémon), community datasets. No first-party statement names any upstream; the DB was described in Dec 2025 as built by the developer, incrementally, per user demand. 🟢F
- **What they store** (unchanged from teardown): per-game databases with card image, set, number, rarity, language, artist, year, TCGplayer SKU.

---

## 6. Angle 5 — AI search vs. search engine: what's actually inside

**Verdict (unchanged from the teardown, now mechanically grounded): there is no LLM or semantic search in CardUploader. "AI" means one thing: a computer-vision matcher. Everything text-based is conventional keyword search.**

| Surface | Technology | Evidence |
|---|---|---|
| Photo → card ID | **Trained CV model matching against the catalog's reference images** — "trained on hundreds of thousands of Pokemon cards… over 95% accuracy for standard Japanese & English cards" (FAQ 🟢F). The 38-min official walkthrough describes image matching, autocrop/detection preprocessing ("this Charizard got automatically cropped and it's going to match easier to our database" 🟢F), and no LLM anywhere. | The industry-standard architecture for this is **embedding-based reverse image search**: extract a feature vector per photo, nearest-neighbor search over precomputed vectors of every reference card image. Ximilar (a commercial vendor covering the same games) describes exactly this and claims 97%+; a hobbyist MTG pipeline resolves the *exact printing* of a basic Island out of 200+ printings with a stock VGG16 embedding + cosine KNN. Per-class CNN classification is impractical at 20k–90k+ cards per game, which forces the retrieval design. Simpler perceptual-hash pipelines (pHash + Hamming distance) work at hobby scale and — notably — **struggle with holo/1st-ed variants, consistent with CardUploader excluding them.** 🔵🟡 |
| Where the vectors could live | **Supabase pgvector** — CardUploader's known primary DB is Supabase Postgres, and Supabase's first-party recipe covers exactly this: CLIP embeddings (512-dim) in pgvector with indexed nearest-neighbor queries, no external vision API needed. ⚪ (Plausible-fit evidence, not proof — Terms also name OCR, autocrop, and condition-assessment models, all standard CV components available off the shelf from the Ximilar vendor class.) 🔵 |
| In-app Card Search / Listing Creator | **Keyword type-ahead** over the catalog + set browse + rarity filters. No NL layer. | Teardown 🟢F, unchanged. |
| Public Sales Lookup | **Keyword match over sold-listing titles.** Results are raw listings, not canonicalized to cards. | Teardown 🟢F, unchanged. |
| "eBay Listed" | Regional **keyword search of active eBay listings** by card title. | Video 🟢F. |

**Implication for the client (restating the teardown with more confidence):** the exploitable upgrade is not "more AI" — it's **structured, typo-tolerant search with query parsing** ("charizard psa 10 base set" → name+grade+set facets) and **sold comps canonicalized to card/variant/grade**. CardUploader's architecture (title-keyword sold search over a variant-blind catalog) cannot do this without re-architecting. ⚪

---

## 7. Changes detected since the Aug 23 teardown 🟢F

Checked Sept 1, 2026 against the live FAQ:

1. **"Database photos are updated every day" claim is gone** from the FAQ.
2. **"We support over 50 TCGs"** (was "45+ TCG databases" / FAQ "over 50" in marketing) — and the FAQ now designates Card Search as the authoritative support test ("If it shows up there, it's supported").
3. Missing-card turnaround now quoted flat at **"48 hours"** (was "generally added within 24 hours," FAQ 48h).
4. The FAQ contains **no mention of eBay/TCGplayer data sources anywhere** — sourcing remains fully undisclosed first-party.
5. Graded credit pricing clarified: PSA/CGC/TAG/ACE 2 credits per cert, BGS 1; pricing-only lookups free.

---

## 8. What this means for the client's build

1. **Sold comps are the hard part, and CardUploader hasn't solved it legitimately-and-publicly either.** Plan for: (a) a **feed vendor** (SoldComps-class hosted APIs from ~$9/mo 🟡, or Alt-style licensed aggregation as CardUploader itself uses for graded 🟢F), and/or (b) carefully scoped scraping with counsel review — and **start archiving from day one**: the ~90-day eBay window means accumulated history *is* the moat (PriceCharting's and Card Ladder's whole business). The eBay API license restriction on derived average prices means official-API routes can't back a public stats page anyway. 🔵
2. **The eBay seller side is free and open — build API-first.** OAuth + Inventory + Fulfillment + Browse need no partnership. Budget for the growth check at scale, and decide deliberately between Inventory API (modern, but listings become un-editable in Seller Hub) vs. Trading AddItem (legacy, seller-editable) — CardUploader's #1 support issue is still CSV rejection friction we can delete entirely. 🔵
3. **TCGplayer: assume no key.** Build on **TCGCSV** (daily, free, product-level prices + catalog incl. images) as the backbone; add **JustTCG or Scrydex** if condition-level pricing is needed; treat per-condition chips as a nice-to-have CardUploader gets from a privileged route we likely can't replicate. Keep the affiliate program for monetized link-outs (it's data-free). 🔵🟡
4. **Catalog: copy the retrieval architecture, beat the curation.** Reference-image index + embedding search (pgvector/CLIP on Supabase, or buy Ximilar-class API) gives release-day set support by ingestion, no retraining. Seed from TCGCSV + Scrydex/TCGdex rather than hand-building like CardUploader did — and keep variants as first-class rows (`card_variants`), since variant-blindness is baked into their matcher's accuracy strategy and is expensive for them to unwind. 🔵⚪
5. **The live test was run (Sept 1, 2026) and answered:** CardUploader's `/sales` reaches back to **Dec 2018** — its sold pool is a licensed multi-year, multi-marketplace archive. Competitive implication: matching their free Sales Lookup is **not** a scraping project, it's a **data-licensing line item** (Alt/Card Ladder-class feed, or years of patient accumulation). Budget accordingly, and treat *canonicalizing* that history to card/variant/grade — which nobody in the space does — as the differentiator rather than raw depth. ⚪

---

## 9. Source index (principal)

**Primary/official:** eBay Developers Program (OAuth auth-code grant; Inventory API overview; Fulfillment API + release notes; Browse `item_summary/search`; application growth check; get-started/compliance pages incl. API License clauses) · TCGplayer developer docs (`pricing/sku/{skuIds}`, program-closure notice, affiliate program) · [tcgcsv.com](https://tcgcsv.com/) · [Scrydex FAQ](https://scrydex.com/faq) · [pokemontcg.io](https://pokemontcg.io/) · [TCGdex](https://tcgdex.dev/) · [Supabase CLIP image-search guide](https://supabase.com/docs/guides/ai/examples/image-search-openai-clip) · [130point About](https://130point.com/about) · CardUploader FAQ + [/sales](https://carduploader.com/sales) · Official walkthrough video (Dec 3, 2025, YouTube `luSdX4LOcII`) · Ximilar engineering blog (card-ID architecture, 2022/2023).
**Secondary:** SoldComps "eBay Sold Data API Alternatives" (July 2026) · JustTCG blog (2025) · CardGrader "TCGplayer API Alternatives" (2026) · ScrapingBee TCGplayer guide · Ballcard Genius best-offer explainer (2023) · eBay community threads (Marketplace Insights access; 130point) · hobbyist pipelines (tmikonen MTG detector 2020; NolanAmblard Pokémon scanner 2022; Zach Brown CV cataloguer 2025).

*Verification status: claims are quote-backed extractions from the sources above, cross-checked against the Aug 23 first-hand teardown; the planned 3-vote adversarial refutation pass did not complete. Re-verify load-bearing items (esp. §2 inferences and §4 route ranking) before client-facing commitments.*
