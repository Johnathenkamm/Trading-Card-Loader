# Launch obligations and platform-policy risks: Trading Card Loader (tradingcardloader.com)

Research notes compiled 2026-09-28 for the U.S.-based trading-card seller web app in `card-db-mvp` (Railway). **This is research, not legal advice.** Items marked ⚖️ need review by a lawyer (and tax items by a CPA). All web sources were read on 2026-09-28. developer.ebay.com, partnernetwork.ebay.com, help.tcgplayer.com, support.pokemon.com and ebay.com help pages block the fetch tool, so I read them as rendered pages in the Browser pane. I did not sign in anywhere. App behavior comes from the repository working tree (which has uncommitted edits), read on 2026-09-28, and from the public site.

**How to read the checklists.** Each section's *Inferences* has a checklist table with these columns: obligation or risk, source and version, what it means for us, what the app does today, severity, and whether it blocks launch.
- **Severity:** **Critical** = likely platform termination or serious legal exposure. **High** = material exposure or lost revenue. **Medium** = fix soon or before scaling. **Low** = good practice.
- **Blocks launch?:** **Yes** = fix before public launch. **Feature** = don't ship that feature publicly until it's resolved. **Revenue** = launch is possible, but that income stream won't pay or won't be compliant. **No** = does not block.

## 1. eBay Developers Program: what the app must do before and after going to production (OAuth user tokens, Sell Inventory/Account/Fulfillment APIs, Browse API)

### Takeaway
Before its first production call, the app must do three things: subscribe to Marketplace Account Deletion notifications (or validly opt out), register a privacy-policy URL on its RuName, and comply with the API License Agreement (ALA; last announced revision June 24, 2025). Beyond the rules on storing, caching and displaying data, the ALA also requires:
- a binding end-user agreement when eBay content is shown to users;
- minimum security measures (DPA Annex II);
- eBay's written permission before eBay content is used to "suggest or model prices".

The deletion endpoint is already built and follows eBay's protocol. The real gaps are elsewhere: there are no Terms of Service; OAuth tokens and the eBay client secret are stored in plaintext, and the admin console is password-only (Annex II expects encryption and 2FA); two price aids are built on eBay data; and catalog stock images are pushed into eBay listings. Default call limits (Browse 5,000/day) are fine for launch but will force an Application Growth Check as usage grows.

### Cited Findings

