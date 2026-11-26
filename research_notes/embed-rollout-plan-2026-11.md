# Rollout plan: image-embedding matcher on the live site (Nov 16 2026)

Goal: fewer cards in review, with **zero false reads** (wrong auto-matches). Today prod runs the hash matcher
(shipped fixes in ceeee22). The embedding matcher (SigLIP 2, `VISION_PROVIDER=embed`) was built Oct 10 and is still
uncommitted. Plan follows; numbers below were measured Nov 15–16 unless marked as estimates.

## Why switch

On the client's 52 real scans (batch #8), same catalog, both with the language rule:

| | Right top pick | Auto-matched (no review) | False reads |
|---|---:|---:|---:|
| Hash (live now) | 51/52 | 16 | 0 |
| Embeddings | 51/52 | 24 | 0 |

The bigger gain is phone photos. On synthetic phone/glare/tilt photos the hash finds the right card 0–4% of the time
(Nov 15 trim check). The embeddings found the right card 98% of the time across all synthetic conditions, including
those (Oct 10 bench). The client uses a flatbed scanner today, so his scans already work; embeddings
matter the day he (or a customer) shoots cards with a phone. **We have no real phone photos to test with:** ask the
client for 20–30.

## Facts that shape the plan

- **Prod container:** 8 vCPU and 8 GB RAM limit (cgroup), using ~165 MB now. Debian 13, Node 24: onnxruntime-node's Linux build fits.
  `nproc` reports 48 CPUs, so the model runtime must be told to use 8 threads, or every scan oversubscribes the CPU.
- **Memory:** model loaded ≈ +0.8 GB. The embedding index for all 171k cards ≈ +0.2 GB (int8 vectors 131 MB + labels). Expect
  ~1.1–1.3 GB total for the app (measured 1.1 GB locally with 27k cards indexed).
- **Model:** 372 MB, downloaded from Hugging Face on first use. The app service has no volume, so it re-downloads after
  every deploy (the first scan waits, unless we warm it up at boot). If the download fails, scans fall back to the hash.
- **Speed (local, i9 8C/16T):** model load 1.6 s from disk, 5.2 images/s embedding (≈3 CPU-seconds per image),
  ~0.46 s per uploaded photo end to end. Prod's speed is unknown until the dry run (step 2).
- **Catalog to embed:** 171k cards = Pokémon 28k + Pokémon JP 30k + One Piece 7k + Magic 105k. About 4.3k have no image.
  Embedding everything is ≈ 515k CPU-seconds: **est. 12–19 h at 8 vCPU** (est.).
- **Database disk:** Postgres volume 766 MB of 5 GB. The embeddings add ≈ 0.2 GB.
  (The photo bucket is at 2.3 of 5 GB from uploads, which is worth watching separately.)
- **Railway prices** (railway.com/pricing, read Nov 16): memory $10/GB-month, vCPU $20/vCPU-month, volume $0.15/GB-month,
  billed per second. Hobby plan: $5/month includes $5 of usage, volumes max 5 GB.

## Cost (estimates)

| Item | Cost |
|---|---|
| Model kept in memory 24/7 (+~1.1 GB) | ~$11/month |
| ...or unloaded after 15 idle minutes (client scans in bursts) | ~$1–2/month |
| One-time catalog embedding on prod CPU | ~$4 |
| Per scan | ~$0.03 per 1,000 photos |
| Extra database disk | ~$0.03/month |

## Steps

**0. Pre-flight code fixes (local, tested before shipping): DONE Nov 16, uncommitted**

