// Build the photo-ID embedding index (VISION_PROVIDER=embed): run every
// catalog card's reference image through the embedding model into
// card_embeddings. The builder lives in src/app/embedindex.ts (the server also
// runs it at boot when the index is behind the catalog); this script is the
// manual / forced entry point.
//
// Run:  npm run embed:catalog                       (embed new/changed cards)
//       npm run embed:catalog -- --game mtg         (one game; repeatable)
//       npm run embed:catalog -- --force            (re-embed everything)

import { parseArgs } from "node:util";
import { close } from "../pg.ts";
import { buildEmbedIndex } from "../app/embedindex.ts";

const { values } = parseArgs({ options: { force: { type: "boolean" }, game: { type: "string", multiple: true } } });

buildEmbedIndex({ force: !!values.force, games: values.game, log: (l) => console.log(l) })
  .then(() => close())
  .catch(async (err) => {
    console.error("embed:catalog failed:", err);
    await close();
    process.exit(1);
  });
