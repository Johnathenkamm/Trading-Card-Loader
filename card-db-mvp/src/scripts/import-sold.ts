// Sold-listings importer -> the canonical sold_sales archive. The importer lives
// in src/app/soldimport.ts (the server also loads the bundled sample feed at
// boot when the archive is empty); this script is the manual entry point for
// any feed file.
//
// Usage:
//   npm run import:sold -- <file.(csv|json)> [--source=<feed-id>] [--demo]
//
// Accepted columns and the dedupe/canonicalization rules: see soldimport.ts.

import { close } from "../pg.ts";
import { importSoldFeed, readFeedFile } from "../app/soldimport.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const source = args.find((a) => a.startsWith("--source="))?.slice("--source=".length) ?? "manual";
  const isDemo = args.includes("--demo");
  if (!file) {
    console.error("Usage: npm run import:sold -- <file.(csv|json)> [--source=<feed-id>] [--demo]");
    process.exit(1);
  }

  const feed = readFeedFile(file);
  await importSoldFeed(feed, { source, demo: isDemo, log: (l) => console.log(l.replace(/^import:sold — /, `import:sold — from ${file}: `)) });
}

main()
  .then(() => close())
  .catch(async (err) => {
    console.error("import failed:", err);
    await close();
    process.exit(1);
  });
