// Grow the catalog from TCGCSV (see src/app/catalog-import.ts).
//
//   npm run import:catalog -- pokemon              # every Pokémon set not yet imported
//   npm run import:catalog -- onepiece --force     # re-import every One Piece set
//   npm run import:catalog -- all --groups=23834   # one TCGplayer group id
//   npm run import:catalog -- pokemon --no-hash    # skip the photo-ID index build

import { close } from "../pg.ts";
import { importGame, CATALOG_GAMES } from "../app/catalog-import.ts";

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith("--")) ?? "all";
const force = args.includes("--force");
const noHash = args.includes("--no-hash");
const groupsArg = args.find((a) => a.startsWith("--groups="));
const groups = groupsArg ? groupsArg.slice(9).split(",").map((s) => parseInt(s, 10)).filter((n) => n > 0) : undefined;

const slugs = which === "all" ? ["pokemon", "onepiece"] : [which];
for (const s of slugs) if (!CATALOG_GAMES[s]) {
  console.error(`Unknown game "${s}". Use one of: ${Object.keys(CATALOG_GAMES).join(", ")}, all`);
  process.exit(2);
}

try {
  for (const s of slugs) {
    console.log(`\n== ${CATALOG_GAMES[s].name} (TCGplayer category ${CATALOG_GAMES[s].category})`);
    const p = await importGame(s, { force, groups, hashAfter: !noHash, log: (l) => console.log(l) });
    if (p.error) process.exitCode = 1;
  }
} finally {
  await close();
}
