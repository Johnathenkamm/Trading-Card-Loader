// Affiliate tagging for every outbound marketplace link.
//
// The site owner is an eBay Partner Network (EPN) affiliate: any eBay link a
// visitor follows from here — "eBay listed", "eBay sold", the Live-on-eBay
// panel rows, archived sold listings — should carry their campaign so the
// resulting purchases pay commission. Same idea for TCGplayer, whose affiliate
// program runs on Impact and hands out a query-string template per partner.
//
// Both are pure URL rewrites driven by env:
//   EBAY_EPN_CAMPID=5338XXXXXX          the 10-digit EPN campaign id (required
//                                        for tagging; nothing is added without it)
//   EBAY_EPN_MKRID=711-53200-19255-0     rotation id (defaults to the US site)
//   EBAY_EPN_TOOLID=10001                tool id (EPN's default for custom links)
//   TCGPLAYER_AFFILIATE_QS=utm_source=impact&utm_medium=affiliate&utm_campaign=YOURSHOP
//                                        appended verbatim to every TCGplayer URL
//
// Link shape (EPN docs, "Creating an EPN tracking link"):
//   {target}?mkevt=1&mkcid=1&mkrid={rotation}&campid={campaign}&toolid={tool}&customid={sub id}
// `customid` is a free-form sub-id (≤ 256 chars) — we pass where on the site
// the click came from so the EPN reports show which surface earns.

export function epnCampaignId(): string | null {
  // console-saved value (owner console → eBay) over the env
  const v = epnCampaignSetting();
  return /^\d{6,12}$/.test(v) ? v : null;
}

import { epnCampaignSetting } from "./app/ebay-config.ts";
import { ebayCategory } from "./app/listing.ts";

export function affiliateConfigured(): boolean {
  return epnCampaignId() != null || !!(process.env.TCGPLAYER_AFFILIATE_QS ?? "").trim();
}

const EPN_KEYS = ["mkevt", "mkcid", "mkrid", "campid", "toolid", "customid"];

/**
 * Tag an eBay URL with the owner's EPN campaign. Non-eBay hosts and unparsable
 * strings come back untouched; an already-tagged link is re-tagged with ours
 * (a page copied from elsewhere shouldn't credit someone else's campaign).
 */
export function ebayLink(url: string, customid = "cardindex"): string {
  const campid = epnCampaignId();
  if (!campid || !url) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname.toLowerCase();
  if (!(host === "ebay.com" || host.endsWith(".ebay.com") || /(^|\.)ebay\.[a-z.]+$/.test(host))) return url;
  for (const k of EPN_KEYS) u.searchParams.delete(k);
  u.searchParams.set("mkevt", "1");
  u.searchParams.set("mkcid", "1");
  u.searchParams.set("mkrid", (process.env.EBAY_EPN_MKRID ?? "").trim() || "711-53200-19255-0");
  u.searchParams.set("campid", campid);
  u.searchParams.set("toolid", (process.env.EBAY_EPN_TOOLID ?? "").trim() || "10001");
  u.searchParams.set("customid", customid.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 256));
  return u.toString();
}

/**
 * eBay search terms for a card: its name plus the collector number, nothing
 * else — the query CardUploader sends ("Fish-Man Island OP11-117"). Adding the
 * set name and finish (as we used to) matches far fewer listing titles, which
 * is why "eBay sold" so often came back empty. Parenthesised catalog suffixes
 * are cleaned up because eBay reads "(a, b)" as an OR group: "(060)" repeats
 * the collector number and is dropped; "(Alternate Art)" keeps its words.
 */
export function ebayCardQuery(name: string, number?: string | null): string {
  const n = (name ?? "")
    .replace(/\(\s*\d+\s*\)/g, " ")
    .replace(/[()"*,]/g, " ")
    .replace(/(^|\s)-+/g, " ") // a leading "-" would exclude the word
    .replace(/\s+/g, " ")
    .trim();
  return [n, (number ?? "").trim()].filter(Boolean).join(" ");
}

/** eBay leaf category for a game's singles (CCG Individual Cards, or MTG Individual Cards). */
export function ebayCategoryFor(gameSlug: string | null | undefined): string | null {
  return gameSlug ? ebayCategory(gameSlug) : null;
}

function ebaySearchBase(category: string | null | undefined): string {
  const c = (category ?? "").replace(/\D/g, "");
  return c ? `https://www.ebay.com/sch/${c}/i.html?_dcat=${c}&` : "https://www.ebay.com/sch/i.html?";
}

/** eBay's live-listings search for a card, scoped to the game's category when known, tagged. */
export function ebaySearchUrl(query: string, customid = "ebay-listed", category?: string | null): string {
  return ebayLink(ebaySearchBase(category) + "_nkw=" + encodeURIComponent(query), customid);
}

/** eBay's completed + sold filter for a card, scoped to the game's category when known, tagged. */
export function ebaySoldUrl(query: string, customid = "ebay-sold", category?: string | null): string {
  return ebayLink(ebaySearchBase(category) + "_nkw=" + encodeURIComponent(query) + "&LH_Sold=1&LH_Complete=1", customid);
}

/**
 * The disclosure the eBay Partner Network requires wherever tagged links
 * appear (CardUploader shows the same line on its results page). Empty when
 * nothing is tagged, so untagged deployments show no claim they don't make.
 */
export function affiliateDisclosure(): string {
  const ebay = epnCampaignId() != null;
  const tcg = !!(process.env.TCGPLAYER_AFFILIATE_QS ?? "").trim();
  if (!ebay && !tcg) return "";
  const who = ebay && tcg ? "an eBay Partner and a TCGplayer affiliate" : ebay ? "an eBay Partner" : "a TCGplayer affiliate";
  const links = ebay && tcg ? "eBay or TCGplayer links" : ebay ? "eBay links" : "TCGplayer links";
  return `<p class="aff-note">As ${who}, we may be compensated if you buy through ${links} on this page.</p>`;
}

/** Append the TCGplayer (Impact) affiliate query string when one is configured. */
export function tcgplayerLink(url: string): string {
  const qs = (process.env.TCGPLAYER_AFFILIATE_QS ?? "").trim().replace(/^[?&]+/, "");
  if (!qs || !url) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!/(^|\.)tcgplayer\.com$/.test(u.hostname.toLowerCase())) return url;
  for (const [k, v] of new URLSearchParams(qs)) u.searchParams.set(k, v);
  return u.toString();
}

const TCG_CONDITION: Record<string, string> = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged" };
const TCG_LANGUAGE: Record<string, string> = { EN: "English", JP: "Japanese", DE: "German", FR: "French", IT: "Italian", ES: "Spanish", PT: "Portuguese", KR: "Korean", ZH: "Chinese (S)" };

/**
 * TCGplayer product page for a catalog product id, tagged. With a condition
 * and language it opens pre-filtered to them (`Condition=Near+Mint&Language=
 * English`, as CardUploader links), so the listings shown are comparable to
 * the card in hand.
 */
export function tcgplayerProductUrl(
  productId: string | number | null | undefined,
  opts: { condition?: string | null; language?: string | null } = {}
): string | null {
  if (productId == null || productId === "") return null;
  const u = new URL(`https://www.tcgplayer.com/product/${encodeURIComponent(String(productId))}`);
  const cond = opts.condition ? TCG_CONDITION[opts.condition.toUpperCase()] : undefined;
  const lang = opts.language ? TCG_LANGUAGE[opts.language.toUpperCase()] : undefined;
  if (cond) u.searchParams.set("Condition", cond);
  if (lang) u.searchParams.set("Language", lang);
  return tcgplayerLink(u.toString());
}
