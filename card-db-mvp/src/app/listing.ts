// eBay listing generation (spec §9–13, §16). Produces an optimized, length-safe
// title, item specifics, a description, and an eBay File Exchange CSV export.
//
// Live publishing goes through the eBay Sell APIs (Inventory → Offer →
// publishOffer) and needs seller OAuth + a production keyset — the documented
// next seam. The File Exchange CSV here is the build plan's explicit fallback
// (and removes CardUploader's #1 complaint: rejected CSVs) — it is a real,
// importable artifact, not a mock.

import type { VariantFull, InventoryRow, Seller } from "./store.ts";
import { money } from "../util.ts";

export const EBAY_TITLE_MAX = 80;

// eBay leaf category. "CCG Individual Cards" (183454) covers Pokémon/MTG/YGO
// singles; sports use a different tree. Illustrative default — the seller
// confirms the exact leaf in the eBay flow / pre-flight validation.
const CATEGORY_BY_GAME: Record<string, string> = {
  pokemon: "183454",
  mtg: "38292",
  onepiece: "183454",
  yugioh: "31395",
};
export function ebayCategory(gameSlug: string): string {
  return CATEGORY_BY_GAME[gameSlug] ?? "183454";
}

// Compact rarity tokens for titles (buyers search these).
const RARITY_ABBR: Array<[RegExp, string]> = [
  [/secret/i, "SEC"],
  [/rainbow/i, "RR"],
  [/illustration|special\s*art|alt(ernate)?\s*art/i, "IR"],
  [/ultra/i, "UR"],
  [/hyper/i, "HR"],
  [/double\s*rare/i, "RR"],
  [/amazing/i, "AMZ"],
  [/promo/i, "Promo"],
  [/holo/i, "Holo"],
];
function rarityAbbr(rarity: string | null): string {
  if (!rarity) return "";
  for (const [re, a] of RARITY_ABBR) if (re.test(rarity)) return a;
  return "";
}

const FINISH_TITLE: Record<string, string> = {
  holofoil: "Holo",
  reverse_holofoil: "Reverse Holo",
  "1st_edition_holofoil": "1st Ed Holo",
  "1st_edition": "1st Edition",
  unlimited_holofoil: "Unlimited Holo",
  unlimited: "Unlimited",
  foil: "Foil",
  etched: "Etched",
  normal: "",
};

const LANG_NAME: Record<string, string> = {
  EN: "English", JP: "Japanese", DE: "German", FR: "French", IT: "Italian",
  ES: "Spanish", PT: "Portuguese", KR: "Korean", ZH: "Chinese",
};

function yearOf(release_date: string | null): string {
  return release_date ? release_date.slice(0, 4) : "";
}

export type ListingFields = {
  year: string;
  game: string;
  set: string;
  setcode: string;
  name: string;
  number: string;
  rarity: string;
  rarityAbbr: string;
  finish: string;
  condition: string;
  conditionLabel: string;
  grade: string; // "PSA 10" or ""
  grader: string; // "PSA" or ""
  cert: string; // grader's certification number, "" when raw/unknown
  language: string; // code
  languageName: string;
  sku: string;
};

const CONDITION_LABEL: Record<string, string> = {
  NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged",
};

export function listingFields(
  vf: VariantFull,
  inv: Pick<InventoryRow, "condition" | "language" | "sku"> & { cert?: string | null },
  grade?: string | null
): ListingFields {
  const g = grade ?? "";
  return {
    year: yearOf(vf.release_date),
    game: vf.game_name,
    set: vf.set_name,
    setcode: vf.set_code ?? "",
    name: vf.card_name,
    number: vf.number ?? "",
    rarity: vf.rarity ?? "",
    rarityAbbr: rarityAbbr(vf.rarity),
    finish: FINISH_TITLE[vf.finish] ?? vf.finish_label ?? "",
    condition: inv.condition,
    conditionLabel: CONDITION_LABEL[inv.condition] ?? inv.condition,
    grade: g,
    grader: g ? g.split(" ")[0] : "",
    cert: g ? (inv.cert ?? "").trim() : "",
    language: inv.language,
    languageName: LANG_NAME[inv.language] ?? inv.language,
    sku: inv.sku,
  };
}

