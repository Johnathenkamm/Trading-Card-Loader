# Card scanning technology: photo in, exact printing out (assessment for tradingcardloader.com, 2026-09-28)

Scope: identifying ungraded Pokémon and One Piece cards from phone photos and flatbed/sheet-fed scans. Source labels: "our code" = files under `C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp` (read on 2026-09-28, uncommitted working tree). "Local report" = earlier research files in `C:/Users/johnn/Antigravity_Files/Card_reader`. Vendor and app-maker claims are labeled as self-reported. Where a page could not be fetched and only a search-result excerpt was seen, that is stated.

---

## 1. What exactly does our current pipeline do, and where will it fail?

### Takeaway
Production (`VISION_PROVIDER=hash`) hashes the **whole uploaded frame**: a 64-bit dHash plus a 64-bit aHash of a 9×8 / 8×8 greyscale thumbnail, on the full frame and on an 8%-inset copy. It then scans every catalog product linearly for the nearest one. The winning card is converted back into **text** ("name number set") and searched again by the text matcher, and the printing (holo, reverse holo, 1st Edition) is never read from the pixels. This works on clean, tightly cropped, catalog-like images, and those are the only images in our local test set. It will fail on uncropped phone or flatbed photos, rotated cards, sleeves and toploaders, glare, look-alike cards that share a frame, and every finish variant. When it fails it returns **no visual candidates at all**, so the item shows as "Unmatched" or 0%.

### Cited Findings
**Capture and upload path**
- The upload offers three layouts: "1 image" (one card per photo), "2 images" (front/back pairs) and "Several cards per photo". Only the last one runs card detection, and it runs on the user's device. — [our code: src/render/app.ts L1636-1640](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/render/app.ts)
- In single-card mode the **whole photo** becomes the unit (`rect:null`). It is shrunk on the device to a maximum edge of 1,600 px and re-encoded as JPEG at quality 0.85. No crop, deskew or perspective correction is applied. — [our code: app.ts L1895-1899, L1912-1943](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/render/app.ts)
- How the multi-card detector works:
  - It works on a ~900 px copy and estimates the background colour from the median of the photo's border.
  - It thresholds each pixel's distance from that background with Otsu (clamped to 20–64), fills holes, erodes, labels connected blobs, and splits merged blobs using row/column coverage dips.
  - It keeps blobs with fill ≥0.55 and aspect ratio 0.5–0.95 or 1.05–2.0, and drops pieces smaller than 35% of the median area.
  - It estimates tilt from a line fit to the top edge and corrects it only when it is 0.006–0.26 rad (about 0.3°–15°). Crops are axis-aligned boxes plus that rotation, with no homography.
  - **If fewer than 2 cards are found, the photo is sent whole.**
  - [our code: app.ts L1745-1848](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/render/app.ts)
- On the server, each unit is stored in the bucket and passed to `visionIdentify`. A "failed" result is relabelled "needs_review". Photos are identified **inline, one after another, inside each upload-chunk request**. — [our code: src/server.ts L657-677](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/server.ts)

**The matcher (hash provider)**
- Available providers are `none`, `mock`, `hash`, and `http` / `custom` / `ximilar`. The http variants are a generic JSON POST with dot-path label mapping; `ximilar` defaults to the "Token " auth prefix. — [our code: src/app/vision.ts L258-285](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/vision.ts)
- The hash is a dHash (9×8 luminance gradient) plus an aHash (8×8 mean threshold), computed on the full frame and on an 8% inset crop. Colour is discarded (Rec. 601 luma). — [our code: src/imagehash.ts L10-68](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/imagehash.ts)
- Distance is the minimum, over four full/inset pairings, of Hamming(dHash) + 0.5 × Hamming(aHash). Hamming is computed with a bit-by-bit BigInt loop. — [our code: imagehash.ts L70-98](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/imagehash.ts)
- Every photo is compared linearly against **every** index row. The index is loaded into memory with a 10-minute TTL. — [our code: vision.ts L88-117, L138-148](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/vision.ts)
- Distance maps to confidence as ≤6 → 0.97, ≤10 → 0.90, ≤14 → 0.75, ≤18 → 0.55. **Anything above 18 returns null** (no vision result). A runner-up from a different card within 2 points caps confidence at 0.70. A code comment records the measurement "same image re-encoded ≈ 0, different cards ≈ 20+". — [our code: vision.ts L151-157](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/vision.ts)
- The provider returns only `{name, number, set_name}` as a text hint. The matched `card_id` survives only in the `raw` log field. — [our code: vision.ts L159-170](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/vision.ts)
- `visionIdentify` re-runs the **text** matcher `identify(hint)` and takes the higher of the text and vision confidences; ≥0.9 auto-matches. A null vision result falls back to the filename hint. — [our code: vision.ts L308-335](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/vision.ts). The thresholds are AUTO_THRESHOLD = 0.9 and MIN_MATCH = 0.5. — [our code: src/app/identify.ts L56-57](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/identify.ts)
- The printing is chosen by `pickVariant` with finish = null, which returns the default or first variant. The "alternatives" come from the **text** ranking (top 6, of which 4 are shown), not from visual neighbours. — [our code: identify.ts L353-367, L412-474](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/identify.ts)
- The parser already recognises One Piece codes (`OP11-117`, `EB02-005`, `ST01-001`) and Pokémon `NNN/NNN` numbers in text. — [our code: identify.ts L168-179](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/identify.ts)

**Index and catalog**
- `card_image_hashes` is keyed by `card_id`, so there is one row per product. It is built from `COALESCE(image_small, image_large)` with 6 concurrent fetches and 4 attempts per image. Failures are only logged. Missing rows are filled by a background build at boot. — [our code: src/app/hashindex.ts L20-52, L68-143](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/hashindex.ts)
- `image_small` is the 200 px TCGplayer image that TCGCSV lists; the 400 px URL is derived from it. — [our code: src/app/catalog-import.ts L79-83](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/catalog-import.ts)
- Pokémon printings (Normal / Holofoil / Reverse Holofoil / 1st Edition / Unlimited…) are TCGCSV **price sub-types of one product**, which we store as `card_variants`. One Piece parallels and alternate arts are **separate products**, with "(Parallel)" in the name. — [our code: catalog-import.ts L19-23](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/catalog-import.ts); [our code: src/scripts/sync-tcgcsv.ts L5-9, L43-57](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/scripts/sync-tcgcsv.ts)
- The imported TCGplayer categories are 3 (Pokémon), 68 (One Piece) and 1 (MTG). Category 85, Pokémon Japan, is noted "when a JP catalog lands", so Japanese Pokémon is not in the catalog. — [our code: sync-tcgcsv.ts L35-41](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/scripts/sync-tcgcsv.ts)
- Per the project brief for this assignment, TCGplayer's CDN starts answering HTTP 403 after about 30k fetches. The catalog holds about 27,700 Pokémon products and about 7,000 One Piece products, roughly 34,700 images in total.

**History and test evidence**
- The production hash table was empty until the Sept 13 boot-time builder landed. A 500-card production test came back "500 × Need review / 0%". — [local report: cardindex-feature-inventory.md L194](C:/Users/johnn/Antigravity_Files/Card_reader/cardindex-feature-inventory.md)
- The client's own Sept 14 test used 15 files with scanner-style names (`20260914204009_0001.jpg`…): OP11-117 plus 13 cards from EB02 Anime 25th Collection. **All 15 came back Unmatched.** Production then held only the 607-card demo catalog. — [local report: client-video-2026-09-14-asks-and-plan.md L89](C:/Users/johnn/Antigravity_Files/Card_reader/client-video-2026-09-14-asks-and-plan.md)
- The hash matched 500/500 distinct cards on Sept 13. The same plan calls the approach "fragile to glare, tilt and cropping on phone shots at 20k+ cards". — [local report: client-video plan L178](C:/Users/johnn/Antigravity_Files/Card_reader/client-video-2026-09-14-asks-and-plan.md)
- A local run of 500 distinct cards at 1600 px took 2.2 minutes end to end. The index size for that run is not recorded. — [local report: carduploader-upload-limits-research.md L46](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-upload-limits-research.md)
- The local test set contains no real photos:
  - `test-cards/phone/01.jpg` is the Seel 41/102 (1st Edition) catalog scan, upscaled to 3024×4032. It is full-bleed, with no background, perspective, sleeve or glare (inspected visually). — [test image](C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/phone/01.jpg)
  - The `binder/` pages are synthetic composites of catalog images on flat colour backgrounds with a lighting gradient, noise, and ±4–6° rotation on the "loose" pages. — [make-binder-pages.mjs](C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/make-binder-pages.mjs)

