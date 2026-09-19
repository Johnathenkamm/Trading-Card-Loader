// Synthetic "several cards per photo" test photos built from test-cards/distinct500:
//   page-black-N.jpg  3x3 binder page, black pocket background, 9 cards
//   page-white-N.jpg  3x3 page on a white page
//   loose-N.jpg       2x3 loose cards on a brown "table" with slight rotation + noise
// Writes binder.txt: file|card_id,card_id,... in row-major order (the order the
// on-device splitter should find them). Run from card-db-mvp:
//   node ../test-cards/make-binder-pages.mjs
import { Jimp } from "file:///C:/Users/johnn/Antigravity_Files/Card_reader/card-db-mvp/node_modules/jimp/dist/esm/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const SRC = "C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/distinct500";
const OUT = "C:/Users/johnn/Antigravity_Files/Card_reader/test-cards/binder";
const key = readFileSync(join(SRC, "..", "distinct500.txt"), "utf8").trim().split(/\r?\n/).map((l) => { const [file, id] = l.split("|"); return { file, id: Number(id) }; });
let next = 0;
const take = (n) => key.slice(next, (next += n));
const lines = [];
async function page(name, cols, rows, bg, opts = {}) {
  const W = 3024, H = 4032;
  const img = new Jimp({ width: W, height: H, color: bg });
  // uneven lighting: a soft gradient, brighter top-left
  img.scan(0, 0, W, H, (x, y, i) => { const g = 1 + 0.18 * (1 - (x / W + y / H) / 2) - 0.09; for (let c = 0; c < 3; c++) img.bitmap.data[i + c] = Math.max(0, Math.min(255, img.bitmap.data[i + c] * g + (opts.noise ? (Math.random() - 0.5) * opts.noise : 0))); });
  const cards = take(cols * rows);
  const gap = opts.gap ?? 70, margin = opts.margin ?? 160;
  const cw = Math.floor((W - 2 * margin - (cols - 1) * gap) / cols), ch = Math.round(cw * 1.4);
  const top = Math.floor((H - rows * ch - (rows - 1) * gap) / 2);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const card = await Jimp.read(join(SRC, cards[r * cols + c].file));
    card.resize({ w: cw, h: ch });
    if (opts.rotate) card.rotate((Math.random() - 0.5) * 2 * opts.rotate);
    const x = margin + c * (cw + gap) + Math.round((Math.random() - 0.5) * (opts.jitter ?? 0));
    const y = top + r * (ch + gap) + Math.round((Math.random() - 0.5) * (opts.jitter ?? 0));
    img.composite(card, x, y);
  }
  writeFileSync(join(OUT, name), await img.getBuffer("image/jpeg", { quality: 85 }));
  lines.push(`${name}|${cards.map((c) => c.id).join(",")}`);
  console.log(name, cards.length, "cards");
}
await page("page-black-1.jpg", 3, 3, 0x141414ff, { noise: 6 });
await page("page-black-2.jpg", 3, 3, 0x101010ff, { noise: 6, gap: 40, jitter: 20 });
await page("page-white-1.jpg", 3, 3, 0xf4f2eeff, { noise: 4 });
await page("loose-1.jpg", 3, 2, 0x7a5a3aff, { noise: 14, gap: 220, margin: 260, rotate: 4, jitter: 60 });
await page("loose-2.jpg", 2, 2, 0x2b3a4aff, { noise: 10, gap: 300, margin: 420, rotate: 6, jitter: 80 });
writeFileSync(join(OUT, "..", "binder.txt"), lines.join("\n") + "\n");
console.log("done:", lines.length, "photos");
