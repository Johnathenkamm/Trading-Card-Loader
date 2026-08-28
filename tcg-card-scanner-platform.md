# TCG Card Scanner & Listing Platform

## Main Goal

Build a subscription-based website that allows TCG sellers to quickly scan/upload their cards, automatically identify them, review the information, price them, and create marketplace-ready listings.

**Phase 1 priority: eBay.**

The system should be built so we can later export/sync the same inventory to TCGplayer, Whatnot, Shopify, and other marketplaces.

---

## 1. User Accounts & Subscription

- Users create their own account.
- Monthly subscription model.
- Subscription gives access to card scanning/listing tools.
- User dashboard keeps their cards, previous uploads, settings, inventory, etc.
- Eventually we can have different subscription levels based on usage/features.

---

## PHASE 1 — CARD SCANNING

### 2. Ungraded / Raw Card Scanner

User uploads photos/scans of raw cards.

The system should:

- Recognize the card automatically.
- Identify:
  - TCG
  - Card name
  - Set
  - Card number
  - Rarity
  - Language
  - Finish/variant when possible
- Allow front and back images.
- Allow multiple cards to be processed in one batch.
- Allow phone photos OR scanner images.
- Automatically crop/prepare images when necessary.
- Detect duplicate cards.

**Examples of TCGs:**

- Pokémon
- One Piece
- Yu-Gi-Oh
- Lorcana
- Dragon Ball
- Magic
- Other major TCGs

The goal is eventually to support as many TCGs as possible.

### 3. Graded Card Scanner

Separate workflow for graded cards.

**Support:**

- PSA
- BGS
- CGC
- TAG
- ACE
- Additional grading companies later

**Allow users to:**

- Upload/scan slab images.
- Scan slab QR/barcodes when available.
- Enter certification number manually.
- Automatically identify the card.
- Pull grading company.
- Pull grade.
- Pull certification number.
- Pull card/set information.
- Generate listing information automatically.

---

## PHASE 1 — REVIEW SCREEN

### 4. Review Cards Before Listing

After scanning, show all cards in a batch.

**Each card should display:**

- Card image(s)
- Card name
- Set
- Card number
- Condition
- Variant
- Language
- Price
- SKU
- Generated title

Everything should be editable before exporting.

**If the AI identifies the wrong card:**

- Show alternative matches.
- Allow manual card search.
- Allow user to replace the identification.

### 5. Bulk Editing

Very important for people listing hundreds of cards.

**Select multiple cards and change:**

- Condition
- Price
- SKU
- SKU prefix
- Variant
- Language
- eBay category
- eBay store category
- Listing settings

**Example:** User scans 100 cards and can set all 100 to Near Mint at once.

---

## PHASE 1 — PRICING

### 6. Automatic Market Pricing

Display pricing information while reviewing cards.

**Eventually pull data from:**

- TCGplayer market price
- eBay active listings
- eBay sold listings
- Graded card pricing sources

**Allow pricing rules such as:**

- TCG Market + 10%
- TCG Market - 5%

The user should still be able to manually override any price.

### 7. Remember Previous Prices

If someone scans the same card again later:

- Show their previous selling/listing price.
- Allow them to automatically reuse previous pricing.

---

## PHASE 1 — EBAY

### 8. Connect eBay Account

Allow the seller to connect their eBay account.

**Save their:**

- Store categories
- Shipping policies
- Payment policies
- Return policies
- Item location
- Listing preferences

The user shouldn't have to configure this every time.

### 9. Automatically Build eBay Listings

After a card is identified, automatically create:

- Optimized eBay title
- Description
- Category
- Item specifics
- Condition
- Price
- Quantity
- SKU
- Card images

Users can create their own title templates.

**Example:**

`2024 One Piece OP05 Monkey D. Luffy #119 SEC NM English`

Keep titles within eBay's character limits automatically.

### 10. eBay Fixed-Price Listings

Allow users to export/create normal Buy It Now listings.

**Include:**

- Images
- Price
- Quantity
- SKU
- Description
- Item specifics
- Business policies

### 11. eBay Auctions

Allow cards to be listed as auctions.

**User can control:**

- Starting price
- Auction duration
- Start date/time
- Individual or bulk settings

### 12. eBay Scheduled Listings

Allow the user to schedule listings.

Also allow listings to be spaced apart automatically.

**Example:** List one card every 5 minutes — instead of dumping 500 listings onto eBay simultaneously.

### 13. eBay Variation Listings

Eventually allow multiple cards to exist under one eBay listing as variations.

**Example:** "One Piece OP05 Singles" — buyers choose individual cards from the listing.

---

## INVENTORY

### 14. SKU System

Every physical card should be able to receive a unique SKU.

**Example:**

- `HOH-000001`
- `HOH-000002`
- `HOH-000003`

**Allow:**

- Custom prefixes
- Automatic numbering
- Manual SKUs
- Searching inventory by SKU

This will become extremely important once we support multiple marketplaces.

### 15. Duplicate Detection

The system should identify when the seller scans the same card multiple times.

**Allow them to:**

- Keep individual copies.
- Combine quantity.
- Maintain individual SKUs.
- Update an existing listing instead of accidentally creating duplicates.

Also eventually check whether that card is already listed on eBay.

---

## EXPORTS / MARKETPLACES

### 16. eBay Export — FIRST PRIORITY

The first marketplace we need working extremely well.

**Flow:**

`Scan → Identify → Review → Price → Export/List on eBay`

**Support:**

- Fixed Price
- Auctions
- Scheduled Listings
- Variation Listings

### 17. Other Marketplace Exports — NEXT PHASE

Build the database so the same card information can eventually export to:

- TCGplayer
- Whatnot
- Shopify
- Mana Pool
- Cardmarket
- MercadoLibre
- Tradera
- Generic CSV

The important thing is that we do not want to rebuild the card database for every marketplace.

One card/inventory record should be capable of being formatted differently depending on where the seller wants to list it.

---

## LONG-TERM GOAL

Eventually this should become a central hub for a TCG seller.

**Flow:**

```
SCAN CARD
    ↓
AI IDENTIFIES CARD
    ↓
GET MARKET PRICE
    ↓
REVIEW / EDIT
    ↓
ADD TO INVENTORY
    ↓
LIST TO EBAY
```

Then eventually:

**EBAY • TCGPLAYER • WHATNOT • SHOPIFY • OTHER MARKETPLACES**

The seller should only have to scan and enter the card once. The system handles converting that information into the correct format for each marketplace.
