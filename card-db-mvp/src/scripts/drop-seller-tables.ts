// One-shot cleanup after the buyer/collector overhaul (Sept 2026): drop the
// tables and columns that only the old SELLER tooling used. Nothing in the app
// reads them any more; they are left in place at boot so a deploy can be
// verified (and rolled back) before the data is gone for good.
//
//   npm run db:drop-seller            # prints what would be dropped
//   npm run db:drop-seller -- --yes   # actually drops it
//
// Kept on purpose: the `sellers` table (it IS the accounts table; renaming it
// in production buys nothing a visitor can see), scan_batches / scan_items (the
// review queue and price checks), collection_items, wishlist_items.

import { query, close } from "../pg.ts";

const TABLES = ["inventory_price_history", "listings", "order_items", "orders", "inventory", "ebay_connections", "oauth_states"];
const SELLER_COLUMNS = [
  "sku_prefix", "sku_pad", "sku_next",
  "price_mode", "price_pct", "price_fixed_cents",
  "ebay_connected", "ebay_store_category", "ebay_shipping_policy", "ebay_return_policy", "ebay_payment_policy", "item_location",
  "title_template", "title_structure", "auto_price_pref", "price_floor_cents", "description_templates", "channel_prefs",
];
const ITEM_COLUMNS = ["price_mode", "price_pct", "price_overridden", "prev_price_cents", "sku", "title"];

async function main(): Promise<void> {
  const yes = process.argv.includes("--yes");
  const existing = await query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])`, [TABLES]);
  const present = existing.map((r) => r.t);
  console.log(yes ? "Dropping seller-only schema…" : "Dry run — pass --yes to apply.");
  console.log(`  tables:            ${present.length ? present.join(", ") : "(none left)"}`);
  console.log(`  sellers columns:   ${SELLER_COLUMNS.join(", ")}`);
  console.log(`  scan_items columns: ${ITEM_COLUMNS.join(", ")}`);
  if (!yes) return;
  for (const t of present) await query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  for (const c of SELLER_COLUMNS) await query(`ALTER TABLE sellers DROP COLUMN IF EXISTS ${c}`);
  for (const c of ITEM_COLUMNS) await query(`ALTER TABLE scan_items DROP COLUMN IF EXISTS ${c}`);
  console.log("Done.");
}

main()
  .then(() => close())
  .catch(async (err) => {
    console.error("drop-seller failed:", err);
    await close();
    process.exit(1);
  });
