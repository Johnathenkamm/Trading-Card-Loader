// Multi-channel file exports (CardUploader's export tabs: eBay, TCGplayer,
// Whatnot, Shopify) plus the per-channel preferences from Configuration's
// Shopify / Whatnot / TCGplayer / Mana Pool tabs. One neutral ExportItem feeds
// every writer, so inventory rows and blank listings export identically.
//
// Column sets follow each marketplace's documented bulk-import template; the
// seller confirms mappings on first import (every importer previews).

import type { ListingExportRow } from "./listing.ts";
import type { Listing, Seller } from "./store.ts";

export type ExportItem = {
  sku: string;
  title: string;
  description: string;
  category: string;
  priceCents: number | null;
  startCents: number | null;
  quantity: number;
  condition: string; // NM | LP | …
  conditionLabel: string;
  grade: string; // "PSA 10" or ""
  grader: string;
  pic: string;
  specifics: Record<string, string>;
  game: string;
  set: string;
  setcode: string;
  number: string;
  name: string;
  finish: string;
  language: string;
  languageName: string;
  rarity: string;
  tcgplayerId: string;
  format: "fixed" | "auction";
  durationDays: number | null;
};

const CONDITION_LABEL: Record<string, string> = {
  NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged",
};
const LANG_NAME: Record<string, string> = {
  EN: "English", JP: "Japanese", DE: "German", FR: "French", IT: "Italian", ES: "Spanish", PT: "Portuguese", KR: "Korean", ZH: "Chinese",
};

export function itemsFromRows(rows: ListingExportRow[]): ExportItem[] {
  return rows.map((r) => {
    const grade = (r.grade ?? (r.inv as { grade?: string | null }).grade ?? "").trim();
    return {
      sku: r.inv.sku,
      title: r.title,
      description: r.description,
      category: r.category,
      priceCents: r.priceCents,
      startCents: r.startCents,
      quantity: r.inv.quantity,
      condition: r.inv.condition,
      conditionLabel: CONDITION_LABEL[r.inv.condition] ?? r.inv.condition,
      grade,
      grader: grade ? grade.split(" ")[0] : "",
      pic: r.vf.image_large || r.vf.image_small || "",
      specifics: r.specifics,
      game: r.vf.game_name,
      set: r.vf.set_name,
      setcode: r.vf.set_code ?? "",
      number: r.vf.number ?? "",
      name: r.vf.card_name,
      finish: r.vf.finish === "normal" ? "" : r.vf.finish_label,
      language: r.inv.language,
      languageName: LANG_NAME[r.inv.language] ?? r.inv.language,
      rarity: r.vf.rarity ?? "",
      tcgplayerId: r.vf.tcgplayer_id ?? "",
      format: r.format,
      durationDays: r.durationDays,
    };
  });
}

/** A blank (catalog-less) listing draft as an export item. */
export function itemFromBlankListing(l: Listing): ExportItem {
  let specifics: Record<string, string> = {};
  try {
    specifics = JSON.parse(l.item_specifics || "{}");
  } catch {
    specifics = {};
  }
  const condition = specifics["Card Condition"] ? Object.entries(CONDITION_LABEL).find(([, v]) => v === specifics["Card Condition"])?.[0] ?? "NM" : "NM";
  const grade = specifics["Grade"] && specifics["Professional Grader"] ? `${specifics["Professional Grader"]} ${specifics["Grade"]}` : "";
  return {
    sku: l.sku ?? `BLANK-${l.id}`,
    title: l.title,
    description: l.description,
    category: l.category_id ?? "183454",
    priceCents: l.price_cents,
    startCents: l.start_cents,
    quantity: l.quantity,
    condition,
    conditionLabel: CONDITION_LABEL[condition] ?? condition,
    grade,
    grader: grade ? grade.split(" ")[0] : "",
    pic: l.image_url ?? "",
    specifics,
    game: specifics["Game"] ?? "",
    set: specifics["Set"] ?? "",
    setcode: "",
    number: specifics["Card Number"] ?? "",
    name: specifics["Card Name"] ?? l.title,
    finish: specifics["Finish"] === "Regular" ? "" : specifics["Finish"] ?? "",
    language: "EN",
    languageName: specifics["Language"] ?? "English",
    rarity: specifics["Rarity"] ?? "",
    tcgplayerId: "",
    format: l.format === "auction" ? "auction" : "fixed",
    durationDays: l.duration_days,
  };
}

