// Sold-sales harvest: our own sellers' completed eBay orders -> the sold_sales
// archive.
//
// Research (carduploader-data-sourcing-research.md §2, §8.1): every official
// eBay route to market-wide sold data is closed, so the archive has to be fed
// by a licensed vendor, scraping, or accumulation. This is the accumulation
// leg, and the one nobody can copy: every seller who connects an eBay account
// already grants sell.fulfillment, and each PAID line item on their orders is
// a real sale — true accepted price, real date, and (via the SKU) the EXACT
// card/variant/grade in our catalog, no title parsing needed. It costs nothing
// and grows with every user.
//
// Runs two ways:
//   - in-process, every SOLD_HARVEST_INTERVAL_MS (default 6h) for every
//     connected seller, from startSoldHarvestOnBoot() in server.ts
//   - on demand from "Fetch eBay orders" in the workspace, for that seller
//
// Privacy: nothing about the buyer leaves the Fulfillment API — only title,
// price, date, SKU and listing id land in the (public) archive.

import { query, one } from "../pg.ts";
import { ebaySellConfigured, fetchCompletedOrderLines, getConnection, EbayError, type EbaySoldLine } from "./ebay-sell.ts";
import { importSoldFeed, type FeedRow, type SoldImportStats } from "./soldimport.ts";

export const HARVEST_SOURCE = "ebay-orders";
/** First harvest reaches back this far (the Fulfillment API keeps ~2 years). */
const BACKFILL_DAYS = 730;
/** Later harvests re-read this much overlap so a late-paid order isn't missed. */
const OVERLAP_DAYS = 3;

type InvRow = { card_id: number; variant_id: number; grade: string | null; condition: string | null };

function lineToRow(l: EbaySoldLine, inv: InvRow | undefined): FeedRow | null {
  if (!l.title || l.unit_cents == null) return null;
  return {
    title: l.title,
    price: (l.unit_cents / 100).toFixed(2),
    sold_on: l.sold_on,
    marketplace: "ebay",
    sale_type: l.sold_format,
    external_id: `${l.orderId}#${l.lineItemId}`,
    url: l.legacyItemId ? `https://www.ebay.com/itm/${l.legacyItemId}` : null,
    sku: l.sku,
    quantity: l.quantity,
    card_id: inv?.card_id ?? null,
    variant_id: inv?.variant_id ?? null,
    grade: inv?.grade ?? null,
    condition: inv && !inv.grade ? inv.condition : null,
  };
}

/**
 * Fold one connected seller's paid orders into the archive. Must run inside
 * that seller's `runWithSeller` scope (the eBay client reads the token from it).
 */
export async function harvestSoldSalesFor(sellerId: number, log: (l: string) => void = () => {}): Promise<SoldImportStats | null> {
  const conn = await getConnection(sellerId);
  if (!conn) return null;
  const since = conn.last_sold_harvest
    ? new Date(new Date(conn.last_sold_harvest).getTime() - OVERLAP_DAYS * 86_400_000)
    : new Date(Date.now() - BACKFILL_DAYS * 86_400_000);
  const lines = await fetchCompletedOrderLines(since.toISOString());

  // SKU -> our inventory row: exact card/variant/grade, no title parsing.
  const skus = [...new Set(lines.map((l) => l.sku).filter((s): s is string => !!s))];
  const bySku = new Map<string, InvRow>();
  if (skus.length) {
    const rows = await query<InvRow & { sku: string }>(
      "SELECT sku, card_id, variant_id, grade, condition FROM inventory WHERE seller_id=$1 AND sku = ANY($2::text[])",
      [sellerId, skus]
    );
    for (const r of rows) bySku.set(r.sku, r);
  }

  const feed = lines.map((l) => lineToRow(l, l.sku ? bySku.get(l.sku) : undefined)).filter((r): r is FeedRow => r !== null);
  const stats = await importSoldFeed(feed, { source: HARVEST_SOURCE, log });
  await query("UPDATE ebay_connections SET last_sold_harvest=now() WHERE seller_id=$1", [sellerId]);
  return stats;
}

/** Harvest every connected seller (each inside its own scope). Per-seller failures only log. */
export async function harvestAllSoldSales(
  runAs: <T>(sellerId: number, fn: () => Promise<T>) => Promise<T>
): Promise<{ sellers: number; inserted: number; updated: number; failed: number }> {
  const out = { sellers: 0, inserted: 0, updated: 0, failed: 0 };
  const conns = await query<{ seller_id: number }>("SELECT seller_id FROM ebay_connections ORDER BY seller_id");
  for (const c of conns) {
    out.sellers++;
    try {
      const s = await runAs(c.seller_id, () => harvestSoldSalesFor(c.seller_id));
      if (s) {
        out.inserted += s.inserted;
        out.updated += s.updated;
      }
    } catch (err) {
      out.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  sold harvest: seller #${c.seller_id} ${err instanceof EbayError ? "eBay said: " : ""}${msg}`);
    }
  }
  return out;
}

let harvestTimer: NodeJS.Timeout | null = null;

/**
 * In-process runner: harvest every connected seller shortly after boot and
 * then every SOLD_HARVEST_INTERVAL_MS (default 6h). Honors SCHEDULER_DISABLED=1
 * (extra instances) like the publish scheduler; SOLD_HARVEST_DISABLED=1 turns
 * just this off. No-op when eBay isn't configured. Idempotent.
 */
export function startSoldHarvestOnBoot(runAs: <T>(sellerId: number, fn: () => Promise<T>) => Promise<T>): void {
  if (harvestTimer) return;
  if (process.env.SCHEDULER_DISABLED === "1" || process.env.SOLD_HARVEST_DISABLED === "1") return;
  if (!ebaySellConfigured()) return;
  const every = Math.max(60_000, Number(process.env.SOLD_HARVEST_INTERVAL_MS) || 6 * 3_600_000);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await harvestAllSoldSales(runAs);
      if (r.sellers) console.log(`  sold harvest: ${r.sellers} seller${r.sellers === 1 ? "" : "s"}, ${r.inserted} new sale${r.inserted === 1 ? "" : "s"} archived, ${r.updated} updated${r.failed ? `, ${r.failed} failed` : ""}`);
    } catch (err) {
      console.error("  sold harvest tick:", err);
    } finally {
      busy = false;
    }
  };
  harvestTimer = setInterval(tick, every);
  harvestTimer.unref?.();
  setTimeout(tick, 20_000).unref?.();
}

/** Latest harvest time across sellers, for status lines. */
export async function lastHarvestAt(sellerId: number): Promise<string | null> {
  const r = await one<{ t: string | null }>("SELECT last_sold_harvest AS t FROM ebay_connections WHERE seller_id=$1", [sellerId]);
  return r?.t ?? null;
}