/**
 * Build an ≤80-char eBay title. With a template, fills {placeholders}; without,
 * assembles a prioritized token list (spec example:
 * "2024 One Piece OP05 Monkey D. Luffy #119 SEC NM English") and drops the
 * lowest-priority tokens until it fits — never the card name or number.
 */
export function buildTitle(f: ListingFields, template?: string | null): string {
  if (template && template.trim()) {
    const filled = template.replace(/\{(\w+)\}/g, (_, k: string) => {
      const map: Record<string, string> = {
        year: f.year, game: f.game, set: f.set, setcode: f.setcode, name: f.name,
        number: f.number ? "#" + f.number : "", rarity: f.rarity, rarityabbr: f.rarityAbbr,
        finish: f.finish, condition: f.condition, conditionlabel: f.conditionLabel,
        grade: f.grade, grader: f.grader, cert: f.cert, language: f.languageName, lang: f.language, sku: f.sku,
      };
      return map[k.toLowerCase()] ?? "";
    });
    return squeeze(filled).slice(0, EBAY_TITLE_MAX).trim();
  }

  // Prioritized tokens: name + number are mandatory; the rest drop right-to-left.
  const graded = !!f.grade;
  const optional: string[] = [];
  optional.push(f.year); // 0
  optional.push(f.game); // 1
  optional.push(f.setcode || f.set); // 2
  const mandatory = `${f.name}${f.number ? " #" + f.number : ""}`;
  const tail: string[] = [];
  // Drop the rarity token when the finish already conveys it (e.g. Rare Holo +
  // Holo finish → just "Holo") to avoid "Holo Holo".
  const finishLc = f.finish.toLowerCase();
  if (f.rarityAbbr && !(f.finish && finishLc.includes(f.rarityAbbr.toLowerCase()))) tail.push(f.rarityAbbr);
  if (f.finish) tail.push(f.finish);
  tail.push(graded ? f.grade : f.condition);
  tail.push(f.languageName);

  const assemble = (opt: string[], tl: string[]) => squeeze([...opt, mandatory, ...tl].join(" "));

  let opt = optional.slice();
  let tl = tail.slice();
  // Drop tail tokens first (language, then condition/grade, finish, rarity),
  // then leading context (year, game, set) until within the limit.
  while (assemble(opt, tl).length > EBAY_TITLE_MAX) {
    if (tl.length > 1) tl.pop();
    else if (opt.length) opt.shift();
    else break;
  }
  return assemble(opt, tl).slice(0, EBAY_TITLE_MAX).trim();
}

