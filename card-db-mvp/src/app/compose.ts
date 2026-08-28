// Cross-cutting operations that combine the store, pricing, and listing modules.
// Kept separate so render/ and server/ can both call them without an import
// cycle (listing.ts holds only pure builders + store *types*).

import {
  getVariantFull, marketCents, getSeller, sampleVariantId,
  type ScanItem, type InventoryRow, type VariantFull, type Seller,
} from "./store.ts";
import {
  listingFields, buildTitle, buildSpecifics, buildDescription, ebayCategory,
  type ListingExportRow, type ListingFields,
} from "./listing.ts";
import { parseStructure, renderStructuredTitle } from "./title.ts";
import { resolvePrice } from "./pricing.ts";

/**
 * Resolve a card's title for a seller. Precedence: a saved visual Title Structure
 * wins; else the legacy {placeholder} template; else the built-in optimizer. This
 * is the single title path shared by the review queue, listing builder, and CSV.
 */
export function sellerTitle(f: ListingFields, seller: Seller): string {
  const st = parseStructure(seller.title_structure);
  if (st && st.blocks.length) return renderStructuredTitle(f, st).title;
  return buildTitle(f, seller.title_template);
}

/** Representative card fields for the Title Structure Editor's live preview. */
export async function sampleTitleFields(): Promise<ListingFields> {
  const vid = await sampleVariantId();
  const vf = vid ? await getVariantFull(vid) : undefined;
  if (vf) return listingFields(vf, { condition: "NM", language: "EN", sku: "HOH-000123" });
  return {
    year: "1999", game: "Pokémon", set: "Base Set", setcode: "BS", name: "Charizard",
    number: "4/102", rarity: "Rare Holo", rarityAbbr: "Holo", finish: "Holo",
    condition: "NM", conditionLabel: "Near Mint", grade: "", grader: "",
    language: "EN", languageName: "English", sku: "HOH-000123",
  };
}

/** Auto-generated marketplace title for a scan item (null if unmatched). */
export async function scanItemTitle(item: ScanItem, seller?: Seller): Promise<string | null> {
  if (!item.matched_variant_id) return null;
  const vf = await getVariantFull(item.matched_variant_id);
  if (!vf) return null;
  const s = seller ?? (await getSeller());
  const f = listingFields(vf, { condition: item.condition, language: item.language, sku: item.sku ?? "" });
  return sellerTitle(f, s);
}

export type ListingPreview = {
  title: string;
  specifics: Record<string, string>;
  description: string;
  category: string;
  priceCents: number | null;
  vf: VariantFull;
};

/** Build a full listing preview for an inventory row. */
export async function inventoryListingPreview(
  inv: InventoryRow,
  opts: { grade?: string | null; template?: string | null; titleOverride?: string | null } = {}
): Promise<ListingPreview | null> {
  const vf = await getVariantFull(inv.variant_id);
  if (!vf) return null;
  const seller = await getSeller();
  const f = listingFields(vf, { condition: inv.condition, language: inv.language, sku: inv.sku }, opts.grade);
  const title = opts.titleOverride && opts.titleOverride.trim()
    ? opts.titleOverride.trim().slice(0, 80)
    : opts.template ? buildTitle(f, opts.template) : sellerTitle(f, seller);
  return {
    title,
    specifics: buildSpecifics(f),
    description: buildDescription(f, inv.price_cents),
    category: ebayCategory(vf.game_slug),
    priceCents: inv.price_cents,
    vf,
  };
}

/** Assemble the export rows for an eBay CSV from inventory ids. */
export async function exportRowsFor(
  invs: InventoryRow[],
  opts: { format: "fixed" | "auction"; durationDays?: number } = { format: "fixed" }
): Promise<ListingExportRow[]> {
  const rows: ListingExportRow[] = [];
  const seller = await getSeller();
  for (const inv of invs) {
    const vf = await getVariantFull(inv.variant_id);
    if (!vf) continue;
    const f = listingFields(vf, { condition: inv.condition, language: inv.language, sku: inv.sku });
    rows.push({
      vf,
      inv,
      title: sellerTitle(f, seller),
      description: buildDescription(f, inv.price_cents),
      specifics: buildSpecifics(f),
      category: ebayCategory(vf.game_slug),
      format: opts.format,
      priceCents: inv.price_cents,
      startCents: inv.price_cents,
      durationDays: opts.durationDays ?? 7,
      grade: null,
    });
  }
  return rows;
}

export { marketCents };