**External evidence on hash fragility**
- Perceptual hashing "is still quite sensitive to the segmentation of the card. If too little or too much extra border is included… the hash difference test fails" (2020 MTG project; older source). — [tmikonen, Magic Card Detector (2020)](https://tmikonen.github.io/quantitatively/2020-01-01-magic-card-detector/)
- A current MTG hash scanner rectifies perspective first, then hashes "in both orientations plus minor shifts" with a 256-bit art hash (not 64-bit). — [ManaMesh](https://github.com/KarimLeexz/ManaMesh)
- Even a trained embedding model's residual confusions are mostly "different prints of the same creature or cards sharing the same frame". — [TCG-AR, arXiv 2607.02090 (Jul 2026)](https://arxiv.org/html/2607.02090v1)

### Inferences
Concrete failure modes, roughly in order of impact:
- **F1. No card localisation in single-card mode.** A phone shot on a table, or a flatbed scan with the card in one corner of the bed, is hashed with the background included. The low-resolution hash is then dominated by layout and background, so the distance will usually exceed 18. The result is null, then a camera-style filename gives no hint, then "Unmatched" with zero candidates.
  - The multi-card mode does not rescue a **single** card either: it requires at least 2 detections.
  - This is the most likely reason real-world uploads fail even after the catalog is loaded.
- **F2. No rotation or perspective handling.** dHash is not rotation-invariant: an upside-down card or a landscape frame produces an unrelated hash. Perspective from a hand-held phone skews the 9×8 gradient grid. The multi-card path corrects only ±15° of in-plane tilt.
- **F3. Low discriminative capacity at catalog scale.** A 64-bit luminance-only gradient, plus a mean hash, on a 9×8 thumbnail mostly encodes frame layout and big light/dark areas. Cards share frames within an era (Pokémon yellow borders, One Piece colour frames), and colour is thrown away. So at about 35k products, near-ties and wrong nearest neighbours become likely on degraded input.
  - The fixed thresholds (≤10 → 0.90 means auto-accept) were tuned on re-encoded copies of the same image. They were not calibrated on real photos.
- **F4. Glare, holo foil, sleeves and toploaders.** Specular highlights and foil sparkle flip gradient bits locally. A toploader adds a thick clear margin and reflections, which the fixed 8% inset cannot absorb.
- **F5. The visual answer is thrown away.**
  - Converting the hash winner back to text and re-searching can land on a different product: same name and number, or a similar set name.
  - The "alternatives" shown to the user are text neighbours, not look-alike images.
  - Final confidence is the maximum of the text and vision scores, so a vision 0.9 can auto-accept whatever the text step picked. That is a silent-error risk.
- **F6. Printing is never determined from the image.** For Pokémon, holo, reverse holo, 1st Edition and Unlimited share one product image in the TCGplayer data model. The hash therefore cannot separate them, and `pickVariant` silently picks the default, which risks a price error.
  - One Piece parallels are separate products with their own images, so they are at least visually addressable.
- **F7. Throughput risk.** Each photo runs about N × 8 Hamming calls; about 280k at 35k products. Each is a bit-by-bit BigInt loop of up to about 64 iterations, and every photo is also decoded in pure-JS Jimp.
  - Per-photo latency at full-catalog scale is unmeasured. It could reach seconds, which matters for 500-card batches processed inline per chunk.
  - Storing each hash as two 32-bit integers with a popcount, or a SIMD/native scan, would make it negligible.
- **F8. The index may be incomplete in production.** About 34.7k product images against a CDN that 403s after about 30k fetches means some cards may never be hashed. Failures are only logged. Reference images are not cached in our own bucket, so every rebuild refetches.
- **F9. Japanese cards cannot resolve to the right printing** because category 85 is not imported. The best case is the English printing with the same art, which gives a wrong price and language.
- **F10. The local results (500/500, "5/6 and 6/6") say little about field accuracy.** The test images are catalog art, upscaled or composited. None is a real phone or scanner capture of a physical card.

What this means for the client's own test: their inputs were **scanner** files. Scanner images are the easiest real-world case: uniform light, no perspective, often auto-cropped by the scanner software. With the full One Piece catalog now hashed, many of those 15 cards may match. Cards whose parallel or alternate art resembles the base art, and any image with a big scanner-bed margin, remain at risk from F1, F3 and F5.

### Gaps
- Full-catalog per-photo latency in production and the actual index coverage on Railway (hashed vs. cards) were not measured; the brief forbids running the app.
- The image files behind the "One Piece 5/6, Pokémon 6/6" degraded-photo test are not in `test-cards/`, so how degraded they were is unknown.
- Whether the client's scanner auto-crops to the card, and at what DPI, is unknown. Their 15 files are not in the repo.
- Whether Jimp applies EXIF orientation on the server when a JPEG is passed through un-shrunk (`app.ts` L1925 path) was not verified.

---

## 2. Which approaches work best in practice, and how does each cope with glare, holo foil, sleeves, rotation and perspective, partial crops and multi-card photos?

### Takeaway
The approach that works in current systems is a pipeline. First **localise and rectify each card** with an oriented detector or quadrilateral plus homography. Then **retrieve the top-k candidates with a global image embedding**; best results come from a model fine-tuned with a metric loss on reference images plus synthetic glare and perspective augmentation. Finally, **re-rank or verify** with the printed code or number (OCR or a vision-LLM) and, where art is ambiguous, with local-feature geometric checks.

Perceptual hashing is a legitimate fast tier *only after* good rectification (ManaMesh). Brute-force ORB across the whole catalog is too slow and fails on blur. Generic, un-tuned embeddings leave a gap on real photos: the best published real-photo Pokémon result is 85% top-1 but 96% top-5, which is why a candidate picker is mandatory.

### Cited Findings
**Deep embeddings plus retrieval**
- **TCG-AR (arXiv, Jul 2026)** is the most relevant public evaluation:
  - Pokémon, **20,360 distinct cards**, identified "by retrieval against per-card reference embeddings so the label set can grow without retraining".
  - Model: ResNet-50 with an ArcFace head (512-d, s=30, m=0.50), trained on reference images from the Pokémon TCG API.
  - Synthetic augmentations: localized lighting and saturated highlights imitating spotlights (p=0.33), global saturation changes (0.10), additive and impulse noise (0.20), and perspective warp of the corners (0.20). Crops are 224×224.
  - [TCG-AR](https://arxiv.org/html/2607.02090v1)
- TCG-AR results:
  - Synthetic test: top-1 97.0%, top-5 99.5%.
  - **Real footage, open set over all 20,360 cards: top-1 85.1%, top-5 96.2%.**
  - With candidates restricted to a deck list (631 unique cards): top-1 96.4%, top-5 99.2%.
  - A triplet-loss head reached only 1.7% top-1 on real images, i.e. poor transfer.
  - "75% [of top-1 errors] still place the correct card within the top five".
  - The main confusions are different prints of the same creature, or cards sharing a frame.
  - [TCG-AR](https://arxiv.org/html/2607.02090v1)
- TCG-AR hardware and detection:
  - Identification ran at 53–55 FPS on an RTX 2080 Ti GPU and **1.2–1.3 FPS on CPU** (Ryzen 5 3600X). Oriented R-CNN detection ran at 14 FPS on GPU and 0.6 FPS on CPU for 14-card boards.
  - Detection mAP was 0.90 on 832 real annotated instances.
  - The setting is overhead cameras at a play table, i.e. small, distant cards. That is harder than a close-up phone photo or a scan.
  - [TCG-AR](https://arxiv.org/html/2607.02090v1)
- **ILIAS (CVPR 2025)**, a benchmark of instance-level retrieval with foundation models (1,000 object instances, 100M distractors), found:
  - (i) domain-fine-tuned models excel in their domain but fail on ILIAS;
  - (ii) a linear adaptation layer trained with multi-domain supervision improves results, especially for vision-language models;
  - (iii) "local descriptors in retrieval re-ranking are still a key ingredient, especially in the presence of severe background clutter".
  - [ILIAS, arXiv 2502.11748](https://arxiv.org/abs/2502.11748)
- Hobby Pokémon projects using this pattern:
  - One uses YOLOv8 detection, then CLIP embeddings in a FAISS index (about 20,000 cards), with OCR of the card name as "a sanity check on candidate filenames". No accuracy numbers are published. — [ShreyShingala/Pokemon-Card-Scanning-Webapp](https://github.com/ShreyShingala/Pokemon-Card-Scanning-Webapp)
  - PokéDINO localises cards with YOLO11s-OBB plus test-time augmentation, rectifies perspective to 630×448, snaps edges, then runs a blur/glare/exposure quality gate and CLAHE normalisation. It uses DINOv2 ViT-B/14 for condition anomaly inspection, not identification. No accuracy numbers. — [PokeDino](https://github.com/Lilith-E/PokeDino)

**Perceptual hashing**
- ManaMesh (MTG) uses 256-bit fingerprints of card **artwork**, with perspective correction of the clicked region, hashing in both orientations plus minor shifts, and a single matrix-multiply lookup.
  - About **10 ms per scan**, an index of about 5–10 MB for every distinct MTG artwork, and a match threshold of 78 of 256 bits.
  - "Why not feature matching (ORB)? It was tried first: it needs a comparison against every card per scan (over a minute for the full database)", and it gave "confident wrong answers on blurry input".
  - [ManaMesh](https://github.com/KarimLeexz/ManaMesh)
- Hash indexes are still maintained for hobby MTG scanners, e.g. a daily-updated perceptual art-hash index published as SQLite. — [mtg-scanner-art-index](https://github.com/neotoxicfr/mtg-scanner-art-index)
- Older source (2020): hashing breaks when segmentation includes too much or too little border. — [tmikonen](https://tmikonen.github.io/quantitatively/2020-01-01-magic-card-detector/)

**Reading the printed code or number (OCR / vision-LLM)**
- Haki (One Piece) describes "AI image recognition plus an OCR fallback that reads the card code", useful "for worn cards and odd lighting". This is a competitor-authored blog, Aug 6, 2026. — [Haki blog](https://hakitcg.com/blog/best-one-piece-card-scanner-apps-2026)
- Bounty (One Piece) "combines printed ID with artwork recognition". Codes follow OP/ST/EB/PRB/P formats such as OP07-119, EB02-014 and P-045. — [Bounty set-codes guide (updated Aug 23, 2026)](https://www.bountytcg.app/en/blog/one-piece-tcg-set-codes-explained)
- RocketVault (sports) uses OCR + Gemini Vision. — [local report: carduploader-competitive-research-report.md L203](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)
- Vision-LLM cost inputs:
  - Gemini 2.5 Flash-Lite charges $0.10 per 1M input tokens for text/image and $0.40 per 1M output tokens; batch mode is $0.05 / $0.20. — [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
  - An image costs "258 tokens if both dimensions <= 384 pixels. Larger images are tiled into 768x768 pixel tiles, each costing 258 tokens"; a 960×540 image works out to 1,548 tokens. — [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)

**Multi-card photos and detection**
- Ximilar's TCG endpoint has `analyze_all`, which will "analyze all cards visible in the image". — [Ximilar docs](https://docs.ximilar.com/collectibles/recognition)
- CardSight's API examples show multi-card detection. — [CardSight for developers](https://cardsight.ai/for-developers)
- Oriented detectors reach 0.90 mAP on real multi-card boards (TCG-AR, above). CardUploader has a "binder-crop" path that splits multi-card photos. — [local report: carduploader-logged-in-teardown.md L56](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-logged-in-teardown.md)

**Hard conditions**
- Commercial apps drop "20 to 30 percentage points" on sleeved-and-toploader cards and "10 to 20" on vintage cards. Holo glare is a named failure mode. These are eyeball ranges from a site with its own scanner. — [HobbyCardIndex (May 18, 2026)](https://hobbycardindex.com/hubs/pokemon-card-scanners/)
- "Glare from plastic can make a reverse holo pattern or small promotional stamp look like a reflection instead of a printed feature." (app vendor) — [LensApp](https://lensapp.io/card-scanner/pokemon-card-variants/)
- "Reflective sleeves, partial images and similar parallel artwork can produce an incorrect match" (One Piece scanner guidance). This was seen only in a search-result summary of One Piece scanner pages; exact page not confirmed. — [tcgapp.io One Piece identify guide](https://tcgapp.io/identify-one-piece-card-set-and-number/)

### Inferences
How each approach copes with each condition. The ratings are synthesis from the evidence above, not measurements.

| Approach | Clean scan / catalog-like | Phone on table (background) | Rotation / perspective | Glare / holo foil | Sleeve / toploader | Partial crop | Look-alike art (same frame) | CPU cost per card |
|---|---|---|---|---|---|---|---|---|
| Global pHash/dHash (ours: 64-bit, whole frame) | Good | Poor without crop | Poor (not invariant) | Fair–poor | Poor | Poor | Poor | Tiny (if popcount is native) |
| Hash after detect + rectify + orientation tries (ManaMesh-style, 256-bit art hash) | Very good | Good | Good | Fair | Fair | Poor | Fair | Tiny (~10 ms per scan reported) |
| ORB/SIFT/AKAZE + RANSAC against the whole catalog | Good | Good | Very good | Fair | Fair | Good (local) | Good | Prohibitive at 35k (">1 min" reported) |
| Local features as a **re-ranker on top-k** | Good | Good | Very good | Fair | Fair | Good | **Best at separating near-duplicate art** | Moderate (k pairs only) |
| Generic embedding (CLIP/SigLIP/DINOv2, no fine-tune) | Good | Fair–good after crop | Fair (needs rectification) | Fair | Fair | Fair | Fair | ~0.1–0.3 s |
| Fine-tuned metric embedding (ArcFace + synthetic glare/perspective) | Very good | Good (85% top-1 / 96% top-5 open set on real Pokémon footage) | Good | Good | Fair–good | Fair | Fair (main residual error) | Same as generic |
| OCR / VLM of printed code or number | n/a (verifier) | Good if in focus | Good | Fair (glare on number box) | Fair | Fails if the number is cropped | **Decisive for One Piece** (code narrows to base + parallels) | OCR: small; VLM: ~$0.0002 per card |

- **Best practical design for us: a hybrid.**
  1. Detect and rectify each card, and try 0°/180° orientation.
  2. Take the top 20–50 candidates by embedding, or by a stronger art hash as an interim step.
  3. Apply the batch's game filter and Advanced Matching set priors. TCG-AR's jump from 85% to 96% top-1 when the candidate list was restricted shows how much priors help.
  4. Read the collector code or number and treat it as a hard filter or strong boost. One Piece codes like `OP11-117` are printed clearly.
  5. Use a local-feature inlier count to break ties among look-alikes.
  6. Output the top-5 to a picker whenever confidence is not decisive.
- **Card localisation and rectification is the single most important missing step** for every approach, including the current hash.
- **For One Piece, reading the code is disproportionately valuable.** Code plus a visual pick among the few printings sharing that code (base, parallel, SP, manga, promo reprint) is a very small classification problem.
- A **vision-LLM** can read name, code and number robustly from a rectified crop at a trivial cost per card, but its output must be validated against the catalog. Accept only codes that exist in the candidate set, never free text.

### Gaps
- No public head-to-head of DINOv2 vs SigLIP vs CLIP on **trading-card** photos was found. ILIAS covers generic objects; exact ILIAS numbers were not retrievable (403/404 on the paper HTML/PDF).
- There is no published accuracy for hash-based Pokémon or One Piece scanners on real phone photos. ManaMesh gives speed and threshold but not accuracy.
- No measured OCR accuracy (Tesseract/PaddleOCR) on small Pokémon collector numbers in phone photos was found.
- TCG-AR's CPU FPS figure is ambiguous (per card vs. per multi-card frame).

---

## 3. How can look-alike printings be told apart, and which cases need a human pick?

### Takeaway
Separability depends on whether the catalog gives the look-alike its **own image**.
- **One Piece parallels, alternate arts and manga rares** are separate TCGplayer products with different art. The shared card number narrows them to a handful, and image matching picks among them. That makes them realistically automatable.
- **Pokémon holo / reverse holo / non-holo and 1st Edition / Unlimited** are price sub-types sharing **one** image. They need a dedicated finish or stamp detector on a sharp, glare-free image, or a human pick.
- **English vs Japanese** is easy to see but impossible for us today, because no Japanese catalog is loaded.
- **Stamped promos and identical-art reprints** should default to human confirmation.

### Cited Findings
- **One Piece numbering.** "An alternate art keeps the card number of the original." To know which printing, "check the rarity code and parallel marker". "Japanese and English printings of the same number are priced independently." — [Bounty (Aug 23, 2026)](https://www.bountytcg.app/en/blog/one-piece-tcg-set-codes-explained)
- **One Piece specialist catalogs.** Haki's catalog is "print-aware", with Foil, Pirate Foil, Jolly Roger Foil and alternate-art versions as separate cards, and tracks -v1/-v2 parallels as separate entries. The same author says the TCGplayer app's "accuracy on alt arts and parallels varies" and Collectr's One Piece variant handling "is less granular". Competitor-authored. — [Haki blog (Aug 6, 2026)](https://hakitcg.com/blog/best-one-piece-card-scanner-apps-2026)
- **Our catalog.** One Piece parallels are separate cards (name suffix "(Parallel)"), while Pokémon finishes are variants of one card. — [our code: catalog-import.ts L19-23](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/catalog-import.ts). The finish sub-types synced include normal, holofoil, reverse holofoil, 1st edition (normal / holofoil), unlimited (holofoil), foil and etched. — [our code: sync-tcgcsv.ts L45-57](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/scripts/sync-tcgcsv.ts)
- **Pokémon finish cues.** Holo: "Only the artwork window is foil"; reverse holo: foil on "the card body, text box, and border" while "the artwork stays matte". The tilt test: if only the picture window flashes it is a holo; if the body flashes it is a reverse holo. — [TCG MasterSet guide](https://tcgmasterset.app/guides/reverse-holo-vs-holo)
- **Photo limits on variants (app vendor).**
  - "Sleeves, top loaders, glare, and low-resolution marketplace photos can make holo vs reverse holo look wrong."
  - "A scanner may identify the correct card and set but still need a human check for subtle foil pattern differences."
  - Scanners can help spot "prerelease, staff, set-logo, or event stamps", but glare can make a small promotional stamp look like a reflection.
  - [LensApp](https://lensapp.io/card-scanner/pokemon-card-variants/)
- **Measured variant difficulty.**
  - Most scanners fall to "60-70%" on parallels and reverse holos despite 90%+ base accuracy. Secret and Special Illustration Rares are hardest because their "visual signature is mostly in the foil treatment". Japanese exclusives suffer from catalog completeness. These are eyeball ranges from an affiliated site. — [HobbyCardIndex](https://hobbycardindex.com/hubs/pokemon-card-scanners/)
  - Eyevo counts a scan as correct only if both card **and** variant are right ("reverse holo vs. regular matters — they can differ in price by 10x"). Its self-test reports Eyevo 96%, TCGplayer 82%, Pokellector 78%, "Card Scanner for TCG" 71%.
  - Caveat: the stated test was 20 cards, so a simple proportion can only be a multiple of 5%. The reported numbers do not fit the stated method. Treat them as marketing. — [Eyevo (Dec 25, 2025; updated Aug 10, 2026)](https://eyevotcg.com/blog/best-pokemon-card-scanner-apps-2026/)
- **CardUploader's choice.** "We do not store stamped, first edition, holo, or reverse holo versions of cards in the database to reduce mismatches and improve identification accuracy." Variants are only title labels. — [local report: carduploader-competitive-research-report.md L70](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)
- **Commercial APIs expose some signals.** Ximilar returns a `Foil/Holo` tag, distinguishes Latin-alphabet languages with `"lang": true`, and "for some TCGs" identifies Korean, Thai, Japanese and Chinese variants. — [Ximilar docs](https://docs.ximilar.com/collectibles/recognition). CardSight reports the printed language across eight languages. — [CardSight press release](https://www.mycarrollcountynews.com/online_features/press_releases/article_80681662-a99c-510c-b2db-e055d2d8c7a8.html)
- **1st Edition stamp location.** On the WOTC-era test image, the 1st Edition stamp is a small mark left of the flavour bar under the art box. It is a few percent of card width (inspected visually). — [test image](C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/phone/01.jpg)
- Japanese Pokémon (TCGplayer category 85) is not imported. — [our code: sync-tcgcsv.ts L35-41](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/scripts/sync-tcgcsv.ts)

### Inferences
Feasibility by case, for our stack:

| Case | Same catalog image? | Automatable? | How |
|---|---|---|---|
| One Piece base vs Parallel / Alt Art / Manga / SP (same number) | No, separate products | **Yes, high** | Read code, restrict to the printings with that code, then visual similarity / local features |
| One Piece same art, different treatment (e.g. foil types, pre-release stamps, reprint in a later set) | Often near-identical art | Partly | Code or set prefix via OCR; stamp region check; else human pick |
| Pokémon holo vs reverse holo vs non-holo (same number) | **Yes, one image** | Partly | A foil-location classifier (art window vs body) on a rectified, glare-free image. Flatbed scans help, sleeves and glare hurt. Until built: auto-select only when the product has one finish, else ask |
| Pokémon 1st Edition vs Unlimited (WOTC) | Yes, one image | Partly | Stamp detector on a high-resolution crop; unreliable in sleeves or low-resolution phone shots |
| Shadowless vs Unlimited (Base Set) | Unknown (see Gaps) | Weak | Subtle art-box shadow; human pick |
| English vs Japanese | Separate products, but JP not loaded | Not today | Load JP catalogs; script detection via OCR/VLM is easy |
| Stamped promos (prerelease, staff, league, Pokémon Center, set-logo reprints) | Often separate products; stamp small | Partly | Stamp-region check plus a human confirm |
| Secret / Special Illustration / textured full arts vs. regular full arts | Separate products | Mostly | Visual and number (numbers above set total) |

- **Realistically needing a human pick:**
  - finish on multi-finish Pokémon products shot in sleeves, toploaders or under glare;
  - 1st Edition vs Unlimited from phone photos;
  - identical-art reprints that differ only by a tiny stamp or set symbol;
  - Shadowless;
  - anything Japanese until the JP catalog exists.
- The UI should make these a one-tap choice, as chips on the matched card, rather than a search.
- Our variant-level catalog is a genuine differentiator: CardUploader collapses variants on purpose. It only pays off if the UI asks the finish question instead of silently defaulting (F6).

### Gaps
- Whether TCGplayer's images for 1st Edition vs Unlimited, or for stamped products, actually show the stamp, and whether "Shadowless" is a separate TCGplayer group with its own images, was not verified.
- No public accuracy data for automatic foil-location classifiers on Pokémon cards was found.
- How many One Piece parallels in TCGCSV have placeholder or low-quality images was not checked.

---

## 4. Which commercial recognition APIs exist, with supported games, accuracy claims, latency and price per call?

### Takeaway
Two developer-facing APIs cover **both Pokémon and One Piece** today: **Ximilar** (10 credits per TCG identification, about $0.007 per card on the $69 plan) and **CardSight AI** ($0.002–$0.003 per call on paid tiers, 750 free calls per month). Both claim multi-card detection, alternatives and language handling. Both publish only **self-reported** accuracy (Ximilar "~99%" per our earlier report; CardSight "99.5% mAP"). No independent audit was found. Either could plug into our existing `http` / `ximilar` provider seam after modest mapping work.

### Cited Findings
**Ximilar**
- The endpoint is `/v2/tcg_id`. It covers "cards from over 15 games, including Pokémon, Yu-Gi-Oh!, Magic: The Gathering, One Piece, and Lorcana".
  - Returns: name, year, set, set_code, series, card_number, rarity, full_name, colour/type, and links to tcgplayer.com, ebay.com and scryfall.com.
  - Also: an `alternatives` array with `distances`, `analyze_all` for multiple cards in one image, a `Foil/Holo` tag, and `"lang": true` for Latin-alphabet languages.
  - [Ximilar docs](https://docs.ximilar.com/collectibles/recognition)
- Pricing as extracted on 2026-09-28:
  - Plans: Free $0 / 1,000 credits; Business 100K $69; 300K $199; 500K $329; Professional 1M $579 … 5M $2,299.
  - "Identify a TCG card" costs **10 credits**; "Grade a card" costs 100.
  - Credit packs were extracted as 10k = $11, 100k = $189, 1M = $1,209. These per-credit figures look internally inconsistent, so re-check on the page.
  - Monthly credits expire; packs do not.
  - [Ximilar pricing](https://www.ximilar.com/pricing/)
- Latency: "usually takes a second to process". Supports Pokémon (English, Japanese, Chinese), MTG, YGO, DBS, FaB, One Piece and Lorcana. Returns holo/foil status, language and front/back. This page dates from July 27, 2023, so it is older. — [Ximilar blog](https://www.ximilar.com/blog/build-your-own-trading-card-game-identifier-with-our-api/)
- The collectibles page claims it can "scale to hundreds of requests per second", with recent additions such as Hololive and Duel Masters. No accuracy figure is shown there. — [Ximilar collectibles](https://www.ximilar.com/services/visual-ai-for-collectibles/)
- Our earlier research recorded Ximilar as "self-reported ~99% on MTG/Pokémon/YGO". I did not re-locate that figure on current Ximilar pages. — [local report: card-site-research-and-build-plan.md L289](C:/Users/johnn/Antigravity_Files/Card_reader/card-site-research-and-build-plan.md)

**CardSight AI**
- Tiers: Free, 750 calls per month; Pro $14.95 for 5,000 calls (overage $0.0030); Premium $74.95 for 30,000 ($0.0025); Ultra $199.95 for 100,000 ($0.0020); Enterprise custom. — [CardSight for developers](https://cardsight.ai/for-developers)
- Self-reported claims: "99.5% mAP accuracy", "< 300ms response time", a 99.9% uptime SLA, "15M+ trading cards", "Every parallel & variation", multi-card detection, slab handling, and "CardMagic" crop/deskew/dewarp. SDKs for Node.js, Python, Swift, Java and .NET. — [CardSight for developers](https://cardsight.ai/for-developers)
- One Piece support was added in July 2026. The same release describes CardSight as identifying over 12 million cards at 99.5% accuracy across baseball, football, basketball, hockey, Pokémon, MTG and One Piece. — [press release (EIN Presswire)](https://www.einpresswire.com/article/926413474/cardsight-ai-adds-one-piece-card-identification-trading-card-database-and-market-data-for-platforms). Japanese Pokémon and 8-language printed-language reporting were announced separately. — [press release](https://www.mycarrollcountynews.com/online_features/press_releases/article_80681662-a99c-510c-b2db-e055d2d8c7a8.html)

**Other options noted in earlier research**
- eBay Browse API `searchByImage` (matches active listings, useful as a hint) and PriceCharting's Photo Appraiser. — [local report: carduploader-competitive-research-report.md L257](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)
- Heystack, an identification vendor claiming a "98% match". — [local report L202](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)
- API TCG and OPTCG API are open **databases**, not recognisers. — [API TCG](https://www.apitcg.com/); [OPTCG API](https://optcg-api.ryanmichaelhirst.us/)

**General-purpose vision-LLM for reading text on the card** (not a recogniser by itself)
- Gemini 2.5 Flash-Lite charges $0.10 per 1M image-input tokens; images are 258 tokens per 768 px tile. — [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing); [Gemini image docs](https://ai.google.dev/gemini-api/docs/image-understanding)

**Our integration point**
- `VISION_PROVIDER=ximilar` already exists: a POST of base64 JSON with dot-path mapping of name, number and set. Today it keeps only the first result and reduces it to text. — [our code: vision.ts L174-285](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/vision.ts)

### Inferences
- **Cost per 500-card batch** (derived from the published rates):
  - Ximilar: 5,000 credits, about $3.45 on the $69 plan. That plan covers 10,000 cards per month; the free tier gives 100 IDs per month.
  - CardSight: about $1.00–1.50 on paid tiers; the free tier gives 750 calls per month.
  - Gemini Flash-Lite as a code or number reader only: about $0.10. A 1143×1600 photo is 6 tiles × 258 = 1,548 tokens, about $0.00016 input plus a few output tokens. A ≤384 px crop of the number strip costs about $0.00003.
- **Integration work** to use a vendor properly:
  - map the vendor's TCGplayer link or ID straight to our `tcgplayer_product_id`, not through the text matcher;
  - keep the vendor's `alternatives` for the picker;
  - map `Foil/Holo` to our finish;
  - send each detected card crop or use `analyze_all`;
  - log vendor answers plus user confirmations as training data.
- Vendor accuracy claims are not comparable to each other. "mAP" is a ranking metric, not top-1, and neither vendor discloses a test set. The only credible comparison is **our own golden set** (Q7). Both free tiers are large enough to run a 100–750-card evaluation at no cost.

### Gaps
- No independent third-party accuracy tests of Ximilar or CardSight on Pokémon or One Piece were found.
- Neither vendor's terms on caching results, storing their IDs, or building a competing catalog were reviewed.
- Per-call latency under batch load, rate limits and data-retention policies were not verified.
- Whether Ximilar's One Piece coverage distinguishes parallels that share a number is not documented.

---

## 5. What do competitors use or claim (CardUploader, TCGplayer's scanner, Collectr, CollX, the eBay app)?

### Takeaway
Every major competitor frames identification as **image recognition against its own catalog, with a candidate list or confidence for human correction**. None publishes an audited accuracy figure.
- CardUploader claims >95% on standard English and Japanese Pokémon and deliberately collapses finish variants to avoid mismatches.
- TCGplayer's Scan & Identify runs on its Roca Vision sorter technology and shows confidence levels.
- Independent-ish tests put modern English Pokémon at about 85–95% card-level across apps, falling to about 60–70% on parallels and reverse holos and losing 20–30 points in toploaders.

### Cited Findings
**CardUploader** (the client's benchmark)
- Its "AI is image matching, not OCR/LLM", claiming ">95% accuracy for standard English & Japanese Pokémon". The results UI shows a per-card **confidence %**, `alternativeMatches` and an "Alternative Match Comparison" view. A binder-crop path detects multiple cards. — [local report: carduploader-competitive-research-report.md L27, L79](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)
- It describes a proprietary model "trained on hundreds of thousands of Pokemon cards". Its Terms also name OCR, autocrop and condition-assessment models. — [local report L148](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md); [local report: carduploader-data-sourcing-research.md L122](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-data-sourcing-research.md)
- There is an "Auto Crop for Phone Images" option; the walkthrough says "this Charizard got automatically cropped and it's going to match easier to our database". — [local report: data-sourcing L122](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-data-sourcing-research.md). In the Sept 14 video the client leaves Auto Crop unchecked. — [local report: client-video plan L85](C:/Users/johnn/Antigravity_Files/Card_reader/client-video-2026-09-14-asks-and-plan.md)
- Variants are collapsed "to reduce mismatches". — [local report L70](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)
- The claim that CardUploader uses CLIP + pgvector on Supabase is our own **plausible-fit inference**, marked unproven. — [local report: data-sourcing L123](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-data-sourcing-research.md)
- Throughput: identification is a background job queue. A May 2026 user was "~26th in a processing queue after ~500 of 5,000 cards". — [local report: carduploader-upload-limits-research.md L36](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-upload-limits-research.md)

**TCGplayer**
- Scan & Identify "is powered by Roca Vision, the same computer vision technology that powers Roca Sorters". It differentiates itself "by indicating confidence levels in card identification, allowing users to focus quality control efforts on cards more likely to be incorrect". Search-result excerpt; the page returned 403 on fetch. — [TCGplayer Help: How Scan & Identify Technology Works](https://help.tcgplayer.com/hc/en-us/articles/27303183354007-How-Scan-Identify-Technology-Works)
- The TCGplayer app got "a new scanning engine that significantly improves the speed and accuracy". It "now scans every TCG available on TCGplayer". The seller blog is dated May 15, 2025; a search summary said August 5, 2025, which conflicts. No accuracy figures. — [TCGplayer seller blog](https://seller.tcgplayer.com/blog/tcgplayer-mobile-app-update)
- The Roca Sifter hardware costs $799 + $25/month, with "up to 1,800 cards/hr" (vendor spec) and foil detection. — [local report L204](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)

**Collectr**
- Claims "Collectr identifies the exact set, number and variant" and "Normal, Foil or Reverse Foil, Collectr matches the precise printing". Covers Pokémon, Magic, YGO, One Piece, Lorcana, FaB, Digimon "+18 more". — [Collectr scan page](https://getcollectr.com/scan)

**CollX**
- Search excerpts, pages not fetched:
  - "visual search technology… matches against a database of 20+ million cards", with deep-learning models from a team with "10+ years" in image recognition (App Store listing). — [CollX App Store](https://apps.apple.com/us/app/collx-sports-card-scanner/id1581164444)
  - It scans front and back with "95 percent accuracy" (local TV coverage). — [local3news](https://www.local3news.com/local-news/what-the-tech-collx-the-ultimate-smartphone-app-for-card-collectors/article_e29128ba-3d61-11ef-8635-57cecd32b7d6.html)

**eBay app**
- Point the camera at a card and "a list of possible matches will pop up"; sellers tap the correct or closest match. Uses "computer vision technology". MTG launched in April 2021, with Pokémon and YGO in May 2021. Older source (2021). — [eBay Inc. (Mar 24, 2021)](https://www.ebayinc.com/stories/news/new-ebay-scanning-tool-to-cut-listing-time-in-half-for-trading-card-sellers/)
- A 2026 tester rates the eBay scanner "Variable", with no parallel detection ("returns active listings"). — [HobbyCardIndex](https://hobbycardindex.com/hubs/pokemon-card-scanners/)

**Cross-app test (HobbyCardIndex, May 18, 2026)**
- Method: 200 modern English Pokémon cards, household lighting, **sleeved**, camera 6–10 inches away, free tiers.
- Card-level results: Collectr ~90–95%, TCGplayer ~85–92%, Ludex ~88–93%, HCI ~88–93%, Card Dealer Pro ~85–90%, Pokellector ~80–88%.
- Parallels: "60-70%". Vintage: −10–20 points. Toploaders: −20–30 points.
- Caveats: "Numbers are eyeball ranges, not formal benchmarks", and the site has its own scanner.
- [HobbyCardIndex](https://hobbycardindex.com/hubs/pokemon-card-scanners/)

**One Piece specialists**
- Haki claims recognition "in under a second" plus an OCR fallback on the card code (competitor-authored). — [Haki blog](https://hakitcg.com/blog/best-one-piece-card-scanner-apps-2026)
- Bounty uses "printed ID with artwork recognition". — [Bounty](https://www.bountytcg.app/en/blog/one-piece-tcg-set-codes-explained)

### Inferences
- The competitive bar for a *seller* tool is about **90–95% card-level top-1** on clean English captures, with a fast correction path. Variant-level accuracy is where everyone is weaker, at about 60–80%.
- CardUploader side-steps variant errors by not modelling variants. We model them, so we must at least *ask* about the finish.
- The client's benchmark is CardUploader on **scanner** images of One Piece. That is arguably easier than the phone-in-sleeve Pokémon tests above, but CardUploader's accuracy claim is scoped to Pokémon, so its One Piece accuracy is unknown.
- Several competitors pair image matching with printed-code reading (Haki, Bounty, CardUploader's Terms naming OCR). That supports the hybrid in Q2.

### Gaps
- The local notes do not record whether CardUploader got all 15 of the client's One Piece scans right in the Sept 14 video.
- No engineering blog or teardown was found describing the model architectures of TCGplayer (Roca Vision), Collectr or CollX.
- The TCGplayer help-center articles were not fetchable (403); only excerpts were seen.

---

## 6. What is feasible on a CPU-only Railway container (latency, RAM, index size, batch throughput, monthly cost) versus an external API, and what path should we take?

### Takeaway
A self-hosted pipeline fits comfortably on Railway CPU:
- **Embedding index:** about 27–110 MB for about 35k images, depending on dimensions and precision.
- **Per-card compute:** about 0.1–0.3 s for a ViT-B/32-class embedding on 2 vCPU.
- **Cost:** tens of dollars a month, dominated by resident RAM.

The real cost is engineering time and building a real-photo test set. An external API costs about $0.002–0.007 per card, needs little engineering, and can be evaluated this week on free tiers.

**Recommended path:** (0) build a real golden set and benchmark the current hash, Ximilar, CardSight and CardUploader on it now. (1) Fix the pipeline flaws that hurt every engine: crop and rectify, keep the visual ID, top-k picker, code/number reading, finish chooser. (2) Ship whichever engine clears the bar, likely a vendor first, while building a self-hosted embedding tier with our own confirmed matches as training data.

### Cited Findings
- **Railway pricing:** $20 per vCPU per month ($0.000463 per vCPU-minute) and $10 per GB RAM per month ($0.000231 per GB-minute), billed on usage. Egress is $0.05/GB and volumes $0.15/GB/month.
  - Hobby includes $5 of usage, with ceilings of 48 vCPU / 48 GB; Pro includes $20, up to 1,000 vCPU / 1 TB.
  - The plans page mentions no GPU offering.
  - [Railway docs: pricing plans](https://docs.railway.com/pricing/plans)
- **Embedding CPU latency (older benchmarks):**
  - CLIP ViT-B/32 image encoder on a 2-core Colab Xeon @ 2.3 GHz: batch 2 took 0.234 and batch 64 took 7.944. The units are printed as "ms" but are almost certainly **seconds**, i.e. about 0.12 s per image. ONNX Runtime is slightly faster than PyTorch at small batches. — [CLIP-ONNX benchmark](https://github.com/Lednik7/CLIP-ONNX/blob/main/benchmark.md)
  - Another ONNX Runtime export reports 95 ms CPU latency for ViT-B/32. Search-result excerpt; hardware not verified. — [akorobeinikov/CLIP-VIT-B-32](https://github.com/akorobeinikov/CLIP-VIT-B-32/blob/main/README.md)
- **CPU vs GPU on a card-ID model:** identification ran at 1.2–1.3 FPS on a Ryzen 5 3600X CPU vs 53–55 FPS on a 2080 Ti. Oriented R-CNN detection ran at 0.6 FPS on CPU vs 14 FPS on GPU for 14-card boards. A heavy detector is the CPU bottleneck. — [TCG-AR](https://arxiv.org/html/2607.02090v1)
- **Hash-scale reference:** a 256-bit art-hash lookup over every MTG artwork takes about 10 ms in a single matrix multiply, with an index of about 5–10 MB. — [ManaMesh](https://github.com/KarimLeexz/ManaMesh)
- **pgvector v0.8.6:**
  - Storage per vector: `vector` is 4·d + 8 bytes, `halfvec` is 2·d + 8 bytes, `bit` is d/8 + 8 bytes.
  - HNSW and IVFFlat index up to 2,000 dimensions for `vector` and 4,000 for `halfvec`. HNSW defaults are m = 16, ef_construction = 64, ef_search = 40.
  - "By default, pgvector performs exact nearest neighbor search, which provides perfect recall." Binary quantization with re-ranking is supported.
  - [pgvector](https://github.com/pgvector/pgvector)
- **Vendor latency and price:** Ximilar "usually takes a second" at about $0.0069 per ID on the $69 plan; CardSight "< 300ms" at $0.002–0.003 per call. — [Ximilar blog](https://www.ximilar.com/blog/build-your-own-trading-card-game-identifier-with-our-api/); [Ximilar pricing](https://www.ximilar.com/pricing/); [CardSight](https://cardsight.ai/for-developers)
- **Current throughput reference:** 500 distinct cards at 1600 px took 2.2 minutes end to end locally. Identification runs inline per chunk, whereas CardUploader uses a background job with 2 s polling. — [local report: carduploader-upload-limits-research.md L46-50](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-upload-limits-research.md)
- **Production database access:** the prod DB is internal-only, and `railway run` cannot reach it from a laptop. That is why the hash index is built at server boot. — [our code: hashindex.ts L4-10](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/hashindex.ts)
- **Reference image source:** reference images come from TCGplayer's CDN at 200 px, with a 400 px URL derived. — [our code: catalog-import.ts L79-83](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/catalog-import.ts). The brief notes a 403 after about 30k fetches.

### Inferences
**Index size.** Arithmetic from the pgvector formulas, for about 35,000 product images:
- 384-d halfvec (ViT-S class): about 27 MB.
- 512-d float (CLIP-B/32): about 72 MB.
- 768-d halfvec: about 54 MB; 768-d float: about 108 MB.
- At 50,000 images, multiply by about 1.43. If each card is also indexed with 3–5 augmented reference views, multiply again.
- **Exact (brute-force) search is fine at this size.** 35k × 768 multiply-adds is about 27M per query, milliseconds in native code, so an HNSW index is optional. Vectors can also sit in process memory as a Float32Array.

**RAM.** Model weights are about 90–350 MB (ViT-S to ViT-B class, FP32; INT8 about 4× smaller), plus the vectors, plus image decoding. A 1.5–2 GB worker is comfortable. That is about **$15–20 per month** of Railway RAM if resident 24/7.

**Per-card latency on 2 vCPU** (estimate, not measured):
- decode and shrink: tens of ms with a native decoder; pure-JS Jimp is slower;
- detect and rectify: classical contour/quad about 50–150 ms, a YOLO-nano-class ONNX model about 100–300 ms;
- embed: about 0.1–0.3 s;
- exact search: under 10 ms;
- re-rank top-k with local features: about 0.2–1 s if done for every card;
- total: **about 0.5–1.5 s per card.**

**Batch throughput.** A 500-card batch is about 4–12 minutes on one 2-vCPU worker, or about 1–3 minutes across 4–8 vCPU with a background job queue and progress bar. CPU cost for 500 cards is about 500 vCPU-seconds, about **$0.004**, so compute is effectively free. A vision-LLM number read adds about $0.10 per 500 cards and network latency, which can run concurrently.

**One-off reference build.** About 35k × ~0.15 s is about 1.5 hours on 2 vCPU. The binding constraint is fetching images under the CDN throttle.
- Fetch once and cache in our own S3 bucket, so rebuilds never refetch.
- Compute vectors offline and have the server import a vectors file at boot. That is the same workaround the hash index uses for the internal-only prod DB.

**Self-hosted vs API**, for a client scanning thousands of cards per month:

| | Self-hosted embedding hybrid | Ximilar | CardSight |
|---|---|---|---|
| Marginal cost per card | ≈ $0 (CPU) + optional ~$0.0002 VLM | ~$0.007 ($69 plan) / ~$0.011 (packs) | ~$0.002–0.003 |
| Fixed cost | ~$15–30/mo RAM; weeks of engineering | $69+/mo plan (free: 100 IDs/mo) | $14.95+/mo (free: 750 calls/mo) |
| Latency | ~0.5–1.5 s per card on 2 vCPU (parallelisable) | "usually a second" | "< 300ms" (claimed) |
| Accuracy | Unknown until built; published analogue: 85% top-1 / 96% top-5 on real Pokémon footage (harder setting) | Self-reported ~99% | Self-reported "99.5% mAP" |
| Control | Full: our variants, JP when loaded, our priors, learns from our corrections | Vendor catalog and IDs; variant granularity unclear | Vendor catalog; claims every parallel |
| Risk | Engineering effort; the model may underperform vendors initially | Vendor lock-in, per-call cost at scale, terms | Young vendor, terms not reviewed |

#### Recommended path
**Phase 0 (days; answers the go/no-go with evidence, costs ~$0)**
1. Get the client's real scan files, including the 15 from the video, plus about 100–300 more from their actual workflow. Build the golden set described in Q7.
2. Confirm production index coverage (hashed / cards) and make sure One Piece is fully hashed. Record any CDN 403 gaps.
3. Run the golden set through:
   - (a) the current hash matcher with the full catalog;
   - (b) Ximilar's free tier;
   - (c) CardSight's free tier;
   - (d) CardUploader, in the client's account.
4. Report card-level and variant-level top-1 and top-5 per stratum.

**Phase 1 (1–2 weeks; engine-independent fixes that raise every engine's accuracy)**
- Run card detection and quad rectification on **every** photo, including single-card mode and a single card on a flatbed bed. Normalise orientation by trying 0° and 180° (and 90° for landscape frames).
- Keep the visual `card_id` end to end instead of re-resolving by text. Return the **visual top-5** as alternatives. Never return zero candidates.
- Read the printed code or number from the rectified crop and use it as a filter or boost.
  - For One Piece, match `OP/ST/EB/PRB\d\d-\d\d\d` and `P-\d\d\d`.
  - Use OCR, or a vision-LLM whose answer is validated against the catalog.
- Add a finish chooser for multi-finish Pokémon products, auto-selecting only when a product has a single finish.
- Replace the BigInt Hamming loop with 32-bit popcounts. Move identification to a background job with progress.
- Cache reference images in S3.

**Phase 2 (decision point)**
- If a vendor clears the bar on the golden set (suggested: ≥95% card-level top-1 on the client's scanner images, ≥99% top-5), ship it behind the existing `http` provider:
  - map the vendor ID or link to our product ID;
  - keep alternatives and the foil tag;
  - send per-card crops.
- In parallel or instead, build the self-hosted tier:
  - a DINOv2-S / CLIP-B / SigLIP-B-class ONNX embedding on CPU;
  - exact search in pgvector `halfvec` or in memory;
  - local-feature re-rank for near ties;
  - then fine-tune an ArcFace head on reference images with synthetic glare, perspective and sleeve augmentation, plus confirmed review-queue matches (the TCG-AR recipe).
- Switch engines when ours matches the vendor on the golden set.

**Phase 3**
- A foil-location classifier (holo vs reverse holo).
- A 1st Edition stamp detector.
- The Japanese catalog (TCGplayer category 85).
- Capture guidance in the UI (flat, no sleeve, even light), since toploaders cost commercial apps 20–30 points.

Why this order: F1, F5 and F6 are the probable dominant errors, and they are independent of the recogniser. Cropping, keeping the visual top-k and asking for the finish improve the hash, a vendor or our own embedding equally. The client's go/no-go deserves a measured number on **their** images within days, not a model-building project first.

### Gaps
- No measured latency for DINOv2 ViT-S/14 or SigLIP on ONNX Runtime CPU was found. Estimates above are extrapolated from CLIP ViT-B/32 benchmarks on older hardware.
- Railway's CPU model and per-vCPU performance are undocumented in the pages read.
- Whether Railway enforces a request timeout that the inline per-chunk identification could hit was not checked.
- The exact TCGplayer CDN throttle behaviour (per-IP? per-day? reset?) is known only from the project brief.
- `onnxruntime-node` and native image decoders (e.g. sharp) are assumed to work on Railway's Linux images. Not verified in this pass.

---

## 7. How should accuracy be measured and surfaced (test-set design, top-1/top-5, confidence thresholds for auto-accept vs needs-review, candidate-picker UX)?

### Takeaway
Measure on a **real-capture golden set drawn from the client's workflow**: their scanner first, then phone, sleeve and binder captures. Stratify it by game, era, finish and look-alike class. Report card-level and variant-level top-1 and top-5, the auto-accept rate, and precision among auto-accepted cards. Pick the auto-accept threshold to hit about 99% precision, calibrated on that set, not on re-encoded catalog images. Everything below the threshold goes to a fast top-5 picker with finish chips. The published evidence (correct card in top-5 for about 75% of top-1 misses) makes the picker the main safety net.

### Cited Findings
- **Metrics used in the field:**
  - TCG-AR reports top-1 and top-5, synthetic vs real, and open-set vs restricted candidates, plus an error analysis (75% of top-1 errors fall in the top-5; confusions are same-creature prints and shared frames). — [TCG-AR](https://arxiv.org/html/2607.02090v1)
  - HobbyCardIndex logs "catalog match rate and parallel-detection rate separately" and calls its numbers "eyeball ranges". — [HobbyCardIndex](https://hobbycardindex.com/hubs/pokemon-card-scanners/)
  - Eyevo counts correct only if card **and** variant match. — [Eyevo](https://eyevotcg.com/blog/best-pokemon-card-scanner-apps-2026/)
- **Precedents for surfacing confidence:**
  - TCGplayer shows "confidence levels… allowing users to focus quality control efforts on cards more likely to be incorrect" (help-center excerpt). — [TCGplayer Help](https://help.tcgplayer.com/hc/en-us/articles/27303183354007-How-Scan-Identify-Technology-Works)
  - CardUploader shows a confidence % per card, alternatives and an "Alternative Match Comparison" view. — [local report L27](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)
  - eBay pops up "a list of possible matches" to tap. — [eBay Inc.](https://www.ebayinc.com/stories/news/new-ebay-scanning-tool-to-cut-listing-time-in-half-for-trading-card-sellers/)
  - RocketVault uses inline "attention chips" in review. — [local report L203](C:/Users/johnn/Antigravity_Files/Card_reader/carduploader-competitive-research-report.md)
- **Our current thresholds:**
  - Auto-match at ≥0.90 combined confidence, fail below a 0.5 best score. — [our code: identify.ts L56-57, L455-472](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/identify.ts)
  - Hash confidence is a step function of distance (≤10 → 0.90) with a near-tie cap of 0.70. — [our code: vision.ts L151-157](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/vision.ts)
  - Failed photo results become "needs_review". — [our code: server.ts L669-671](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/server.ts)
- **Why priors matter:** restricting candidates to a known list lifted real-photo top-1 from 85.1% to 96.4% in TCG-AR. That is the effect our "Advanced Matching Options" (prioritise or exclude sets) can exploit. — [TCG-AR](https://arxiv.org/html/2607.02090v1); [our code: src/app/matching.ts](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/matching.ts)
- **Ground-truth keys are available:** our cards carry `tcgplayer_product_id`, and finishes map from TCGCSV sub-types. — [our code: catalog-import.ts](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/app/catalog-import.ts); [our code: sync-tcgcsv.ts](C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/src/scripts/sync-tcgcsv.ts)

### Inferences
**Golden-set design** (recommended):
- **Sources, in priority order:**
  1. the client's own scanner output, at the same scanner, DPI and cropping settings;
  2. phone photos in good light, flat;
  3. phone photos through penny sleeves and toploaders;
  4. binder pages (3×3) and loose multi-card shots.
- Label each capture with (TCGplayer productId, finish, language) and the capture condition.
- **Size and strata:** about 300–500 physical cards, at least 50 per key stratum.
  - One Piece: base; parallel / alt art / manga / SP sharing a number; DON!!; promos (P-xxx); EB/PRB reprints.
  - Pokémon: modern SV; SWSH; WOTC vintage including 1st Edition vs Unlimited; multi-finish (normal / reverse / holo) of the same card; full art, SIR and IR; stamped promos; Japanese (expected fail until the JP catalog exists).
  - Precision: with 300 cards at about 90% accuracy, the 95% confidence interval is about ±3.4 points; per-stratum numbers at n = 50 are about ±8 points.
- **Keep it separate from training data:** never use golden-set images, or photos of the same physical copies, for fine-tuning. Refresh it quarterly with new sets.
- **Metrics per stratum and overall:**
  - card-level top-1 and top-5 (product);
  - variant-level top-1 (product + finish);
  - zero-candidate rate;
  - auto-accept rate (coverage);
  - precision among auto-accepted cards;
  - median and p95 seconds per card;
  - time-to-fix per review item.
  - Always run CardUploader on the same images as the client's reference point.
- **Thresholds:**
  - Build confidence from calibrated signals, not a fixed distance table:
    - top-1 similarity;
    - margin to the top-2 *different* product;
    - agreement of the OCR'd code or number;
    - local-feature inlier count;
    - set-prior agreement.
  - Pick the auto-accept cut-off where precision among auto-accepted cards is ≥99% on the golden set, and report the coverage it yields.
  - Card identity and finish get **separate** thresholds: auto-accept the card while flagging the finish when a product has several finishes and no finish evidence.
  - Re-calibrate whenever the engine, catalog or capture device changes.
- **Candidate-picker UX:**
  - Put the user's cropped photo beside the top-5 reference images at the same size, with name, set, number and rarity under each.
  - Finish chips on the chosen card (Normal / Holo / Reverse / 1st Ed.). Keyboard shortcuts 1–5 and Enter.
  - Order the review queue by confidence, lowest first, with a bulk "accept all ≥ threshold".
  - Show *why* a match was chosen ("code OP11-117 read", "set prioritised").
  - A "none of these" path into manual search.
  - Log every confirmation or correction as labelled data for fine-tuning; the opt-in logging already exists per the local plan.
- **Surface honestly to the client:** show a small accuracy panel per batch (auto-accepted n, needs review n, unmatched n) and a monthly golden-set score. The go/no-go should be judged on that score, not on anecdotes.

### Gaps
- No published standard for card-scanner evaluation exists. The strata and thresholds above are recommendations, not sourced benchmarks.
- The client's tolerance (e.g., is 95% top-1 plus a 5-second review per miss acceptable?) has not been stated and should be asked directly.
- There is no data yet on how our current matcher's confidence correlates with correctness on real captures, so current thresholds cannot be judged as over- or under-confident.