// ---- channel preferences (Configuration → Shopify / Whatnot / TCGplayer / Mana Pool)

export type ChannelPrefs = {
  shopify_vendor: string;
  shopify_location: string;
  shopify_grams: string;
  shopify_tags: string;
  whatnot_category: string;
  whatnot_shipping_profile: string;
  whatnot_offerable: boolean;
  tcg_my_store: boolean;
  tcg_store_multiplier: string; // e.g. "1.05"
  tcg_reserve_qty: string;
  manapool_note: string;
};

export const CHANNEL_DEFAULTS: ChannelPrefs = {
  shopify_vendor: "",
  shopify_location: "",
  shopify_grams: "5",
  shopify_tags: "trading cards",
  whatnot_category: "Trading Card Games",
  whatnot_shipping_profile: "",
  whatnot_offerable: true,
  tcg_my_store: false,
  tcg_store_multiplier: "1",
  tcg_reserve_qty: "0",
  manapool_note: "",
};

export function parseChannelPrefs(json: string | null | undefined): ChannelPrefs {
  if (!json || !json.trim()) return { ...CHANNEL_DEFAULTS };
  try {
    const o = JSON.parse(json) ?? {};
    const out: ChannelPrefs = { ...CHANNEL_DEFAULTS };
    for (const k of Object.keys(CHANNEL_DEFAULTS) as Array<keyof ChannelPrefs>) {
      const v = o[k];
      if (typeof CHANNEL_DEFAULTS[k] === "boolean") (out as any)[k] = v === true || v === "1" || v === "true";
      else if (v != null) (out as any)[k] = String(v).slice(0, 120);
    }
    return out;
  } catch {
    return { ...CHANNEL_DEFAULTS };
  }
}

export function channelPrefsFromForm(f: Record<string, string>): ChannelPrefs {
  const s = (k: string, d: string) => (f[k] != null ? String(f[k]).trim().slice(0, 120) : d);
  return {
    shopify_vendor: s("shopify_vendor", CHANNEL_DEFAULTS.shopify_vendor),
    shopify_location: s("shopify_location", CHANNEL_DEFAULTS.shopify_location),
    shopify_grams: s("shopify_grams", CHANNEL_DEFAULTS.shopify_grams),
    shopify_tags: s("shopify_tags", CHANNEL_DEFAULTS.shopify_tags),
    whatnot_category: s("whatnot_category", CHANNEL_DEFAULTS.whatnot_category),
    whatnot_shipping_profile: s("whatnot_shipping_profile", CHANNEL_DEFAULTS.whatnot_shipping_profile),
    whatnot_offerable: f.whatnot_offerable === "1",
    tcg_my_store: f.tcg_my_store === "1",
    tcg_store_multiplier: s("tcg_store_multiplier", CHANNEL_DEFAULTS.tcg_store_multiplier),
    tcg_reserve_qty: s("tcg_reserve_qty", CHANNEL_DEFAULTS.tcg_reserve_qty),
    manapool_note: s("manapool_note", CHANNEL_DEFAULTS.manapool_note),
  };
}

// ---- writers --------------------------------------------------------------

function cell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows: unknown[][]): string => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
const dollars = (c: number | null): string => (c != null ? (c / 100).toFixed(2) : "");

/** eBay File Exchange flat file (same layout as listing.ts, driven by ExportItem). */
export function ebayCsv(items: ExportItem[], seller: Seller): string {
  const specNames: string[] = [];
  for (const it of items) for (const k of Object.keys(it.specifics)) if (!specNames.includes(k)) specNames.push(k);
  const header = [
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)", "CustomLabel", "*Category", "*Title", "*Description", "*ConditionID",
    "PicURL", "*Format", "*Duration", "*StartPrice", "*Quantity", "*Location", "ShippingProfileName", "ReturnProfileName", "PaymentProfileName",
    ...specNames.map((n) => `C:${n}`),
  ];
  const rows: unknown[][] = [header];
  for (const it of items) {
    const price = it.format === "auction" ? it.startCents ?? it.priceCents : it.priceCents;
    rows.push([
      "Add", it.sku, it.category, it.title, it.description.replace(/\n/g, "<br>"), it.grade ? "2750" : "4000", it.pic,
      it.format === "auction" ? "Auction" : "FixedPrice", it.format === "auction" ? `Days_${it.durationDays ?? 7}` : "GTC",
      dollars(price), String(it.quantity), seller.item_location ?? "United States",
      seller.ebay_shipping_policy ?? "", seller.ebay_return_policy ?? "", seller.ebay_payment_policy ?? "",
      ...specNames.map((n) => it.specifics[n] ?? ""),
    ]);
  }
  return csv(rows);
}

