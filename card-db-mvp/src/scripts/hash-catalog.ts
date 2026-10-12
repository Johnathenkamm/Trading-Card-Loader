// Build the photo-identification index: perceptual-hash every catalog card's
// reference image into card_image_hashes. The builder itself lives in
// src/app/hashindex.ts (the server also runs it at boot when the index is
// behind the catalog); this script is the manual / forced entry point.
//
// Run:  npm run hash:catalog                      (hash new/changed cards)
//       npm run hash:catalog -- --retry-missing   (also retry images the host had no picture for)
//       npm run hash:catalog -- --force           (rehash everything)

import { close } from "../pg.ts";
import { buildHashIndex } from "../app/hashindex.ts";

const args = process.argv.slice(2);
buildHashIndex({ force: args.includes("--force"), retryMissing: args.includes("--retry-missing"), log: (l) => console.log(l) })
  .then(() => close())
  .catch(async (err) => {
    console.error("hash:catalog failed:", err);
    await close();
    process.exit(1);
  });