#### Marketplace Account Deletion / Closure notifications
- Every developer must "1) subscribe to eBay marketplace account deletion/closure notifications; or 2) follow the process to opt out". Non-compliance "will result in termination of your access to the Developer Tools, and/or reduced access to all or some APIs". New developers cannot make their first production API call until they subscribe or opt out. Source: [eBay: Marketplace Account Deletion](https://developer.ebay.com/marketplace-account-deletion) (page undated).
- Endpoint rules: it must be an https URL, must not contain an internal IP or `localhost`, and must accept GET and POST. On subscription eBay sends `GET ?challenge_code=…` and expects HTTP 200 with JSON `{"challengeResponse": SHA-256(challengeCode + verificationToken + endpoint)}`. The verification token must be 32–80 characters (alphanumeric, `_`, `-`). Source: [same page](https://developer.ebay.com/marketplace-account-deletion).
- Acknowledgment: the endpoint should "immediately acknowledge" each notification with 200/201/202/204. eBay resends until it is acknowledged. After 24 hours without acknowledgment, the endpoint is "marked down" and eBay emails an alert. Developers then have 30 days to fix it before being marked non-compliant. Source: [same page](https://developer.ebay.com/marketplace-account-deletion).
- Signatures: verify the `x-ebay-signature` header with the Notification API's `getPublicKey`, caching the key for about an hour. Source: [same page](https://developer.ebay.com/marketplace-account-deletion).
- Deletion duty: delete the user's data, or retain it only "to meet specific and demonstrable legal requirements (e.g. tax, collections, AML regulations)". "Deletion should be done in a manner such that even the highest system privilege cannot reverse the deletion." Source: [same page](https://developer.ebay.com/marketplace-account-deletion).
- Opting out is available only to an application "that is not persisting any eBay data". Giving incorrect information "may result in penalties or having their account disabled". Source: [same page](https://developer.ebay.com/marketplace-account-deletion).

#### API License Agreement (ALA) and its Data Processing Addendum
- **Version.** The ALA page shows no date. eBay's Q2 2025 developer newsletter says an updated ALA "was posted to our portal on June 24, 2025", adding "detailed data protection measures" and "important restrictions … to the use of Restricted APIs and AI content". Sources: [ALA](https://developer.ebay.com/join/api-license-agreement); [Q2 2025 newsletter](https://developer.ebay.com/updates/newsletter/q2_2025). The Q2 2026 newsletter announces no newer revision ([Q2 2026 newsletter](https://developer.ebay.com/updates/newsletter/q2_2026)). Amendments take effect 30 days after posting (ALA "Modification").
- **Section numbers.** The page does not print them. I reconstructed them from the ALA's own cross-references ("Section 8.1(b)", "Sections 3.3 and 12.2", the survival clause), so they may be off.
- **§2.2 Growth Check.** Applications "must comply with eBay's Compatible Application Growth Check requirements, incorporated herein by reference". Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§3.1 Authorized Use.** Only "limited intermediate copies of eBay Content only as necessary … must be deleted when they are no longer required". Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§3.3 Call limits.** eBay may cap calls. "Attempts to circumvent API call limits" can lead to suspension or termination. Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§4.2 Sublicensing display to your users.** Conditions: keys are never shared, all calls run through your keys, and users have no programmatic control. Also: "You will enter into a binding agreement with each of Your Users that includes the following terms: (1) Your Users will be bound by this API License Agreement; (2) eBay will be a third-party beneficiary to such agreement; (3) such sublicense is revocable at any time." Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§8.1(b) Public Display.** Publicly available eBay content may be shown "to promote eBay and enable Your Users to search and browse listings". Restrictions:
  - delete it when it is no longer publicly available;
  - it "may not be co-mingled or combined with non-eBay Content" and must be "visually isolated";
  - content available only after sign-in "may only be displayed to that eBay User … and such eBay Content may not be used for Public Display without the explicit prior consent of that Authenticated User".

  Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§8.1(c) Freshness.** Displayed listing information may be at most 6 hours older than eBay's, other eBay content at most 24 hours, and anything staler must be disclosed. Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§8.1(d) Derivation.** eBay's "express prior written permission" is required to use or display eBay content in a way that enables derivation of, among other things, "Average selling price or gross merchandise sold for any eBay category", "Aggregated seller or buyer data", "Information relating to specific eBay Users", or "Conversion, completion or success rates". Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§8.2 Privacy.**
  - Delete Personal Information at the earliest of: your retention policy, a request from eBay or the user, when it is "no longer necessary for the specific, legitimate purpose", or termination.
  - "You will not under any circumstances collect, store or share any eBay User' User IDs or passwords."
  - Publish a privacy policy consistent with eBay's Privacy Notice.
  - Use other users' information (for example buyers) "only as strictly necessary".
  - "You will not use Personal Information to send or enable sending unsolicited communications of any type to any eBay Users."

  Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§8.5 Restricted APIs.** These are APIs about "market trends, pricing strategies, sales volumes". They may be used to build pricing tools "only upon receiving eBay's express prior written consent", and eBay then receives an irrevocable license to the resulting "eBay Enhanced Tools". Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **§9 Restricted Activities (examples).** Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
  - "Use eBay Content, either alone or in combination with third-party information, to suggest or model prices for items listed on eBay Site."
  - No seller arbitrage, "(for example, automatically repricing eBay listings in response to price changes on other third-party sites…)".
  - No selling, distributing, storing or modifying eBay Content "other than for the purposes allowed".
  - No training of ML/AI on eBay Content.
  - No providing data to eBay "without having a valid legal basis and all of the rights necessary".
  - No "excessive or abusive usage".
- **§10.** The app must comply with the eBay User Agreement, which is incorporated by reference. **§12.1:** eBay may audit the app and "records related to the storage, use and handling of eBay data". **§16.2:** on termination, destroy eBay Content and Personal Information within 10 days. Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **Exhibit A (DPA).** Source: [ALA, Exhibit A](https://developer.ebay.com/join/api-license-agreement).
  - Developer and eBay are independent controllers; processing is limited to the Agreement's purposes.
  - Security must "meet or exceed industry standards", including Annex II: encryption in transit and at rest, encrypted backups, encrypted database connections, and "appropriate authentication (e.g. two-factor authentication)" for remote access.
  - The developer affirms it is not a "covered person" under 28 CFR Part 202 and must certify this periodically.

#### Application Growth Check and call limits
- The Growth Check is free and is required to "Increase the API call limits for your application" or "Use restricted APIs in production". Source: [Application Growth Check](https://developer.ebay.com/grow/application-growth-check). The form asks for "estimated call peak, both hourly and daily volume, for each of the API calls". Source: [Apply for the growth check](https://developer.ebay.com/api-docs/static/gs_apply-for-the-application.html). eBay describes it as "a final step before allowing your Production keyset to access restricted APIs". Source: [Use the growth check for restricted APIs](https://developer.ebay.com/api-docs/static/gs_use-the-application-growth.html).
- Default Sell limits: Account API 25,000/day; Inventory API 2,000,000/day; Fulfillment order resource 100,000/day; Notification 10,000/day; Identity 5,000/day ("additional user restrictions apply"); Trading 5,000/day. Source: [Sell API call limits](https://developer.ebay.com/develop/api/sell/api_call_limits).
- Browse API: 5,000/day for all methods except getItems, plus 5,000/day for getItems. It carries the footnote "* Buy APIs require an additional license". Source: [Buy API call limits](https://developer.ebay.com/develop/api/buy/api_call_limits).
- Buy APIs Requirements: "Many of the Buy APIs are a (Limited Release). The use of eBay's Buy APIs in production is intended for eBay partners only. You must apply for production access through the eBay Partner Network." Source: [Buy APIs Requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html). Our Sept 1 internal report found eBay's docs inconsistent on this point, and basic Browse search broadly available in practice. Source: internal `C:\Users\johnn\Antigravity_Files\Card_reader\carduploader-data-sourcing-research.md` §3.

#### OAuth and token handling
- The RuName's Privacy Policy URL is required when an app uses user access tokens ("This policy states how you use the eBay information that your application can access"). Refresh tokens "must [be stored] in a secure location". User access tokens last 7,200 s. Source: [eBay Authorization guide](https://developer.ebay.com/develop/guides/sell/authorization).

#### eBay site rules the Sell integration inherits
- eBay's Picture policy does not allow "Photos that don't accurately represent the item" or "Stock photos for used, damaged, or defective items", and requires at least 500 px on the longest side. Source: [eBay Picture policy](https://www.ebay.com/help/policies/listing-policies/picture-policy?id=4370) (undated).
- The eBay User Agreement bans robots, spiders, scrapers and other automated access without eBay's express permission. Nobody who cannot form binding contracts (for example, anyone under 18) may use eBay. Source: [eBay User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259) (per search excerpt). The 2026 update added "buy-for-me"/LLM agents to the list. Source: [The Register, Jan 22, 2026](https://www.theregister.com/2026/01/22/ebay_updates_legalese_to_ban/).

#### What the app does today (code read 2026-09-28)
- **Deletion endpoint.** `/ebay/account-deletion` (`src/server.ts:1309-1332`, `src/app/ebay-deletion.ts`):
  - GET answers the challenge with 200 JSON.
  - POST verifies `X-EBAY-SIGNATURE` against the Notification API public key (cached 1 hour), returns 412 on failure, runs the deletion, then returns 204.
  - The deletion removes the `ebay_connections` row (username, user ID, tokens, policies, ship-from), sets `sellers.ebay_connected=false`, and nulls `orders.buyer`/`ship_to` where the buyer username matches.
  - A receipt log stores no identities. The token is 48 characters. A one-time boot scrub removes seller/buyer keys from `sold_sales.raw`.
- **OAuth scopes:** `api_scope`, `sell.inventory`, `sell.account`, `sell.fulfillment`, `commerce.identity.readonly` (`src/app/ebay-sell.ts:30-35`).
- **Secrets at rest.** `access_token` and `refresh_token` are plain `text` columns (`ebay-sell.ts:55-57`). The eBay client secret can also be saved in plaintext in the `meta` table from the owner console (`src/app/ebay-config.ts:40,114`). The owner console uses its own password-only login (`ADMIN_EMAIL`/`ADMIN_PASSWORD`, per project memory and the feature inventory).
- **Browse results** are cached in memory for 10 minutes (`src/ebay.ts` header).
- **Listing images.** Images sent to eBay are `[l.image_url, inv?.image_large, inv?.image_small]`, so catalog (TCGplayer CDN) images follow the seller's scan (`ebay-sell.ts:427`). The public card page's "List on eBay" button promises to "Build a listing from the catalog stock image — no scan needed" (`src/render/pages.ts:481`).
- **Price aids built on eBay data:**
  - the review-row popup shows "Listed from $lo to $hi · affiliate links" from Browse results (`src/render/app.ts:2051`);
  - the public Sales Lookup computes last sale and last-3 average (`src/sales.ts:227-231`).
- **Quantity sync.** `bulk_update_price_quantity` keeps eBay stock right after non-eBay sales (`ebay-sell.ts:560-575`). It is not automatic repricing.
- **Production state.** As of the Sept 13 inventory there were no eBay keys on Railway. Keys can now be entered in the owner console at `/admin/ebay`. I have not verified current production state (keys, deletion subscription), because that needs a sign-in. Source: internal `cardindex-feature-inventory.md` (lines 114, 192–197).
- **Terms of Service.** There is no `/terms` route and signup has no terms or age acceptance (`src/render/auth.ts`). The live `https://tradingcardloader.com/terms` returned HTTP 404 on 2026-09-28.

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| E1 | Subscribe the **Production** keyset to Marketplace Account Deletion before the first production call | [eBay MAD page](https://developer.ebay.com/marketplace-account-deletion) (undated) | Save the endpoint and token in the portal and pass "Send Test Notification". Keep the endpoint up: 24 h unacknowledged → marked down; 30 days → non-compliant | Code complete and matches the protocol. Production subscription not verified (needs a portal sign-in). `APP_BASE_URL` or `EBAY_DELETION_ENDPOINT` must match the portal URL byte for byte | Critical | Yes (for every eBay feature) |
| E2 | Delete *all* of a closed account's data, irreversibly | Same | Deletion should also cover data tied to that seller elsewhere, and survive backups | Harvested `sold_sales` rows carry no `seller_id`, so they can't be deleted when a seller closes, disconnects or asks for deletion. Their `/itm/` URL re-identifies the seller. Railway backup retention unknown. The 204 reply has no Content-Type header; the MAD page mentions an application/json content type, so confirm with a test notification | High ⚖️ | Feature (sold archive) |
| E3 | Terms of Service binding users to the ALA (§4.2) | [ALA](https://developer.ebay.com/join/api-license-agreement) (rev. 2025-06-24) | Any app that shows eBay content to its users needs a user agreement: users bound by the ALA, eBay a third-party beneficiary, sublicense revocable | No ToS (`/terms` is 404; no acceptance at signup) | High ⚖️ | Yes |
| E4 | DPA Annex II security (encryption at rest and in transit, encrypted backups, 2FA for remote/admin access) and §3.2 key confidentiality | ALA Exhibit A | Encrypt OAuth tokens and the client secret at the application level, add 2FA to `/admin`, confirm Railway backup/DB encryption | Tokens and client secret are plaintext in Postgres; admin is password-only | High | Yes (before real sellers connect) |
| E5 | "Not … collect, store or share any eBay User' User IDs" (§8.2) | ALA | The literal text clashes with storing seller usernames/IDs and buyer usernames. It is probably aimed at login credentials, but that is ambiguous | Stores `ebay_user`, `ebay_user_id`, `orders.buyer` | Medium ⚖️ | No (minimize: keep only the opaque userId; hash buyer usernames for deletion matching) |
| E6 | Delete Personal Information once it is no longer necessary (§8.2) | ALA; [Fulfillment release notes](https://developer.ebay.com/api-docs/sell/fulfillment/release-notes.html) (v1.19.19, 2023-02-16: PII masked after 90 days) | Buyer name, city, state, ZIP and username should be purged some time after shipment (eBay itself masks at 90 days) | `orders.buyer`/`ship_to` kept indefinitely | Medium | No |
| E7 | No "suggest or model prices" from eBay content (§9); no derived average selling price without permission (§8.1(d)) | ALA | Showing live-listing price ranges as a pricing aid, or averages computed from eBay sales, needs eBay's written permission | Popup shows a min–max price range from Browse results; Sales Lookup shows last-3 average including eBay-harvested rows | High ⚖️ | Feature |
| E8 | Don't push catalog stock images into eBay listings | [eBay Picture policy](https://www.ebay.com/help/policies/listing-policies/picture-policy?id=4370); ALA §9 (rights to data sent to eBay) | Stock photos are banned for used items and must represent the actual item. The images belong to TCGplayer or the card's IP owner. Require the seller's own photo and drop catalog images from eBay payloads | Catalog images appended to every Inventory API listing; "List on eBay … no scan needed" | High | Feature |
| E9 | Browse API production licensing | [Buy APIs Requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html); [Buy call limits](https://developer.ebay.com/develop/api/buy/api_call_limits) | "Buy APIs require an additional license" and are "intended for eBay partners only". Confirm with eBay developer support that Browse search is licensed for this use | "eBay Listed" popup and panel use Browse | Medium | Feature (Browse panel) until confirmed |
| E10 | Call limits; Growth Check before scaling | [Sell limits](https://developer.ebay.com/develop/api/sell/api_call_limits), [Growth Check](https://developer.ebay.com/grow/application-growth-check) | Browse at 5,000/day is shared by *all* users. Plan a Growth Check and prepare hourly/daily peak estimates per call. The review checks ALA compliance, so the sold-archive and pricing features will be scrutinized then | 10-minute cache helps. The harvest (every 6 h per seller) is well inside the Fulfillment limit | Medium | No |
| E11 | Freshness (§8.1(c)) | ALA | Listings may be at most 6 h stale, other content at most 24 h | Browse cache of 10 min is fine. Sold archive: see §2 | Low | No |
| E12 | Only licensed third-party sold feeds (the ALA incorporates the eBay User Agreement's scraping ban) | [eBay User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259); ALA §10 | The owner console accepts any CSV/JSON sold feed. A feed scraped from eBay would breach eBay's terms | Importer accepts feeds from any source (`src/app/soldimport.ts`, admin import UI) | High ⚖️ | Feature |
| E13 | No messages to eBay buyers using order data (§8.2) | ALA | Don't email buyers or add them to marketing lists | App doesn't do this | Low | No |

- If eBay audits under §12.1 or during a Growth Check, E7, E8 and the sold archive (§2) are where a review is most likely to find breaches.
- TCGplayer is part of eBay's corporate family (see §5). A problem with TCGplayer data could therefore spill into the eBay relationship.

### Gaps
- The actual "Compatible Application Growth Check requirements" checklist is not public; the public pages describe only the process. The Sept 1 internal report quotes growth-check review criteria about apps that "derive average selling price…", and I could not re-find that wording on 2026-09-28. The same restriction does appear in ALA §8.1(d).
- I did not read the OAuth token-request rate limits ("Access token rate limits") page.
- Apart from the deletion-notification prerequisite, I found no public description of how eBay reviews or approves production keysets.
- I could not see production state (keys in the console, deletion subscription validated, test notification received) without signing in.
- I found no eBay guidance on whether showing Browse listing prices inside a seller pricing tool counts as "suggest or model prices". This needs confirmation from eBay developer support or counsel.
- The ALA section numbers are my reconstruction.

## 2. Is a public sold-price archive built from connected sellers' eBay orders allowed? Is sold data available through official APIs?

### Takeaway
As currently built, probably not, on my reading of the ALA (⚖️ confirm with counsel and eBay). Order data is sign-in-only eBay content, and the ALA attaches five conditions to it:
- it can't go into a public display without each seller's *explicit prior consent*;
- it must come down when it is no longer publicly visible on eBay;
- it can't be mixed with non-eBay data;
- average selling prices, or information about specific eBay users, can't be derived from it without eBay's written permission;
- eBay claims ownership of anything derived from it.

The app breaks these as follows:
- it backfills 730 days of each seller's sales the moment they connect;
- each public row links to the seller's eBay listing;
- it can reveal accepted Best Offer prices, which eBay itself does not show publicly;
- it computes last-3 averages next to rows from other marketplaces;
- the only notice to sellers is a privacy-policy sentence.

There is no open official route to market-wide sold data: the Finding API was decommissioned on Feb 4, 2025, and Marketplace Insights is limited release, with its docs now behind a sign-in. Keep harvested sales private to each seller and power public comps from licensed data, or get eBay's written approval first.

### Cited Findings
- **ALA rules that apply to order data** ([ALA](https://developer.ebay.com/join/api-license-agreement), rev. announced June 24, 2025):
  - §8.1(b)(3): sign-in-only content "may not be used for Public Display without the explicit prior consent of that Authenticated User";
  - §8.1(b)(1): "When the eBay Content is no longer publicly available, you must delete it from your Application";
  - §8.1(b)(2): no co-mingling with non-eBay content;
  - §8.1(d): permission required to derive "Average selling price…", "Aggregated seller or buyer data", or "Information relating to specific eBay Users";
  - §9: no "suggest or model prices", and no commercializing or storing eBay content "other than for the purposes allowed";
  - §5: eBay "shall own any content created or derived therefrom or any form of derivative works".
- **Restricted APIs.** Pricing and sales-volume data needs eBay's written consent before being used in a pricing tool, and eBay then gets a license to the tool (§8.5). Source: [ALA](https://developer.ebay.com/join/api-license-agreement). The trade press reported the June 2025 changes, including limits on AI use of eBay data. Source: [EcommerceBytes, July 18, 2025](https://www.ecommercebytes.com/2025/07/18/ebay-restricts-developers-from-using-its-data-to-train-ai/).
- **Fulfillment API reach.** Orders can be retrieved up to two years back; personally identifiable fields "are masked for orders older than 90 days" (v1.19.19, 2023-02-16). Source: [Fulfillment API release notes](https://developer.ebay.com/api-docs/sell/fulfillment/release-notes.html). The API returns only the connected seller's own orders. Source: internal Sept 1 report §2, citing [Fulfillment API docs](https://developer.ebay.com/develop/api/sell/fulfillment_api).
- **No official market-wide sold data.** The Finding API (`findCompletedItems`) was decommissioned on Feb 4, 2025. Marketplace Insights is "restricted and not open to new users", needs a growth check, and returns about 90 days of history. The Browse API covers active listings only. Source: internal `carduploader-data-sourcing-research.md` §2, citing [SoldComps survey](https://sold-comps.com/alternatives) and an [eBay developer forum thread](https://community.ebay.com/t5/eBay-APIs-Talk-to-your-fellow/Marketplace-Insights-API-query-about-small-project/td-p/34802982).
- **Marketplace Insights docs now private.** On 2026-09-28 the public Marketplace Insights overview URL ([link](https://developer.ebay.com/api-docs/buy/marketplace-insights/static/overview.html)) redirected to the eBay developer sign-in page, with the return path `marketplace-insights-private` (observed in the Browser pane).
- **Best Offer prices.** eBay itself shows only the struck-through list price on Best Offer sales. Tools that reveal the accepted price (130point, CardUploader) don't document where that data comes from. Source: internal Sept 1 report §2, point 3.
- **What the harvest stores** (`src/app/soldharvest.ts`):
  - it pulls every PAID, non-cancelled order line, backfilling 730 days on the first run;
  - it runs every 6 h and immediately when a seller connects (`src/server.ts:2284-2289`, "First sold-sales harvest right away");
  - it stores title, price (actual line cost per unit), sale date, sale type, `orderId#lineItemId`, `https://www.ebay.com/itm/{legacyItemId}`, SKU, quantity, and card/variant/grade from inventory;
  - no buyer fields; mock-mode rows are flagged demo.
- **What the public sees.** Sales Lookup (`src/sales.ts`) shows real rows with affiliate-tagged links to `/itm/` pages (`soldListingLink`, line 93–112), plus last sale and last-3 average (lines 227–231). It filters across eBay, Goldin and Fanatics in one table.
- **What sellers are told.** The public privacy policy says: "From your paid eBay orders we also take the card title, sale price, sale date, listing number and your SKU. These become sold-price comparisons that other visitors can see." It also says: "Sold-price records contain no personal details and may be kept as market history." Source: `src/render/privacy.ts:43,66`; live [/privacy](https://tradingcardloader.com/privacy) (updated Sept 28, 2026). The code has no separate consent step before the harvest starts on connect.

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| S1 | Each seller's explicit, prior, revocable consent before their order data goes public | ALA §8.1(b)(3) | A privacy-policy sentence is not "explicit prior consent". Use an unticked opt-in at connect, revocable in Settings | Harvest (730-day backfill) starts on connect with no opt-in | Critical ⚖️ | Feature (public display of `ebay-orders` rows) |
| S2 | eBay's written permission to derive averages or price comps from eBay data | ALA §8.1(d), §9, §8.5 | Last-sale and last-3-average stats on eBay-sourced rows likely need permission. The Growth Check review would surface this | Stats computed and shown publicly | High ⚖️ | Feature |
| S3 | Remove eBay content once it is no longer public on eBay | ALA §8.1(b)(1) | Sales older than eBay's public sold-listing window shouldn't appear. The 2-year backfill conflicts | Backfill 730 days; rows kept indefinitely "as market history" | High ⚖️ | Feature |
| S4 | No co-mingling of eBay content with non-eBay data | ALA §8.1(b)(2) | eBay-sourced rows must be visually separate from Goldin, Fanatics and imported feeds, and from TCGplayer prices. Combined stats conflict | One table and one set of stats across marketplaces | High | Feature |
| S5 | No "information relating to specific eBay Users"; don't publish non-public Best Offer prices | ALA §8.1(d); internal Sept 1 report | The `/itm/` link exposes which seller made each sale. Order-derived accepted Best Offer prices aren't shown publicly by eBay | Links shown (affiliate-tagged); unit price from `lineItemCost` | High ⚖️ | Feature |
| S6 | Per-seller deletion of harvested rows | ALA §8.2; MAD page | Needed for disconnect, account closure and deletion requests | `sold_sales` has no seller link; the privacy policy promises to keep rows | High | Feature |
| S7 | Private use is fine | ALA §8.1(b)(3) | A seller seeing their *own* sales history after authenticating is allowed | n/a | Low | No |
| S8 | Licensed provenance for any imported sold feed | eBay User Agreement (anti-scraping); ALA §10 | Third-party sold data needs a license that allows public display, and must not be scraped from eBay | Importer accepts any file | High ⚖️ | Feature |

- The lowest-risk design keeps harvested eBay sales private to the seller: their own dashboard, their own pricing history. Public comps would then come from licensed data only, or be deferred until eBay gives written approval.
- If the public archive stays, do all of the following before it goes live:
  - add an explicit opt-in;
  - limit rows to eBay's public window;
  - drop the `/itm/` links and Best Offer prices;
  - separate eBay rows from non-eBay rows;
  - stop computing averages from eBay rows;
  - add `seller_id` to harvested rows so they can be deleted.

### Gaps
- I did not confirm from an eBay source how long sold listings stay publicly visible on eBay (commonly said to be about 90 days).
- I found no eBay guidance specifically about public sold-price databases built from Fulfillment API data. Everything above is my reading of the ALA ⚖️.
- It is unclear whether de-identified aggregates (no URLs, no usernames) still count as "eBay Content". The definition covers data "retrieved from eBay", and §5 claims derived works ⚖️.

## 3. eBay Partner Network (EPN) and eBay Ambassador: placement inside a SaaS tool, disclosure, prohibited placements, link format

### Takeaway
A new EPN Network Agreement was published on Sept 24, 2026 and takes effect for existing partners *today*, Sept 28, 2026. It treats promotional content "created by a developer's program tool or API" and any "Software Application" as restricted methods that need EPN's prior written approval, and EPN "will withhold all compensation for traffic directed through Software Applications not approved by EPN". The bigger business problem: the client's campaign comes from an **eBay Ambassador** account. Under Exhibit C, only EPN-curated "Eligible Ambassador Listings", sold while listed in the Ambassador Portal, earn commission, and an Ambassador "may not simultaneously participate in any other EPN Program". Most of the app's tagged search, sold-search and item links will therefore earn nothing unless the client gets a standard EPN account, or EPN's written permission, and approval for the app. The disclosure wording matches EPN's own example. Its placement on the Sales Lookup and in the "eBay Listed" popup needs fixing.

### Cited Findings
- **Dates.** "This Agreement was published on the Network website on September 24th, 2026… If you were already a partner of the Network on September 23rd, 2026, these terms will take effect for you on September 28th, 2026." EPN may change the Rate Card and Program Details on 3 days' notice, and Ambassador Program details "at any time without notice". Source: [EPN Network Agreement](https://partnernetwork.ebay.com/page/network-agreement).
- **Definitions.** "Software Application: A software application used or developed by an Affiliate to be used in a Promotional Method." On links: "You may not modify a Link unless it is specifically designed to be modified, and then only within the parameters provided by EPN." Source: [Network Agreement, Definitions and Exhibit A](https://partnernetwork.ebay.com/page/network-agreement).
- **Approvals (Exhibit A).** Source: [Network Agreement, Exhibit A](https://partnernetwork.ebay.com/page/network-agreement). Special business models are applied for at [EPN special business models](https://partnernetwork.ebay.com/resources/special-business-models).
  - "If you wish to create your own Promotional Content, you must first obtain EPN's prior written approval."
  - Promotional Tools: "Obtain EPN's prior written approval if you create new tools and applications using the Promotional Tools."
  - "Unless expressly permitted…, all Promotional Methods are subject to EPN's prior written approval."
  - Examples of Additional Restricted Promotional Methods include "Promotional Content created by a developer's program tool or API".
  - Software Applications need prior written approval, and "EPN will withhold all compensation for traffic directed through Software Applications not approved by EPN."
  - A Software Application may send users through the tracking code "only in an immediate response to a user's deliberate and voluntary click … on a clearly-labeled Link".
- **Restricted methods** (need approval): incentive programs; email, SMS and other electronic communications ("must comply with … the CAN-SPAM Act"; EPN's or the advertiser's name may not appear in the "from" line); paid traffic. Source: [Network Agreement](https://partnernetwork.ebay.com/page/network-agreement).
- **Prohibited methods.** Source: [Network Agreement](https://partnernetwork.ebay.com/page/network-agreement).
  - cookie stuffing;
  - non-bona-fide events, including "clicks or impressions generated when you or your Agents click on your own Promotional Content containing Tracking Code";
  - improper influence;
  - middle servers and URL cloaking (only listed shorteners allowed);
  - "Unacceptable Placements", including "content aimed at children";
  - buying search keywords that include eBay marks;
  - framing;
  - "You may not attempt to intercept or redirect traffic from or on, or divert compensation from, Participating Sites and Content or any other Affiliate";
  - promotional content "placed on an Advertiser website itself (for example, in your listings, your 'About Me' page, or your store…)".
- **Disclosure.** Promotional methods "must clearly and prominently identify Promotional Content as advertising and, where required by Applicable Law, disclose your economic interest as a participant in EPN (e.g., 'As an eBay Partner Network Affiliate, I earn from qualifying purchases.')". Affiliates may not imply that EPN or eBay "supports, sponsors, or endorses you". Source: [Network Agreement, Exhibit A §I.G](https://partnernetwork.ebay.com/page/network-agreement).
- **Privacy notice.** The affiliate's privacy notice must fully disclose "your use of third-party technology, including EPN's Tracking Code (if applicable)" and "your use of cookies and options for discontinuing use of such cookies". Source: [Network Agreement, Privacy and Data](https://partnernetwork.ebay.com/page/network-agreement).
- **Tracking and attribution.** "You must include and maintain the Tracking Code provided to you by EPN … You may not modify the Tracking Codes." A qualifying Buy It Now sale needs a click within 24 hours before purchase; for auctions, a bid within 24 hours of the click. Source: [Network Agreement](https://partnernetwork.ebay.com/page/network-agreement).
- **Using the eBay name.** "eBay" may appear in the name of a software tool "only … subject to EPN's prior written approval" and only descriptively: "'eBay Fee Calculator' is not acceptable while 'Fee Calculator for eBay' would be acceptable". Company or brand names may not incorporate eBay marks. Source: [Network Agreement, Intellectual Property](https://partnernetwork.ebay.com/page/network-agreement).
- **Exhibit C (Ambassador Program).** Source: [Network Agreement, Exhibit C and Registration](https://partnernetwork.ebay.com/page/network-agreement).
  - "Only Eligible Ambassador Listings that sold while they were available via the Ambassador Portal … will be considered Qualifying Transactions."
  - "If you are participating in the Ambassador Program, you may not simultaneously participate in any other EPN Program."
  - From Registration: "You may not simultaneously be registered as an EPN Ambassador and any other EPN account type, unless expressly permitted in writing by EPN."
- **Ambassador background.** The program is limited to "a pre-selected set of eligible items accessible through a special portal", and Ambassadors can't promote their own inventory. Source: [Value Added Resource, Apr 14/24, 2025](https://www.valueaddedresource.net/ebay-ambassador-program/). eBay opened it to all U.S. users with commissions "up to 7.5%". Source: [eBay Inc., Aug 26, 2025](https://www.ebayinc.com/stories/news/with-the-ebay-ambassador-program-everyone-can-be-an-affiliate/). EPN stopped incentives for U.S. sellers on their own inventory from Aug 1, 2025. Source: [Value Added Resource](https://www.valueaddedresource.net/ebay-kills-epn-affiliate-fvf-seller-incentive/) (search summary; secondary).
- **EPN Affiliate Disclosure FAQ** ([EPN FAQ](https://partnernetwork.ebay.com/resources/affiliate-disclosure-faq), undated):
  - Disclosure must be "as close to the promotional contents … and/or links as possible".
  - A footer is not sufficient "if the affiliate links are at the top of the page and scrolling would need to occur".
  - "linking to an affiliate disclosure is not sufficient".
  - In apps the disclosure must be "above the fold".
  - #affiliate is "not acceptable".
  - Suggested wording: "This site contains affiliate links for which I may be compensated" or "As an eBay Partner, I may be compensated if you make a purchase".
  - Violators get at least three notifications before action is taken.
- **What the app does today:**
  - Link building: `src/affiliate.ts` adds `mkevt=1&mkcid=1&mkrid=711-53200-19255-0&campid=<id>&toolid=10001&customid=<surface>` to any eBay URL (search, sold-search, `/itm/`). It re-tags links that already carry *another* campaign ("a page copied from elsewhere shouldn't credit someone else's campaign", line 38–40). It uses the Browse API's `itemAffiliateWebUrl` when one is returned (`src/ebay.ts:144-146`).
  - The owner console calls it "The client's Ambassador account", which accepts "any share link they generated at ambassador.ebay.com" (`src/render/admin.ts:633-636`).
  - Disclosure text (only when tagging is configured): "As an eBay Partner and a TCGplayer affiliate, we may be compensated if you buy through eBay or TCGplayer links on this page." (`affiliate.ts:106-113`).
  - Disclosure placement: directly under the card-page buttons (`render/pages.ts:481-487`); *after* the full Sales Lookup results table (`render/sales.ts:143-145`); near the top of the workspace batch review (`render/app.ts:1041-1042`). The popup label reads only "· affiliate links" (`render/app.ts:2051`).
  - No tagging suppression for the owner's own sessions or seller account.
  - No affiliate links in generated eBay listing content (no `ebayLink`/`tcgplayerLink` calls under `src/app`).
  - The privacy policy mentions affiliate tags but not EPN tracking or cookies specifically.
  - The pricing page names a feature "eBay listing builder + File Exchange CSV" (`src/render/pricing.ts:34`).

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| A1 | EPN prior written approval for an app/tool that generates affiliate links (Software Application / tool-generated promotional content) | [Network Agreement](https://partnernetwork.ebay.com/page/network-agreement) (pub. 2026-09-24, eff. 2026-09-28) | Without approval, EPN can withhold all commissions on this traffic | No evidence approval was sought | High | Revenue |
| A2 | Ambassador account limits | Same, Exhibit C | Only curated Ambassador listings pay, and the client can't also join standard EPN without written permission. Generic search, sold and item links likely earn $0 | Tags every eBay link with the Ambassador campaign | High | Revenue |
| A3 | Disclosure next to the links, above the fold | [EPN FAQ](https://partnernetwork.ebay.com/resources/affiliate-disclosure-faq); FTC (§4) | Move the Sales Lookup disclosure above the table. Replace the popup's bare "affiliate links" with the full sentence. Cover every surface that has tagged links | Card page ✓, workspace ✓, Sales Lookup ✗ (bottom), popup ✗ (weak label) | Medium | Yes (quick fix) |
| A4 | Wording and no implied endorsement | Network Agreement §I.G; EPN FAQ | Current wording matches EPN's FAQ example. The agreement's own example is "eBay Partner Network Affiliate", which is safer. Footer "not affiliated with any marketplace" sits oddly beside "As an eBay Partner"; reword to "not affiliated with or endorsed by eBay or TCGplayer; we earn commissions on some links" | See left | Low | No |
| A5 | No self-clicks | Network Agreement (Non-Bona Fide Events) | The owner using the tool, and the owner's own seller account, generate invalid clicks. Suppress tagging in owner/admin sessions | Not suppressed | Medium | No |
| A6 | Don't divert other affiliates' compensation | Network Agreement (Misdirection) | Re-tagging URLs that carry another affiliate's campaign ID (for example in imported feed URLs) can be "divert[ing] compensation" | Re-tags by design | Low–Medium ⚖️ | No |
| A7 | Privacy notice must describe EPN Tracking Code and cookies, with options to discontinue | Network Agreement, Privacy and Data | Add a paragraph to /privacy | Mentions tags only | Medium | No |
| A8 | Email containing eBay affiliate links needs EPN approval plus CAN-SPAM compliance | Network Agreement (Electronic Communications) | Relevant if price-alert or newsletter emails ever carry tagged links | None today | Low | No |
| A9 | "Content aimed at children" is an unacceptable placement | Network Agreement | Keep the product and marketing seller-oriented and 18+ (ties to §7) | Seller tool; Pokémon imagery | Low–Medium | No |
| A10 | "eBay" in tool or feature names only descriptively, with EPN approval | Network Agreement, IP §E.5 | Rename "eBay listing builder" to "Listing builder for eBay". Never put eBay in the brand or domain | Brand and domain fine; one feature label | Low | No |
| A11 | Link format kept "within the parameters provided by EPN" | Network Agreement | The parameter set in code (`campid`, `customid` ≤256, `toolid`, `mkrid`, `mkevt`, `mkcid`) follows the EPN "Creating an EPN tracking link" doc cited in the code comment, which I couldn't re-verify | Implemented | Low | No |

### Gaps
- EPN's link-format help article ("Creating an EPN tracking link") and the "Common missteps" page redirect the fetch tool to an eBay bot challenge, so I did not re-verify the parameter rules.
- I found no EPN statement on whether a logged-in SaaS web tool counts as a "Software Application". The definition is broad, but the installation rules target installable software. Ask EPN.
- I could not confirm from a primary page (other than Exhibit C) whether Ambassador tracking works at all on arbitrary eBay items or search pages.

## 4. FTC Endorsement Guides (16 CFR Part 255, 2023) and affiliate-link disclosure: what a web app must show, and where

### Takeaway
The revised Endorsement Guides (published July 26, 2023) require clear and conspicuous disclosure of material connections such as affiliate commissions. FTC staff guidance says:
- put the disclosure close to the links;
- a hyperlinked "disclosure" page is "easily avoidable";
- a footer works only if the reader sees it together with the link;
- "affiliate link" alone may not be understood.

The app's sentence is adequate. The gaps are placement on Sales Lookup and the bare "affiliate links" label in the eBay popup. TCGplayer's partner guidelines list "Affiliate link" as an acceptable disclosure, which conflicts with FTC staff guidance, so use the full sentence everywhere.

### Cited Findings
- The revised Guides were published at 88 FR 48092 on July 26, 2023. Sources: [Federal Register](https://www.federalregister.gov/documents/2023/07/26/2023-14795/guides-concerning-the-use-of-endorsements-and-testimonials-in-advertising); [eCFR 16 CFR Part 255](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255).
- FTC staff FAQ ([FTC: What People Are Asking](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking); page date not captured):
  - "You should disclose your relationship to the retailer clearly and conspicuously on your site."
  - "The closer the disclosure is to your recommendation, the better."
  - A hyperlinked disclosure "is easily avoidable, meaning that the disclosure is not clear and conspicuous".
  - "Affiliate link" alone may be insufficient; "Paid link" next to the link can work; "commissionable link" is unclear.
  - Advertisers and intermediaries can be liable for deceptive endorsements they help disseminate.
- EPN's U.S. guidance applies the FTC standard to "Mobile apps, websites…" and wants disclosures "directly preceding the affiliate link" and "above the fold" in apps. Source: [EPN Affiliate Disclosure FAQ](https://partnernetwork.ebay.com/resources/affiliate-disclosure-faq).
- TCGplayer's partner guidelines require "unavoidable" disclosure and list "Affiliate link; Promotion; #Sponsored; #Ad" as examples. This conflicts with the FTC FAQ's view of "affiliate link". Source: [TCGplayer Partner Guidelines, updated Apr 14, 2025](https://help.tcgplayer.com/hc/en-us/articles/31411199594391-TCGplayer-Partner-Guidelines).
- Placements in the app: see §3.

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| F1 | Clear and conspicuous disclosure next to every group of tagged links | 16 CFR 255 (rev. 2023-07-26); FTC FAQ | Put the sentence just above or before tagged links on every surface, logged-in workspace included | Card page and workspace OK; Sales Lookup at the bottom; popup label weak | Medium | Yes (quick fix) |
| F2 | Plain words consumers understand | FTC FAQ | Use a full sentence such as "We earn a commission if you buy through eBay or TCGplayer links on this page", not "affiliate links" | Sentence OK; popup label not | Low | No |
| F3 | Truthful claims | FTC FAQ; see §7 PV6 | The disclosure shows only when tagging is configured (good). The footer's data-source claims are stale (see §7) | — | Low | No |

### Gaps
- I did not capture the FTC FAQ's last-updated date.
- I found no FTC guidance specific to affiliate links inside logged-in SaaS tools; the general website guidance applies.
- I did not research the FTC's Consumer Reviews and Testimonials Rule (16 CFR 465). It is relevant only if the site shows reviews or testimonials.

## 5. TCGplayer: affiliate program terms (Impact) and commercial use of TCGplayer data (API, TCGCSV mirror, CDN images)

### Takeaway
TCGplayer's API is closed to new developers. Its API Terms (updated June 8, 2022) cover "any of the materials, code, data or content from TCGplayer.com" and forbid, among other things:
- obtaining TCGplayer content or prices "from a third-party that was collected from the Site using our API";
- combining TCGplayer prices with other pricing data;
- distributing TCGplayer content to end users for commercial purposes;
- making derivative works.

Its site Terms (updated Sept 27, 2023) claim "pricing information and card databases" as TCGplayer property and bar crawling or scraping. TCGCSV is a one-person mirror with no license. The app's catalog, daily prices and TCGplayer CDN images all come through TCGCSV. The public card page even says prices are "synced daily from TCGplayer (via the TCGCSV mirror)".

That makes this a high contract and IP risk, and a risk to the client's affiliate standing: TCGplayer partners "must remain in good standing with TCGplayer and eBay", and TCGplayer is eBay-owned. Bare price facts may not be copyrightable, but images, the compilation and contract theories remain ⚖️. Separately, the app's TCGplayer affiliate tagging (UTM parameters) may not track under Impact at all.

### Cited Findings
- **API closed.** "We are no longer granting new API access at this time. Existing users must adhere to the terms of service that govern the use of our API, including … important restrictions and attributions required." Source: [TCGplayer Getting Started](https://docs.tcgplayer.com/docs/getting-started) (undated). A third party saw the sentence still present on Aug 26, 2026. Source: [tcgapi.dev](https://tcgapi.dev/compare/tcgplayer-api/) (secondary).
- **API Terms** ([TCGplayer API Terms & Conditions, updated June 8, 2022](https://help.tcgplayer.com/hc/en-us/articles/360061115874-TCGplayer-API-Terms-Conditions)):
  - "The API is provided solely for the purpose of (a) academic research or (b) promoting and facilitating access to and use of the Site."
  - Prohibited: "Develop, promote, or enable any product, application, or service similar to or that competes with TCGplayer's current or planned offerings"; "Combine TCGplayer's pricing data with your own or a third party's pricing data"; "Rebrand TCG Content"; "Distribute TCG Content or otherwise make it available to your end users or third parties … for commercial or competitive purposes".
  - Also prohibited: "Obtain content or information (including pricing information) from a third-party that was collected from the Site using our API or otherwise using automated means"; "Modify, make derivative works of…"; "Sell, rent, trade, distribute, lease (or otherwise commercialize), copy, store or modify content or information (including pricing information) from the Site…".
  - Attribution: "This product uses TCGplayer data but is not endorsed or certified by TCGplayer." When using pricing data, "TCGplayer must be identified as the source" and a link to the product page must be provided.
  - Governed by New York law, in courts in Onondaga County / N.D.N.Y.
- **Site Terms** ([TCGplayer Terms of Service, updated Sept 27, 2023](https://help.tcgplayer.com/hc/en-us/articles/205004918-Terms-of-Service)):
  - "All of the content found on TCGplayer.com … including graphics, text, … pricing information and card databases, are the property of TCGplayer, Inc. and protected by … copyright laws."
  - Its graphics, logos and trade dress "may not be used in connection with any service or product outside of TCGplayer without express written permission".
  - "You agree not to crawl, scrape or spider any of our websites without express permission from us."
  - Users must be 18+ to buy or sell.
- **Partner Guidelines** ([TCGplayer Partner Guidelines, updated Apr 14, 2025](https://help.tcgplayer.com/hc/en-us/articles/31411199594391-TCGplayer-Partner-Guidelines)):
  - "Affiliate links are not for personal use and are not for TCGplayer sellers to promote their own products on the TCGplayer marketplace."
  - Disclosure must be "unavoidable".
  - "Partners must remain in good standing with TCGplayer and eBay."
  - TCGplayer may revoke affiliate status "for any reason".
- **Affiliate program basics.** It runs on impact.com and pays 3.5% per sale within a 48-hour window, 45 days after month end. Sources: [Lasso](https://getlasso.co/affiliate/tcgplayer/); [Affilitizer](https://www.affilitizer.com/programs/tcgplayer.com) (secondary, from search summaries).
- **eBay ownership.** Developer blogs say eBay acquired TCGplayer in 2022 and API access has stayed limited since. Source: [tcgapi.dev](https://tcgapi.dev/compare/tcgplayer-api/) (secondary). The partner guidelines' "good standing with TCGplayer and eBay" wording is consistent with this.
- **TCGCSV.** The site is run by an individual (GitHub/Patreon "CptSpaceToaster"), updates daily around 20:00 UTC, links a TCGplayer affiliate link, and shows no license or terms of use. Source: [tcgcsv.com](https://tcgcsv.com/). Its FAQ says the data is "sourced directly from TCGplayer's API", asks for an identifiable User-Agent, keeps a price archive from Feb 8, 2024, and says nothing about licensing. Source: [TCGCSV FAQ](https://tcgcsv.com/faq).
- A secondary source says "Free, unlicensed options like TCGCSV are not cleared for commercial use." Source: [ScrapingBee](https://www.scrapingbee.com/blog/how-to-scrape-tcgplayer/) (secondary, per search summary).
- **What the app does today:**
  - `src/app/catalog-import.ts` pulls from `https://tcgcsv.com/tcgplayer` and keeps TCGplayer CDN image URLs (lines 29, 80, 219–234). `src/scripts/sync-tcgcsv.ts` runs the daily price sync; its comment says "TCGplayer's developer API is closed to new developers".
  - Catalog images are perceptually hashed for photo ID (`npm run hash:catalog`, plus a boot-time builder) and sent to eBay in listings (`ebay-sell.ts:427`).
  - TCGplayer "market" prices feed the pricing rules (market ± %) and sit alongside eBay sold comps on card pages.
  - The public card page states prices are "synced daily from TCGplayer (via the TCGCSV mirror)" (`render/pages.ts:492,495`), but the site footer credits "the Pokémon TCG API & Scryfall" (`render/layout.ts:146`, live).
  - Affiliate tagging appends the env string, e.g. `utm_source=impact&utm_medium=affiliate&utm_campaign=YOURSHOP`, to tcgplayer.com URLs (`affiliate.ts:14,116-128`).

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| T1 | Licensed source for catalog and prices | [TCGplayer API Terms](https://help.tcgplayer.com/hc/en-us/articles/360061115874-TCGplayer-API-Terms-Conditions) (2022-06-08); [ToS](https://help.tcgplayer.com/hc/en-us/articles/205004918-Terms-of-Service) (2023-09-27) | Using a third-party mirror of TCGplayer API data commercially is expressly prohibited for API users. For others the exposure is via the site ToS, database/copyright and unfair-competition theories, and loss of the affiliate account. Price facts alone are weakly protected | Entire catalog and daily prices come from TCGCSV; the card page publicly says so | Critical ⚖️ | Yes (counsel decision, or switch to a licensed data source) |
| T2 | Card images: hotlinking, hashing, and re-publishing to eBay | Same; eBay Picture policy (§1 E8); IP (§6) | Hotlinked TCGplayer scans shown in a paid product and pushed into eBay listings compound TCGplayer's and the IP owners' claims | Hotlinked CDN URLs; hash index; images in eBay payloads | High ⚖️ | Feature (images to eBay); counsel for display |
| T3 | "Combine TCGplayer's pricing data with … third party's pricing data" | API Terms | Mixing TCGplayer market prices with eBay comps and pricing rules is exactly what the API Terms forbid | Combined on card pages and in pricing | High ⚖️ | Part of T1 |
| T4 | Correct attribution | API Terms (Attribution) | If TCGplayer-derived data stays, use the mandated sentence plus product-page links, and fix the footer, which misstates the sources | Footer wrong; product links present | Medium | No |
| T5 | Affiliate tracking actually works | Partner program on Impact (secondary) | Impact normally tracks through a partner-specific tracking link; appending UTM parameters to tcgplayer.com may not credit the client. Check in the Impact dashboard | UTM query string appended | Medium | Revenue |
| T6 | Personal-use restriction on affiliate links | Partner Guidelines | Suppress tagging for the owner's own browsing and seller account | Not suppressed | Low | No |
| T7 | Counterparty concentration | Partner Guidelines ("good standing with TCGplayer and eBay"); eBay ownership (secondary) | One corporate family controls TCGplayer data, TCGplayer affiliate status, eBay API access and EPN, so a single dispute could hit all four | — | High (strategic) | No |

### Gaps
- The TCGplayer affiliate agreement on Impact needs an Impact login. I couldn't confirm whether it incorporates the API Terms or site ToS, or restricts placement inside software.
- I found no statement from TCGCSV's operator about permission from TCGplayer to republish.
- I found no primary source for Impact's TCGplayer link format; tcgsniper's help page doesn't show it.
- I did not research the copyright status of TCGplayer's own card scans. Faithful photographs of 2-D art may carry thin or no copyright (e.g., *Bridgeman v. Corel*, S.D.N.Y. 1999), but the underlying artwork belongs to TPCi, Bandai and their licensors ⚖️.
- Licensed alternatives (paid TCG pricing APIs, licensed sold-data vendors) belong to the competitor and data-sourcing researchers and weren't evaluated here.

## 6. Pokémon and One Piece card names and images in a commercial tool: rights-holder policies, industry practice, practical risk

### Takeaway
Neither rights holder offers permission. The Pokémon Company International (TPCi) says it is "not in a position to review requests to use the Pokémon intellectual property (including its characters, names, and designs)" and asks people "not [to] use it in or associate it with your project in any way". Bandai's July 10, 2026 notice targets unauthorized goods that copy ONE PIECE card designs or characters and reserves all rights. Naming a card only to identify what a seller owns is standard marketplace practice and lower risk. Showing full card art in a paid tool, sourced from TCGplayer's CDN, is the higher-risk part. Using logos or marks in the brand, or implying affiliation, would raise the risk sharply.

Practical risk: low for descriptive names; moderate for card images; high only if branding or affiliation is implied ⚖️. Mitigations: a non-affiliation and trademark notice, no marks in branding, the seller's own photos preferred, and a registered DMCA agent.

### Cited Findings
- Pokémon Support: "Unfortunately, we're not in a position to review requests to use the Pokémon intellectual property (including its characters, names, and designs). As a result, we ask that you not use it in or associate it with your project in any way." The article showed "8 months ago Updated" on 2026-09-28. Source: [Pokémon Support: Can I use Pokémon images or materials?](https://support.pokemon.com/hc/en-us/articles/360000634094-Can-I-use-Pok%C3%A9mon-images-or-materials).
- pokemon.com legal notice: "© 2026 Pokémon. © 1995–2026 Nintendo/Creatures Inc./GAME FREAK inc." Fan-art creators get no authorization to use Pokémon IP "beyond a personal, noncommercial home use". Source: [Pokémon Legal Information](https://www.pokemon.com/us/legal/information) (undated).
- Bandai: "No cards, accessory items, or other goods derived from or copied from card designs released or sold by Bandai without authorization may be sold or distributed." The same applies to goods using ONE PIECE characters. The notice "do[es] not signify formal permission or consent, nor … operate as a waiver of any legal rights". Copyright line: "©Eiichiro Oda/Shueisha, Toei Animation". Source: [ONE PIECE CARD GAME IP regulations, July 10, 2026](https://en.onepiece-cardgame.com/news/02_382.html).
- Unofficial Pokémon tools commonly carry non-affiliation disclaimers, e.g. "not affiliated with, endorsed, sponsored, or specifically approved by Nintendo, Creatures, Game Freak or The Pokémon Company". Sources: [pokecard.net](https://www.pokecard.net/); [Pokédex Print Kit terms](https://pokeprintkit.com/terms) (examples only).
- DMCA safe harbor needs a designated agent: the agent's contact details on the site plus a filing with the Copyright Office directory (online-only since Dec 2016). Source: [U.S. Copyright Office DMCA Designated Agent Directory](https://www.copyright.gov/dmca-directory/).
- **What the app does today:** the brands "Trading Card Loader" and "CardIndex" contain no Pokémon or Bandai marks. The footer has no trademark or non-affiliation notice for Pokémon, Nintendo or Bandai; it says only "not affiliated with any marketplace" (`render/layout.ts:147`, live). Card art is shown from TCGplayer CDN URLs. Sellers upload their own scans, which are stored in S3.

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| P1 | Trademark and non-affiliation notice for Pokémon/Nintendo/Creatures/GAME FREAK and ONE PIECE/Shueisha/Toei/Bandai | [pokemon.com legal](https://www.pokemon.com/us/legal/information); [Bandai notice](https://en.onepiece-cardgame.com/news/02_382.html) (2026-07-10) | Lowers confusion and implied-endorsement risk. Doesn't create rights | Absent | Medium | No (add before launch) |
| P2 | Card-image display | [Pokémon Support FAQ](https://support.pokemon.com/hc/en-us/articles/360000634094-Can-I-use-Pok%C3%A9mon-images-or-materials) (≈Jan 2026); see §5 T2 | No license is available from TPCi. Prefer sellers' own photos; treat catalog art as a counsel-reviewed risk. Keep use to identifying and reselling cards, never decoration or merchandise | Catalog art on public card pages, in the workspace and in eBay listings | High ⚖️ | No (counsel), but images to eBay = Feature (§1 E8) |
| P3 | No marks in branding; no logos, set symbols or "official" claims | Rights-holder policies above | Keep the product name, domain and ads free of Pokémon and ONE PIECE marks | Compliant | Low | No |
| P4 | Register a DMCA agent and publish a takedown policy | [Copyright Office](https://www.copyright.gov/dmca-directory/) | The site hosts user uploads (scans, listing text), so safe harbor needs a registered agent | None found (no `/terms` or `/dmca`) | Medium | No (strongly recommended pre-launch) |

### Gaps
- I gathered no case law on nominative fair use or fair use for price-guide display of card images ⚖️.
- I didn't check whether TPCi or Bandai have sent takedowns to price-guide or scanner sites, or how they use eBay VeRO.
- I didn't confirm whether competitors (TCGplayer, CardUploader, Collectr) license card images. "Industry practice" here is an observation that marketplaces and price guides routinely show them, not evidence of licensing.

## 7. Privacy law, children, and required documents: CCPA/CPRA and other state laws, GDPR (brief), COPPA and minimum age, privacy policy contents, Terms of Service

### Takeaway
At launch scale, CCPA/CPRA almost certainly does not apply. Its thresholds are more than $26.625M annual revenue, 100,000+ California consumers or households, or at least 50% of revenue from selling or sharing data. Most other state laws need 35,000–100,000 consumers. CalOPPA, however, applies to any commercial site collecting personal information from Californians. The existing policy needs a Do-Not-Track statement and a third-party tracking statement, and EPN separately requires disclosure of its tracking code and cookies.

GDPR applies only if the service targets EU users. COPPA's amended rule (compliance date April 22, 2026) applies only to child-directed services or operators with actual knowledge of under-13 users. Given Pokémon's young audience, eBay's and TCGplayer's 18+ rules, and EPN's ban on "content aimed at children", set accounts to 18+.

The privacy policy (updated Sept 28, 2026) is solid. The site has **no Terms of Service at all** (`/terms` 404), and one is needed for eBay's sublicense terms, the subscription, the age limit, acceptable use, IP/DMCA and disclaimers.

### Cited Findings
- **CCPA monetary thresholds** (effective Jan 1, 2025; posted Dec 17, 2024): revenue threshold $26,625,000; fines up to $2,663 per violation and $7,988 per intentional violation or violation involving minors; statutory damages $107–$799. Source: [privacy.ca.gov monetary thresholds](https://privacy.ca.gov/laws-and-regulations/monetary-thresholds-in-the-ccpa/). The other criteria are buying, selling or sharing personal information of 100,000+ consumers or households, or deriving 50%+ of revenue from selling or sharing. Source: [Clym CCPA applicability guide 2026](https://www.clym.io/blog/ccpa-applicability-guide) (secondary).
- **CalOPPA** (Cal. Bus. & Prof. Code §§22575–22579) requires any commercial website operator that collects Californians' personal information to post a privacy policy conspicuously. Under §22575(b)(5)–(6) the policy must disclose how the operator responds to browser "do not track" signals, or link to a choice program, and whether third parties may collect personal information about a user's activity across sites. Sources: [Alston & Bird](https://www.alstonprivacy.com/california-adopts-do-not-track-disclosure-law-a-b-370-amends-the-california-online-privacy-protection-act-caloppa-to-require-new-privacy-policy-disclosures-for-websites-online-services-and-mobile/); [IAPP](https://iapp.org/news/a/what-do-the-new-disclosure-requirements-under-caloppa-mean-for-your-busines); [California AG letter](https://oag.ca.gov/system/files/attachments/press_releases/CalOPPA%20Letter_0.pdf).
- **Other state laws.** 20 states have comprehensive privacy laws in 2026; Indiana, Kentucky and Rhode Island took effect Jan 1, 2026. Rhode Island has the lowest threshold: 35,000 consumers, or 10,000 if more than 20% of revenue comes from selling data. Texas and Nebraska apply broadly but exempt SBA-defined small businesses. Sources: [MultiState, Feb 4, 2026](https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026); [Clym comparison](https://www.clym.io/blog/us-privacy-law-comparison-map) (secondary).
- **GDPR Art. 3(2)** covers non-EU controllers whose processing relates to "the offering of goods or services … to such data subjects in the Union" or to "the monitoring of their behaviour". Source: [GDPR Art. 3](https://gdpr-info.eu/art-3-gdpr/).
- **COPPA amended rule.** Published April 22, 2025, effective June 23, 2025, full compliance by April 22, 2026. It adds a formal "mixed audience" definition (a neutral age screen is required before collecting personal information), separate consent for third-party disclosures, and biometric identifiers as personal information. Sources: [Federal Register](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule); [Finnegan](https://www.finnegan.com/en/insights/articles/coppas-amended-rule-is-now-in-full-effect-what-operators-need-to-know.html); [Securiti](https://securiti.ai/ftc-coppa-final-rule-amendments/).
- **Platform age rules.** eBay bars anyone who can't form binding contracts, e.g. under 18 ([eBay User Agreement](https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259)). TCGplayer requires 18+ to buy or sell ([TCGplayer ToS](https://help.tcgplayer.com/hc/en-us/articles/205004918-Terms-of-Service)). EPN forbids "content aimed at children" ([Network Agreement](https://partnernetwork.ebay.com/page/network-agreement)).
- **Platform privacy-policy rules.** eBay: a privacy policy "consistent with the eBay Privacy Notice" (ALA §8.2). EPN: disclose the tracking code and cookies (see §3).
- **What the app does today:**
  - The live /privacy page ("Last updated September 28, 2026") covers what is collected (browsing, seller accounts, eBay connection, orders, sold archive), use, sharing (eBay, service providers, affiliate links, legal), retention, eBay account deletion, rights (email-based requests, answered within 30 days), security, children ("not directed at children under 13"), changes and contact. The contact is a Gmail address (`thegivingbulbasaur@gmail.com`). Sources: `src/render/privacy.ts`; live [/privacy](https://tradingcardloader.com/privacy).
  - The policy has no Do-Not-Track or third-party-tracking statement, no named EPN tracking or cookie options, no legal entity or postal address, and no retention period for order personal information.
  - Terms of Service: live `/terms` returned HTTP 404; there is no route in `src/`; the signup form has no terms or age acceptance (`src/render/auth.ts`).
  - The live footer reads "Catalog & market prices from the Pokémon TCG API & Scryfall. Grade values, price history & sold comps are demo data. Phase 1 MVP — not affiliated with any marketplace". Brand names differ between pages ("CardIndex" in the header and pricing page, "Trading Card Loader" on /privacy).
  - The card page says per-grade values and the history chart are "demo data" (`render/pages.ts:491-495`). The pricing page nevertheless sells "Per-grade values (PSA · BGS · CGC)" and "Live market prices, history & sold comps" as features without that caveat (`render/pricing.ts:19-26`).

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| PV1 | **Terms of Service** (none exist) | ALA §4.2 (eBay sublicense terms); CA ARL/ROSCA (§8); DMCA (§6); platform 18+ rules | Must cover eBay's three required terms, 18+ eligibility, subscription/auto-renewal/cancellation/refunds, acceptable use (no scraping, no IP infringement; sellers responsible for listings and eBay policy compliance), license to uploaded photos (and explicit consent to publish sales data if that stays), price-estimate disclaimer (not financial advice), limitation of liability, DMCA procedure, termination, governing law/disputes, changes. Require click-through acceptance at signup | Missing (404) | High ⚖️ | Yes |
| PV2 | Privacy policy additions | CalOPPA §22575(b)(5)–(6); EPN; ALA §8.2 | Add: DNT response and third-party tracking statements; EPN/TCGplayer tracking and cookie note with opt-out options; operator legal name and postal address; retention for order personal information and backups; sold-archive consent mechanics (§2); photo deletion; consistent brand | Good base, missing these | Medium | No (quick) |
| PV3 | Minimum age 18+ in ToS; optional neutral age attestation at signup; no child-directed marketing | COPPA (compliance 2026-04-22); eBay UA; TCGplayer ToS; EPN | Keeps the service out of COPPA "directed to children" territory and matches the platforms it connects to | Policy says not directed at under-13s; no age term | Medium ⚖️ | Yes (as part of PV1) |
| PV4 | CCPA and other state laws: monitor thresholds | [privacy.ca.gov](https://privacy.ca.gov/laws-and-regulations/monetary-thresholds-in-the-ccpa/) (eff. 2025-01-01); MultiState 2026 | Not triggered at launch. Watch Rhode Island's 35k threshold and the Texas/Nebraska small-business test. Keep "we don't sell" true: no ad or analytics pixels | Compliant posture | Low | No |
| PV5 | GDPR/UK GDPR (brief) | [GDPR Art. 3](https://gdpr-info.eu/art-3-gdpr/) | Don't target the EU or UK (USD pricing, eBay US). If EU/UK users are targeted later: lawful basis, rights handling, and possibly an Art. 27 representative | U.S.-oriented | Low | No |
| PV6 | Accurate public claims about data and features | ALA §9 ("false, inaccurate or misleading"); TCGplayer API Terms (same); EPN "Clear and Not Deceptive" | The footer names the wrong sources. The pricing page markets demo-backed features (grade values, history) as live. Fix before charging money | Stale footer; unqualified pricing claims | Medium ⚖️ | Yes (before a paid launch) |
| PV7 | Honor deletion requests fully | Privacy policy promise; ALA §8.2 | Account deletion should remove S3 photos, inventory, sessions, eBay tokens and (see §2) harvested rows | Email-based process | Low–Medium | No |

### Gaps
- I verified the CCPA 100,000-consumer and 50%-revenue criteria only through a secondary source this session.
- I did not research state teen-privacy or age-appropriate-design laws; they likely don't apply to an 18+ seller tool.
- The client's state of residence and entity type are unknown. They affect state law, the operator identity shown in the policy and ToS, and tax.

## 8. Subscription billing: Stripe setup, auto-renewal and cancellation laws, refund policy, sales tax on SaaS

### Takeaway
Before charging (Stripe; target $7–10/month), the app needs the following:
- **Stripe's baseline site content:** what is sold, the currency, several contact methods, refund and cancellation policies, a privacy policy, and a business address.
- **ROSCA (federal):** clear material terms before collecting billing information, express informed consent, and a simple way to stop charges.
- **California's ARL as amended July 1, 2025 (AB 2863):** express affirmative consent kept on record for 3 years, cancellation through the same medium (online click-to-cancel), annual reminders, and notice of material price changes.

The FTC's 2024 click-to-cancel rule was vacated on July 8, 2025. The FTC restarted rulemaking with an advance notice (announced Mar 11, published Mar 13, 2026; comments closed Apr 13, 2026), but no new federal rule is in force.

Sales tax: about 20 states plus DC tax SaaS, and California starts taxing SaaS on Jan 1, 2027 (SB 122). Remote-seller nexus is mostly $100k in sales per state ($500k in CA, NY and TX), so at $7–10/month the early question is home-state registration, not remote nexus (CPA).

The app today advertises $15/month, "Billed monthly, cancel anytime", with checkout disabled and no refund or cancellation policy.

### Cited Findings
- **Stripe website checklist:** "A description of what you're selling"; "The purchase currency"; "Customer service contact information" (several methods); "Your fulfillment policies", including "Refund policy" and "Cancellation policy: Describe the conditions under which customers can cancel subscriptions"; legal restrictions; "Your website's privacy policy"; "Your business address"; promotion and trial terms; payment security (PCI, HTTPS); card logos. Source: [Stripe website checklist](https://docs.stripe.com/get-started/checklist/website).
- A Stripe account may not activate until the website has the necessary business information. Source: [Stripe support: business website FAQ](https://support.stripe.com/questions/business-website-for-account-activation-faq) (search summary).
- The Stripe customer portal lets customers cancel, enabled by default. Stripe can send "upcoming renewal" emails and include manage-subscription links. Sources: [Stripe cancellation page docs](https://docs.stripe.com/customer-management/cancellation-page); [Stripe customer emails](https://docs.stripe.com/billing/revenue-recovery/customer-emails) (search summaries).
- **ROSCA** (15 U.S.C. §§8401–8405): "disclose clearly all material terms of the transaction" before obtaining billing information, obtain "the consumer's express informed consent", and provide simple mechanisms to stop recurring charges. Source: [FTC ROSCA page](https://www.ftc.gov/legal-library/browse/statutes/restore-online-shoppers-confidence-act).
- **California ARL (AB 2863).** In effect July 1, 2025 for contracts made, amended or extended from that date. Requirements:
  - express affirmative consent, with records kept "a minimum of three years or one year following contract termination, whichever is longer";
  - cancellation "through the same channel used to initiate the subscription";
  - an annual reminder with "the renewal frequency, amount charged and clear instructions for cancellation";
  - coverage of free-to-paid conversions.

  Sources: [AB 2863 bill text](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB2863); [Barnes & Thornburg, July 7, 2025](https://btlaw.com/en/insights/alerts/2025/california-expands-automatic-renewal-law-new-requirements-now-in-effect). It also requires "clear and conspicuous" notice of material price and service changes and "click to quit" cancellation. Source: [Kilpatrick alert](https://ktslaw.com/en/insights/alert/2024/10/california-latest-automatic-renewal-law-amendments-take-effect-in-july-2025) (search summary).
- **FTC negative-option rulemaking:**
  - the 2024 click-to-cancel amendments were vacated by the Eighth Circuit on July 8, 2025 and never took effect ([Crowell & Moring](https://www.crowell.com/en/insights/client-alerts/clicking-all-the-right-boxes-ftc-moves-to-revive-click-to-cancel-rule-following-eighth-circuit-vacatur));
  - the FTC announced a new advance notice of proposed rulemaking on Mar 11, 2026, published Mar 13, 2026, with comments due Apr 13, 2026 ([FTC press release](https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-seeks-public-comment-response-advance-notice-proposed-rulemaking-regarding-negative-option); [Federal Register](https://www.federalregister.gov/documents/2026/03/13/2026-04952/rule-concerning-the-use-of-prenotification-negative-option-plans));
  - the notice contains no draft rule text ([Sidley, Feb 2026](https://www.sidley.com/en/insights/newsupdates/2026/02/us-ftc-signals-renewed-interest-in-click-to-cancel-rulemaking); [Regulatory Oversight, Mar 2026](https://www.regulatoryoversight.com/2026/03/ftc-revives-negative-option-rulemaking/));
  - I found no proposed rule after April 2026 in searches on 2026-09-28.
- **SaaS taxability (2026).** Fully taxable in AZ, CT, DC, HI, KY, LA, MA, MS, NM, NY, PA, RI, SC, SD, TN, TX, UT, VT, WA and WV. Local-only or conditional in AK, CO, IL, IA, MD, NE and OH. Exempt in AL, AR, DE, FL, GA, ID, IN, KS, ME, MI, MN, MO, MT, NV, NH, NJ, NC, ND, OR, VA, WI and WY. Source: [Numeral, July 7, 2026](https://www.numeral.com/blog/sales-tax-on-saas) (secondary; verify per state).
- **California SB 122** was signed June 29, 2026. From Jan 1, 2027, SaaS and electronically delivered prewritten software are taxable, sourced to the customer's billing address. Sources: [Avalara, June 2026](https://www.avalara.com/blog/en/north-america/2026/06/california-sales-tax-software-saas.html); [Greenberg Traurig, July 2026](https://www.gtlaw.com/en/insights/2026/7/california-sb-122-cdtfa-workshop-addresses-software-and-saas-tax-rules-effective-jan-1-2027); [PwC](https://www.pwc.com/us/en/services/tax/library/california-imposes-sales-and-use-tax-on-digital-products-and-saas.html) (search summaries).
- **Economic nexus.** 41 states use $100,000 in sales, 2 use $250,000 and 3 use $500,000 (CA, NY, TX; NY also requires 100 transactions). Illinois dropped its 200-transaction test on Jan 1, 2026. Sources: [TaxCloud nexus chart 2026](https://taxcloud.com/blog/sales-tax-nexus-by-state/); [Numeral economic nexus](https://www.numeral.com/blog/economic-nexus) (search summaries).
- **What the app does today:** the pricing page shows Pro at $15/month, "cancel anytime" and "Prices in USD. Billed monthly, cancel anytime." For signed-in users the Subscribe button is disabled, with "Secure online checkout is coming soon — contact us and we'll activate Pro". `PRO_PRICE_CENTS = 1500`. Pro is granted by `npm run grant-pro`. There is no refund policy, no cancellation mechanism, no renewal disclosure at a checkout step and no consent capture. Sources: `src/render/pricing.ts:71-76,110`; `src/app/billing.ts:17-18`. The client's target is $7–10/month (per the assignment).

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| B1 | Pre-purchase disclosure plus express consent for auto-renewal, with consent records kept 3 years | ROSCA; CA ARL (AB 2863, eff. 2025-07-01) | Next to the Subscribe button: price, "renews monthly until you cancel", how to cancel. Affirmative consent (e.g., an unticked checkbox). Store consent evidence | No checkout exists | High ⚖️ | Revenue (paid plan) |
| B2 | Online click-to-cancel | CA ARL; ROSCA | Enable the Stripe customer portal and link it from Settings and billing emails | None | High | Revenue |
| B3 | Acknowledgment email, annual reminder, price-change notice | CA ARL | Use Stripe emails plus a custom annual reminder. Renewal reminders are transactional emails (§9) | None | Medium | Revenue |
| B4 | Posted refund and cancellation policy | [Stripe checklist](https://docs.stripe.com/get-started/checklist/website) | Even "no refunds for partial months" must be stated in the footer, on the pricing page and at checkout. Card networks and Stripe expect it | None | Medium | Revenue |
| B5 | Accurate price and plan claims | ROSCA / FTC Act (deception) | The site says $15 while the target is $7–10. Plan features include demo-backed items (§7 PV6). Fix before charging | Mismatch | Medium | Revenue |
| B6 | Sales tax registration and collection | Numeral 2026; SB 122 (eff. 2027-01-01) | Find the client's home state and register if SaaS is taxable there. Turn on Stripe Tax threshold monitoring. California-billed customers become taxable in 2027 if the client has CA nexus ($500k for remote sellers) | Not set up | Medium ⚖️ (CPA) | No (set up before charging) |
| B7 | Other state ARLs | State laws (not researched individually) | Adopting California's standard nationally is the usual approach | — | Low–Medium ⚖️ | No |
| B8 | Watch federal rulemaking | [FTC notice, Mar 2026](https://www.federalregister.gov/documents/2026/03/13/2026-04952/rule-concerning-the-use-of-prenotification-negative-option-plans) | No federal click-to-cancel rule is in force. ROSCA and FTC Act §5 enforcement continue | — | Low | No |

### Gaps
- I did not check Stripe's restricted-businesses list for this model; a trading-card SaaS appears benign.
- I did not read AB 2863's exact notice periods for price changes (summaries only). Other states' ARLs (NY, CO, VA, MN, etc.) were not researched.
- The client's home state is unknown, so I can't finalize sales-tax registration (CPA).
- I did not verify card-network (Visa/Mastercard) rules for subscription merchants (e.g., trial reminders).

## 9. Email: CAN-SPAM rules for transactional vs marketing email

### Takeaway
Password resets and account or billing notices are transactional or relationship messages. They are exempt from most CAN-SPAM duties, except that header and routing information must not be false or misleading. Marketing email (newsletters, promotional price alerts, Pro upsells) needs:
- accurate headers and subject lines;
- identification as an ad;
- a valid postal address;
- a working opt-out that stays usable for at least 30 days and is honored within 10 business days.

Penalties run up to $53,088 per email. Any email that carries eBay affiliate links needs EPN's prior written approval. The ALA forbids messaging eBay buyers using order data. Operationally, production email was not configured as of Sept 13, so password-reset links are never delivered.

### Cited Findings
- Transactional or relationship messages are those that facilitate or confirm an agreed transaction, give warranty or safety information, give notice of changes to account or subscription terms, deliver employment information, or deliver goods or services. They "need only truthful routing information". Source: [FTC CAN-SPAM Act: A Compliance Guide for Business](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).
- Commercial email must meet seven requirements: accurate headers; truthful subject lines; identification as an ad; a valid physical postal address; a clear opt-out; opt-outs processed for at least 30 days; opt-outs honored within 10 business days. Senders can't contract away responsibility to vendors. Mixed messages are commercial if the subject line suggests an ad or the transactional content isn't mainly at the beginning. Penalties are "up to $53,088" per email. Source: [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).
- EPN: promoting eBay by email or SMS requires EPN's prior written approval and CAN-SPAM compliance, and EPN's or eBay's name may not appear in the "from" line. Source: [EPN Network Agreement](https://partnernetwork.ebay.com/page/network-agreement).
- ALA §8.2: "You will not use Personal Information to send or enable sending unsolicited communications of any type to any eBay Users." Source: [ALA](https://developer.ebay.com/join/api-license-agreement).
- **What the app does today:** `src/app/mailer.ts` selects a provider by `MAIL_PROVIDER` (default "log"). The only `sendMail` call is the password-reset email (`src/server.ts:1638`). As of Sept 13, production had no `MAIL_PROVIDER`/`RESEND_API_KEY`, so "the reset link is printed to the server log". Source: internal `cardindex-feature-inventory.md` (lines 44, 195).

### Inferences

| # | Obligation / risk | Source & version | What it means for us | What the app does today | Severity | Blocks launch? |
|---|---|---|---|---|---|---|
| M1 | Working transactional email (plus SPF/DKIM/DMARC on the sending domain) | Operational; CAN-SPAM routing accuracy | Customers can't recover accounts until email works. Subscription-law reminders (§8) will depend on it too | Not configured in prod as of Sept 13 | High (operational) | Yes |
| M2 | Keep transactional emails free of promotional content (primary-purpose test) | FTC CAN-SPAM guide | Don't add Pro upsells or tagged links to reset or billing emails | Compliant today | Low | No |
| M3 | Before any marketing email: opt-out, postal address, ad identification, vendor oversight | FTC CAN-SPAM guide | Needed if price alerts, newsletters or Pro promotions are added | None today | Low (now) | No |
| M4 | No eBay affiliate links in email without EPN approval; never email eBay buyers from order data | EPN agreement; ALA §8.2 | Design constraint for future alert emails | Compliant today | Low | No |

### Gaps
- The FTC guide shows $53,088 per email. The figure is inflation-adjusted each January and I didn't confirm the 2026 value.
- Deliverability rules (the Gmail and Yahoo bulk-sender requirements, Resend domain setup) are operational and were not researched.
