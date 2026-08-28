// Structured title builder — the visual "Title Structure Editor" model.
//
// CardUploader's standout feature (see the walkthrough video) is a drag-to-order
// list of title "building blocks", each with a per-block CAPS toggle, an 80-char
// optimization switch, and a live preview. We model the same thing as data: an
// ordered list of blocks (a catalog token, or literal custom text) plus an
// `optimize` flag. This renders through the SAME ListingFields the rest of the
// listing pipeline uses, so a structure edited in Settings flows identically into
// the review queue, the listing builder, and the eBay File Exchange CSV.
//
// Precedence (resolved in compose.ts): a saved structure wins; else the legacy
// {placeholder} title_template; else the built-in prioritized optimizer.

import type { ListingFields } from "./listing.ts";

export const TITLE_MAX = 80;

export type TitleBlock =
  | { t: "token"; k: string; caps?: boolean }
  | { t: "text"; v: string; caps?: boolean };

export type TitleStructure = { blocks: TitleBlock[]; optimize: boolean };

// Available blocks. `drop` = optimization priority: when a title exceeds 80 chars
// and optimization is on, blocks with the HIGHEST drop are removed first. The
// card name and number are anchored (drop 0) and never removed.
export const TITLE_TOKENS: Array<{ k: string; label: string; drop: number }> = [
  { k: "name", label: "Card Name", drop: 0 },
  { k: "number", label: "Card Number", drop: 0 },
  { k: "grade", label: "Grade", drop: 15 },
  { k: "condition", label: "Condition", drop: 25 },
  { k: "finish", label: "Finish", drop: 35 },
  { k: "rarity", label: "Rarity", drop: 45 },
  { k: "language", label: "Language", drop: 50 },
  { k: "setcode", label: "Set Number", drop: 60 },
  { k: "set", label: "Set Name", drop: 70 },
  { k: "game", label: "Card Game", drop: 78 },
  { k: "year", label: "Year", drop: 85 },
  { k: "sku", label: "SKU", drop: 95 },
];
const TOKEN_DROP = new Map(TITLE_TOKENS.map((t) => [t.k, t.drop]));
const NEVER_DROP = new Set(["name", "number"]);
const CUSTOM_TEXT_DROP = 55;

// Mirrors the built-in optimizer's example ordering:
// "2024 One Piece OP05 Monkey D. Luffy #119 SEC NM English".
export const DEFAULT_STRUCTURE: TitleStructure = {
  optimize: true,
  blocks: [
    { t: "token", k: "year" },
    { t: "token", k: "game" },
    { t: "token", k: "setcode" },
    { t: "token", k: "name" },
    { t: "token", k: "number" },
    { t: "token", k: "rarity" },
    { t: "token", k: "finish" },
    { t: "token", k: "condition" },
    { t: "token", k: "language" },
  ],
};

/** Resolve a token key to its display value for a given card. */
function tokenValue(k: string, f: ListingFields, abbrevRarity = false): string {
  switch (k) {
    case "year": return f.year;
    case "game": return f.game;
    case "set": return f.set;
    case "setcode": return f.setcode;
    case "name": return f.name;
    case "number": return f.number ? "#" + f.number : "";
    case "rarity": return abbrevRarity ? f.rarityAbbr || f.rarity : f.rarity;
    // Condition is meaningless on a graded slab — the grade carries it.
    case "condition": return f.grade ? "" : f.condition;
    case "grade": return f.grade;
    // Match the built-in behaviour: only surface language when it's not English,
    // keeping English titles clean (the video calls this out explicitly).
    case "language": return f.language === "EN" ? "" : f.languageName;
    case "sku": return f.sku;
    default: return "";
  }
}

const cap = (s: string, on?: boolean): string => (on ? s.toUpperCase() : s);

/** Parse a stored structure JSON string; returns null if empty/invalid. */
export function parseStructure(json: string | null | undefined): TitleStructure | null {
  if (!json || !json.trim()) return null;
  try {
    const o = JSON.parse(json);
    if (!o || !Array.isArray(o.blocks)) return null;
    const blocks: TitleBlock[] = [];
    for (const b of o.blocks) {
      if (b && b.t === "text") blocks.push({ t: "text", v: String(b.v ?? ""), caps: !!b.caps });
      else if (b && b.t === "token" && typeof b.k === "string" && TOKEN_DROP.has(b.k))
        blocks.push({ t: "token", k: b.k, caps: !!b.caps });
    }
    return { blocks, optimize: !!o.optimize };
  } catch {
    return null;
  }
}

/** Normalize a structure back to a compact JSON string for storage. */
export function serializeStructure(st: TitleStructure): string {
  const blocks = st.blocks.map((b) =>
    b.t === "text"
      ? { t: "text", v: b.v, ...(b.caps ? { caps: true } : {}) }
      : { t: "token", k: b.k, ...(b.caps ? { caps: true } : {}) }
  );
  return JSON.stringify({ optimize: !!st.optimize, blocks });
}

type Mat = { val: string; drop: number; anchored: boolean; caps?: boolean; kind: "token" | "text"; k?: string };

/**
 * Render a structured title for a card. Applies per-block CAPS, then — when
 * optimization is on and the result exceeds 80 chars — first abbreviates the
 * rarity, then removes the lowest-value blocks (highest `drop`) until it fits,
 * never removing the card name or number. Returns the final title plus the true
 * (pre-truncation) length so the editor can warn when a title is over budget.
 */
export function renderStructuredTitle(f: ListingFields, st: TitleStructure): { title: string; length: number; over: boolean } {
  let mats: Mat[] = st.blocks
    .map((b): Mat => {
      if (b.t === "text")
        return { val: cap(b.v.trim(), b.caps), drop: CUSTOM_TEXT_DROP, anchored: false, caps: b.caps, kind: "text" };
      return {
        val: cap(tokenValue(b.k, f), b.caps),
        drop: TOKEN_DROP.get(b.k) ?? CUSTOM_TEXT_DROP,
        anchored: NEVER_DROP.has(b.k),
        caps: b.caps,
        kind: "token",
        k: b.k,
      };
    })
    .filter((m) => m.val !== "");

  const join = (arr: Mat[]): string => arr.map((m) => m.val).join(" ").replace(/\s+/g, " ").trim();

  if (st.optimize && join(mats).length > TITLE_MAX) {
    // 1) abbreviate rarity ("Special Illustration Rare" -> "IR", etc.)
    mats = mats.map((m) => (m.kind === "token" && m.k === "rarity" ? { ...m, val: cap(f.rarityAbbr || f.rarity, m.caps) } : m));
    // 2) drop highest-`drop` removable blocks until within budget
    while (join(mats).length > TITLE_MAX) {
      let idx = -1;
      let best = -1;
      mats.forEach((m, i) => {
        if (!m.anchored && m.drop > best) {
          best = m.drop;
          idx = i;
        }
      });
      if (idx < 0) break;
      mats.splice(idx, 1);
    }
  }

  const full = join(mats);
  return { title: full.slice(0, TITLE_MAX).trim(), length: full.length, over: full.length > TITLE_MAX };
}