function squeeze(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** eBay item specifics (Name → Value). Empty values are omitted. */
export function buildSpecifics(f: ListingFields): Record<string, string> {
  const s: Record<string, string> = {
    Game: f.game,
    "Card Name": f.name,
    Set: f.set,
    "Card Number": f.number,
    Rarity: f.rarity,
    Finish: f.finish || "Regular",
    Language: f.languageName,
    Year: f.year,
    Graded: f.grade ? "Yes" : "No",
  };
  if (f.grade) {
    s["Grade"] = f.grade.replace(/^[A-Z]+\s*/, "");
    s["Professional Grader"] = f.grader;
    s["Certification Number"] = f.cert;
  } else {
    s["Card Condition"] = f.conditionLabel;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) if (v !== "" && v != null) out[k] = v;
  return out;
}

// ---- description templates ------------------------------------------------
// CardUploader's Configuration → General → "Description Templates": up to three
// saved templates with insertable variables, one active. Stored per seller as
// JSON ({active, items:[{name, body}]}); the active body fills {variables} below.

export const DESCRIPTION_TEMPLATE_MAX = 3;

export const DESCRIPTION_VARS: Array<{ k: string; label: string; hint: string }> = [
  { k: "title", label: "Title", hint: "The generated listing title" },
  { k: "name", label: "Card Name", hint: "Name of the card" },
  { k: "number", label: "Card Number", hint: "Full card number (e.g. 4/102)" },
  { k: "set", label: "Set Name", hint: "Full name of the set" },
  { k: "setcode", label: "Set Code", hint: "Set code abbreviation" },
  { k: "game", label: "Card Game", hint: "Card game name" },
  { k: "year", label: "Year", hint: "Year the set was released" },
  { k: "rarity", label: "Rarity", hint: "Card rarity" },
  { k: "finish", label: "Finish", hint: "Card finish (e.g. Holo)" },
  { k: "condition", label: "Condition", hint: "Condition code (NM, LP…)" },
  { k: "conditionlabel", label: "Condition (full)", hint: "Full condition text (e.g. Near Mint)" },
  { k: "language", label: "Language", hint: "Card language" },
  { k: "grade", label: "Grade", hint: "Grade when graded (e.g. PSA 10), else empty" },
  { k: "grader", label: "Grade Company", hint: "PSA, CGC, BGS… when graded, else empty" },
  { k: "cert", label: "Certification Number", hint: "Grader's cert number when graded, else empty" },
  { k: "sku", label: "SKU", hint: "Stock keeping unit" },
  { k: "price", label: "Price", hint: "Your listing price" },
];

export type DescriptionTemplates = { active: number; items: Array<{ name: string; body: string }> };

/** The built-in description, expressed as a template so the editor can start from it. */
export const DEFAULT_DESCRIPTION_TEMPLATE = [
  "{name} #{number} — {set} ({year})",
  "",
  "Game: {game}",
  "Set: {set} ({setcode})",
  "Rarity: {rarity}",
  "Finish: {finish}",
  "Language: {language}",
  "Condition: {conditionlabel} ({condition})",
  "",
  "Card shipped in a penny sleeve + top loader, securely packaged. Combined shipping available — check my other listings for more singles.",
].join("\n");

/** Parse stored templates JSON; empty/invalid → no templates. */
export function parseDescriptionTemplates(json: string | null | undefined): DescriptionTemplates {
  if (!json || !json.trim()) return { active: 0, items: [] };
  try {
    const o = JSON.parse(json);
    const items = Array.isArray(o?.items)
      ? o.items
          .slice(0, DESCRIPTION_TEMPLATE_MAX)
          .map((it: any, i: number) => ({ name: String(it?.name ?? `Template ${i + 1}`).slice(0, 40), body: String(it?.body ?? "").slice(0, 8000) }))
      : [];
    const active = Math.max(0, Math.min(items.length ? items.length - 1 : 0, Number(o?.active) || 0));
    return { active, items };
  } catch {
    return { active: 0, items: [] };
  }
}

export function serializeDescriptionTemplates(t: DescriptionTemplates): string | null {
  const items = t.items.filter((it) => it.body.trim()).slice(0, DESCRIPTION_TEMPLATE_MAX);
  if (!items.length) return null;
  return JSON.stringify({ active: Math.max(0, Math.min(items.length - 1, t.active)), items });
}

/** The active template body, or null to use the built-in description. */
export function activeDescriptionTemplate(json: string | null | undefined): string | null {
  const t = parseDescriptionTemplates(json);
  const body = t.items[t.active]?.body;
  return body && body.trim() ? body : null;
}

/** Fill {variables} in a template; lines that end up blank-after-label ("Rarity: ") are dropped. */
export function fillDescriptionTemplate(tpl: string, f: ListingFields, priceCents: number | null, title = ""): string {
  const map: Record<string, string> = {
    title, name: f.name, number: f.number, set: f.set, setcode: f.setcode, game: f.game, year: f.year,
    rarity: f.rarity, finish: f.finish, condition: f.condition, conditionlabel: f.conditionLabel,
    language: f.languageName, lang: f.language, grade: f.grade, grader: f.grader, cert: f.cert, sku: f.sku,
    price: priceCents != null ? money(priceCents) : "",
  };
  return tpl
    .split(/\r?\n/)
    .map((line) => {
      const had = /\{\w+\}/.test(line);
      const out = line.replace(/\{(\w+)\}/g, (_, k: string) => map[k.toLowerCase()] ?? "");
      // "Label: {var}" with an empty var, or a line that was only variables → drop it
      if (had && (/^[^:]{0,40}:\s*$/.test(out.trim()) || out.trim() === "" || /^[#()\s—-]*$/.test(out.trim()))) return null;
      return out.replace(/\(\s*\)/g, "").replace(/\s+—\s*$/, "").replace(/[ \t]+$/, "");
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildDescription(f: ListingFields, priceCents: number | null, template?: string | null, title = ""): string {
  if (template && template.trim()) return fillDescriptionTemplate(template, f, priceCents, title);
  const cond = f.grade ? `${f.grade} (graded)` : `${f.conditionLabel} (${f.condition})`;
  // Conditional lines are null when their field is empty; the deliberate blank
  // separators ("") stay.
  const lines: Array<string | null> = [
    `${f.name}${f.number ? " #" + f.number : ""} — ${f.set}${f.year ? " (" + f.year + ")" : ""}`,
    ``,
    `Game: ${f.game}`,
    `Set: ${f.set}${f.setcode ? " (" + f.setcode + ")" : ""}`,
    f.rarity ? `Rarity: ${f.rarity}` : null,
    f.finish ? `Finish: ${f.finish}` : null,
    `Language: ${f.languageName}`,
    `Condition: ${cond}`,
    f.cert ? `Certification Number: ${f.cert}` : null,
    ``,
    `Card shipped in a penny sleeve + top loader, securely packaged. Combined shipping available — check my other listings for more singles.`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

// ---- eBay File Exchange CSV ----------------------------------------------

export type ListingExportRow = {
  vf: VariantFull;
  inv: InventoryRow;
  title: string;
  description: string;
  specifics: Record<string, string>;
  category: string;
  format: "fixed" | "auction";
  priceCents: number | null;
  startCents: number | null;
  durationDays: number | null;
  grade?: string | null;
};

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * eBay File Exchange flat-file CSV. Uses the widely-supported column set; item
 * specifics ride in C:<Name> columns. ConditionID follows eBay's trading-card
 * convention (Ungraded=4000, Graded=2750) — the seller confirms per category on
 * import. This is a template/fallback; the API path does live pre-flight checks.
 */
export function toEbayCsv(rows: ListingExportRow[], seller: Seller): string {
  // union of all specifics names → stable C: columns
  const specNames: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.specifics)) if (!specNames.includes(k)) specNames.push(k);

  const header = [
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
    "CustomLabel",
    "*Category",
    "*Title",
    "*Description",
    "*ConditionID",
    "PicURL",
    "*Format",
    "*Duration",
    "*StartPrice",
    "*Quantity",
    "*Location",
    "ShippingProfileName",
    "ReturnProfileName",
    "PaymentProfileName",
    ...specNames.map((n) => `C:${n}`),
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const graded = !!(r.grade && r.grade.trim());
    const conditionId = graded ? "2750" : "4000";
    const format = r.format === "auction" ? "Auction" : "FixedPrice";
    const duration = r.format === "auction" ? `Days_${r.durationDays ?? 7}` : "GTC";
    const price = r.format === "auction" ? r.startCents ?? r.priceCents : r.priceCents;
    const pic = r.vf.image_large || r.vf.image_small || "";
    const row = [
      "Add",
      r.inv.sku,
      r.category,
      r.title,
      r.description.replace(/\n/g, "<br>"),
      conditionId,
      pic,
      format,
      duration,
      price != null ? (price / 100).toFixed(2) : "",
      String(r.inv.quantity),
      seller.item_location ?? "United States",
      seller.ebay_shipping_policy ?? "",
      seller.ebay_return_policy ?? "",
      seller.ebay_payment_policy ?? "",
      ...specNames.map((n) => r.specifics[n] ?? ""),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export { money };
