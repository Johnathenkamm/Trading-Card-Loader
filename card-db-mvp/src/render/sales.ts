// Public Sales Lookup page (/sales) — see src/sales.ts for the search logic
// and the research rationale (CardUploader's /sales is the model; canonical
// card matching is our edge).

import { esc, money, fmtDate } from "../util.ts";
import { breadcrumb, sourceChip, demoNote } from "./components.ts";
import { soldListingLink, type SalesParams, type SalesResult, type SalesRow } from "../sales.ts";
import type { SoldSale } from "../db.ts";

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  return u.toString();
}

function saleCell(s: SoldSale): string {
  if (s.sale_type === "best_offer") {
    const pct =
      s.list_price_cents && s.list_price_cents > s.price_cents
        ? ` <span style="color:var(--muted)">−${Math.round((1 - s.price_cents / s.list_price_cents) * 100)}%</span>`
        : "";
    const listed = s.list_price_cents
      ? ` <s style="color:var(--muted)">${money(s.list_price_cents, s.currency)}</s>${pct}`
      : "";
    return `<span class="chip">Best Offer</span>${listed}`;
  }
  if (s.sale_type === "auction") return `<span class="chip">Auction${s.bids ? ` · ${s.bids} bids` : ""}</span>`;
  if (s.sale_type === "bin") return `<span class="chip">Buy It Now</span>`;
  return "";
}

/**
 * `base` is the page the filter pills and search form post back to: the public
 * `/sales`, or `/app/sales-lookup` when the same lookup is rendered inside the
 * seller workspace (`embedded` then drops the public page chrome — wrap,
 * breadcrumb, h1 — because the workspace header already carries those).
 */