Results (local):
- Thread cap: 2 threads gave 3.5 img/s vs 5.1 at 16, so the option takes effect.
- Idle unload: memory went 873 → 116 MB after the idle time; the next scan reloads in 0.7 s.
- Boot warm-up: "Embedding matcher ready in 3.2 s".
- Builder skipped the 170 known-missing One Piece images (6,790 of 6,960 queued).
- Safety net: with One Piece unbuilt, "Any game" had 0 auto-matches through embeddings, and only exact-scan hash matches auto-matched.
- Client batch, Pokémon fully built: 51/52 right, **32 auto-matched, 0 wrong**. The same on "Any game" once One Piece
  and Magic were built too (51/52, 32 auto, 0 wrong).
- Embed builder now uses the hash builder's image fetch (reads error bodies; unread ones caused TCGplayer reset storms
  in October). Magic rebuild: 302 in 75 s, 0 failed. One Piece: 6,790, 0 failed.
- A laptop sleep paused the local build for hours. On prod the build runs on Railway, so that doesn't apply, but a
  redeploy still kills it (resume by re-running; done cards are skipped).
- False-read panel on /admin/catalog counted a seller correction (Pineco VIV → TEF) and listed it with the photo.

The fixes:
- Thread cap: pass `session_options.intraOpNumThreads` from `EMBED_THREADS` (default: the cgroup CPU quota, 8 on prod).
- Coverage safety net: a game in the photo's pool with no vectors yet counts as "still building" (caps to review). Today
  it's silently skipped, so a Magic photo could get a Pokémon guess.
- Embed builder skips `card_image_missing` (the 4.3k known-dead TCGplayer images), like the hash builder does.
- Warm-up: when `VISION_PROVIDER=embed`, load the model at boot so the first scan doesn't wait for the download.
- Idle unload (recommended): free the model after `EMBED_IDLE_MIN` (15) minutes without scans; reload takes ~2 s.
- False-read counter: count auto-matches the seller later replaces, and show it in /admin. This is the live measure of "zero false reads".
- Re-run: client batch replay (embed), synthetic bench, `trim-check.ts`.

**1. Ship the code dormant.** Commit the embedding work with `VISION_PROVIDER` still `hash`. Nothing changes for users.
The build gets ~450 MB bigger (onnxruntime). Verify the deploy, pages, and boot log.

**2. Dry run on prod CPU (no user impact).** Over `railway ssh`, load the model in a one-off process and embed the
client's 52 photos. Measure images/s, memory and load time. This turns the 12–19 h estimate into a number.

**3. Build the catalog index on prod (provider still `hash`).** One-off background process over ssh, client's games first:
`embed:catalog --game pokemon --game pokemon-jp --game onepiece`, then `--game mtg`. Resumable if interrupted (it skips done
cards; a redeploy kills it, so don't push during the build). Users keep the hash matcher the whole time, so there's no
half-built window. Optional: temporarily raise the service to 16–24 vCPU in Railway settings to finish faster (CPU is billed by use).
Fallback if prod is too slow: embed on the dev laptop (free, ~9 h) and upload the vectors.

**4. Flip the switch.** Set `VISION_PROVIDER=embed` (+ `EMBED_THREADS=8`) in Railway variables (this redeploys). Check the boot log for the index load
and memory. Replay the client's batch read-only on prod: expect ~24/52 auto, **0 wrong**.

**5. Watch for a week.** Look at the false-read counter, memory, and upload time per photo (~0.7–1 s est. vs ~0.3 s now).
Ask the client for phone photos and replay them.

**Rollback:** set `VISION_PROVIDER=hash` (one variable, ~2 min redeploy). The embeddings table can stay.

## Guardrails that keep false reads at zero

- Auto-match needs high similarity AND a clear lead over the runner-up. Identical-art reprints (lead < 0.02) always go to review.
- Language rule: an EN batch never matches Pokémon Japanese, and the reverse for JP batches.
- While any game in the pool is still being embedded, nothing auto-matches through embeddings.
- A card whose sibling printing has no image goes to review (it can't rule the sibling out).
- All thresholds are env variables (`EMBED_AUTO_SIM`, `EMBED_AUTO_MARGIN`, …), so they can be tightened without a deploy.
