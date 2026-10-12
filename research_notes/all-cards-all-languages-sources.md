# Every Pokémon and Magic card in every language: sources and counts

Checked Oct 9 2026 against each source's live API (counts are what the APIs returned that day).

## Magic: The Gathering — Scryfall (complete, free)

| Scope | Count |
|---|---|
| Unique cards (Oracle) | 32,993 |
| English/default printings | 98,769 |
| Printings in every language | 524,438 |

Per language (paper printings): en 96,180 · ja 62,423 · fr 59,137 · de 58,800 · es 53,688 · it 53,074 · zhs 40,814 · pt 39,535 · zht 23,579 · ru 21,759 · ko 15,381 · Phyrexian 49 · a handful of one-offs (he, la, grc, ar, sa, qya).

Bulk download: `all_cards` = one gzipped JSONL file, 395 MB compressed (`https://api.scryfall.com/bulk-data/all-cards` → `jsonl_download_uri`), refreshed daily. Streamable line by line.
Scryfall carries USD/EUR prices on English printings. Most non-English printings have no price.
TCGplayer (TCGCSV category 1): 454 groups, 105,466 singles, all with images and prices. Mostly English.

## Pokémon

| Source | Language | Cards | With image | Prices |
|---|---|---|---|---|
| TCGCSV category 3 (TCGplayer) | English | 28,054 | 28,054 | yes (TCGplayer) |
| TCGCSV category 85 "Pokemon Japan" | Japanese | 27,920 | 27,920 | yes (TCGplayer) |
| TCGdex | en | 23,736 | 21,987 | no |
| TCGdex | fr | 22,170 | 18,342 | no |
| TCGdex | de | 20,498 | 14,871 | no |
| TCGdex | it | 15,741 | 14,580 | no |
| TCGdex | es (+ es-mx 1,655) | 15,510 | 14,369 | no |
| TCGdex | pt (+ pt-br 1,124) | 13,907 | 12,746 | no |
| TCGdex | ja | 12,781 | 3,882 | no |
| TCGdex | zh-tw | 7,436 | 2,146 | no |
| TCGdex | th | 2,921 | 1,224 | no |
| TCGdex | id | 2,788 | 1,152 | no |
| TCGdex | zh-cn | 877 | 0 | no |
| TCGdex | ko | 239 | 0 | no |
| TCGdex | nl / pl / ru | 0 (sets only) | 0 | no |

No open source has complete Korean or Chinese Pokémon. The only complete sources are the official regional card databases (pokemoncard.co.kr, the Chinese official site), which would need scraping. That has licensing risk.
For European-language Pokémon prices, Cardmarket is the market of record (TCGplayer doesn't price them).

## Our database
- Local (Oct 9): Pokémon 28,044 (= TCGCSV cat 3), One Piece 6,960, Magic 302 (one demo set).
- Prod (tradingcardloader.com, Oct 9): 3 sets / 836 cards (Vivid Voltage, Base, Kamigawa: Neon Dynasty).
- Schema: `card_variants.language` already exists (default 'EN'), and `cards` holds one image per card.
- Importer `src/app/catalog-import.ts` knows TCGCSV pokemon (3), onepiece (68), mtg (1). It has no Pokemon Japan (85) entry yet.

## Japanese Pokémon import (built Oct 9 2026)
- Game `pokemon-jp` ("Pokemon Japanese"), TCGCSV category 85, variants stored with language `JP`.
- 461 TCGplayer groups → 454 sets with singles, **30,365 cards** (27,920 numbered + 2,445 numberless).
  Vintage JP sets (1996–2000) and many promos have no collector number; TCGplayer still lists them with a
  `CardType`, which sealed products lack. The importer's `numberlessSingles` flag picks them up (JP only; One Piece
  also has 245 numberless DON!! cards, which the flag would pull in if switched on there).
- Prices: 21,720 market-price rows on the first import (many numberless promos have no TCGplayer price).
- Local import took about 12 minutes for the sets, then about an hour of photo indexing (~30k images from
  tcgplayer-cdn.tcgplayer.com). The index reached 27,570 / 30,365 (91%). The rest are permanent 403s:
  TCGplayer has no image for many "(Mirror Holofoil)" / Ball-pattern / deck products (195 of 200 failed cards
  still 403 on retry). The CDN also resets connections intermittently under load, but those succeed later.
- EN↔JP same-art twins, measured on clean renders (hash distance, 20 pairs each): vintage Base ↔ Expansion Pack
  median 17.5 (never confused); Vivid Voltage ↔ S4 median 6; 151 ↔ SV2a median 7.5. The true card beat its twin by 2+
  in ~95% of photos; the rest go to review with the twin offered as an alternative.

## Notes for building it
- Photo matching uses the card ART. A French or German printing has the same art as the English one, so the English
  hash usually finds the card. Language is then a pick in review (the batch's language default). Hashing all 524k MTG
  language printings is likely unnecessary. Japanese Pokémon is the exception: many JP-only cards and arts, so it needs
  its own catalog and hashes (TCGCSV 85).
- Check Scryfall's data-use terms before putting Scryfall data behind the $15 Pro paywall.
- TCGCSV is an unlicensed TCGplayer mirror (see reports/Client video asks and platform gaps.md).