export function renderSales(
  p: SalesParams,
  r: SalesResult,
  opts: { base?: string; embedded?: boolean } = {}
): { html: string; title: string; description: string; jsonLd: unknown[] } {
  const base = opts.base ?? "/sales";
  const filt = (over: Partial<SalesParams>) =>
    `${base}?${qs({ q: p.q, market: p.market, type: p.type, grade: p.grade, sort: p.sort, ...over })}`;
  const pill = (label: string, href: string, active: boolean) =>
    `<a class="${active ? "active" : ""}" href="${href}">${esc(label)}</a>`;

  const marketBar = [
    pill("All", filt({ market: undefined }), !p.market),
    pill("eBay", filt({ market: "ebay" }), p.market === "ebay"),
    pill("Goldin", filt({ market: "goldin" }), p.market === "goldin"),
    pill("Fanatics", filt({ market: "fanatics" }), p.market === "fanatics"),
  ].join("");
  const typeBar = [
    pill("All", filt({ type: undefined }), !p.type),
    pill("Auctions", filt({ type: "auction" }), p.type === "auction"),
    pill("BIN", filt({ type: "bin" }), p.type === "bin"),
    pill("Best Offer", filt({ type: "best_offer" }), p.type === "best_offer"),
  ].join("");
  const sortBar = [
    pill("Newest", filt({ sort: undefined }), !p.sort || p.sort === "new"),
    pill("Price ↓", filt({ sort: "price" }), p.sort === "price"),
  ].join("");

  const stats = `<div class="sales-stats">
    <div class="stat"><div class="v">${r.stats.last_cents != null ? money(r.stats.last_cents, r.stats.currency) : "—"}</div><div class="k">Last sale</div></div>
    <div class="stat"><div class="v">${r.stats.last3_avg_cents != null ? money(r.stats.last3_avg_cents, r.stats.currency) : "—"}</div><div class="k">Last 3 avg</div></div>
    <div class="stat"><div class="v">${r.total.toLocaleString()}</div><div class="k">Total sales</div></div>
  </div>`;

  const cardBanner = r.matchedCard
    ? `<div class="panel" style="display:flex;align-items:center;gap:14px;padding:12px 16px">
        ${r.matchedCard.image ? `<img src="${esc(r.matchedCard.image)}" alt="" width="44" height="61" style="border-radius:4px">` : ""}
        <div>
          <div><b>${esc(r.matchedCard.name)}</b>${r.matchedCard.number ? ` · #${esc(r.matchedCard.number)}` : ""} · ${esc(r.matchedCard.set_name)}</div>
          <div class="sub" style="margin:2px 0 0">Recognized your search — results include every archived sale of this exact card, however the listing was titled.</div>
        </div>
        <a class="btn" style="margin-left:auto" href="${esc(r.matchedCard.slug)}">View card →</a>
      </div>`
    : "";

  const gradeNote = r.gradeFilter
    ? `<div class="applied"><span class="tag">Showing only ${esc(r.gradeFilter)} <a href="${filt({ grade: "all" })}" aria-label="Disable grade filter">×</a></span></div>`
    : "";

  const rows = r.rows
    .map(
      (s) => `<tr>
      <td class="date">${esc(fmtDate(s.sold_on))}</td>
      <td>${sourceChip(s.marketplace)}</td>
      <td class="title-cell">${(() => {
        // Title opens OUR card page whenever the sale is canonicalized (always
        // reachable, never a dead marketplace page); the original listing, when
        // its URL passes soldListingLink, is a separate chip. Unmatched rows
        // with a good listing URL link straight to the listing.
        const cardHref = s.card_id && s.card_slug ? `/c/${esc(s.card_slug)}-${s.card_id}` : null;
        const listing = soldListingLink(s);
        const title = cardHref
          ? `<a href="${cardHref}" title="Open this card — every archived sale, market price and grades">${esc(s.title)}</a>`
          : listing
            ? `<a href="${esc(listing)}" target="_blank" rel="noopener nofollow">${esc(s.title)}</a>`
            : esc(s.title);
        const chips = [
          cardHref && listing ? `<a class="chip" href="${esc(listing)}" target="_blank" rel="noopener nofollow" title="Original listing on ${esc(s.marketplace)}">listing ↗</a>` : "",
          s.is_demo ? `<span class="chip" title="Sample-feed row — the original listing page doesn't exist">sample</span>` : "",
        ].filter(Boolean);
        return title + (chips.length ? " " + chips.join(" ") : "");
      })()}</td>
      <td>${s.grade ? esc(s.grade) : `<span class="chip">Raw${s.condition ? " · " + esc(s.condition) : ""}</span>`}</td>
      <td>${saleCell(s)}</td>
      <td class="price">${money(s.price_cents, s.currency)}</td>
    </tr>`
    )
    .join("");

  const table = rows
    ? `<div class="comps-wrap"><table class="comps sales-table">
        <thead><tr><th>Date</th><th>Market</th><th>Listing</th><th>Grade</th><th>Sale</th><th class="price">Price</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : `<div class="empty"><h2>No archived sales${p.q ? ` for “${esc(p.q)}”` : ""}</h2>
       <p>The archive grows with every imported feed — try a broader search, or remove filters.</p></div>`;

  const sampleNote = r.allDemo
    ? demoNote(
        "The archive currently holds a <b>sample feed import</b> — plug a licensed sold-data feed into <code>npm run import:sold</code> and this page goes live with real depth."
      )
    : "";

  const searchForm = `<form class="sales-search" action="${esc(base)}" method="get" role="search">
        <input type="search" name="q" value="${esc(p.q ?? "")}" placeholder="e.g. Charizard PSA 10" aria-label="Search sold listings" autofocus>
        <button class="btn primary" type="submit">Search</button>
      </form>`;
  const body = `${p.q || r.total ? stats : ""}
    ${cardBanner}
    ${gradeNote}
    <div class="sales-filters">
      <div class="fgroup"><span class="fl">Market</span>${marketBar}</div>
      <div class="fgroup"><span class="fl">Type</span>${typeBar}</div>
      <div class="fgroup"><span class="fl">Sort</span>${sortBar}</div>
    </div>
    ${sampleNote}
    ${table}`;

  const html = opts.embedded
    ? `<div class="sales-head sales-head-embedded">${searchForm}</div>${body}`
    : `<div class="wrap">
    ${breadcrumb([{ label: "Sales Lookup" }])}
    <div class="sales-head">
      <h1>Sold-price lookup</h1>
      <p class="sub">Real sales from the archive — eBay, Goldin and Fanatics, with accepted Best Offer prices revealed and every recognized sale tied to its exact card.</p>
      ${searchForm}
    </div>
    ${body}
  </div>`;

  return {
    html,
    title: p.q ? `“${p.q}” sold prices — Sales Lookup | CardIndex` : "Card sold-price lookup | CardIndex",
    description:
      "Free trading-card sold-price search: real sales from eBay, Goldin and Fanatics with accepted Best Offer prices revealed, canonicalized to exact cards.",
    jsonLd: [],
  };
}