/** TCGplayer seller inventory CSV (Pricing → Export/Import layout). Ungraded only — TCGplayer doesn't list slabs. */
export function tcgplayerCsv(items: ExportItem[], prefs: ChannelPrefs): { csv: string; skipped: number } {
  const header = [
    "TCGplayer Id", "Product Line", "Set Name", "Product Name", "Title", "Number", "Rarity", "Condition",
    "TCG Market Price", "TCG Direct Low", "TCG Low Price With Shipping", "TCG Low Price", "Total Quantity", "Add to Quantity", "TCG Marketplace Price", "Photo URL",
    ...(prefs.tcg_my_store ? ["My Store Price", "My Store Reserve Quantity"] : []),
  ];
  const rows: unknown[][] = [header];
  let skipped = 0;
  const mult = parseFloat(prefs.tcg_store_multiplier) || 1;
  for (const it of items) {
    if (it.grade) {
      skipped++;
      continue;
    }
    const cond = `${it.conditionLabel}${it.finish ? " " + (/holo|foil/i.test(it.finish) ? "Holofoil" : it.finish) : ""}`;
    rows.push([
      it.tcgplayerId, it.game, it.set, it.name, it.title, it.number, it.rarity, cond,
      "", "", "", "", "", String(it.quantity), dollars(it.priceCents), it.pic,
      ...(prefs.tcg_my_store ? [it.priceCents != null ? (Math.round(it.priceCents * mult) / 100).toFixed(2) : "", prefs.tcg_reserve_qty || "0"] : []),
    ]);
  }
  return { csv: csv(rows), skipped };
}

/** Whatnot bulk-listing CSV. */
export function whatnotCsv(items: ExportItem[], prefs: ChannelPrefs): string {
  const header = [
    "Category", "Sub Category", "Title", "Description", "Quantity", "Type", "Price", "Shipping Profile", "Offerable", "Hazmat",
    "Condition", "Cost Per Item", "SKU", "Image URL 1",
  ];
  const rows: unknown[][] = [header];
  for (const it of items) {
    rows.push([
      prefs.whatnot_category || "Trading Card Games", it.game, it.title, it.description, String(it.quantity),
      it.format === "auction" ? "Auction" : "Buy it Now", dollars(it.priceCents), prefs.whatnot_shipping_profile,
      prefs.whatnot_offerable ? "TRUE" : "FALSE", "Not Hazmat",
      it.grade ? "Graded" : it.condition === "NM" ? "Near Mint" : it.conditionLabel, "", it.sku, it.pic,
    ]);
  }
  return csv(rows);
}

/** Shopify product import CSV (one product per card, one variant). */
export function shopifyCsv(items: ExportItem[], prefs: ChannelPrefs): string {
  const header = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags", "Published",
    "Option1 Name", "Option1 Value", "Variant SKU", "Variant Grams", "Variant Inventory Tracker", "Variant Inventory Qty",
    "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Price", "Variant Requires Shipping", "Variant Taxable",
    "Image Src", "Status",
  ];
  const rows: unknown[][] = [header];
  for (const it of items) {
    const handle = `${it.sku}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const tags = [prefs.shopify_tags, it.game, it.set, it.rarity, it.grade || it.conditionLabel].filter(Boolean).join(", ");
    rows.push([
      handle, it.title, it.description.replace(/\n/g, "<br>"), prefs.shopify_vendor, "Toys & Games > Games > Card Games", "Trading Card", tags, "TRUE",
      "Condition", it.grade || it.conditionLabel, it.sku, prefs.shopify_grams || "5", "shopify", String(it.quantity),
      "deny", "manual", dollars(it.priceCents), "TRUE", "TRUE", it.pic, "active",
    ]);
  }
  return csv(rows);
}

export const EXPORT_FORMATS: Array<{ key: string; label: string; ext: string }> = [
  { key: "ebay", label: "eBay (File Exchange)", ext: "csv" },
  { key: "tcgplayer", label: "TCGplayer", ext: "csv" },
  { key: "whatnot", label: "Whatnot", ext: "csv" },
  { key: "shopify", label: "Shopify", ext: "csv" },
];
