// Build the photo-identification index: perceptual-hash every catalog card's
// reference image into card_image_hashes (see src/imagehash.ts for the method
// and the research grounding). Re-runnable: cards whose stored image_url is
// unchanged are skipped, so after a catalog sync only new/changed cards fetch.
// This is exactly why the retrieval architecture supports new sets without
// retraining — "adding a set" is hashing its images.
//
// Run:  npm run hash:catalog          (hash new/changed cards)
//       npm run hash:catalog -- --force   (rehash everything)

import { query, one, close } from "../pg.ts";
import { hashImage, toHex } from "../imagehash.ts";
import { sleep } from "../util.ts";

const CONCURRENCY = 6;

async function fetchImage(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": "CardIndex/0.1 (catalog hashing)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

async function ensureSchema(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS card_image_hashes (
    card_id     bigint PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    dhash       text NOT NULL,
    ahash       text NOT NULL,
    dhash_inset text NOT NULL,
    ahash_inset text NOT NULL,
    image_url   text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`);
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  await ensureSchema();

  const cards = (await query(
    `SELECT c.id, c.name, COALESCE(c.image_small, c.image_large) AS image, h.image_url AS hashed_url
     FROM cards c
     LEFT JOIN card_image_hashes h ON h.card_id = c.id
     WHERE COALESCE(c.image_small, c.image_large) IS NOT NULL
     ORDER BY c.id`
  )) as Array<{ id: number; name: string; image: string; hashed_url: string | null }>;

  const todo = cards.filter((c) => force || c.hashed_url !== c.image);
  console.log(`hash:catalog — ${cards.length} cards with images, ${todo.length} to hash${force ? " (forced)" : ""}`);

  let done = 0;
  let failed = 0;
  const queue = [...todo];
  const worker = async () => {
    for (;;) {
      const card = queue.shift();
      if (!card) return;
      try {
        const h = await hashImage(await fetchImage(card.image));
        await query(
          `INSERT INTO card_image_hashes (card_id, dhash, ahash, dhash_inset, ahash_inset, image_url, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT (card_id) DO UPDATE SET dhash=EXCLUDED.dhash, ahash=EXCLUDED.ahash,
             dhash_inset=EXCLUDED.dhash_inset, ahash_inset=EXCLUDED.ahash_inset,
             image_url=EXCLUDED.image_url, updated_at=now()`,
          [card.id, toHex(h.full.dhash), toHex(h.full.ahash), toHex(h.inset.dhash), toHex(h.inset.ahash), card.image]
        );
        done++;
        if (done % 50 === 0) console.log(`  ${done}/${todo.length}…`);
      } catch (err: any) {
        failed++;
        console.log(`  ! ${card.name} (#${card.id}): ${err?.message ?? err}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const total = await one<{ n: number }>("SELECT COUNT(*)::int n FROM card_image_hashes");
  console.log(`Done: ${done} hashed, ${failed} failed. Index now covers ${total!.n}/${cards.length} cards.`);
}

main()
  .then(() => close())
  .catch(async (err) => {
    console.error("hash:catalog failed:", err);
    await close();
    process.exit(1);
  });
