# UI language audit: confusing, inconsistent and redundant copy in the seller platform (tradingcardloader.com)

Audit date 2026-09-28. Scope: every user-visible string in `card-db-mvp/src/render/*.ts` (page templates and the client scripts embedded in them), flash and error messages in `src/server.ts`, label constants and error text in `src/app/*.ts`, the only outbound email (password reset, `src/server.ts` + `src/app/mailer.ts`), and CSS-generated text in `public/styles.css`. All files were read from disk, so uncommitted edits are included. Line numbers are as of today. In the fix tables, `render/app.ts:1491` means `card-db-mvp/src/render/app.ts` line 1491 (paths are relative to `card-db-mvp/src/` unless they start with `public/`). "CU" = CardUploader. Recommendations only; nothing was edited.

## 1. Which concepts have more than one name across the UI, and what single term should each use?

### Takeaway
At least 30 concepts carry two to six names each. The most damaging are: the settings area ("Configuration" in the sidebar, "Settings" almost everywhere else); the whole "list" family (inventory "Listed" is set as soon as a draft exists, two different "Mark as listed" buttons do different things, a third button "Mark live" exists, and statuses show raw words like "exported" and "published"); stock status ("In stock" vs CU's "Not listed", plus a "Cards in stock" tile that shows a different number on the Dashboard and on Inventory, neither of which excludes sold cards); the add-cards pages (sidebar says "Ungraded cards" and "Ungraded pricing tool" but both pages are titled "Add cards"); the sold-price tool (five names); and platform/channel/marketplace/market. The glossary below picks one term per concept, preferring (a) the client's own words and CU's labels where he learned them, (b) eBay's official terms for anything that ends up on eBay, and (c) plain English where CU's term is jargon.

### Cited Findings

**Settings area**
- The sidebar item, the hub heading and the breadcrumb all say "Configuration" — [render/app.ts:195, 1301, 1488](../../card-db-mvp/src/render/app.ts).
- The same area is called "Settings" on the Dashboard quick tile ("Settings — SKUs, pricing, matching, titles, descriptions, every channel.") — [render/app.ts:252](../../card-db-mvp/src/render/app.ts); the back link on every section page is "← All settings" — [render/app.ts:1486](../../card-db-mvp/src/render/app.ts); the listing builder says "Business policies applied from settings" — [render/app.ts:1116](../../card-db-mvp/src/render/app.ts).
- Error and help text sends sellers to "Settings → eBay": the Orders note — [render/workspace2.ts:458](../../card-db-mvp/src/render/workspace2.ts); the eBay listing checks ("Connect your eBay account first (Settings → eBay).", "No fulfillment policy selected (Settings → eBay → Sync policies).", "…save a postal code under Settings → eBay.") — [app/ebay-sell.ts:281, 440, 445, 448](../../card-db-mvp/src/app/ebay-sell.ts); the public privacy policy ("Disconnect in Settings → eBay") — [render/privacy.ts:65, 74](../../card-db-mvp/src/render/privacy.ts).
- The owner console, by contrast, says "Configuration → eBay" — [render/admin.ts:686, 700](../../card-db-mvp/src/render/admin.ts); the owner uploader button says "My settings" — [render/admin.ts:382](../../card-db-mvp/src/render/admin.ts).
- The client calls it configuration ("when I go to configuration") — [client transcript 02:23–02:26](../../client-walkthrough-2026-09-14-transcript.txt); CU's sidebar item is "Configuration", and CU keeps a separate "Account Settings" in the account menu — [login/nav research §4](../../carduploader-login-nav-research.md).

**The listing lifecycle ("listed", "exported", "published", "live")**
- Inventory status tabs and pills are "All / In stock / Listed / Sold" — [render/app.ts:396, 431](../../card-db-mvp/src/render/app.ts).
- Creating any listing draft (bulk "Create listings" or the builder's "Save listing draft") immediately sets the inventory row to `listed` — [app/store.ts:857–862](../../card-db-mvp/src/app/store.ts). "Listed" in Inventory therefore can mean "a draft exists", not "live on eBay".
- Inventory bulk "Mark as listed" sets the inventory status to `listed` — [server.ts:864–868](../../card-db-mvp/src/server.ts). Listings bulk "Mark as listed" instead sets the listing status to `exported` and flashes "N listings marked as listed on eBay." — [server.ts:1011–1013](../../card-db-mvp/src/server.ts); the Listings status pill then prints the raw word "exported" — [render/app.ts:1162](../../card-db-mvp/src/render/app.ts).
- Automatic inventory shows a third button, "Mark live", on `exported` rows, which sets `published` and flashes "Marked live." — [render/workspace2.ts:491](../../card-db-mvp/src/render/workspace2.ts); [server.ts:2190](../../card-db-mvp/src/server.ts).
- The direct-listing verbs are "Save & publish to eBay →", "Publish", "Publish now", "Publish due now", "Revise", "End" — [render/app.ts:1119, 1165, 1185, 1200](../../card-db-mvp/src/render/app.ts).
- Listing statuses are printed raw in four tables: draft / scheduled / exported / published / ended — [render/app.ts:1134, 1162](../../card-db-mvp/src/render/app.ts); [render/workspace2.ts:204, 490](../../card-db-mvp/src/render/workspace2.ts); values set in [app/store.ts:885, 898, 917](../../card-db-mvp/src/app/store.ts).
- CU's inventory statuses are "Listed / Not listed / Sold", its buttons "Mark as Listed" and "List on eBay (via API)" — [teardown §3 Inventory](../../carduploader-logged-in-teardown.md); [asks-and-plan §1b "List / Export"](../../client-video-2026-09-14-asks-and-plan.md). Our own Automatic-inventory note already uses "Listed / Not listed / Sold" — [render/workspace2.ts:499](../../card-db-mvp/src/render/workspace2.ts).
- The client's verb is "list": "they have a way to just click this and it'll just list it automatically to eBay" — [client transcript 12:47–12:52](../../client-walkthrough-2026-09-14-transcript.txt).

**Stock counts**
- Dashboard tile "Cards in stock" shows the sum of quantities across all inventory rows including sold ones, with the sub-line "N records · N listed · N sold" — [render/app.ts:240](../../card-db-mvp/src/render/app.ts); `units` = `SUM(inv.quantity)` with no status filter — [app/store.ts:796](../../card-db-mvp/src/app/store.ts).
- Inventory tile "Cards in stock" shows the number of rows (`COUNT(*)`), again including sold — [render/app.ts:390](../../card-db-mvp/src/render/app.ts); [app/store.ts:796](../../card-db-mvp/src/app/store.ts).
- Directly above it, the Inventory summary line "N products · N cards · Price $ · Market $" counts only unsold rows and copies — [render/app.ts:494](../../card-db-mvp/src/render/app.ts); [app/store.ts:800–801](../../card-db-mvp/src/app/store.ts). A seller can see "12 products · 30 cards" and "Cards in stock: 15" on the same screen.
- The same quantities are also called "records" ([render/app.ts:240](../../card-db-mvp/src/render/app.ts); [render/admin.ts:173, 297](../../card-db-mvp/src/render/admin.ts)) and "units" ([render/app.ts:388](../../card-db-mvp/src/render/app.ts); [render/workspace2.ts:310](../../card-db-mvp/src/render/workspace2.ts)). CU's header is "N products · N cards · Price $ · Market $" — [teardown §3](../../carduploader-logged-in-teardown.md).

**Add-cards pages and the "add" call to action**
- Sidebar: "Ungraded cards" and "Ungraded pricing tool" — [render/app.ts:180, 190](../../card-db-mvp/src/render/app.ts). Both open the same template, whose heading is "Add cards" in both modes — [render/app.ts:750](../../card-db-mvp/src/render/app.ts) — and whose browser title is "Add cards" or "Price cards" — [render/app.ts:766](../../card-db-mvp/src/render/app.ts). The mode cards say "Price only" and "Add to inventory" — [render/app.ts:585, 592](../../card-db-mvp/src/render/app.ts); the Dashboard tile says "Pricing tool" — [render/app.ts:250](../../card-db-mvp/src/render/app.ts). In price mode the heading "Add cards" sits above the sentence "Nothing is added to inventory" — [render/app.ts:622](../../card-db-mvp/src/render/app.ts).
- The link to `/app/scan` is labelled "+ Add cards" ([render/app.ts:358](../../card-db-mvp/src/render/app.ts)), "+ Scan cards" (:286, :492), "+ New batch" (:340), "New batch" (:1030), "Scan / add cards" (:345, :411; [render/admin.ts:308](../../card-db-mvp/src/render/admin.ts)), "Start Scanning →" and "Start your free scan" ([render/pages.ts:103, 135](../../card-db-mvp/src/render/pages.ts)).

**Batches and pricing runs**
- Sidebar and heading "Previous batches" but browser title "Batches" — [render/app.ts:169, 340, 349](../../card-db-mvp/src/render/app.ts).
- Default batch names differ by page: "Photo batch / Pasted batch / Sample batch" ([render/app.ts:304, 325](../../card-db-mvp/src/render/app.ts)), "Scan batch" for everything on Inventory (:483), "Batch" on the add-cards aside (:742), "Graded batch / Catalog picks" in the owner console ([render/admin.ts:321, 442](../../card-db-mvp/src/render/admin.ts)).
- Pricing runs are "pricings" ("Recent pricings", "No pricings yet.", fallback "Pricing") — [render/app.ts:717, 722, 725](../../card-db-mvp/src/render/app.ts); "Pricing #N" — [render/workspace2.ts:326, 332](../../card-db-mvp/src/render/workspace2.ts); "Card pricing" / "Priced list" on the public share page — [render/workspace2.ts:314, 318](../../card-db-mvp/src/render/workspace2.ts); converting one is "Turn into inventory batch →" — [render/workspace2.ts:326](../../card-db-mvp/src/render/workspace2.ts); card search adds to "a new review batch" — [render/workspace2.ts:348, 353](../../card-db-mvp/src/render/workspace2.ts).
- On Sept 14 the client's own test tab showed "Price check #6" — [asks-and-plan §1c](../../client-video-2026-09-14-asks-and-plan.md) — a name from the abandoned buyer pivot, since replaced by "Pricing #N".
- The client and CU both say "batch" ("Previous batches I want people to go back to their previous batches") — [client transcript 01:04–01:12](../../client-walkthrough-2026-09-14-transcript.txt); CU sidebar "Previous Batches" — [teardown §2](../../carduploader-logged-in-teardown.md).

**Match states**
- Review tabs: "All / Needs review / Failed / Matched" — [render/app.ts:970–975](../../card-db-mvp/src/render/app.ts). The same state is "No match" on the row badge (:775) and in help (:280), "failed" in the progress bar (:1038), column "Failed" on Previous batches (:344), "Unmatched" on pricing results ([render/workspace2.ts:270](../../card-db-mvp/src/render/workspace2.ts)), "Unmatched card" / "no match yet" in the compare modal ([render/app.ts:2085, 2088](../../card-db-mvp/src/render/app.ts)).
- "Needs review" is also "Awaiting review" ([render/app.ts:241](../../card-db-mvp/src/render/app.ts); [render/admin.ts:299, 374](../../card-db-mvp/src/render/admin.ts)), "need review" ([render/app.ts:1037](../../card-db-mvp/src/render/app.ts)) and "to review" (:301, :317).

**Variant (Normal / Holo / Reverse Holo)**
- Review dropdown label "Printing" — [render/app.ts:916](../../card-db-mvp/src/render/app.ts); TCGplayer panel column "Printing" — [render/pages.ts:568](../../card-db-mvp/src/render/pages.ts); search facet "Finish" — [render/pages.ts:689](../../card-db-mvp/src/render/pages.ts); title block "Finish" — [app/title.ts:32](../../card-db-mvp/src/app/title.ts); marketing "variant-aware values" — [render/layout.ts:126](../../card-db-mvp/src/render/layout.ts).
- The client says "variants": "the variants? This is like if it's holo normal … reverse is whatever the variant is" — [client transcript 08:34–08:54](../../client-walkthrough-2026-09-14-transcript.txt); CU results rows show a "variant pill" and its title variables include "Variant" — [asks-and-plan §1b](../../client-video-2026-09-14-asks-and-plan.md); [teardown §6b](../../carduploader-logged-in-teardown.md).

**Ungraded vs raw**
- "Ungraded" on card-page grade rows and tabs ([render/pages.ts:332–336](../../card-db-mvp/src/render/pages.ts)) and in the sidebar ([render/app.ts:180, 190](../../card-db-mvp/src/render/app.ts)); "Raw" as the grader choice in review ([render/app.ts:926](../../card-db-mvp/src/render/app.ts)), in sold-price chips "Raw · NM" ([render/pages.ts:382, 399](../../card-db-mvp/src/render/pages.ts); [render/sales.ts:111](../../card-db-mvp/src/render/sales.ts)), "raw cards" on the landing page ([render/pages.ts:149](../../card-db-mvp/src/render/pages.ts)) and "raw market" on Graded cards ([render/workspace2.ts:89](../../card-db-mvp/src/render/workspace2.ts)).
- Since July 2023 eBay's two conditions for single trading cards are "Graded" and "Ungraded" — [eBay announcement](https://community.ebay.com/t5/Announcements/Revamp-your-trading-card-listings-with-updated-conditions/ba-p/33878006); [EcommerceBytes, July 19 2023](https://www.ecommercebytes.com/2023/07/19/no-more-used-trading-cards-on-ebay-either-graded-or-ungraded/).

**Condition**
- Dropdowns show "NM · Near Mint … DMG · Damaged" — [app/pricing.ts:126–131](../../card-db-mvp/src/app/pricing.ts); column headers are "Cond" ([render/app.ts:467](../../card-db-mvp/src/render/app.ts)), "Cond." ([render/workspace2.ts:309](../../card-db-mvp/src/render/workspace2.ts)) or "Condition".
- The eBay item specific we send is "Card Condition: Near Mint" (etc.) — [app/listing.ts:87–89, 190](../../card-db-mvp/src/app/listing.ts). eBay's own "Card Condition" values for category 183454 (CCG singles, which covers Pokémon and One Piece) are "Near Mint or Better", "Lightly Played (Excellent)", "Moderately Played (Very Good)", "Heavily Played (Poor)"; the plain "Excellent / Very Good / Poor" values are for sports and non-sport categories — [eBay Developers Program, Condition Descriptor IDs](https://developer.ebay.com/api-docs/user-guides/static/mip-user-guide/mip-enum-condition-descriptor-ids.html). eBay's list has no separate "Damaged" value.

**Grader and cert number**
- "Grader" ([render/app.ts:926](../../card-db-mvp/src/render/app.ts); [render/workspace2.ts:226](../../card-db-mvp/src/render/workspace2.ts)), "Grade Company" (description variable, [app/listing.ts:218](../../card-db-mvp/src/app/listing.ts)), "Professional Grader" (eBay item specific, [app/listing.ts:187](../../card-db-mvp/src/app/listing.ts)); "Cert numbers", "Certification numbers", "Cert number" ([render/workspace2.ts:61, 65, 228](../../card-db-mvp/src/render/workspace2.ts)).
- eBay's graded descriptors are "Professional Grader", "Grade" and "Certification Number" — [eBay Condition Descriptor IDs](https://developer.ebay.com/api-docs/user-guides/static/mip-user-guide/mip-enum-condition-descriptor-ids.html). CU's description variables include "Grade Company" — [teardown §3 Configuration](../../carduploader-logged-in-teardown.md).

**Platform / channel / marketplace / market**
- "Platform" on the add-cards setup — [render/app.ts:634](../../card-db-mvp/src/render/app.ts); "Channel" as the Listings column — [render/app.ts:1195](../../card-db-mvp/src/render/app.ts), on Automatic inventory — [render/workspace2.ts:498](../../card-db-mvp/src/render/workspace2.ts) and on the add-order form — [render/workspace2.ts:443](../../card-db-mvp/src/render/workspace2.ts); "Marketplace" in the builder's drafts table — [render/app.ts:1132](../../card-db-mvp/src/render/app.ts).
- "Market" is used for the marketplace column and filter on the sales pages — [render/sales.ts:120, 139](../../card-db-mvp/src/render/sales.ts); [render/pages.ts:389](../../card-db-mvp/src/render/pages.ts) — and for the eBay site in the owner console — [render/admin.ts:695](../../card-db-mvp/src/render/admin.ts) — while "Market" also means market price everywhere else ([render/app.ts:239, 389, 1001](../../card-db-mvp/src/render/app.ts); [render/workspace2.ts:309](../../card-db-mvp/src/render/workspace2.ts)).
- The client says "what platform you're gonna use" — [client transcript 03:35–03:41](../../client-walkthrough-2026-09-14-transcript.txt); CU's setup field is "Platform" — [teardown §6b](../../carduploader-logged-in-teardown.md).

**Game / "Database" / catalog**
- Add-cards field "Database — which game the cards are from" with option "Any game (auto-detect)" — [render/app.ts:614, 69](../../card-db-mvp/src/render/app.ts); the same choice is "Game" in Listing creator ([render/workspace2.ts:144](../../card-db-mvp/src/render/workspace2.ts)), card search ("All games", [render/workspace2.ts:361](../../card-db-mvp/src/render/workspace2.ts)) and blank listings ([render/workspace2.ts:232](../../card-db-mvp/src/render/workspace2.ts)). The public share page calls the catalog "the card price database" — [render/workspace2.ts:316](../../card-db-mvp/src/render/workspace2.ts).
- The client: "the Database of all the card games that are out there right now" — [client transcript 03:12–03:16](../../client-walkthrough-2026-09-14-transcript.txt); CU's field is "Database (default 'English Pokemon')" — [teardown §6b](../../carduploader-logged-in-teardown.md).

**Sold-price tool**
- Header "Sales Lookup" — [render/layout.ts:98](../../card-db-mvp/src/render/layout.ts); sidebar "Sales lookup" — [render/app.ts:192](../../card-db-mvp/src/render/app.ts); public heading "Sold-price lookup" and title "Card sold-price lookup" — [render/sales.ts:152, 161](../../card-db-mvp/src/render/sales.ts); card-page button "Sold prices" — [render/pages.ts:483](../../card-db-mvp/src/render/pages.ts); card-page panel "Sold comps" — [render/pages.ts:500](../../card-db-mvp/src/render/pages.ts); owner nav "Sold prices", "Open Sold prices →", "the public Sold prices page" — [render/admin.ts:67, 514, 534](../../card-db-mvp/src/render/admin.ts). CU's name is "Sales Lookup" — [login/nav research §3](../../carduploader-login-nav-research.md).

**Pricing words**
- The rule select is "Pricing rule" ([render/app.ts:635, 693, 1326](../../card-db-mvp/src/render/app.ts)), "Pricing" (bulk bar :456, review row :929), "Default pricing" (:391; [render/admin.ts:282](../../card-db-mvp/src/render/admin.ts)).
- The remembered price is "you listed at $X" ([render/app.ts:879](../../card-db-mvp/src/render/app.ts)), "that memory" (:1332) and "Previous price" ([app/pricing.ts:70–72](../../card-db-mvp/src/app/pricing.ts)); CU calls it "Previous price" — [teardown §6b](../../carduploader-logged-in-teardown.md).
- The minimum is "Never price below ($) — floor for automatic prices" ([render/app.ts:1337](../../card-db-mvp/src/render/app.ts)), "A floor stops automatic prices dropping below a minimum" (:279), hub meta "floor $0.99" (:1257); CU: "Do not price below start price" — [teardown §6b](../../carduploader-logged-in-teardown.md). eBay's US minimum for a fixed-price item is $0.99 (the minimum applies only to fixed-price listings) — [eBay "Selling with Buy It Now" help, seen via search-result summary](https://www.ebay.com/help/selling/listings/selling-buy-now?id=4109).
- "mkt" abbreviation for market price — [render/app.ts:430, 879, 1093](../../card-db-mvp/src/render/app.ts).

**Offers**
- "Accept Best Offers" ([render/app.ts:1114, 1448](../../card-db-mvp/src/render/app.ts)), bulk "Offers on" / "Offers off" (:1190–1191), flash "Best Offer enabled/disabled on N listings" ([server.ts:1009](../../card-db-mvp/src/server.ts)).
- On eBay's own listing form the Best Offer switch is labelled "Allow offers" (Pricing → More options) — [eBay help "Adding Best Offer to your listing", seen via search-result summary](https://www.ebay.com/help/selling/listings/selling-buy-now/adding-best-offer-listing?id=4144); CU: "Best Offer: allow offers, Minimum Offer %, Auto Accept %" — [teardown §6b](../../carduploader-logged-in-teardown.md). The client "usually turn[s] this off" — [client transcript 08:12–08:15](../../client-walkthrough-2026-09-14-transcript.txt).

**Listing formats**
- "eBay Fixed Price" / "eBay Auctions" ([render/app.ts:634, 1025](../../card-db-mvp/src/render/app.ts)), "Fixed price (Buy It Now)" / "Auction" (:1104), "Fixed price" / "Auction" ([render/workspace2.ts:216](../../card-db-mvp/src/render/workspace2.ts)), "Buy It Now" chip ([render/pages.ts:369](../../card-db-mvp/src/render/pages.ts); [render/sales.ts:29](../../card-db-mvp/src/render/sales.ts)), "BIN" filter ([render/sales.ts:59](../../card-db-mvp/src/render/sales.ts)), raw "fixed" / "auction" in tables ([render/app.ts:1134, 1159](../../card-db-mvp/src/render/app.ts); [render/workspace2.ts:204](../../card-db-mvp/src/render/workspace2.ts)).

**Export and eBay's upload tool**
- "Export eBay CSV" ([render/app.ts:45](../../card-db-mvp/src/render/app.ts)), "Export batch → eBay CSV" (:1027), bare "CSV" buttons (:333; [render/workspace2.ts:204](../../card-db-mvp/src/render/workspace2.ts)), "Download eBay CSV" (:1120), "Export [eBay / TCGplayer / Whatnot / Shopify]" with tooltip "eBay (File Exchange)" (:458; [app/exporters.ts:286](../../card-db-mvp/src/app/exporters.ts)), "Export all" (:1174).
- "File Exchange CSV" appears in seller copy at [render/app.ts:261, 281, 1084, 1206, 1423](../../card-db-mvp/src/render/app.ts) and on the pricing page ([render/pricing.ts:34](../../card-db-mvp/src/render/pricing.ts)).
- eBay has moved File Exchange into "Seller Hub Reports": Reports tab → Upload → "Get template" / "Upload template", template types "Create new listings template" and "Create drafts template"; processing "usually takes less than 15 minutes", ending with "Your upload is complete" and a downloadable results report — [eBay help: Seller Hub Reports](https://www.ebay.com/help/selling/selling-tools/file-exchange?id=4096); [eBay Community: "File Exchange Has Moved To Seller Hub Reports"](https://community.ebay.com/t5/Seller-Tools/File-Exchange-Has-Moved-To-Seller-Hub-Reports/td-p/31864538).

**Business policies**
- UI labels are "Shipping policy", "Payment policy", "Return policy" ([render/app.ts:1432, 1451–1453](../../card-db-mvp/src/render/app.ts)), but the listing check prints "No fulfillment policy selected" — [app/ebay-sell.ts:445](../../card-db-mvp/src/app/ebay-sell.ts) ("fulfillment" is the API's name). eBay's help uses payment, shipping and return policies, managed from the business policies dashboard — [eBay help: Business policies](https://www.ebay.com/help/selling/business-policies/business-policies?id=4212).

**People and accounts**
- Seller side: "Shop name" ([render/auth.ts:105](../../card-db-mvp/src/render/auth.ts); [render/app.ts:1318](../../card-db-mvp/src/render/app.ts)); privacy policy "seller account" ([render/privacy.ts:27](../../card-db-mvp/src/render/privacy.ts)).
- Owner side: nav "Users" ([render/admin.ts:65](../../card-db-mvp/src/render/admin.ts)), stat "Accounts" (:154), "Newest accounts" (:180), "seller #N" (:369), "legacy seller · no login" (:51, :275), "Connected sellers" (:692), "Customer sign-in" (:107), "customer" in page descriptions (:348, :772); the owner-mode banner says "customer's workspace" ([render/layout.ts:56–79](../../card-db-mvp/src/render/layout.ts)).

**Plan**
- "Your plan", "Pro · $15/month", status pill "Active" or "Free" ([render/app.ts:225–226](../../card-db-mvp/src/render/app.ts)), "Plans & pricing" (:231) vs footer "Pricing & plans" ([render/layout.ts:142](../../card-db-mvp/src/render/layout.ts)); owner console "tier", "Free tier", "Pro (paid)", "plan tier" ([render/admin.ts:155–156, 240, 339](../../card-db-mvp/src/render/admin.ts)); "Subscribe" ([render/pricing.ts:51, 71](../../card-db-mvp/src/render/pricing.ts)).
- The client calls it "the membership" — [client transcript 15:12–15:15](../../client-walkthrough-2026-09-14-transcript.txt); CU shows "Plan: Free · Active" and "Upgrade plan" / "Billing" — [login/nav research §4](../../carduploader-login-nav-research.md).

**Help and feedback**
- Seller "Inbox" page with a "Send a note" form ([render/workspace2.ts:520, 525](../../card-db-mvp/src/render/workspace2.ts)); owner "Feedback" ([render/admin.ts:71, 766](../../card-db-mvp/src/render/admin.ts)). CU: "Feedback (modal) · Inbox (unread badge)" — [login/nav research §4](../../carduploader-login-nav-research.md).

**Help-improve-matching opt-in**
- Hub tile "Privacy" with meta "Opted in to improving identification" / "Not sharing matches (default)" ([render/app.ts:1236, 1270](../../card-db-mvp/src/render/app.ts)); checkbox "Opt in to improving identification from my confirmed matches" (:1482); privacy policy calls it "photo matching … turn on that option in Settings" ([render/privacy.ts:33, 75](../../card-db-mvp/src/render/privacy.ts)).

**Duplicates and bulk edit**
- "merge duplicates" checkbox ([render/app.ts:1049](../../card-db-mvp/src/render/app.ts)), "merge folds its quantity in on commit" (:819), "duplicates that merge are skipped" (:1014); the price-all / SKU panel is "Batch tools" (:1006).
- The client and CU say "Manage duplicates", "combine" and "bulk editing" — [client transcript 07:24–07:30, 08:01–08:04](../../client-walkthrough-2026-09-14-transcript.txt); CU menus "Manage Duplicates", "Combine All Duplicates", "Bulk Edit" — [asks-and-plan §1b](../../client-video-2026-09-14-asks-and-plan.md).

**Title and description tokens**
- The set code is "Set Number" in the title builder ([app/title.ts:35](../../card-db-mvp/src/app/title.ts)) but "Set Code" in description variables ([app/listing.ts:209](../../card-db-mvp/src/app/listing.ts)); default template names are "Description N" ([render/app.ts:1382](../../card-db-mvp/src/render/app.ts)) vs "Template N" ([app/listing.ts:248](../../card-db-mvp/src/app/listing.ts)).

**Demo vs sample**
- Owner console: "N real · N demo", "Mark as demo data (shown with a 'sample' chip…)", pill "demo" ([render/admin.ts:481, 492, 498, 520](../../card-db-mvp/src/render/admin.ts)); public chip "sample" ([render/sales.ts:107](../../card-db-mvp/src/render/sales.ts)).

**Style-guide basis**
- NN/g heuristic #4: use "the same patterns everywhere inside the system", and users "bring their expectations from other sites" (external consistency) — [NN/g, Krause, Jan 10 2021](https://www.nngroup.com/articles/consistency-and-standards/).
- NN/g heuristic #2: "The system should speak the users' language, with words, phrases, and concepts familiar to the user, rather than system-oriented terms." — [NN/g, Kaley, July 1 2018](https://www.nngroup.com/articles/match-system-real-world/).

### Inferences
- Where the client's words, CU's labels and eBay's terms agree ("batch", "Previous batches", "Configuration", "platform", "variant", "Ungraded", "Mark as listed", "bulk edit", "Sales lookup"), the approved term should be that shared word; it is both the users' language (NN/g #2) and the external convention (NN/g #4).
- Where CU's term is jargon to anyone who hasn't used CU ("Database" for the game), plain English ("Game") serves more sellers; this is a judgment call for the client because the Sept 19 change deliberately copied CU's "Database" label.
- Where our data goes to eBay (conditions, policies, offers, formats), eBay's wording should win, because that is what the seller sees in Seller Hub afterwards.
- The "Listed" problem is partly behaviour, not just wording: as long as creating a draft marks inventory `listed` ([app/store.ts:857–862](../../card-db-mvp/src/app/store.ts)), no label makes "Listed" truthful. The developer should set `listed` only when a listing goes live (API) or the seller marks it listed after a CSV upload; until then, label that state "In a listing draft" rather than "Listed".

#### Proposed glossary (one approved term per concept)

| Concept | Approved term | Retire / avoid | Basis |
|---|---|---|---|
| Product name | **Trading Card Loader** (client to confirm; see question 2) | CardIndex | Matches the domain and the eBay-linked privacy page |
| Logged-in area (nav and header) | **Dashboard** | Seller tools, Seller workspace, My workspace, "Open your workspace" | CU header item "Dashboard"; our sidebar already says Dashboard |
| The person | **seller** (owner console); "you" in seller UI | user, customer, member (except eBay's own "member"), legacy seller, "the client's" | DB, eBay page and privacy policy already say seller |
| Login | **account** | login (noun) | Microsoft/GOV.UK advice against "login" as a noun |
| Business name | **shop name** | display name | Already used at signup and in Configuration |
| Plan | **plan**; names **Free** and **Pro**; action **Upgrade to Pro** | tier, Free tier, Pro (paid), membership, subscription/Subscribe (until checkout exists) | CU "Plan: Free · Active", "Upgrade plan" |
| Public plans page | **Plans** | Pricing (clashes with card pricing), Pricing & plans, Plans & pricing | "pricing" already means card prices in 10+ places |
| Game choice on add-cards pages | **Game** (or "Database" if the client wants exact CU parity) | Database, card game, TCG (in headings) | NN/g #2; client/CU use "Database" |
| All cards the site knows | **catalog** | database, card price database | Admin page is already "Catalog" |
| A group of cards added together | **batch** | job, scan batch, review batch, inventory batch | Client and CU say batch |
| A pricing-tool run | **pricing batch**; the shareable output **priced list** | pricing(s), Pricing #N, Card pricing, Price check | Removes the buyer-pivot "Price check" and the awkward plural |
| Global add action | **+ Add cards** | + Scan cards, + New batch, New batch, Scan / add cards, Start Scanning | One destination, one label |
| Page headings | **Same words as the sidebar item** (Ungraded cards, Ungraded pricing tool, Previous batches, Configuration…) | "Add cards" as the heading of both tools, "Price cards", "Batches" | NN/g #4 |
| Match states | **Matched (N%)**, **Needs review**, **No match**, **Approved**, **Skipped** | Failed, Unmatched, Awaiting review, need review, to review | One word per state |
| Fixing a match | **Compare** (opens) / **Replace** (commits) | Search manually as a separate control | CU "Compare", "Replace" |
| Card version | **Variant** (Normal, Holo, Reverse Holo…) | Printing, Finish (as a picker label) | Client and CU say variant; keep "Finish" only as an eBay item-specific / title-token name |
| Condition | **Condition**, values NM / LP / MP / HP / DMG with TCGplayer names; on eBay screens show eBay's descriptor | Cond, Cond., Lang | eBay CCG descriptors |
| Not graded | **Ungraded** | Raw | eBay condition name |
| Grading company | **Grader** (eBay field: Professional Grader) | Grade Company | eBay descriptor names |
| Cert | **cert number** (eBay field: Certification Number) | mixed "Cert/Certification numbers" headings | eBay descriptor names |
| Inventory status | **Not listed / Listed / Sold** | In stock (as a status), Mark in stock | CU; our own note at workspace2.ts:499; listed cards are also "in stock" |
| Inventory counts | **products** (rows) and **cards** (copies) | records, units, the "Cards in stock" tile | CU header |
| Listing status (Listings page) | **Draft → Scheduled → CSV exported → Live on eBay → Ended** | raw draft/scheduled/exported/published/ended | eBay calls live listings "live"/"active" |
| Make it live through eBay's API | **List on eBay**; then **Revise**, **End listing** | Publish, Publish now, Save & publish, Publish due now | Client "list it"; CU "List on eBay (via API)"; eBay's own verbs |
| After uploading a CSV at eBay | **Mark as listed** (one meaning: listing becomes Live on eBay, inventory row becomes Listed) | the second "Mark as listed", Mark live | CU "Mark as Listed" |
| Export | **Export {platform} CSV** (e.g. Export eBay CSV) | Download eBay CSV, bare "CSV", Export batch →, eBay (File Exchange) | CU "Export CSV" |
| eBay's bulk upload tool | **eBay Seller Hub → Reports → Upload** | File Exchange | eBay renamed it |
| Where a listing goes | **Platform** | Channel, Marketplace, Market (as a column) | Client and CU say platform |
| TCGplayer market price | **Market price** (short: Market) | mkt, catalog market, TCGP | Plain English |
| Seller's price | **Your price**; batch default **Start price** | ambiguous bare "Price" in totals | CU "Start Price"; client "whatever price I want to start off with" |
| Price rule | **Pricing rule** | Pricing (as a select label), Default pricing, rule | Already the main label |
| Remembered price | **Previous price** | you listed at, memory | CU "Previous price" |
| Price floor | **Minimum price** | floor | Plain English |
| Settings area | **Configuration** | Settings, settings, All settings | Client, CU, Sept 19 sidebar |
| eBay connection | **Connect eBay** / **Connected as {user}** / **Disconnect** | Seller link, eBay link | Consistent verbs |
| Business policies | **Shipping policy, Payment policy, Return policy** | fulfillment policy | eBay help |
| Offers | **Allow offers (Best Offer)** | Accept Best Offers, Offers on/off | eBay listing form, CU |
| Listing format | **Fixed price (Buy It Now)** and **Auction** | BIN, raw fixed/auction, "eBay Auctions" | eBay terms |
| Scheduling | **Schedule**, **Space out** | runner, scheduler, parked | CU "Space Out" |
| Sold-price tool / data | **Sales lookup** (tool); **sold prices** (data) | Sold-price lookup, Sold prices (as a page name), sold comps, archive, canonicalized | CU "Sales Lookup" |
| Live eBay research | **eBay listed ↗** / **eBay sold ↗** / **Live on eBay** panel | "eBay Listed" (inconsistent capitals) | CU |
| Session | **Sign in / Sign out / Create account** | Log out, Sign out of console | Microsoft style; CU "Sign in"/"Sign out" |
| Help | **Inbox** (replies) + **Send feedback** (form); owner side **Seller feedback** | Send a note | CU "Feedback · Inbox" |
| Opt-in | **Help improve matching** | Privacy (as tile name), photo matching, sharing matches, training | One name for one switch |
| Example data | **sample** | demo | Public chip already says sample |
| Review-page price/SKU tools | **Bulk edit** | Batch tools | Client and CU |
| Duplicates | **Combine duplicates** | merge duplicates, "folds in on commit" | CU "Combine All Duplicates" |
| Owner area | **Owner console** | back office, console alone | Already the admin heading |

#### Before → after fixes: naming (N-series)

| ID | Where | Before | After | Why |
|---|---|---|---|---|
| N1 | render/app.ts:252 | Quick tile "Settings — SKUs, pricing, matching, titles, descriptions, every channel." | "Configuration — SKUs, pricing rules, matching, titles, descriptions and platforms." | Sidebar says Configuration |
| N2 | render/app.ts:1486 | "← All settings" | "← Configuration" | Same |
| N3 | render/app.ts:1116 | "Business policies applied from settings:" | "Business policies from Configuration → eBay:" | Same |
| N4 | app/ebay-sell.ts:281, 440, 448 | "…(Settings → eBay)." / "…under Settings → eBay." | "…(Configuration → eBay)." | Same |
| N5 | app/ebay-sell.ts:445 | "No fulfillment policy selected (Settings → eBay → Sync policies)." | "No shipping policy selected. Go to Configuration → eBay, press Sync policies from eBay and pick one." (payment/return likewise) | UI label is "Shipping policy"; "fulfillment" is API-speak |
| N6 | render/privacy.ts:33, 65, 74, 75 | "in Settings", "Settings → eBay" | "in Configuration", "Configuration → eBay" | Public policy should name the real menu |
| N7 | render/app.ts:396, 431, 461; server.ts:868 | Tab/pill "In stock"; "Mark in stock"; "marked … in stock" | "Not listed"; "Mark not listed"; "marked not listed" | CU vocabulary; listed cards are also in stock |
| N8 | render/app.ts:240 | Tile "Cards in stock" (all copies incl. sold) · "N records · N listed · N sold" | Tile "Cards" (unsold copies) · "N products · N listed · N sold" | The label promised "in stock" but counted sold cards |
| N9 | render/app.ts:916; render/pages.ts:568, 689 | "Printing"; facet "Finish" | "Variant" | Client/CU word |
| N10 | render/app.ts:926; render/pages.ts:149, 382, 399; render/sales.ts:111; render/workspace2.ts:89 | "Raw"; "raw cards"; "Raw · NM"; "raw market" | "Ungraded"; "ungraded cards"; "Ungraded · NM"; "ungraded market price" | eBay condition name |
| N11 | render/app.ts:344, 973, 1038; render/workspace2.ts:270; render/app.ts:2085 | "Failed", "N failed", "Unmatched", "Unmatched card" | "No match", "N no match", "No match", "No match yet" | One name per state |
| N12 | render/app.ts:241; render/admin.ts:299, 374 | "Awaiting review" | "Needs review" | Matches the review tab |
| N13 | render/app.ts:1049 | "merge duplicates" | "Combine duplicates" | CU/client word |
| N14 | render/app.ts:819 | "Duplicate of item #N in this batch — merge folds its quantity in on commit." | "Duplicate of card #N in this batch. When you add the batch to inventory, the two become one card with quantity 2." | Removes "commit" and "item" |
| N15 | render/app.ts:1006 | "Batch tools" | "Bulk edit" | CU/client word |
| N16 | render/app.ts:1132, 1195; render/workspace2.ts:443, 498 | "Marketplace", "Channel" | "Platform" | Client/CU word |
| N17 | render/sales.ts:120, 139; render/pages.ts:389; render/admin.ts:695 | Column/filter "Market" (meaning marketplace or eBay site) | "Sold on" (sales); "eBay site" (owner) | "Market" means market price elsewhere |
| N18 | render/sales.ts:59 | "BIN" | "Buy It Now" | Spell out |
| N19 | render/app.ts:634, 1025; render/workspace2.ts:216 | "eBay Fixed Price" / "eBay Auctions"; "Fixed price" | "eBay fixed price (Buy It Now)" / "eBay auction"; "Fixed price (Buy It Now)" | eBay terms, sentence case |
| N20 | render/app.ts:1114, 1448, 1190–1191 | "Accept Best Offers…"; "Offers on" / "Offers off" | "Allow offers (Best Offer)…"; "Allow offers" / "Turn off offers" | eBay's own label |
| N21 | render/app.ts:391, 456, 929; render/admin.ts:282 | "Default pricing"; select label "Pricing" | "Default pricing rule"; "Pricing rule" | One label for one control |
| N22 | render/app.ts:879, 1332 | "you listed at $X"; "choose whether that memory beats the rule" | "Previous price $X"; "choose whether your previous price or the pricing rule comes first" | CU term, plain English |
| N23 | render/app.ts:1337, 279, 1257 | "Never price below ($) — floor for automatic prices · blank = eBay's $0.99 minimum"; "A floor stops…"; "floor $0.99" | "Minimum price ($) — automatic prices never go below this · blank = $0.99, eBay's minimum for fixed-price listings"; "A minimum price stops…"; "min. $0.99" | Plain English, accurate scope |
| N24 | render/app.ts:430, 879, 1093; :239, :389 | "mkt $X"; "catalog market price × quantity" | "Market $X"; "TCGplayer market price × quantity" | Spell out, name the source |
| N25 | render/app.ts:717, 722, 725; render/workspace2.ts:326, 332 | "Recent pricings", "Pricing", "No pricings yet.", "Pricing #N" | "Recent pricing batches", "Pricing batch", "No pricing batches yet.", "Pricing batch #N" | One term; no awkward plural |
| N26 | render/workspace2.ts:326 | Confirm "Turn this pricing into an inventory batch? …"; button "Turn into inventory batch →" | "Add these cards to inventory? They'll go through review first and get SKUs when you add them."; "Add to inventory →" | Uses the same verb as the review page |
| N27 | render/app.ts:304, 325, 483, 742; render/admin.ts:321, 442 | "Photo batch / Pasted batch / Sample batch", "Scan batch", "Batch", "Graded batch / Catalog picks" | One helper everywhere: "Photo batch", "Pasted batch", "Graded batch", "Catalog batch", "Sample batch" | Same batch, same name on every page |
| N28 | render/app.ts:349 | Title "Batches — Seller workspace \| CardIndex" | "Previous batches \| Trading Card Loader" | Match sidebar |
| N29 | render/app.ts:750, 766 | Heading "Add cards" (both modes); title "Price cards" / "Add cards" | Inventory mode "Ungraded cards"; price mode "Ungraded pricing tool" (heading and title) | Page name = nav name |
| N30 | render/app.ts:286, 340, 345, 411, 492, 1030; render/admin.ts:308 | "+ Scan cards", "+ New batch", "Scan / add cards", "New batch" | "+ Add cards" | One CTA |
| N31 | render/app.ts:614 | "Database — which game the cards are from" | "Game — which game the cards are from" (keep "Database" only if the client wants CU parity) | Plain English |
| N32 | app/title.ts:35; app/listing.ts:209, 218 | "Set Number" (title) vs "Set Code" (description); "Grade Company" | "Set code" in both; "Grader" | Same field, same name |
| N33 | render/app.ts:1382; app/listing.ts:248 | Default template names "Description N" vs "Template N" | "Template N" in both | Consistency |
| N34 | render/app.ts:1236, 1270, 1482 | Tile "Privacy"; "Opted in to improving identification" / "Not sharing matches (default)"; checkbox "Opt in to improving identification from my confirmed matches" | Tile "Help improve matching"; meta "On" / "Off (default)"; checkbox "Let my confirmed matches help improve matching (off by default)" | One name for one switch |
| N35 | render/admin.ts:481, 492, 498, 520 | "demo", "Mark as demo data" | "sample", "Mark as sample data" | Public chip says sample |
| N36 | render/workspace2.ts:525; render/admin.ts:71 | "Send a note"; nav "Feedback" | "Send feedback"; "Seller feedback" | CU "Feedback · Inbox" |
| N37 | render/admin.ts:51, 65, 107, 154, 180, 184, 275, 348; render/layout.ts:79 | "Users", "Accounts", "Newest accounts", "Customer sign-in", "legacy seller · no login", "customer's workspace" | "Sellers", "Newest sellers", "Seller sign-in", "seller without a login", "seller's dashboard" | One word for the people |
| N38 | render/admin.ts:155, 156, 240, 253, 339 | "Pro (paid)", "Free tier", "plan tier", "tier" | "Pro", "Free", "plan" | Retire "tier" |
| N39 | render/layout.ts:100, 137–142 | Header "Seller tools"; footer "Seller tools: Dashboard / Scan & identify / Inventory & pricing / eBay listings / Pricing & plans" | Header "Dashboard"; footer "Dashboard: Ungraded cards / Inventory / Listings / Plans" | Match the sidebar and CU |

### Gaps
- eBay's current label for the seller's ship-from address ("Item location" is what our CSV section uses; I did not verify eBay's current listing-form wording in this session).
- TCGplayer's official condition-guide page returned HTTP 403, so the TCGplayer names ("Near Mint … Damaged") rest on our own code's TCGplayer URL mapping ([affiliate.ts:130](../../card-db-mvp/src/affiliate.ts)) and CU's link format (`Condition=Near+Mint`, [asks-and-plan §1c item C](../../client-video-2026-09-14-asks-and-plan.md)), not on a fetched TCGplayer page.
- The eBay "Allow offers" label and the $0.99 fixed-price minimum were taken from search-result summaries of eBay help pages, not full page fetches.
- Whether the client prefers CU's "Database" over plain "Game" is a decision only he can make.

## 2. Is the product name itself consistent?

### Takeaway
No. The site lives at tradingcardloader.com and its new privacy policy calls it "Trading Card Loader", but every other surface (logo text, all browser-tab titles, social-share name, search-engine structured data, sign-in pages, the owner console, the public share page, and the password-reset email subject, body and sender) says "CardIndex". A seller who connects eBay reaches a privacy page named differently from the site they came from, and a reset email from "CardIndex" can look like phishing to a user who signed up at tradingcardloader.com.

### Cited Findings
- The brand constant is `SITE = "CardIndex"`; it drives the header logo text, the footer brand and `og:site_name` — [render/layout.ts:15, 94, 124, 221](../../card-db-mvp/src/render/layout.ts); the logo's accessible name is `aria-label="CardIndex"` — [render/layout.ts:21](../../card-db-mvp/src/render/layout.ts).
- Sign-in, sign-up and reset pages show "CardIndex" beside the logo and in titles/descriptions ("Sign in — CardIndex", "Sign in to your CardIndex seller workspace.") — [render/auth.ts:53, 90–91, 123–124, 151–152, 178–179](../../card-db-mvp/src/render/auth.ts).
- Home page title "CardIndex — scan, price & list your trading cards" and structured data `"name": "CardIndex"` — [render/pages.ts:159, 170](../../card-db-mvp/src/render/pages.ts); set, card and search titles end "| CardIndex" or "— CardIndex" — [render/pages.ts:217–218, 265, 624, 742–743](../../card-db-mvp/src/render/pages.ts); sales titles — [render/sales.ts:161](../../card-db-mvp/src/render/sales.ts); pricing title — [render/pricing.ts:118](../../card-db-mvp/src/render/pricing.ts); 404 title — [server.ts:261](../../card-db-mvp/src/server.ts).
- Every workspace title ends "— Seller workspace | CardIndex" and every owner page "— Owner console | CardIndex" — e.g. [render/app.ts:297](../../card-db-mvp/src/render/app.ts); [render/workspace2.ts:44](../../card-db-mvp/src/render/workspace2.ts); [render/admin.ts:86, 110, 205](../../card-db-mvp/src/render/admin.ts). A case-insensitive grep of `card-db-mvp` (excluding node_modules) finds 99 matches for "cardindex" or "tradingcardloader" across 27 files (code, README, config); only 5 of them are the Trading Card Loader name or domain (3 in the privacy page, 2 in `.env.example`).
- The public share page says "TCGplayer-market prices from the CardIndex catalog" and "Priced with CardIndex — the card price database you can upload to." — [render/workspace2.ts:314, 316, 318](../../card-db-mvp/src/render/workspace2.ts).
- The only outbound email: subject "Reset your CardIndex password", body "…the password for this CardIndex account." — [server.ts:1640–1646](../../card-db-mvp/src/server.ts); the default sender is `CardIndex <no-reply@localhost>` unless `MAIL_FROM` is set — [app/mailer.ts:15](../../card-db-mvp/src/app/mailer.ts).
- "Trading Card Loader" appears only on the privacy page ("This page explains what information Trading Card Loader (the 'site') collects…", title "Privacy policy | Trading Card Loader") and the domain only there ("applies to tradingcardloader.com") — [render/privacy.ts:16, 18, 92](../../card-db-mvp/src/render/privacy.ts). No project document in the Card_reader root uses the spelled-out name "Trading Card Loader" (grep of `*.md`).
- The privacy page is the URL eBay shows on its "Grant application access" screen when a seller connects — [render/privacy.ts:1–5 (comment)](../../card-db-mvp/src/render/privacy.ts).
- Project documents name the product "CardIndex" (e.g. `cardindex-feature-inventory.md`), and the client's own browser tab on Sept 14 showed "CardIndex" — [asks-and-plan §1c](../../client-video-2026-09-14-asks-and-plan.md).

### Inferences
- Changing a string constant is cheap; changing a live domain is not. Aligning the brand to the domain ("Trading Card Loader") removes the privacy-page and email mismatch in one pass. If the client prefers "CardIndex", the domain, privacy page and eBay app listing would all have to follow instead. Either way, one name must win; the client should decide.
- The title suffix "— Seller workspace |" adds length without information (the sidebar already shows where you are); dropping it makes tabs readable.

#### Before → after fixes: product name (B-series)

| ID | Where | Before | After | Why |
|---|---|---|---|---|
| B1 | render/layout.ts:15 (feeds :94, :124, :221) | `SITE = "CardIndex"` | "Trading Card Loader" | One brand, matching the domain |
| B2 | render/layout.ts:21 | `aria-label="CardIndex"` | `aria-label="Trading Card Loader"` | Screen readers read the logo |
| B3 | render/auth.ts:53; render/admin.ts:86 | Logo text "CardIndex" | "Trading Card Loader" | Same |
| B4 | Page titles: render/auth.ts:90, 123, 151, 178; render/pricing.ts:118; render/pages.ts:170, 217, 265, 624, 742; render/sales.ts:161; server.ts:261; every workspace and owner title | "… — CardIndex", "… \| CardIndex", "— Seller workspace \| CardIndex" | "… \| Trading Card Loader" (drop "Seller workspace") | Shorter, consistent tabs |
| B5 | render/auth.ts:91, 124, 152, 179; render/pages.ts:218, 743 | Descriptions "Sign in to your CardIndex seller workspace.", "…card prices on CardIndex." etc. | "…your Trading Card Loader account.", "…on Trading Card Loader." | Search snippets |
| B6 | server.ts:1640, 1642, 1646 | Subject "Reset your CardIndex password"; "this CardIndex account" | "Reset your Trading Card Loader password"; "your Trading Card Loader account" | Email must match the site the user signed up on |
| B7 | app/mailer.ts:15 (and the `MAIL_FROM` setting) | `CardIndex <no-reply@localhost>` | `Trading Card Loader <no-reply@tradingcardloader.com>` | Recognisable sender |
| B8 | render/workspace2.ts:314, 316, 318 | "…from the CardIndex catalog…", "Priced with CardIndex — the card price database you can upload to." | "TCGplayer market prices as of {date}. Prices are a guide, not an offer."; "Priced with Trading Card Loader — scan, price and list your cards." | Brand + plainer tagline |
| B9 | render/pages.ts:159 | Structured data `"name": "CardIndex"` | `"name": "Trading Card Loader"` | Search engines |
| B10 | render/privacy.ts:16, 18, 92 | Already "Trading Card Loader" / tradingcardloader.com | Keep | The rest should follow it |

### Gaps
- What name the eBay developer application (RuName) displays on eBay's consent screen was not checkable without signing in.
- Whether the client has a stated preference between the two names is not recorded in any project document I found.
- Trademark availability of either name was not researched (out of scope; the legal researcher may cover it).

## 3. Which pages, sections, links, or buttons duplicate each other, and which should be merged or removed?

### Takeaway
The biggest duplications are functional, not cosmetic: two "Mark as listed" buttons that change different records plus a third button ("Mark live") for the same idea; an Inventory header that shows the same totals twice with conflicting counts; three separate controls on each review row for replacing a match; six export entry points with four different labels; Listings and Automatic inventory showing the same listings; and two owner uploaders into the same account. Several duplicates also contradict each other (help text that says binder pages aren't supported, sitting on a page that offers a "Several cards per photo" option).

### Cited Findings
- "Mark as listed" on Inventory changes the inventory row — [render/app.ts:460](../../card-db-mvp/src/render/app.ts); [server.ts:864–868](../../card-db-mvp/src/server.ts). "Mark as listed" on Listings changes the listing to `exported` — [render/app.ts:1192](../../card-db-mvp/src/render/app.ts); [server.ts:1011–1013](../../card-db-mvp/src/server.ts). "Mark live" on Automatic inventory changes `exported` to `published` — [render/workspace2.ts:491](../../card-db-mvp/src/render/workspace2.ts).
- Inventory shows a summary line ("N products · N cards · Price · Market") and then four tiles, two of which restate Price and Market and one of which ("Cards in stock") shows a different count — [render/app.ts:387–392, 494](../../card-db-mvp/src/render/app.ts).
- Inventory also carries its own "Recent batches" panel (with the generic name "Scan batch" and raw status) — [render/app.ts:476–489](../../card-db-mvp/src/render/app.ts) — duplicating the Dashboard panel ([render/app.ts:271–274](../../card-db-mvp/src/render/app.ts)) and the Previous batches page.
- Each review row offers "Compare" (a modal with search, alternatives and "Replace card") — [render/app.ts:899, 2059–2126](../../card-db-mvp/src/render/app.ts); "Alternatives:" chips — [render/app.ts:862–871](../../card-db-mvp/src/render/app.ts); and an inline "Search manually" box — [render/app.ts:873–877](../../card-db-mvp/src/render/app.ts). All three do the same "replace" action.
- Export entry points: Inventory bulk "Export eBay / TCGplayer / Whatnot / Shopify" ([render/app.ts:458](../../card-db-mvp/src/render/app.ts)), Listings "Export all" (:1174), review "Export batch → eBay CSV" (:1027), Previous batches row "CSV" (:333), blank-listing row "CSV" ([render/workspace2.ts:204](../../card-db-mvp/src/render/workspace2.ts)), builder "Download eBay CSV" ([render/app.ts:1120](../../card-db-mvp/src/render/app.ts)).
- Listings shows a "Connect eBay" button in every row plus a separate Connect note — [render/app.ts:1166, 1206](../../card-db-mvp/src/render/app.ts). Orders shows "Fetch eBay orders" that, when not connected, is really a link to Configuration — [render/workspace2.ts:430](../../card-db-mvp/src/render/workspace2.ts).
- The eBay CSV hand-off box is always shown on Inventory ([render/app.ts:473](../../card-db-mvp/src/render/app.ts)) but hidden on Listings once eBay is connected (:1197) and compact on the builder (:1125).
- When eBay is connected, Configuration → eBay shows the synced policy dropdowns ([render/app.ts:1431–1432](../../card-db-mvp/src/render/app.ts)) and also the free-text "Policy names for the CSV" fields (:1449–1453); it also has two location blocks, "Ship-from location" (postal code, country, city, state; :1433–1440) and "Item location" ("City, ST, United States"; :1446).
- Listings ([render/app.ts:1147–1214](../../card-db-mvp/src/render/app.ts)) and Automatic inventory ([render/workspace2.ts:480–503](../../card-db-mvp/src/render/workspace2.ts)) list the same scheduled/exported/published listings with the same "End" action; Automatic inventory's own note says the sync it is named for does not exist yet — [render/workspace2.ts:499](../../card-db-mvp/src/render/workspace2.ts). In CU, Automatic Inventory is an engine-owned view that pushes quantities to eBay/Mana Pool/Shopify — [teardown §3–4](../../carduploader-logged-in-teardown.md).
- The owner has "My uploader" (/admin/upload) — [render/admin.ts:66, 453](../../card-db-mvp/src/render/admin.ts); [render/layout.ts:71](../../card-db-mvp/src/render/layout.ts) — and their own workspace's Ungraded cards page, both writing into the owner's own account; "My uploader" lacks the Game field, the Setup block and the layout choice the workspace page has ([render/admin.ts:390–429](../../card-db-mvp/src/render/admin.ts) vs [render/app.ts:614–669, 1636–1640](../../card-db-mvp/src/render/app.ts)).
- The Dashboard "Orders" quick tile is always shown ([render/app.ts:251](../../card-db-mvp/src/render/app.ts)) although the Orders sidebar item is hidden unless `ORDERS_ENABLED=1` ([render/app.ts:161–174](../../card-db-mvp/src/render/app.ts)); `ordersEnabled()` is used only by the sidebar (grep). The client explicitly asked not to show orders yet ("I don't want that yet because I think it's very confusing for us") — [client transcript 00:57–00:59](../../client-walkthrough-2026-09-14-transcript.txt).
- Help is repeated between the Dashboard "How it works" ([render/app.ts:276–283](../../card-db-mvp/src/render/app.ts)) and the add-cards aside (:715–747); the aside's note "Binder-page detection … plugs into the same upload — today each photo is treated as one card." (:729) contradicts the "Several cards per photo — binder pages or loose cards…" option on the same page (:1639).
- On public card pages "Sold prices" (our Sales lookup) sits next to "eBay sold ↗" (eBay's own search) with no explanation of the difference — [render/pages.ts:483, 485](../../card-db-mvp/src/render/pages.ts).
- "Account" names two different groups: the sidebar group "Account" (Inbox, Configuration) — [render/app.ts:195](../../card-db-mvp/src/render/app.ts) — and the Configuration hub group "Account" (Privacy, Your plan) — [render/app.ts:1236, 1287–1293](../../card-db-mvp/src/render/app.ts).
- The header "Pro" pill links to the Configuration hub ([render/layout.ts:41](../../card-db-mvp/src/render/layout.ts)), where the plan is one tile among eleven.
- Mana Pool appears as a Configuration page ([render/app.ts:1235, 1477–1480](../../card-db-mvp/src/render/app.ts)), an Orders tab ([app/orders.ts:47](../../card-db-mvp/src/app/orders.ts)) and a disabled button ([render/workspace2.ts:432](../../card-db-mvp/src/render/workspace2.ts)); the page itself says "Mana Pool sells Magic singles" (:1478) and CU notes "only Magic cards can be listed there" — [teardown §1](../../carduploader-logged-in-teardown.md). The client's focus games are Pokémon and One Piece — [asks-and-plan §1 item 9](../../client-video-2026-09-14-asks-and-plan.md). A "Storefront (soon)" Orders tab also exists — [app/orders.ts:48](../../card-db-mvp/src/app/orders.ts).

### Inferences
- The "Mark as listed" family should collapse to one control on one page (Listings), with inventory status following the listing automatically; otherwise sellers will mark the same card twice and still see "exported".
- Keeping the CU summary line and dropping the restating tiles fixes both the redundancy and the conflicting count.
- "Compare" already contains search, alternatives and Replace; the inline "Search manually" box is the one to remove.
- Automatic inventory is a CU label for a feature we don't have (quantity sync). Until sync exists, it duplicates a "Live on eBay" filter of Listings; hiding it (or renaming its description honestly) avoids promising sync.
- Removing Mana Pool and Storefront from a Pokémon/One Piece seller's UI removes four dead ends at once.

#### Before → after fixes: redundancy (R-series)

| ID | Where | Before | After | Why |
|---|---|---|---|---|
| R1 | render/app.ts:460–461, 1192; render/workspace2.ts:491 | Inventory "Mark as listed" / "Mark in stock"; Listings "Mark as listed" (sets `exported`); Automatic inventory "Mark live" | One "Mark as listed" on Listings that sets the listing "Live on eBay" and the inventory row "Listed"; remove the Inventory pair and "Mark live" | One action, one meaning |
| R2 | render/app.ts:387–392 vs :494 | Summary line + tiles "Inventory value", "Market value", "Cards in stock", "Default pricing" | Keep the summary line; keep only a "Default pricing rule: {rule} · Change" link | Same numbers twice, one conflicting |
| R3 | render/app.ts:476–489 | Inventory "Recent batches" panel | Remove (Dashboard and Previous batches cover it) | Duplicate list |
| R4 | render/app.ts:873–877 (and :899) | "Search manually" box; button "Compare" | Remove the inline box; rename the button "Compare / replace" | The modal already searches |
| R5 | render/app.ts:333, 458, 1027, 1120, 1174; render/workspace2.ts:204 | "CSV", "Export eBay", "Export batch → eBay CSV", "Download eBay CSV", "Export all eBay" | Keep the entry points, one label pattern: "Export eBay CSV" (and "Export TCGplayer CSV", etc.) | Same action, same words |
| R6 | render/app.ts:1166, 1206 | "Connect eBay" in every row + separate note | One banner above the table: "Connect eBay to list, revise and end listings from here. Configuration → eBay" | Repetition |
| R7 | render/workspace2.ts:430 | "Fetch eBay orders" (links to Configuration when not connected) | "Connect eBay to fetch orders" | Button says what it does |
| R8 | render/app.ts:473 | eBay CSV hand-off box always on Inventory | Show only after an eBay export and only when eBay isn't connected (as on Listings, :1197) | Consistency |
| R9 | render/app.ts:1449–1453 | Policy-name text fields shown next to synced dropdowns | Hide when connected (or show read-only "Filled from your selections above") | Two inputs for one value |
| R10 | render/app.ts:1433–1440, 1446 | "Ship-from location" block + "Item location" field | One "Item location (ships from)" block | Two locations confuse |
| R11 | render/workspace2.ts:480–503; render/app.ts:171 | Sidebar "Automatic inventory" page (BETA) | Until quantity sync exists: a "Live on eBay" filter on Listings, or keep the CU label with the honest description in O24 | Duplicate list, name promises sync |
| R12 | render/admin.ts:66, 453; render/layout.ts:71 | "My uploader" (owner) | Owner nav "My dashboard →" (opens their own Ungraded cards page); retire /admin/upload | Two uploaders, the weaker one in the owner nav |
| R13 | render/app.ts:251 | Dashboard "Orders" tile always shown | Hide with the same `ORDERS_ENABLED` flag as the sidebar | Client asked to hide orders |
| R14 | render/app.ts:276–283, 715–747 | Two help blocks, one stale | Keep one "How it works" (Dashboard); trim the aside to two lines | Duplicate, contradicting help |
| R15 | render/pages.ts:483, 485 | "Sold prices" next to "eBay sold ↗" | "Sales lookup" and "eBay sold ↗" (distinct names), or one "Sold prices" menu with both | Unclear difference |
| R16 | render/app.ts:195, 1236 | Sidebar group "Account" and hub group "Account" | Sidebar group "Help & settings"; hub group "Your account" | Same word, two groupings |
| R17 | render/layout.ts:41 | "Pro" pill → Configuration hub | Link to the plan tile/page directly | Indirect |
| R18 | render/app.ts:1235, 1477–1480; app/orders.ts:47–48; render/workspace2.ts:432 | Mana Pool page, "Mana Pool (soon)" and "Storefront (soon)" tabs, disabled "Fetch Mana Pool" | Remove | Magic-only / non-existent features for a Pokémon/One Piece seller |

### Gaps
- No usage data was consulted (the owner console's activity log exists, but the constraints ruled out database queries), so which duplicate entry points sellers actually use is unknown.
- Whether the client wants the "Automatic inventory" sidebar item kept for CU parity even without sync is a product decision.

## 4. Which labels are vague, overlong, inconsistent in capitalization or tone, or would confuse a first-time seller?

### Takeaway
The single largest problem is developer language shown to sellers: environment-variable names (MAIL_PROVIDER, EBAY_CLIENT_ID, CERT_PROVIDER), command lines (`npm run import:sold`, `sync:tcgcsv`), API names (Sell API, Inventory API, Browse API, Fulfillment API), internal words ("seam", "pre-flight", "runner", "commit", "recognizer", "keyed by", "canonicalized"), raw status codes ("HTTP 500") and raw database values ("exported", "done", "ebay", "fixed"). Some of these appear on public card pages and on production screens that sellers hit today (for example, the reset-password page while email is unconfigured). Secondary issues: a save button that lower-cases brand names ("Save ebay"), Title Case on the landing page vs sentence case elsewhere, competitor names in tooltips, a sarcastic aside, abbreviations ("mkt", "BIN", "Cond"), and several multi-sentence page subtitles.

### Cited Findings

**Environment variables and server state shown to sellers**
- After requesting a reset link: "Email isn't configured on this server yet (MAIL_PROVIDER), so the link was printed to the server log instead." — [render/auth.ts:138](../../card-db-mvp/src/render/auth.ts). As of Sept 13, production had no `MAIL_PROVIDER`/`RESEND_API_KEY`, so this shows to real users — [feature inventory lines 44, 195](../../cardindex-feature-inventory.md).
- Configuration → eBay when keys are missing: "eBay isn't configured on this server. Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME to .env (see .env.example), or EBAY_MOCK=1 to try the flow…" — [render/app.ts:1423](../../card-db-mvp/src/render/app.ts); flash "eBay isn't configured on this server yet (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_RU_NAME)." — [server.ts:2264](../../card-db-mvp/src/server.ts); hub meta "Not configured on this server" — [render/app.ts:1262](../../card-db-mvp/src/render/app.ts). Production had no eBay keys on Sept 13 — [feature inventory line 114](../../cardindex-feature-inventory.md).
- Connected card: "· {EBAY_US} · mock mode · since …" and "Location {location_key} is on file." — [render/app.ts:1426, 1440](../../card-db-mvp/src/render/app.ts).
- Graded cards: "Cert lookup isn't connected yet (set CERT_PROVIDER)…" — [render/workspace2.ts:86](../../card-db-mvp/src/render/workspace2.ts).

**Internal and API words**
- Add-cards aside: "Reading the card from the pixels is the remaining seam. A vision model (photo → identity, front/back, auto-crop) and graded-slab OCR/QR + cert lookup drop in behind the same review queue and identify contract…" — [render/app.ts:737](../../card-db-mvp/src/render/app.ts); "Binder-page detection … plugs into the same upload…" (:729).
- Build listing subtitle: "…live publish uses the eBay Sell API (seam)." — [render/app.ts:1084](../../card-db-mvp/src/render/app.ts).
- "Publishing runs a pre-flight (policies by ID, …)" (:1124); button title "Run pre-flight and create the eBay listing" (:1165); "Publish creates the live eBay listing through the Inventory API (pre-flight first)…" (:1205); "chosen by ID — the pre-flight rejects a listing whose policy no longer exists, before eBay does" (:1431) — [render/app.ts](../../card-db-mvp/src/render/app.ts).
- "…the runner checks every minute" — [render/app.ts:1200](../../card-db-mvp/src/render/app.ts); flash "Ran the scheduler: N published, N failed, N parked as drafts." — [server.ts:985](../../card-db-mvp/src/server.ts).
- "Photos go through the configured recognizer" / "read by the recognizer" — [render/app.ts:278, 728, 733](../../card-db-mvp/src/render/app.ts); owner uploader "Same pipeline as the customer scan page… configured recognizer" — [render/admin.ts:434](../../card-db-mvp/src/render/admin.ts).
- "on commit" — [render/app.ts:819, 1018](../../card-db-mvp/src/render/app.ts); "the matcher" — :1341; "the CSV's StoreCategory column" — :1445; "Rows are keyed by TCGplayer product id" — :1471; "eBay inventory items are keyed by SKU" — [app/ebay-sell.ts:433](../../card-db-mvp/src/app/ebay-sell.ts).
- Orders: title "Pull open orders from eBay (Fulfillment API)" and note "…for Fulfillment-API orders; Mana Pool and Shopify plug into this same table next" — [render/workspace2.ts:429, 458](../../card-db-mvp/src/render/workspace2.ts); Automatic inventory "Engine sync (eBay Feed/Inventory API, Mana Pool, Shopify)…" — :499; blank listings "they never train the identifier" — :247; "no credits · no lookup" (credits are a CU concept; we have none) — :212.
- Public card page (no login needed): "Market prices are synced daily from TCGplayer (via the TCGCSV mirror). Sold comps below come from the sold-sales archive (sample feed import — plug a licensed feed into `npm run import:sold` to go live), canonicalized to this exact card…" and "…real sold-comp data is a licensed-feed line item (see the data-sourcing research report §8.1), and the archive schema + importer are ready for it." — [render/pages.ts:492, 495](../../card-db-mvp/src/render/pages.ts); "from eBay's Browse API. Loaded on demand." — :510; "SKU-level NM/LP/MP/HP market prices, per printing. Loaded on demand." — :551.
- Public Sales lookup: "…plug a licensed sold-data feed into `npm run import:sold` and this page goes live with real depth." — [render/sales.ts:127](../../card-db-mvp/src/render/sales.ts); meta description "…canonicalized to exact cards." — :163.
- Public card-page condition panel error: "No TCGplayer product linked for this card yet (run sync:tcgcsv)." — [server.ts:1409](../../card-db-mvp/src/server.ts).
- Footer on every page: "Phase 1 MVP — not affiliated with any marketplace." — [render/layout.ts:147](../../card-db-mvp/src/render/layout.ts).

**Raw codes and database values**
- Upload error "Upload failed (HTTP {status})" — [render/app.ts:1879](../../card-db-mvp/src/render/app.ts); eBay errors "eBay token request failed (HTTP N): …" and "HTTP N: {raw text}" flow into flashes — [app/ebay-sell.ts:239, 300](../../card-db-mvp/src/app/ebay-sell.ts); [server.ts:971, 1065, 2294](../../card-db-mvp/src/server.ts).
- Raw batch status ("done"/"processing") — [render/app.ts:301, 322, 484, 742](../../card-db-mvp/src/render/app.ts); [render/admin.ts:321, 442](../../card-db-mvp/src/render/admin.ts) (values from [app/store.ts:332, 533](../../card-db-mvp/src/app/store.ts)). Raw listing status — see question 1. Raw order status ("pending") — [render/workspace2.ts:401](../../card-db-mvp/src/render/workspace2.ts). Raw feedback status ("open", "answered") — [render/workspace2.ts:512](../../card-db-mvp/src/render/workspace2.ts); [render/admin.ts:750](../../card-db-mvp/src/render/admin.ts). Raw marketplace "ebay" (lower case) in Listings, Automatic inventory, the sales tooltip "Original listing on ebay" and the owner stats — [render/app.ts:1134, 1158](../../card-db-mvp/src/render/app.ts); [render/workspace2.ts:487](../../card-db-mvp/src/render/workspace2.ts); [render/sales.ts:106](../../card-db-mvp/src/render/sales.ts); [render/admin.ts:483](../../card-db-mvp/src/render/admin.ts). Raw format "fixed"/"auction" — [render/app.ts:1134, 1159](../../card-db-mvp/src/render/app.ts); raw batch source ("upload") — [render/app.ts:325](../../card-db-mvp/src/render/app.ts).

**Broken or vague labels**
- Configuration save button is `Save ${sec.title.toLowerCase()}`, which renders "Save ebay", "Save shop & skus", "Save tcgplayer", "Save mana pool" — [render/app.ts:1491](../../card-db-mvp/src/render/app.ts); the flash is "{title} saved." ("eBay saved.") — [server.ts:2196](../../card-db-mvp/src/server.ts).
- Configuration hub: "Each card below opens one short page." ("card" = settings tile, in a trading-card app) — [render/app.ts:1301](../../card-db-mvp/src/render/app.ts).
- Sidebar tooltip suffix "— takes cards in" — [render/app.ts:198](../../card-db-mvp/src/render/app.ts).
- "Go" buttons — [render/app.ts:448](../../card-db-mvp/src/render/app.ts); [render/pages.ts:695](../../card-db-mvp/src/render/pages.ts).
- Dropzone hint "JPG / PNG / WebP / HEIC · front side · up to N cards per batch … · resized to 1600 px on your device and sent in groups of 20" — [render/app.ts:1631](../../card-db-mvp/src/render/app.ts) — says "front side" although the next control offers "2 images — front and back pairs" (:1638); the over-limit message says "max N per upload" (:1698); the server says "max N photos per batch" — [server.ts:733](../../card-db-mvp/src/server.ts).
- "Upload too large — max 60 MB per batch…" — [upload.ts:68](../../card-db-mvp/src/upload.ts), although the 60 MB limit applies per request (one group of 20 photos), not per batch — [upload.ts:31–32](../../card-db-mvp/src/upload.ts).
- "(s)" plurals: "Created N listing draft(s).", "Updated N card(s).", "Added N card(s) to inventory", confirm "Add N matched card(s) to inventory?" — [server.ts:861, 886, 2209](../../card-db-mvp/src/server.ts); [render/app.ts:1048](../../card-db-mvp/src/render/app.ts) (elsewhere the code pluralises properly).
- The help answer "What if a card isn't in the catalog?" ends "The public catalog grows by set sync; tell us which set is missing." with no link to the Inbox — [render/app.ts:280](../../card-db-mvp/src/render/app.ts).

**Capitalization**
- Landing page uses Title Case: "Market Price", "Your Price", "Add to Inventory", "Start Scanning →", "Scan Any Card", "AI Identification", "Get Market Prices", "Manage Inventory", "List & Sell" — [render/pages.ts:85–89, 103, 117–121](../../card-db-mvp/src/render/pages.ts) — while the rest of the site uses sentence case ("Start free", "See how it works", "Trending by value").
- Header "Sales Lookup" vs sidebar "Sales lookup" — [render/layout.ts:98](../../card-db-mvp/src/render/layout.ts); [render/app.ts:192](../../card-db-mvp/src/render/app.ts). Help "Advanced Matching Options" vs panel "Advanced matching options" — [render/app.ts:278, 526](../../card-db-mvp/src/render/app.ts). "BETA" in capitals — [render/workspace2.ts:496](../../card-db-mvp/src/render/workspace2.ts). Owner console "eBay Listed" vs seller UI "eBay listed" — [render/admin.ts:672, 683](../../card-db-mvp/src/render/admin.ts).
- CSS injects the text "✓ Selected" (upper-cased) on the chosen mode card — [public/styles.css:1291](../../card-db-mvp/public/styles.css).
- Microsoft style: "Use sentence-style capitalization… Capitalize the first word of a sentence, heading, title, UI label (such as the name of a button or checkbox)…" and "Don't use all uppercase for emphasis." — [Microsoft Writing Style Guide: Capitalization](https://learn.microsoft.com/en-us/style-guide/capitalization).

**Tone and voice**
- Privacy checkbox: "(off by default — the opposite of a perpetual training licence)" (a dig at a competitor's terms, and British spelling where the rest of the site is US English) — [render/app.ts:1482](../../card-db-mvp/src/render/app.ts).
- Competitor named in seller tooltips: "(CardUploader's Space Out)" — [render/app.ts:1188](../../card-db-mvp/src/render/app.ts); "(CardUploader's 'apply to all items')" — [render/workspace2.ts:248](../../card-db-mvp/src/render/workspace2.ts).
- Owner console talks about its own reader in the third person: "paste the client's campaign id below", "The client's Ambassador account is an eBay Partner Network membership. Paste the 10-digit campaign id from their EPN dashboard…" — [render/admin.ts:616, 634](../../card-db-mvp/src/render/admin.ts) (the owner reading this is the client). "Stripe will flip this automatically once checkout is wired up." — [render/admin.ts:293](../../card-db-mvp/src/render/admin.ts).
- Owner console also shows setup names: `ADMIN_EMAIL`/`ADMIN_PASSWORD` ([render/admin.ts:92](../../card-db-mvp/src/render/admin.ts)), `SOLD_SAMPLE_ON_BOOT=1` (:500), `npm run import:sold` (:534), `EBAY_EPN_CAMPID` (:637), `APP_BASE_URL` (:710), "check ADMIN_EMAIL and restart" ([server.ts:1809, 1973](../../card-db-mvp/src/server.ts)), "watch the server log" (:1842).
- Emoji status marks are mixed with line icons: review progress uses check/warning/cross emoji ([render/app.ts:1035–1038](../../card-db-mvp/src/render/app.ts)), Dashboard tiles use emoji (:247–252), owner banners use emoji ([render/layout.ts:69, 78](../../card-db-mvp/src/render/layout.ts)), while the sidebar uses SVG line icons ([render/app.ts:108–128](../../card-db-mvp/src/render/app.ts)).

**Abbreviations**
- "mkt" ([render/app.ts:430, 879, 1093](../../card-db-mvp/src/render/app.ts)), "Cond"/"Lang" (:467, :925), "Cond." ([render/workspace2.ts:309](../../card-db-mvp/src/render/workspace2.ts)), "BIN" ([render/sales.ts:59](../../card-db-mvp/src/render/sales.ts)), "ship"/"free ship" ([render/app.ts:2046](../../card-db-mvp/src/render/app.ts); [render/admin.ts:659](../../card-db-mvp/src/render/admin.ts)).
- Mailchimp: "If there's a chance your reader won't recognize an abbreviation or acronym, spell it out the first time you mention it." and "Write in plain English. If you need to use a technical term, briefly define it…" — [Mailchimp Content Style Guide: Grammar and mechanics](https://styleguide.mailchimp.com/grammar-and-mechanics/).

**Overlong subtitles (examples)**
- Listings: "Draft, scheduled and exported listings across channels — catalog cards and blank items alike. Export to eBay, TCGplayer, Whatnot or Shopify files with your channel preferences applied." (two sentences, 26 words) — [render/app.ts:1177](../../card-db-mvp/src/render/app.ts). Similar length on Graded cards, Listing creator, Card search and Automatic inventory — [render/workspace2.ts:56, 138, 353, 496](../../card-db-mvp/src/render/workspace2.ts).

**Guidance basis**
- NN/g: "Avoid technical jargon and use language familiar to your users instead." and "Hide or minimize the use of obscure error codes or abbreviations; show them for technical diagnostic purposes only." — [NN/g, Error-Message Guidelines, Neusesser & Sunwall, May 14 2023](https://www.nngroup.com/articles/error-message-guidelines/).
- NN/g: "Users should always be able to understand meaning without having to go look up a word's definition in a search engine." — [NN/g heuristic #2](https://www.nngroup.com/articles/match-system-real-world/).

### Inferences
- The environment-variable messages were written for the developer running a local server; on production they tell a seller or a card-page visitor to edit a `.env` file they cannot see. They should say what the seller can do now (export a CSV, check spam), and the setup detail belongs only in the owner console.
- Developer-facing "seam notes" (the diamond-bullet boxes) are useful in a demo to the client but read as unfinished to a seller; they should be removed from seller and public screens, not reworded.
- Raw database values should be mapped through one label helper so the same status reads the same everywhere.
- The Title Case landing page reads as a different product from the sentence-case app; Microsoft's sentence-case rule is a simple house style to adopt site-wide.
- Owner-console copy should address the owner as "you"; it was clearly written from the developer's point of view.

#### Before → after fixes: jargon, vague labels, tone (J-series)

| ID | Where | Before | After | Why |
|---|---|---|---|---|
| J1 | render/auth.ts:138 | "Email isn't configured on this server yet (MAIL_PROVIDER), so the link was printed to the server log instead." | Never shown to customers. Show "Didn't get it? Check your spam folder, or email {support address}." (and configure mail) | Env var on a customer screen |
| J2 | render/app.ts:1423 | "eBay isn't configured on this server. Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RU_NAME to .env (see .env.example), or EBAY_MOCK=1 to try the flow…" | "Connecting eBay isn't available yet. You can still export an eBay CSV and upload it in eBay Seller Hub → Reports → Upload." | Seller can't act on env vars |
| J3 | server.ts:2264 | Flash "eBay isn't configured on this server yet (EBAY_CLIENT_ID / …)." | Same plain message as J2 | Same |
| J4 | render/app.ts:1262 | "Not configured on this server · policy names set" | "eBay connection not available yet · policy names set" | Server-speak |
| J5 | render/app.ts:1426 | "Connected {user} · EBAY_US · mock mode · since …" | "Connected as {user} · eBay US · since …" (test mode shown only in the owner console) | Raw id, dev mode |
| J6 | render/app.ts:1440 | "Location {location_key} is on file." | "Ship-from location saved ({postal code})." | Raw key |
| J7 | render/app.ts:1431 | "chosen by ID — the pre-flight rejects a listing whose policy no longer exists, before eBay does" | "We check these before each listing goes to eBay." | Jargon |
| J8 | render/app.ts:1124 | "Publishing runs a pre-flight (policies by ID, ship-from location, image, title length) and then creates the eBay listing directly — no CSV to upload." | "Before listing, we check your policies, ship-from location, photo and title length. Then the listing goes live on eBay — no CSV needed." | Jargon |
| J9 | render/app.ts:1165 | Titles "Run pre-flight and create the eBay listing" / "Push current title, price and quantity to the live listing" | "Check and list on eBay" / "Update the live eBay listing's title, price and quantity" | Jargon |
| J10 | render/app.ts:1205 | "Publish creates the live eBay listing through the Inventory API (pre-flight first); Revise pushes…; End withdraws it…" | "List on eBay makes the listing live. Revise updates its title, price and quantity. End listing takes it down. Select several rows to list or schedule them together." | Jargon, eBay verbs |
| J11 | render/app.ts:1200; server.ts:985 | "…the runner checks every minute"; "Ran the scheduler: N published, N failed, N parked as drafts." | "Scheduled listings go live within a minute of their start time."; "Listed N on eBay; N failed; N moved back to drafts." | Jargon |
| J12 | render/app.ts:729, 737 | Seam notes about binder detection ("today each photo is treated as one card") and "the remaining seam… identify contract…" | Delete both (729 is also false: see :1639) | Developer notes; one is stale |
| J13 | render/app.ts:1084 | "Generate an eBay listing for this card. Saved drafts export to a File Exchange CSV; live publish uses the eBay Sell API (seam)." | "Edit the listing, then save it as a draft, list it on eBay (when connected) or export an eBay CSV." | Jargon, old eBay name |
| J14 | render/app.ts:278, 728, 733; render/admin.ts:434 | "configured recognizer", "read by the recognizer", "Same pipeline as the customer scan page" | "Each photo is matched to catalog card images", "Same steps as the Ungraded cards page" | Plain English |
| J15 | render/app.ts:1018 | Title "Back to automatic SKUs on commit" | "Use automatic SKUs when the batch is added to inventory" | "commit" |
| J16 | render/app.ts:1341 | "the matcher considers every set equally" | "every set is treated equally" | Jargon |
| J17 | render/app.ts:640, 1445 | "your eBay Store category id — the CSV's StoreCategory column" | "eBay Store category number (from your eBay Store's category list)" | CSV internals |
| J18 | render/app.ts:1471; app/ebay-sell.ts:433 | "Rows are keyed by TCGplayer product id when the catalog has one."; "SKU is empty — eBay inventory items are keyed by SKU." | "Cards are matched to TCGplayer products automatically."; "This card needs a SKU before it can be listed on eBay." | "keyed by" |
| J19 | render/app.ts:1482 | "(off by default — the opposite of a perpetual training licence)" | "(off by default)" | Sarcasm, spelling |
| J20 | render/app.ts:1879 | "Upload failed (HTTP {status})" | "Upload interrupted — nothing is lost; press Retry." (status code logged, not shown) | Raw code |
| J21 | app/ebay-sell.ts:239, 300 → server.ts:971, 1065, 2294 | "eBay rejected '…': HTTP 400: {raw}"; "eBay token request failed (HTTP N)…" | "eBay didn't accept this: {eBay's own message}. Try again, or reconnect eBay in Configuration → eBay." | Raw codes |
| J22 | render/workspace2.ts:429, 458 | "(Fulfillment API)"; "…for Fulfillment-API orders; Mana Pool and Shopify plug into this same table next…" | Drop the API name; "Connect eBay (Configuration → eBay) to bring your eBay orders in here." | Jargon + promise |
| J23 | render/workspace2.ts:499 | "Engine sync (eBay Feed/Inventory API, Mana Pool, Shopify) is the integration this page is built for…" | Remove | Developer note |
| J24 | render/workspace2.ts:86 | "Cert lookup isn't connected yet (set CERT_PROVIDER), so items land in review…" | "Automatic cert lookup isn't available yet, so each slab waits in review with its cert number attached: pick the card and grade and you're done." | Env var |
| J25 | render/workspace2.ts:212 | "no credits · no lookup" | "no catalog lookup" | We have no credits |
| J26 | render/workspace2.ts:247 | "…and they never train the identifier." | "…and they're never used to improve matching." | Jargon |
| J27 | render/pages.ts:492, 495 (public) | "…(via the TCGCSV mirror)… plug a licensed feed into npm run import:sold… canonicalized… (see the data-sourcing research report §8.1)…" | "Market prices come from TCGplayer and update daily. Sold prices are sales recorded on this site; rows marked 'sample' are examples. Grade values and the price chart are estimates for now." | Internal notes on a public page |
| J28 | render/sales.ts:127 (public) | "The archive currently holds a sample feed import — plug a licensed sold-data feed into npm run import:sold…" | "Only sample sales so far. Real sales appear as sellers connect their eBay accounts." | Same |
| J29 | render/sales.ts:163, 78 | "…canonicalized to exact cards."; "every archived sale" | "…matched to the exact card."; "every recorded sale" | Jargon |
| J30 | server.ts:1409 (public card page) | "No TCGplayer product linked for this card yet (run sync:tcgcsv)." | "TCGplayer condition prices aren't available for this card yet." | CLI command on a public page |
| J31 | render/pages.ts:510, 551 | "…from eBay's Browse API. Loaded on demand."; "SKU-level NM/LP/MP/HP market prices, per printing. Loaded on demand." | "Current eBay listings for this card."; "TCGplayer market prices by condition (NM, LP, MP, HP) for each variant." | API names; "SKU" collides with the seller's SKU |
| J32 | render/layout.ts:147 | "Phase 1 MVP — not affiliated with any marketplace." | "Not affiliated with eBay, TCGplayer or any card publisher." | Internal phase name |
| J33 | render/app.ts:301, 322, 325, 484, 742, 1134, 1158, 1159, 1162; render/workspace2.ts:204, 401, 487, 490, 512; render/admin.ts:321, 442, 483, 750; render/sales.ts:106 | Raw values: done, processing, upload, draft, exported, published, ended, pending, open, answered, ebay, fixed, auction | One label map: "Ready / Processing…", "Photos / Pasted list", "Draft / Scheduled / CSV exported / Live on eBay / Ended", "Pending / Picked / Shipped", "Open / Answered / Closed", "eBay", "Fixed price / Auction" | Raw database words |
| J34 | render/app.ts:1491; server.ts:2196 | "Save ebay", "Save shop & skus", "Save tcgplayer"; flash "eBay saved." | Button "Save changes"; flash "Changes saved." | Lower-casing breaks brand names |
| J35 | render/app.ts:1301 | "Each card below opens one short page." | "Each tile opens one short page." | "card" is ambiguous here |
| J36 | render/app.ts:198 | Tooltip "— takes cards in" | "— add cards here" | Awkward |
| J37 | render/app.ts:1188; render/workspace2.ts:248 | "(CardUploader's Space Out)"; "(CardUploader's 'apply to all items')" | "Space the selected listings N minutes apart"; remove the second note (see O21) | Competitor name in our UI |
| J38 | render/pages.ts:85–89, 103, 117–121; render/layout.ts:98; render/app.ts:278; render/workspace2.ts:496; render/admin.ts:672, 683 | "Market Price", "Your Price", "Add to Inventory", "Start Scanning →", "Scan Any Card", "AI Identification"…; "Sales Lookup"; "Advanced Matching Options"; "BETA"; "eBay Listed" | Sentence case: "Market price", "Your price", "Add to inventory", "Start scanning →", "Scan any card"…; "Sales lookup"; "Advanced matching options"; "Beta"; "eBay listed" | Microsoft sentence case |
| J39 | render/app.ts:430, 467, 925, 2046; render/workspace2.ts:309; render/admin.ts:659 | "mkt", "Cond", "Lang", "Cond.", "ship", "free ship" | "Market", "Condition", "Language", "shipping", "free shipping" (keep "SKU", "Qty") | Mailchimp: spell out |
| J40 | server.ts:861, 886, 2209; render/app.ts:1048 | "Created 3 listing draft(s).", "Updated 2 card(s).", "Add 5 matched card(s) to inventory?" | Real plurals ("Created 3 listing drafts.") | Polish |
| J41 | render/app.ts:448; render/pages.ts:695 | "Go" | "Search" (inventory), "Apply" (price filter) | Say what happens |
| J42 | render/app.ts:1631, 1698 | "…· front side · up to N cards per batch … · resized to 1600 px on your device and sent in groups of 20"; "max N per upload" | "JPG, PNG, WebP or HEIC · up to N cards per batch (500 on Pro) · photos are shrunk on your device before upload"; "max N per batch" | Contradicts the 2-images option; implementation detail |
| J43 | upload.ts:68 | "Upload too large — max 60 MB per batch (this batch was about N MB)…" | "One group of photos was over 60 MB. Try smaller photos." | Limit is per request, not per batch |
| J44 | render/app.ts:280 | "The public catalog grows by set sync; tell us which set is missing." | "Tell us which set is missing in your Inbox and we'll add it." (with link) | Jargon, missing link |
| J45 | render/app.ts:1177; render/workspace2.ts:56, 138, 353, 496 | Two-sentence subtitles | One sentence each, e.g. Listings: "Your listing drafts, scheduled listings and live eBay listings." | Scannability |
| J46 | render/admin.ts:616, 634 | "paste the client's campaign id below"; "The client's Ambassador account… from their EPN dashboard…" | "paste your campaign id below"; "Your eBay Ambassador account is an eBay Partner Network (EPN) membership. Paste the 10-digit campaign id from your EPN dashboard…" | The owner is the client |
| J47 | render/admin.ts:293 | "Stripe will flip this automatically once checkout is wired up." | "Once online payments are switched on, plans will update automatically." | Developer voice |
| J48 | render/admin.ts:92, 500, 534, 637, 710; server.ts:1809, 1842, 1973 | Env/CLI names as the main message | Plain sentence first; the variable name in a small "for your developer" hint | Owner isn't a developer |
| J49 | render/app.ts:1035–1038, 247–252; render/layout.ts:69, 78; render/pricing.ts:50 | Emoji status marks and tile icons | One icon style (the sidebar's line icons) or text | Consistency (low priority) |

### Gaps
- No usability testing with first-time sellers was possible; confusion judgments rest on NN/g, Microsoft and Mailchimp guidance plus the client's recorded vocabulary.
- Whether production still lacks `MAIL_PROVIDER` and eBay keys today (both absent on Sept 13) was not re-checked; the constraints ruled out signing in or running Railway commands. The J1–J4 strings only appear under those conditions.
- GOV.UK's "sign in, not log in" entry was reported by search results (added 2023-09-06) but my direct fetches of the GOV.UK style pages did not reach it (one redirected to a page without the entry, one returned 404), so only Microsoft's version is directly verified.

## 5. Is terminology consistent between the public site, the /app workspace, the /admin console, and between UI text and emails?

### Takeaway
No. The public site, the workspace and the owner console each have their own names for the same things: the plans page is "Pricing" in public and "Plans & pricing" / "Pricing & plans" elsewhere, while "pricing" inside the app means card prices; the public footer's workspace links use different labels from the sidebar; the data-source credit in the footer (Pokémon TCG API & Scryfall) disagrees with the card pages and owner console (TCGplayer via TCGCSV); the owner console describes the Free plan wrongly ("catalog only", "locked"); sign-out is "Log out" for sellers but "Sign out" for the owner. The only email (password reset) matches the UI's wording about the link but uses the "CardIndex" brand. Buyer-pivot vocabulary has been almost entirely removed; what remains is collector phrasing on the landing page and the renamed "Price check" batch.

### Cited Findings
- The public header link "Pricing" goes to the plans page — [render/layout.ts:99](../../card-db-mvp/src/render/layout.ts); its heading is "One plan for sellers. The catalog is always free." — [render/pricing.ts:83](../../card-db-mvp/src/render/pricing.ts); the footer calls it "Pricing & plans" ([render/layout.ts:142](../../card-db-mvp/src/render/layout.ts)); the Dashboard calls it "Plans & pricing" ([render/app.ts:231](../../card-db-mvp/src/render/app.ts)). Inside the app "pricing" means card prices: "Ungraded pricing tool", "Pricing rule", "Pricing & condition" ([render/app.ts:190, 635, 1227](../../card-db-mvp/src/render/app.ts)). CU's footer says "Pricing & Plans" and its header "Pricing" — [login/nav research §3](../../carduploader-login-nav-research.md).
- Footer column "Seller tools" links "Dashboard / Scan & identify / Inventory & pricing / eBay listings / Pricing & plans" — [render/layout.ts:137–142](../../card-db-mvp/src/render/layout.ts); the sidebar calls the same pages "Ungraded cards", "Inventory", "Listings" — [render/app.ts:168–196](../../card-db-mvp/src/render/app.ts).
- Data-source credit: footer "Catalog & market prices from the Pokémon TCG API & Scryfall. Grade values, price history & sold comps are demo data." — [render/layout.ts:146](../../card-db-mvp/src/render/layout.ts); card pages "Market prices are synced daily from TCGplayer (via the TCGCSV mirror)" — [render/pages.ts:492, 495](../../card-db-mvp/src/render/pages.ts); owner console "Cards come from TCGCSV (TCGplayer's free daily mirror)" — [render/admin.ts:586](../../card-db-mvp/src/render/admin.ts).
- Footer browse links list "Pokémon" and "Magic: The Gathering" — [render/layout.ts:131–132](../../card-db-mvp/src/render/layout.ts) — while the add-cards game list puts Pokémon first and One Piece second as "the client's two focus games" — [render/app.ts:53–59](../../card-db-mvp/src/render/app.ts).
- Free plan, public and seller side: "The price catalog needs no account. A free account adds the pricing tool and lookups." ([render/pricing.ts:94](../../card-db-mvp/src/render/pricing.ts)); "Free to start: the pricing tool, card search and sales lookup are included." ([render/auth.ts:118](../../card-db-mvp/src/render/auth.ts)); same on the Dashboard and plan tile ([render/app.ts:230, 1290](../../card-db-mvp/src/render/app.ts)). Owner side: "Free tier — catalog only · upgrade candidates" ([render/admin.ts:156](../../card-db-mvp/src/render/admin.ts)), "Free · public catalog only. The seller workspace is locked until upgraded." (:288), confirm "Move X to the Free tier? They lose workspace access until re-upgraded." (:291). Free accounts in fact keep `/app`, the pricing tool, card search, sales lookup, inbox and Configuration — [server.ts:1995–2021](../../card-db-mvp/src/server.ts).
- Sign-in vocabulary: logged-out "Sign in" ([render/layout.ts:50](../../card-db-mvp/src/render/layout.ts); [render/auth.ts:85](../../card-db-mvp/src/render/auth.ts)), seller header "Log out" ([render/layout.ts:47](../../card-db-mvp/src/render/layout.ts)), owner header "Sign out" (:34), owner nav "Sign out of console" ([render/admin.ts:75](../../card-db-mvp/src/render/admin.ts)). Microsoft: "Use sign in… Use sign out… Don't use log in, login, … log out, logout…" — [Microsoft Writing Style Guide: sign in, sign out](https://learn.microsoft.com/en-us/style-guide/a-z-word-list-term-collections/s/sign-in-sign-out). CU uses "Sign in" and "Sign out" — [login/nav research §2, §4](../../carduploader-login-nav-research.md).
- Area naming: workspace pages carry the eyebrow "Seller workspace" ([render/app.ts:362](../../card-db-mvp/src/render/app.ts)); the header link is "Seller tools" ([render/layout.ts:100](../../card-db-mvp/src/render/layout.ts)); the sidebar top item is "Dashboard" ([render/app.ts:176](../../card-db-mvp/src/render/app.ts)); owner copy says "My workspace", "Open workspace", "Work in their workspace" ([render/layout.ts:30](../../card-db-mvp/src/render/layout.ts); [render/admin.ts:234, 304](../../card-db-mvp/src/render/admin.ts)).
- Sales lookup naming differs by surface (header "Sales Lookup", public heading "Sold-price lookup", owner "Sold prices") — see question 1.
- Privacy policy vs UI: it points sellers to "your Orders page" ([render/privacy.ts:42](../../card-db-mvp/src/render/privacy.ts)) although Orders is hidden unless `ORDERS_ENABLED=1` ([render/app.ts:161–174](../../card-db-mvp/src/render/app.ts)); to "Settings → eBay" (:65, :74) although the menu is "Configuration"; to "the back office" (:81) although the owner area is the "Owner console"; to a "photo matching" option (:33, :75) that the UI calls "Privacy" / "improving identification".
- Password-reset wording is consistent in substance: page "we've emailed a link to set a new password. It expires in 60 minutes." ([render/auth.ts:137](../../card-db-mvp/src/render/auth.ts)); email "Set a new password here — the link works once and expires in 60 minutes" ([server.ts:1643](../../card-db-mvp/src/server.ts)); page heading "Choose a new password", button "Set new password" ([render/auth.ts:172, 177](../../card-db-mvp/src/render/auth.ts)). The brand differs (question 2).
- Buyer-pivot leftovers: a grep of `card-db-mvp/src` for collection, wishlist, price check and alerts finds no remaining collector pages, routes or nav items; only a code comment ("Price checks keep their own naming", [server.ts:372](../../card-db-mvp/src/server.ts)) and the developer README ([README.md:16](../../card-db-mvp/README.md)) mention the pivot. Collector-flavoured phrasing remains on the seller landing page: "Use your scanner or phone to add single cards or entire collections." and "Organize, track and price your collection with SKUs and bulk tools." — [render/pages.ts:117, 120](../../card-db-mvp/src/render/pages.ts). The client saw the pivot's "Price check #6" on Sept 14 ([asks-and-plan §1c](../../client-video-2026-09-14-asks-and-plan.md)); it is now "Pricing #N" ([render/workspace2.ts:326](../../card-db-mvp/src/render/workspace2.ts)).
- NN/g: internal consistency means "the same patterns everywhere inside the system" — [NN/g heuristic #4](https://www.nngroup.com/articles/consistency-and-standards/).

### Inferences
- Renaming the public plans link to "Plans" frees "pricing" to mean card prices everywhere, which is how sellers use the word.
- The footer's Pokémon TCG API/Scryfall credit is a leftover from the original seed data; one attribution line used on the footer and card pages avoids contradicting ourselves on where prices come from (the legal researcher may have separate attribution requirements).
- The owner console's Free-plan description predates the Sept 8 change that let Free accounts into the workspace; it should be corrected so the owner doesn't tell a customer the wrong thing.
- The pivot has been cleaned up well; the remaining risk is the client remembering "Price check" from his Sept 14 test. Using "pricing batch" consistently closes that.

#### Before → after fixes: cross-surface consistency (C-series)

| ID | Where | Before | After | Why |
|---|---|---|---|---|
| C1 | render/layout.ts:99, 142; render/app.ts:231; render/pricing.ts (heading/eyebrow :82) | "Pricing", "Pricing & plans", "Plans & pricing" | "Plans" (link text and eyebrow) | "pricing" = card prices in the app |
| C2 | render/layout.ts:137–142 | "Seller tools: Dashboard / Scan & identify / Inventory & pricing / eBay listings / Pricing & plans" | "Dashboard: Ungraded cards / Inventory / Listings / Plans" | Match the sidebar |
| C3 | render/layout.ts:146; render/pages.ts:492, 495; render/admin.ts:586 | "Catalog & market prices from the Pokémon TCG API & Scryfall…" vs "TCGplayer (via the TCGCSV mirror)" | One line everywhere: "Card data and market prices: TCGplayer, updated daily." | Contradictory sources |
| C4 | render/layout.ts:131–132 | Footer "Pokémon / Magic: The Gathering" | "Pokémon / One Piece" | Client's focus games |
| C5 | render/layout.ts:98; render/sales.ts:150–152, 161; render/pages.ts:483; render/admin.ts:67, 514, 534 | "Sales Lookup", "Sold-price lookup", "Card sold-price lookup", "Sold prices" | "Sales lookup" (tool) everywhere; owner nav "Sales lookup data" | One name across surfaces |
| C6 | render/layout.ts:34, 47; render/admin.ts:75 | "Sign out", "Log out", "Sign out of console" | "Sign out" | Microsoft; CU |
| C7 | render/admin.ts:156, 288, 291 | "catalog only · upgrade candidates"; "Free · public catalog only. The seller workspace is locked until upgraded."; "They lose workspace access until re-upgraded." | "Free: pricing tool, card search and sales lookup · upgrade candidates"; "Free · pricing tool, card search and sales lookup. Pro adds inventory, listings and exports."; "They keep the free tools but lose inventory, listings and exports." | Owner copy was wrong |
| C8 | render/app.ts:362; render/layout.ts:30, 100; render/admin.ts:234, 304, 307 | "Seller workspace", "Seller tools", "My workspace", "Open workspace", "Work in their workspace" | "Dashboard", "My dashboard", "Open their dashboard", "Work in their dashboard" | One area name |
| C9 | render/privacy.ts:33, 42, 65, 74, 75, 81 | "photo matching … in Settings", "your Orders page", "Settings → eBay", "the back office" | "Help improve matching (Configuration)", "the Orders page (when orders are turned on)", "Configuration → eBay", "the owner console" | Policy must name real screens |
| C10 | render/auth.ts:172, 177; server.ts:1643, 1647 | "Set new password" / "Choose a new password" / "Set a new password" | "Set a new password" in all three | Minor alignment |
| C11 | render/pages.ts:117, 120 | "…add single cards or entire collections."; "Organize, track and price your collection with SKUs and bulk tools." | "…add single cards or whole binders."; "Organize, track and price your inventory with SKUs and bulk tools." | Seller, not collector, framing |

### Gaps
- Only one email exists (password reset), so email-vs-UI consistency could only be checked for that flow; "receipts and alerts later" are planned but unwritten ([app/mailer.ts:1](../../card-db-mvp/src/app/mailer.ts)).
- The eBay consent screen text (shown by eBay, not us) could not be viewed without an eBay sign-in.

## 6. Which copy overstates what exists (disabled, hidden behind flags, or stubbed features)?

### Takeaway
About 30 strings promise more than the product does: payment copy that says "Subscribe", "Billed monthly, cancel anytime" and "Billing management is coming soon" when no billing exists; "AI identification" that "instantly identifies… conditions" when identification is image-hash matching and condition is chosen by the seller; "list on eBay, TCGplayer, Whatnot and more" when only eBay has direct listing; "real-time" prices that update daily; "real sold prices… eBay, Goldin and Fanatics" from an archive of seller-harvested and sample rows; a "Free" label on a Pro-only page; "coming soon" / "(soon)" / "next integration" / "next step" labels for Mana Pool, Storefront, Shopify sync, slab scanning and One Piece; an "Orders" tile shown while Orders is switched off; "Pro (paid)" counting accounts that pay nothing; and help text that is stale in the other direction (says direct eBay publishing and binder detection don't exist when they do).

### Cited Findings
- Plans page: disabled button "Subscribe — $15/month" with "Secure online checkout is coming soon — contact us and we'll activate Pro on your account." (no contact link or address on the page) — [render/pricing.ts:71–72](../../card-db-mvp/src/render/pricing.ts); upgrade banner "Subscribe to Pro ($15/month)…" — :51; "$15/month · cancel anytime" — :75; "Prices in USD. Billed monthly, cancel anytime." — :110. Payment is not implemented; Pro is granted manually — [app/billing.ts:8–12](../../card-db-mvp/src/app/billing.ts).
- Configuration plan tile: "Billing management is coming soon" — [render/app.ts:1291](../../card-db-mvp/src/render/app.ts).
- Owner console stat "Pro (paid)" — [render/admin.ts:155](../../card-db-mvp/src/render/admin.ts); every account that existed when the paywall shipped was switched to Pro free of charge — [app/billing.ts:41–55](../../card-db-mvp/src/app/billing.ts).
- "Bulk scan & AI card identification" — [render/pricing.ts:30](../../card-db-mvp/src/render/pricing.ts); "AI Identification — Instantly identifies cards, sets, variants and conditions." — [render/pages.ts:118](../../card-db-mvp/src/render/pages.ts); "AI identifies the card details instantly." — :130. The only photo providers are `none`, `hash` (perceptual-hash matching against catalog images) and `mock` — [app/vision.ts:259–261](../../card-db-mvp/src/app/vision.ts); production runs `VISION_PROVIDER=hash` — [feature inventory line 192](../../cardindex-feature-inventory.md); condition is a seller-chosen default on the upload form — [render/app.ts:665](../../card-db-mvp/src/render/app.ts).
- "Scan, identify, price and list your trading cards on eBay, TCGplayer, Whatnot and more — from one place." — [render/pages.ts:101](../../card-db-mvp/src/render/pages.ts); "List to multiple marketplaces … eBay · TCGplayer · Whatnot · Shopify · + More" — :107–108; "List to eBay, TCGplayer, Whatnot and more with a few clicks." — :121; "Export and list to your favorite marketplaces." — :133; footer "one-click marketplace listings" — [render/layout.ts:125–127](../../card-db-mvp/src/render/layout.ts). Direct listing exists only for eBay (and only when eBay is connected) — [render/app.ts:1119, 1165](../../card-db-mvp/src/render/app.ts); the other platforms are CSV files — [app/exporters.ts:285–289](../../card-db-mvp/src/app/exporters.ts).
- "Real-time pricing from TCGplayer and eBay" — [render/pages.ts:119](../../card-db-mvp/src/render/pages.ts); the card page says TCGplayer prices are "synced daily" — :492.
- "Secure & private — Your data is yours — never sold or shared." — [render/pages.ts:151](../../card-db-mvp/src/render/pages.ts); the privacy policy says data is shared with eBay (when connected) and service providers, and sale prices from paid orders become public sold-price comparisons — [render/privacy.ts:43, 56–58](../../card-db-mvp/src/render/privacy.ts).
- "Start your free scan" — [render/pages.ts:135](../../card-db-mvp/src/render/pages.ts); scanning into inventory is Pro (Free gets the pricing tool) — [server.ts:1995–2021](../../card-db-mvp/src/server.ts); [render/app.ts:705–711](../../card-db-mvp/src/render/app.ts).
- Free plan feature "Live market prices, history & sold comps" — [render/pricing.ts:22](../../card-db-mvp/src/render/pricing.ts) — vs footer "Grade values, price history & sold comps are demo data." — [render/layout.ts:146](../../card-db-mvp/src/render/layout.ts).
- "Real sold prices from the archive — eBay, Goldin and Fanatics — with accepted Best Offer prices revealed." — [render/workspace2.ts:37](../../card-db-mvp/src/render/workspace2.ts); same claim on the public page and in its meta description — [render/sales.ts:153, 163](../../card-db-mvp/src/render/sales.ts). The archive fills from connected sellers' paid eBay orders and from imported files; sample rows are flagged — [render/admin.ts:534, 617, 687](../../card-db-mvp/src/render/admin.ts); [render/sales.ts:107](../../card-db-mvp/src/render/sales.ts).
- "One Piece Card Game — coming soon" is shown as a disabled game option whenever the catalog has no One Piece — [render/app.ts:64–65](../../card-db-mvp/src/render/app.ts); One Piece is the client's main personal game — [client transcript 03:20–03:26](../../client-walkthrough-2026-09-14-transcript.txt).
- Dashboard plan text "Unlimited scans, inventory and listings." — [render/app.ts:229](../../card-db-mvp/src/render/app.ts); Pro batches are capped at 500 photos — [upload.ts:33–34](../../card-db-mvp/src/upload.ts).
- Dashboard "Orders" tile shown while Orders is switched off — [render/app.ts:251](../../card-db-mvp/src/render/app.ts) (see question 3).
- Stale in the other direction: help "…or connect eBay for direct publishing (next integration)." — [render/app.ts:281](../../card-db-mvp/src/render/app.ts) — although Connect eBay and "Save & publish to eBay" exist (:1119, :1427–1429); "Binder-page detection … today each photo is treated as one card" (:729) although "Several cards per photo" exists (:1639).
- Promise labels: Shopify "Store linking with two-way inventory sync is the next integration." — [render/app.ts:1456](../../card-db-mvp/src/render/app.ts); Mana Pool "…the next integration after eBay" and "Connect Mana Pool (API key) → fetch orders, auto mark-shipped…" — :1478, :1480; hub blurb "…until the API link exists." — :1235; Graded "Slab QR / barcode scanning from the camera is the next step here" — [render/workspace2.ts:93](../../card-db-mvp/src/render/workspace2.ts); Blank listings "…are the next addition here." — :248; Orders tabs "Mana Pool (soon)", "Storefront (soon)" — :381 with [app/orders.ts:47–48](../../card-db-mvp/src/app/orders.ts); disabled "Fetch Mana Pool" — :432; Automatic inventory (badge "BETA") "When a marketplace is connected, this page keeps quantities in sync both ways…" — :496.
- Graded cards: "…each slab is looked up, matched, priced at its grade, and queued for review." — [render/workspace2.ts:56](../../card-db-mvp/src/render/workspace2.ts); with no cert provider the page itself says lookup isn't connected — :85–87.
- Blank listing creator subtitle begins "Free · add items by hand…" — [render/workspace2.ts:208](../../card-db-mvp/src/render/workspace2.ts); the page is Pro-only (not in the Free path list, and marked Pro in the sidebar) — [server.ts:1995–2010](../../card-db-mvp/src/server.ts); [render/app.ts:106](../../card-db-mvp/src/render/app.ts). (In CU the Blank Listing Creator is free because it costs no credits — [teardown §6b](../../carduploader-logged-in-teardown.md).)
- Inbox: "Missing card? Include the game, set and card number and it's added on the next catalog sync." — [render/workspace2.ts:530](../../card-db-mvp/src/render/workspace2.ts).
- The eBay hand-off box names eBay's screens slightly differently from eBay: "Open eBay → Reports → Uploads ↗", "…template Create new listings…", "Wait until the status reads Completed" — [render/app.ts:43–48](../../card-db-mvp/src/render/app.ts); eBay's help says Reports tab → "Upload", template type "Create new listings template", completion message "Your upload is complete" plus a downloadable report — [eBay help: Seller Hub Reports](https://www.ebay.com/help/selling/selling-tools/file-exchange?id=4096). "File Exchange" (the retired name) appears in the Pro feature list — [render/pricing.ts:34](../../card-db-mvp/src/render/pricing.ts) — and the getting-started checklist — [render/app.ts:261](../../card-db-mvp/src/render/app.ts).

### Inferences
- The payment copy is the most urgent: "Billed monthly, cancel anytime" next to a disabled Subscribe button describes a billing system that doesn't exist, and the "contact us" instruction gives no way to contact anyone. Until Stripe is live, the page should offer a working "Request Pro" path.
- "AI" is a claim sellers will test on day one; describing the real method (photo matching with a confidence score, seller confirms) is both honest and still a selling point.
- "Coming soon" labels for platforms the client doesn't sell on (Mana Pool, Storefront) have no upside; removing them is better than rewording them.
- The two stale help lines under-sell features that exist, which is as confusing as over-selling.
- Feature status itself (what is live on production) is covered by another researcher; these notes flag only the wording.

#### Before → after fixes: overstatements (O-series)

| ID | Where | Before | After | Why |
|---|---|---|---|---|
| O1 | render/pricing.ts:71–72 | Disabled "Subscribe — $15/month" + "Secure online checkout is coming soon — contact us and we'll activate Pro on your account." | Button "Request Pro" (mailto or Inbox link) + "Online payment isn't available yet. Send a request and we'll switch Pro on for your account." | No checkout, no contact route |
| O2 | render/pricing.ts:51 | "Subscribe to Pro ($15/month) to add cards…" | "Get Pro ($15/month) to add cards…" | Can't subscribe yet |
| O3 | render/pricing.ts:75, 110 | "$15/month · cancel anytime"; "Billed monthly, cancel anytime." | "$15/month"; "Prices in USD." | No billing exists |
| O4 | render/app.ts:1291 | "Billing management is coming soon" | "To change or cancel Pro, contact us." (or remove) | Promise |
| O5 | render/pricing.ts:30; render/pages.ts:118, 130 | "Bulk scan & AI card identification"; "AI Identification — Instantly identifies cards, sets, variants and conditions."; "AI identifies the card details instantly." | "Bulk photo matching"; "Photo matching — each photo is matched to catalog card images with a confidence score; you confirm anything uncertain."; "Each card is matched to the catalog; you confirm the uncertain ones." | Hash matching, no AI; condition isn't detected |
| O6 | render/pages.ts:101, 107–108, 121, 133; render/layout.ts:125–127 | "…list your trading cards on eBay, TCGplayer, Whatnot and more"; "+ More"; "with a few clicks"; "one-click marketplace listings" | "List on eBay, and export ready-to-upload files for TCGplayer, Whatnot and Shopify."; drop "+ More"; footer "…eBay listing tools and CSV exports for other marketplaces." | Only eBay lists directly |
| O7 | render/pages.ts:119 | "Real-time pricing from TCGplayer and eBay" | "TCGplayer market prices, updated daily, plus live eBay listings" | Daily, not real-time |
| O8 | render/pages.ts:151 | "Your data is yours — never sold or shared." | "We never sell your data or use it for ads." | Privacy policy describes sharing |
| O9 | render/pages.ts:103, 135 | "Start Scanning →"; "Start your free scan" | "Start scanning →"; "Price your cards free" | Free = pricing tool only |
| O10 | render/pricing.ts:22; render/layout.ts:146 | "Live market prices, history & sold comps" vs "…price history & sold comps are demo data." | Both: "Market prices (TCGplayer, daily) · price history and sold prices (sample data while real sales build up)" | Pages contradict each other |
| O11 | render/workspace2.ts:37; render/sales.ts:153, 163 | "Real sold prices from the archive — eBay, Goldin and Fanatics — with accepted Best Offer prices revealed." | "Sold prices recorded from connected sellers' eBay sales and imported sales files." | Source overstated |
| O12 | render/app.ts:65 | "One Piece Card Game — coming soon" (disabled) | Import One Piece on production; if still absent, omit the option rather than label a focus game "coming soon" | Client's main game |
| O13 | render/app.ts:229 | "Unlimited scans, inventory and listings." | "Unlimited batches (up to 500 photos each), inventory and listings." | 500-photo cap |
| O14 | render/app.ts:281 | "…or connect eBay for direct publishing (next integration)." | "…or connect eBay (Configuration → eBay) to list directly." | Stale: it exists |
| O15 | render/app.ts:729 | Binder note "…today each photo is treated as one card." | Delete | Stale: binder mode exists |
| O16 | render/app.ts:1456 | "Store linking with two-way inventory sync is the next integration." | Remove the sentence | Promise |
| O17 | render/app.ts:1235, 1478–1480 | Mana Pool "next integration" and "Connect Mana Pool" notes | Remove the page (R18) | Promise, wrong game |
| O18 | render/workspace2.ts:56 | "…each slab is looked up, matched, priced at its grade, and queued for review." | With no lookup provider: "…each cert number becomes a card in review; pick the card and grade, and it's priced at that grade." | No lookup exists |
| O19 | render/workspace2.ts:93 | "Slab QR / barcode scanning from the camera is the next step here…" | Remove | Promise |
| O20 | render/workspace2.ts:208 | "Free · add items by hand…" | "Add items by hand…" | Page is Pro-only |
| O21 | render/workspace2.ts:248 | "Default item specifics per job (CardUploader's 'apply to all items') are the next addition here." | Remove | Promise + competitor name |
| O22 | render/workspace2.ts:381; app/orders.ts:47–48 | Tabs "Mana Pool (soon)", "Storefront (soon)" | Remove | Non-existent features |
| O23 | render/workspace2.ts:432 | Disabled "Fetch Mana Pool" | Remove | Same |
| O24 | render/workspace2.ts:496 | "When a marketplace is connected, this page keeps quantities in sync both ways; today it tracks what you've exported and what sold." | "Listings you've exported or listed on eBay. Shipping an order lowers the quantity here." | No sync engine |
| O25 | render/workspace2.ts:530 | "…and it's added on the next catalog sync." | "…and we'll add it and reply here." | Promise |
| O26 | render/admin.ts:155 | "Pro (paid)" | "Pro" with sub "includes free grandfathered and manually granted accounts" | Nobody pays yet |
| O27 | render/pricing.ts:34; render/app.ts:261 | "eBay listing builder + File Exchange CSV"; "Drafts export to an eBay File Exchange CSV…" | "eBay listing drafts + eBay CSV for Seller Hub"; "Drafts export to an eBay CSV…" | Retired eBay name |
| O28 | render/app.ts:43–48 | "Open eBay → Reports → Uploads ↗"; "…template Create new listings…"; "Wait until the status reads Completed…" | "Open eBay Seller Hub → Reports → Upload ↗"; "…Upload template → .csv → Create new listings template → choose your file → Upload"; "Wait for 'Your upload is complete' (usually under 15 minutes), then download the results report to see any rejected rows." | Match eBay's current labels |

### Gaps
- Which of these conditions are true on production today (One Piece imported, eBay keys saved in the owner console, a cert provider configured, `ORDERS_ENABLED`) was not re-verified; the feature-status researcher is covering that. Strings such as O12 and O18 only appear under specific configurations.
- The exact contact route the client wants for Pro requests (email address, Discord, Inbox) is not documented; the privacy contact (`thegivingbulbasaur@gmail.com`, [render/privacy.ts:9](../../card-db-mvp/src/render/privacy.ts)) is the only address in the code.
- Whether "Goldin" and "Fanatics" rows exist in the production archive (beyond the bundled sample) could not be checked without database access.
