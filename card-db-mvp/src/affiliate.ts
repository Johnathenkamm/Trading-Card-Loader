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
  const v = (process.env.EBAY_EPN_CAMPID ?? "").trim();
  return /^\d{6,12}$/.test(v) ? v : null;
}

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

/** eBay's live-listings search for a card, tagged. */
export function ebaySearchUrl(query: string, customid = "ebay-listed"): string {
  return ebayLink("https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query), customid);
}

/** eBay's completed + sold filter for a card, tagged. */
export function ebaySoldUrl(query: string, customid = "ebay-sold"): string {
  return ebayLink("https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(query) + "&LH_Sold=1&LH_Complete=1", customid);
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

/** TCGplayer product page for a catalog product id, tagged. */
export function tcgplayerProductUrl(productId: string | number | null | undefined): string | null {
  if (productId == null || productId === "") return null;
  return tcgplayerLink(`https://www.tcgplayer.com/product/${encodeURIComponent(String(productId))}`);
}
