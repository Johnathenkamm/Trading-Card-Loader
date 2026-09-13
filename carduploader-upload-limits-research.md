# CardUploader — how a 500-photo upload actually works (Sept 13, 2026)

**Question:** does carduploader.com have an upload limit, and how do they move 500 photos?
**Sources:** their own shipped JavaScript (the ~60 app chunks saved on Sept 3 in `C:\Users\johnn\Downloads\Carduploader_code`, read with grep; nothing was run or submitted) plus the live `/pricing` and `/terms` pages rendered on Sept 13. Everything below is first-hand from their code or pages (🟢F) unless marked.

## 1. The limits, by name

These constants ship in one module of their bundle (`2wgbgtla52zd9.js`, export id 351308) and are passed straight into the upload component as `maxFiles` / `maxCards`:

| Constant | Value | Where it applies |
|---|---|---|
| `MAX_UNGRADED_CARDS_PER_JOB` | **500** | Ungraded (List Cards) upload: cards per job |
| `MAX_UNGRADED_FILES_PER_JOB` | **1,000** | Same job: photos per job (500 cards × 2 images per card) |
| `getMaxPricingUngradedFiles(plan)` | **100 on "Free", 500 on any other plan** | The free Ungraded Pricing Tool |
| `MAX_LISTING_CREATOR_CARDS_PER_JOB` | 3,000 | Listing Creator (from database, no photos) |
| `MAX_PRICING_GRADED_CERTS_PER_JOB` | 200 | Graded pricing by cert number |
| Listing image settings | 6 | Extra branding images per listing (unrelated to card photos) |

So **500 cards per upload is exactly CardUploader's ceiling**, and it is a hard per-job cap enforced in the browser before anything is sent. The messages the user sees when they go over (verbatim from the bundle):

- "Maximum file limit is 1000 files. You can upload N more files."
- "Maximum file limit reached (1000 files). Remove some before uploading more."
- "Maximum card limit is 500 cards (1000 files at 2 images per card)."

The "images per card" selector (default 2, front + back) is what turns the file cap into the card cap: `ceil(files / imagesPerCard) > 500` is refused. With 1 image per card the effective cap is still 500 cards.

**There is no cap on the number of jobs.** The Unlimited plan ($9.99/mo) is "no credits, no caps" for processing, subject to a fair-use policy (Terms, updated April 13, 2026): "no fixed cap on the number of cards you may process", but scripted/bot submission, account sharing and reselling are prohibited, and they "may temporarily throttle processing" for violations. Under the trial or without a subscription, each ungraded card costs 1 credit (graded 2), and the trial grants 100 credits, so a trial user can process at most 100 cards in total.

## 2. How 500 photos move (their pipeline, step by step)

1. **Client-side pre-flight** (`validateUploadFiles`): rejects 0-byte files ("appears to be empty… fully downloaded from cloud storage"), non-image files, and unsupported formats. Accepted: JPG/JPEG/JFIF, PNG, WebP, HEIC/HEIF. HEIC is converted to JPEG in the browser at quality 0.92 (OffscreenCanvas first, a WASM converter as fallback).
2. **Client-side compression** (`processAndCompressFiles`, the `browser-image-compression` library): `maxWidthOrHeight: 1600, maxSizeMB: 3, initialQuality: 0.75, useWebWorker: true`. Every phone photo is shrunk to a 1600 px longest side and at most 3 MB **before** it leaves the phone. This is the single biggest reason their uploads feel fast: a 12 MP, 4 MB photo becomes roughly 300 KB.
3. **Signed URLs in one call**: `POST /upload-card-pair/batch-signed-urls` with the whole file list (name, type, size, pair index, image index) returns one pre-signed PUT URL per file. Signing is retried on failure (`retrySigning`).
4. **Direct-to-storage PUTs, 10 at a time**: `uploadFiles({ concurrency: 10, maxAttempts: 6 })`. Each file is PUT to `images.carduploader.com` (S3-style) with exponential backoff (1 s, 2 s, 4 s cap, with jitter). Files that still fail get a second "sweep" pass at concurrency 3. **Their API server never touches the image bytes.** Telemetry events: `upload_preflight_rejected`, `upload_signing_failed`, `upload_put_failed`, `upload_put_recovered`.
5. **One job, processed in the background**: `POST /jobs/create-listing` (or `/pricing/...` for the pricing tool) with the uploaded keys creates a job; the page polls `GET /jobs/{id}/status` every **2 seconds** (`useJobStatusPolling`, `refetchInterval: 2000`) until `completed` or `failed`, giving up after 5 consecutive poll errors. Results land on `/dashboard/history/{type}/{jobId}`.
6. **Queueing under load**: the admin console in the same bundle has "release-slot", "spare-instance", "workers pause / restart-all" controls, i.e., a per-user processing slot on a worker pool. That is the mechanism behind the public complaint of being "26th in line" after ~500 of 5,000 cards (Hobby Over Hype, May 2026): the upload itself is not limited, the identification queue is.

## 3. What this means for our uploader

| | CardUploader | Ours (Sept 10 build) |
|---|---|---|
| Photos per batch | 1,000 files / 500 cards on paid; pricing tool 100 Free / 500 paid | 500 on Pro, 100 on Free (one photo per card) |
| Where the cap is enforced | Browser (toast) | Browser pre-flight **and** server (409 when full) |
| Bytes path | Browser → storage directly via signed URLs, 10 parallel PUTs | Browser → our server in groups of 20 → storage |
| Client-side shrink | Yes: 1600 px, ≤3 MB, q0.75, web worker | **No** (recommended next: the same 1600 px shrink; our hasher already works at that size) |
| Identification | Background job, 2 s status polling, worker queue | Inline per chunk (500 distinct cards at 1600 px: 2.2 min end to end) |
| Retry | Per-file, 6 attempts + sweep pass | Per-chunk, 3 attempts + Retry button that resumes |
| HEIC | Converted in browser | Accepted as-is (server must decode) |

**Bottom line:** 500 cards per upload matches CardUploader's own paid cap exactly, so the client's ask is "parity", not "beyond". The two things they do that we don't yet, in order of payoff: (1) shrink photos in the browser to 1600 px before sending, which is what makes their 500-photo upload light; (2) move identification to a background job with a 2-second status poll so the browser never waits on a request while cards are being read. Direct-to-storage signed URLs are a third, smaller step that only matters once uploads bypass our server entirely.
