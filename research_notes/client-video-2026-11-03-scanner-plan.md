# Client video, Nov 3 2026: scanner false reads, diagnosis and plan

Source: https://youtu.be/CGigW5XSkVI ("We're Building Our OWN Card Scanner Software! (PART 2)", Hobby Over Hype, 8:18).
Watched Nov 6 2026 with the full caption track and frame-by-frame screenshots. The client uploaded 52 photos to
prod as OWNER: review batch #8, "Any game (auto-detect)", default language EN, eBay Fixed, Market, $0.99 start.

## What the client saw

- 52 cards: 1 matched, 51 needs review. Many top picks were wrong:
  - English cards came back as **Japanese** printings (Heracross → "SI: Start Deck 100", Wingull → "XY6: Emerald Break",
    Galarian Farfetch'd → "S5a: Peerless Fighters"), and the item language flipped to JP.
  - Pokémon cards came back as **Magic** cards (Spheal → "Island (Rocky Path)", Clobbopus → "Scarecrow Guide", Thud, Hostility…).
  - Bisharp matched Dialga. He searched "bisharp" in Compare, didn't see his printing, and concluded the set is missing.
- He clicked an alternative to *look* at it, it replaced the correct match with the Japanese card, and there was no undo (2:40–3:30).
- He wants CardUploader's flow: click an alternative, see it next to the photo, then press Replace (6:00–6:50).
- His verdict: "it's a data thing… we just don't have all the sets in there." He won't approve cards, because he
  doesn't want the system to "learn the wrong cards" (7:15).
- Smaller asks: connect to eBay like CardUploader (2:10); SKU number vs batch number still confusing (1:40).

## Diagnosis: it is NOT missing data

All 52 photos are clean flatbed scans of English Pokémon (Vivid Voltage, Chilling Reign, BREAKpoint, Crimson
Invasion, Roaring Skies, Astral Radiance). Every one of those cards is in the prod catalog and has a photo hash
(checked on prod over `railway ssh`, Nov 6). Prod is on `VISION_PROVIDER=hash`. Three causes:

1. **Language ignored.** "Any game" searched all 166k hashes, including the 27k Japanese Pokémon cards. Those use the
   same artwork as the English cards, so the Japanese twin often scored closer. The batch language (EN) never reached the matcher.
2. **Scanner margin.** The scans have a dark border around the card; catalog art is cropped tight. That alone puts a
   scan 14–18 bits from its own card, as far as random Magic cards, so "Any game" picked Magic.
3. **Compare search showed only 5 results.** "bisharp" listed the 5 newest printings; Astral Radiance 116/189 was cut off.

## Measured on the client's own 52 photos

Ground truth: `card-db-mvp/data/bench/client-batch8/truth.json` (labelled by eye). Photos and a copy of the prod hash
index are in the same folder (git-ignored). Scripts: `src/bench/client-batch.ts` (hash, prod index) and
`src/bench/client-batch-embed.ts` (full upload path, local DB).

| Matcher | Right top pick | Auto-matched | **Wrong auto-matches** |
|---|---:|---:|---:|
| Prod today (hash, Any game) | 15/52 | 0 | 0 |
| Hash + language rule + margin trim (done locally) | 51/52 | 15 | **0** |
| Image embeddings, SigLIP 2 (built Oct 10, not on prod) | 51/52 | 24 | **0** |

The one miss in both is Electabuzz 42/122 (BREAKpoint) vs the XY Trainer Kit printing with identical art. It goes to
review at 70%, not auto-match.

Regression check of the trim on 1,200 synthetic photos (`src/bench/trim-check.ts`): clean images unchanged (99/100);
plain-background 5→43 right, blur 6→34. Through the full upload path, background+blur gave 68/200 right, 16
auto-matched, **0 wrong**.

## Shipped Nov 15 2026 (commit ceeee22, deployment f466a1a2)

The first deploy failed at Railway's image step with no error in the build log; a redeploy of the same commit
succeeded. Live check afterwards (the client's 52 photos through prod's matcher, read-only over `railway ssh`):
51/52 right, 16 auto-matched, 0 wrong, 0 Japanese or Magic picks, ~270 ms/photo.

- `vision.ts` `photoGamePool()`: with "Any game", the batch language picks the language edition. An EN batch never
  matches `pokemon-jp`, and a JP batch never matches `pokemon`. Choosing a Database explicitly still wins. Wired
  through `server.ts` `uploadSettings` (`matching.language`) and `IdentifyOptions.language`.
- `imagehash.ts` `hashPhoto()`: also hashes the photo with a flat background margin trimmed (Jimp, no new dependency).
  The matcher takes the closer of the two. Tight crops are left alone.
- `identify.ts` `maxResults` + `/api/identify` returns up to 30 results, so Compare search shows every printing.
- Compare window (`render/app.ts`, `styles.css`): a click previews the alternative in the middle pane ("Selected card
  (not saved yet)"). Only Replace or Enter saves it. Double-click no longer replaces.
- `store.ts` `replaceMatch`: the card being replaced stays first in the alternatives, so a wrong Replace is undone with one click.

Browser-checked locally before shipping (batch 122, test seller 15): click previews without saving, double-click
doesn't save, Replace then one click on the old card undoes it, "bisharp" lists 30 cards with Astral Radiance at #8.
Only the scanner hunks were committed; the embedding work in `vision.ts`/`server.ts` stays uncommitted.

## Plan to avoid false reads, in order

1. ~~Browser-check the Compare changes~~ (done)
2. ~~Ship the hash fixes to prod~~ (done, ceeee22)
3. ~~Re-run the client's batch on prod~~ (done, read-only)
4. **Turn on image embeddings on prod** (`VISION_PROVIDER=embed`): more auto-matches with the same 0 wrong, and it holds
   up on phone photos, glare and tilt, where the hash fails. Needs about 600 MB more RAM on Railway and a first embed of
   the catalog: hours for Pokémon EN+JP + One Piece, more for 105k MTG. Consider embedding the client's games first.
5. **Keep the auto-match bar strict.** Identical-art reprints always go to review with the runner-up offered. Never
   auto-match across games or languages.
6. **Tell the client:** approving cards doesn't train anything (no learning loop exists), so approving a correct match is
   safe. The "missing sets" were a matching problem, not a data problem.

Still open from the video, not scanner work: eBay connection like CardUploader, and the SKU vs batch-number wording.
