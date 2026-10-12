# Client video, Oct 7 2026: "We're Building Our OWN Card Scanning Software!"

Source: https://www.youtube.com/watch?v=Yma3ZvKKPiQ (Hobby Over Hype, 16:35). Watched Oct 9 2026 with the full
YouTube auto-caption track plus frame-by-frame screenshots. The client is on prod (tradingcardloader.com) as OWNER.

## The main complaint: cards can't be found (11:50–14:50)

- He uploads 35 photos (batch "A-01", database = "Any game (auto-detect)", NM, EN, eBay Fixed, Market, $0.99 start).
  Result: Review batch #7, **35 cards, 7 matched, 28 need review, 0 failed**. Upload took under 5 s ("pretty fast").
- Most of the photos are modern Pokemon cards. 28 show "No catalog match — search below to identify this photo" at 0% match.
- In Compare (card 18 of 35, image34796.jpg) he searches **"tauros"**. The result is **"No matches"**. The empty search
  only lists Base Set cards (Ponyta 60/102, Staryu 65/102, Metapod 54/102, Rattata 61/102, Starmie 64/102).
- He then opens Browse and sees **only 3 sets**: Pokemon Vivid Voltage, Pokemon Base, MTG Kamigawa: Neon Dynasty.
  Quote at 12:15: "I don't think he has all the sets in here yet. So, that's probably why it's not matching."
- **Confident WRONG matches** make it worse:
  - Several green Pokemon photos matched **MTG "Careful Cultivation" #178 (Neon Dynasty) at 99%**. Also "Circuit Mender" #242 at 99%.
    "This is completely wrong. Like it's pulling up magic over here."
  - A modern Magneton matched **1999 Base Set Magneton 9/102 Holo at 99%** ("says 99% match and it's coming out with a Megaton").
- His verdict: "The scan does work... Database needs to be done." "We need to get every single set uploaded in here...
  without that we're not able to do anything." "We can't even test anything without that."
- One Piece: "we don't have One Piece set up yet", so he scanned Pokemon instead (7:00).

## Other asks in the video

1. **Rename**: "This card index needs to be changed." (2:05)
2. **Browse page**: he's leaning toward removing it ("I don't think you need this"). He'll keep it if commenters want it. (3:30–4:30)
3. **Search page**: likes it ("TCG player feel"), likes the eBay last-sold link and graded prices. (4:30–5:15)
4. **Sold-price lookup**: "Charizard PSA 10" and "Charizard" both returned nothing (empty archive). He wants real accepted
   Best Offer prices like the paid site he can't name (130point-style). (5:15–6:30)
5. **$15 Pro badge**: he thinks it's a placeholder. (6:45)
6. **Batches**: keep the 500-per-batch limit, but he's moving to batches of 100–150. Batch label vs SKU prefix confused him.
   He sorts each 500 by color for One Piece. (2:30–3:15, 8:15–8:55, 9:45–10:15)
7. **eBay**: wants a direct eBay link / CSV upload, and **store category** set correctly (Pokemon vs One Piece categories). (9:00–9:45)
8. **Duplicates**: wants a top-of-page "merge duplicates" action. When merged, the duplicate row should DISAPPEAR, not sit there
   with a "Duplicate of item #… merge folds its quantity on commit" note. He was confused by where quantity is and why the fields move. (10:45–11:45)
9. **Review row layout**: "I don't think I'm a fan." (13:00–13:15)
10. **Inventory → Create listings**: felt "a little" confusing. He found Connect to eBay and will do it in another video. (13:50–14:25)
11. **Help content**: he hates reading the side explainer text. Wants a short **how-to video on every page**, or maybe an FAQ. (14:50–15:30)
12. Discord community idea (16:15).

## What this means for us

The main complaint needs the catalog loaded on prod, not code: `/admin/catalog` → Import Pokemon and One Piece
(TCGCSV, every set), then the photo-ID index rebuilds. See `reports/Client video asks and platform gaps.md` (Sept 29),
which already flagged that prod is on the 607-card demo catalog.

Code follow-up that the import alone won't fix: matches score 99% on the wrong card (even the wrong game) when the real
card isn't in the catalog. The confidence score needs a floor or margin test so a weak nearest neighbour lands in
"needs review" and doesn't show as a 99% match.
