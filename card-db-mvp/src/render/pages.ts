import { esc, money, fmtDate } from "../util.ts";
import {
  getGames,
  getAllSets,
  getSetsForGame,
  getCardsInSet,
  getVariants,
  latestMarket,
  priceHistory,
  gradedValues,
  soldComps,
  soldSalesForCard,
  latestSpread,
  trendingCards,
  counts,
  cardHeadlinePrice,
} from "../pg.ts";
import type { Game, CardSet, Card, Variant, SoldSale } from "../db.ts";
import { soldListingLink } from "../sales.ts";
import {
  cardTile,
  cardUrl,
  breadcrumb,
  priceChart,
  sourceChip,
  finishChip,
  deltaBadge,
  demoNote,
  pager,
} from "./components.ts";
import type { SearchParams, SearchResult, FacetOption } from "../search.ts";
import { ebayConfigured } from "../ebay.ts";
import { tcgConfigured } from "../tcgplayer.ts";

const ORIGIN = ""; // relative canonicals keep it host-agnostic for the demo

function setTile(s: CardSet): string {
  const yr = s.release_date ? s.release_date.slice(0, 4) : "";
  return `<a class="tile" href="/s/${esc(s.slug)}" style="text-decoration:none">
    <div class="img" style="aspect-ratio:auto;min-height:96px;padding:16px">${s.image_url ? `<img src="${esc(s.image_url)}" alt="${esc(s.name)}" loading="lazy" style="max-height:64px">` : `<span class="nm">${esc(s.name)}</span>`}</div>
    <div class="body">
      <div class="nm">${esc(s.name)}</div>
      <div class="meta">${esc(s.game_name ?? "")}${yr ? " · " + yr : ""} · ${s.card_count} cards</div>
    </div>
  </a>`;
}

// ---- Home -----------------------------------------------------------------

// Simple line icons (stroke = currentColor) for the feature row and steps.
const ICONS: Record<string, string> = {
  scan: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h1.5L8 4h8l1.5 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="12.5" r="3.3"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 3v2M12 3v2M15 3v2M9 19v2M12 19v2M15 19v2M3 9h2M3 12h2M3 15h2M19 9h2M19 12h2M19 15h2"/></svg>`,
  price: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13 21a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1 0-2.8L11.6 4.4a2 2 0 0 1 1.4-.6l5 .1a2 2 0 0 1 2 2l.1 5a2 2 0 0 1-.5 1.5Z"/><circle cx="16" cy="8" r="1.2"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m21 8-9-5-9 5v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>`,
  rocket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15c-1.6 1.6-2 5.2-2 5.2s3.6-.4 5.2-2M8.5 12.5a13 13 0 0 1 8-8.5c1.6 0 2.6 0 3.2.6s.6 1.6.6 3.2a13 13 0 0 1-8.5 8Z"/><circle cx="14.5" cy="9.5" r="1.5"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 3 10.6l6.7 2.7L12.4 20 21 3Z"/><path d="M21 3 9.7 13.3"/></svg>`,
};

function feature(icon: string, title: string, desc: string): string {
  return `<div class="feat"><div class="feat-ic">${ICONS[icon]}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;
}
function step(n: number, icon: string, title: string, desc: string, last = false): string {
  return `<div class="step"><div class="step-n">${n}</div><div class="step-ic">${ICONS[icon]}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>${last ? "" : `<div class="step-arrow" aria-hidden="true">→</div>`}`;
}

export async function renderHome(): Promise<{ html: string; title: string; description: string; jsonLd: unknown[] }> {
  const c = await counts();
  const trending = await trendingCards(10);
  const hero = trending[0];
  // The trust bar names the games actually in the catalog — no marketing counts.
  const games = await getGames();
  const gameNames = games.length ? games.map((g) => g.name.replace(/:.*$/, "")).join(" & ") : "Trading cards";
  // The device panel shows what a buyer wants to know about the hero card: the
  // market price, a per-grade value when the catalog has one, and a wishlist CTA.
  const heroGraded = hero ? (await gradedValues((await getVariants(hero.id)).find((v) => v.is_default)?.id ?? 0)).find((g) => /PSA 10/i.test(g.grade ?? "")) : undefined;

  const heroVisual = hero
    ? `<div class="hero-visual">
        <div class="glow" aria-hidden="true"></div>
        <div class="device">
          <div class="device-card">${(hero.image_large || hero.image_small) ? `<img src="${esc(hero.image_large || hero.image_small!)}" alt="${esc(hero.name)}" loading="eager" width="245" height="342">` : ""}</div>
          <div class="device-panel">
            <div class="dp-name">${esc(hero.name)}</div>
            <div class="dp-sub">${esc(hero.set_name)}${hero.number ? " · #" + esc(hero.number) : ""}</div>
            <span class="dp-chip">Near Mint ▾</span>
            <div class="dp-row"><span>Market price</span><b class="mono">${money(hero.price_cents, hero.currency)}</b></div>
            ${heroGraded ? `<div class="dp-row"><span>PSA 10</span><b class="mono accent">${money(heroGraded.price_cents, heroGraded.currency)}</b></div>` : `<div class="dp-row"><span>Sold prices</span><b class="mono accent">→</b></div>`}
            <a class="dp-btn" href="${cardUrl(hero)}">♡ Add to wishlist</a>
            <div class="dp-tabs"><span class="on">Price</span><span>History</span><span>Sold</span></div>
          </div>
        </div>
      </div>`
    : "";

  const html = `
<section class="home-hero">
  <div class="wrap home-hero-grid">
    <div class="home-hero-copy">
      <div class="tag">Price guide · sold history · collection tracker</div>
      <h1>Know what it's worth<br><span class="hl">before you buy.</span></h1>
      <p class="lead">Live market prices and real sold prices for every printing of ${c.cards.toLocaleString()} cards, a photo identifier for the cards in your hand, and a private place to keep your collection and wishlist.</p>
      <div class="cta-row">
        <a class="btn primary lg" href="/search">Search a card →</a>
        <a class="btn lg ghost" href="/collection/add?mode=price">Price my cards — free</a>
      </div>
      <div class="mk-strip">
        <span class="mk-lbl">Prices from</span>
        <div class="mk-logos"><span class="mk">TCGplayer</span><span class="mk-lbl">· sold history from</span><span class="mk">eBay</span><span class="mk">Goldin</span><span class="mk">Fanatics</span></div>
      </div>
    </div>
    ${heroVisual}
  </div>
</section>

<section class="feature-row">
  <div class="wrap feats">
    ${feature("ai", "Search any printing", "Every card, every set, every finish — holo, reverse, 1st edition — with its own price.")}
    ${feature("price", "Live market prices", "TCGplayer market values refreshed daily, with 30 and 90-day history and per-grade values.")}
    ${feature("send", "Real sold prices", "What cards actually sold for on eBay, Goldin and Fanatics, tied to the exact card, not a title keyword.")}
    ${feature("scan", "Identify from a photo", "Snap the cards you're holding or being offered and get every one identified and priced.")}
    ${feature("box", "Track what you own and want", "A private collection with its value, and a wishlist that flags cards when they hit your price.")}
  </div>
</section>

<section class="how" id="how">
  <div class="wrap">
    <div class="how-head"><h2>How it works</h2><p>From a card in your hand to a fair price in a few steps.</p></div>
    <div class="steps">
      ${step(1, "ai", "Search", "Type a name or number, or browse a set checklist.")}
      ${step(2, "price", "Check the price", "See today's market, the trend, and what copies actually sold for.")}
      ${step(3, "scan", "Snap a photo", "Photograph a stack or a binder page — every card identified and priced, free.")}
      ${step(4, "box", "Keep track", "Add cards to your collection or wishlist and watch their value.", true)}
    </div>
    <div class="how-cta"><a class="btn primary" href="/collection/add?mode=price">Price my cards free</a></div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec-head"><h2>Trending by value</h2><a href="/search?sort=price_desc">Browse the price guide →</a></div>
    <div class="grid cards">${trending.map((t) => cardTile({ ...t, set_name: t.set_name })).join("")}</div>
  </div>
</section>

<section class="trust-bar">
  <div class="wrap trust-grid">
    <div class="tb"><div class="tb-ic">${ICONS.scan}</div><div><b>${esc(gameNames)} today</b><span>${c.cards.toLocaleString()} cards, every printing priced from TCGplayer market data. More games as sets are added.</span></div></div>
    <div class="tb"><div class="tb-ic">${ICONS.price}</div><div><b>Graded &amp; raw</b><span>Values for PSA, BGS and CGC slabs alongside raw cards.</span></div></div>
    <div class="tb"><div class="tb-ic">${ICONS.ai}</div><div><b>Photo identification</b><span>Hundreds of cards at once, matched to the exact printing.</span></div></div>
    <div class="tb"><div class="tb-ic">${ICONS.box}</div><div><b>Private by default</b><span>Your collection is yours — never sold, shared or shown to anyone.</span></div></div>
  </div>
</section>`;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "CardIndex",
      url: ORIGIN + "/",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: ORIGIN + "/search?q={search_term_string}" },
        "query-input": "required name=search_term_string",
      },
    },
  ];
  return {
    html,
    title: "CardIndex — trading-card prices, sold history & your collection",
    description: `Look up live market prices and real sold prices for ${c.cards.toLocaleString()} trading cards by printing and grade, identify cards from a photo, and track your collection and wishlist.`,
    jsonLd,
  };
}

// ---- Browse / game --------------------------------------------------------
export async function renderBrowse(game?: Game): Promise<{ html: string; title: string; description: string; jsonLd: unknown[] }> {
  const [games, sets] = await Promise.all([
    getGames(),
    game
      ? getSetsForGame(game.id).then((ss) => ss.map((s) => ({ ...s, game_name: game.name, game_slug: game.slug })))
      : getAllSets(),
  ]);
  const grouped: Record<string, CardSet[]> = {};
  for (const s of sets) (grouped[s.game_name ?? "Other"] ??= []).push(s);

  const sections = Object.entries(grouped)
    .map(
      ([gn, ss]) => `<div class="sec-head" style="margin-top:8px"><h2>${esc(gn)}</h2><span class="eyebrow">${ss.length} sets</span></div>
      <div class="grid cards">${ss.map(setTile).join("")}</div>`
    )
    .join("");

  // Game switcher: the per-game pages used to be their own header tabs; now
  // they live here as filters so the header only carries one "Browse" entry.
  const gameTabs = `<nav class="tabs" aria-label="Filter by game" style="margin:0 0 18px">
    <a href="/browse"${game ? "" : ' class="active" aria-current="page"'}>All games</a>
    ${games
      .map(
        (g) =>
          `<a href="/g/${esc(g.slug)}"${game?.id === g.id ? ' class="active" aria-current="page"' : ""}>${esc(g.name)}</a>`
      )
      .join("")}
  </nav>`;

  const html = `<div class="wrap">
    ${breadcrumb(game ? [{ label: "Browse", href: "/browse" }, { label: game.name }] : [{ label: "Browse" }])}
    <div class="sec">
      <h1 style="font-size:1.9rem;margin-bottom:6px">${game ? esc(game.name) + " sets" : "Browse all sets"}</h1>
      <p style="color:var(--muted);margin:0 0 14px">Pick a set to see its checklist with prices, or search across everything.</p>
      ${gameTabs}
      ${sections}
    </div>
  </div>`;
  return {
    html,
    title: game ? `${game.name} sets — CardIndex` : "Browse all sets — CardIndex",
    description: game ? `Browse ${game.name} sets and card prices on CardIndex.` : "Browse every trading card set on CardIndex.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: game ? `${game.name} sets` : "Browse all sets",
      },
    ],
  };
}

// ---- Set page -------------------------------------------------------------
export async function renderSet(set: CardSet): Promise<{ html: string; title: string; description: string; jsonLd: unknown[] }> {
  const cards = await getCardsInSet(set.id);
  const tiles = (
    await Promise.all(
      cards.map(async (card) => {
        const [hp, variants] = await Promise.all([cardHeadlinePrice(card.id), getVariants(card.id)]);
        const defV = variants.find((v) => v.is_default) ?? variants[0];
        return cardTile({
          ...card,
          set_name: set.name,
          price_cents: hp?.price_cents ?? null,
          currency: hp?.currency ?? "USD",
          finish: defV?.finish,
          finish_label: defV?.finish_label,
        });
      })
    )
  ).join("");

  const yr = set.release_date ? fmtDate(set.release_date) : "";
  const html = `<div class="wrap">
    ${breadcrumb([{ label: set.game_name ?? "", href: `/g/${set.game_slug}` }, { label: set.name }])}
    <div class="set-hero">
      ${set.image_url ? `<img class="logo" src="${esc(set.image_url)}" alt="${esc(set.name)} logo">` : ""}
      <div>
        <div class="eyebrow">${esc(set.game_name ?? "")}</div>
        <h1>${esc(set.name)}</h1>
        <div class="meta">${set.card_count} cards${yr ? " · released " + yr : ""}${set.code ? " · " + esc(set.code) : ""}</div>
      </div>
      <a class="btn" style="margin-left:auto" href="/search?set=${esc(set.slug)}">Search this set</a>
    </div>
    <div class="grid cards" style="margin-top:8px">${tiles}</div>
  </div>`;
  return {
    html,
    title: `${set.name} card list & prices — CardIndex`,
    description: `All ${set.card_count} cards in ${set.name} (${set.game_name}) with market prices and variants.`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${set.name} — ${set.game_name}`,
      },
    ],
  };
}

// ---- Card detail ----------------------------------------------------------
export type CardViewerState = { owned: number; wishlist: { id: number; variant_id: number; target_cents: number | null } | null } | null;

export async function renderCard(
  card: Card,
  opts: { variantFinish?: string; range?: number; gradeTab?: string; member?: CardViewerState; msg?: string }
): Promise<{ html: string; title: string; description: string; jsonLd: unknown[]; ogImage: string | null } | null> {
  const variants = await getVariants(card.id);
  if (variants.length === 0) return null;
  const selected = variants.find((v) => v.finish === opts.variantFinish) ?? variants.find((v) => v.is_default) ?? variants[0];

  const [market, fullHistory, graded, sold, archive, spread] = await Promise.all([
    latestMarket(selected.id),
    priceHistory(selected.id),
    gradedValues(selected.id),
    soldComps(selected.id),
    soldSalesForCard(card.id, selected.id),
    latestSpread(selected.id),
  ]);
  // The canonical sold_sales archive (research §8.1) supersedes the synthetic
  // price_points comps as soon as it holds anything for this card.
  const useArchive = archive.length > 0;
  const range = opts.range === 30 ? 30 : 90;
  const history = fullHistory.slice(-range);

  // variant switcher
  const variantSwitch = (
    await Promise.all(
      variants.map(async (v) => {
        const m = await latestMarket(v.id);
        const active = v.id === selected.id ? " active" : "";
        return `<a class="vitem${active}" href="${cardUrl(card, v.finish)}">
        <span class="vf">${esc(v.finish_label)}</span>
        <span class="vp">${m ? money(m.price_cents, m.currency) : "—"}</span>
      </a>`;
      })
    )
  ).join("");

  // price panel
  const hasHistory = history.length >= 2;
  const delta = hasHistory ? deltaBadge(history[0].price_cents, history[history.length - 1].price_cents) : "";
  const histVals = history.map((h) => h.price_cents);
  const lo = histVals.length ? Math.min(...histVals) : 0;
  const hi = histVals.length ? Math.max(...histVals) : 0;

  // range links preserving variant
  const rangeLinks = [30, 90]
    .map((r) => {
      const u = `/c/${card.slug}-${card.id}?v=${encodeURIComponent(selected.finish)}&r=${r}`;
      return `<a class="${r === range ? "active" : ""}" href="${u}">${r}D</a>`;
    })
    .join("");

  // grade strip: ungraded + graded values, with sold volume
  const soldByGrade: Record<string, number> = {};
  const volumeRows: Array<{ grade: string | null }> = useArchive ? archive : sold;
  for (const s of volumeRows) soldByGrade[s.grade ?? "Ungraded"] = (soldByGrade[s.grade ?? "Ungraded"] ?? 0) + 1;
  const stripRows: string[] = [];
  if (market)
    stripRows.push(
      `<tr><td class="g">Ungraded</td><td class="val">${money(market.price_cents, market.currency)}</td><td class="vol">${soldByGrade["Ungraded"] ?? 0} sold</td></tr>`
    );
  for (const g of graded)
    stripRows.push(
      `<tr><td class="g">${esc(g.grade!)}</td><td class="val">${money(g.price_cents, g.currency)}</td><td class="vol">${soldByGrade[g.grade!] ?? 0} sold</td></tr>`
    );

  // sold comps tabs + rows
  const grades = ["all", ...Array.from(new Set(volumeRows.map((s) => s.grade ?? "Ungraded")))];
  const tab = opts.gradeTab && grades.includes(opts.gradeTab) ? opts.gradeTab : "all";
  const compTabs = grades
    .map((gr) => {
      const u = `/c/${card.slug}-${card.id}?v=${encodeURIComponent(selected.finish)}&tab=${encodeURIComponent(gr)}#comps`;
      const label = gr === "all" ? "All" : gr;
      return `<a class="${gr === tab ? "active" : ""}" href="${u}">${esc(label)}</a>`;
    })
    .join("");

  // Best-offer sales show the accepted price AND the struck list price — the
  // "hidden price" 130point/CardUploader surface, here tied to the canonical
  // card instead of a title string (research §2, §6).
  const saleCell = (s: SoldSale) => {
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
  };

  let compsTable: string;
  if (useArchive) {
    const rows = archive
      .filter((s) => tab === "all" || (s.grade ?? "Ungraded") === tab)
      .slice(0, 40)
      .map(
        (s) => `<tr title="${esc(s.title)}">
          <td class="date">${(() => { const href = soldListingLink(s); return href ? `<a href="${esc(href)}" target="_blank" rel="noopener nofollow">${esc(fmtDate(s.sold_on))}</a>` : esc(fmtDate(s.sold_on)); })()}</td>
          <td>${sourceChip(s.marketplace)}</td>
          <td>${s.grade ? esc(s.grade) : `<span class="chip">Raw${s.condition ? " · " + esc(s.condition) : ""}</span>`}</td>
          <td>${saleCell(s)}</td>
          <td class="price">${money(s.price_cents, s.currency)}</td>
        </tr>`
      )
      .join("");
    compsTable = rows
      ? `<table class="comps"><thead><tr><th>Date</th><th>Market</th><th>Grade</th><th>Sale</th><th class="price">Price</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div style="padding:16px;color:var(--muted)">No sold comps for this filter.</div>`;
  } else {
    const rows = sold
      .filter((s) => tab === "all" || (s.grade ?? "Ungraded") === tab)
      .slice(0, 40)
      .map(
        (s) => `<tr>
          <td class="date">${esc(fmtDate(s.observed_on))}</td>
          <td>${sourceChip(s.source)}</td>
          <td>${s.grade ? esc(s.grade) : `<span class="chip">Raw${s.condition ? " · " + esc(s.condition) : ""}</span>`}</td>
          <td class="price">${money(s.price_cents, s.currency)}</td>
        </tr>`
      )
      .join("");
    compsTable = rows
      ? `<table class="comps"><thead><tr><th>Date</th><th>Source</th><th>Grade</th><th class="price">Price</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div style="padding:16px;color:var(--muted)">No sold comps for this filter.</div>`;
  }

  const noPrice = !market && graded.length === 0;

  // Free price-research link-outs (research §2: no open eBay sold API exists —
  // CardUploader's own in-app "eBay Sold" button is exactly this link-out).
  // LH_Sold+LH_Complete opens eBay's completed-sales filter pre-searched.
  const ebayQuery = encodeURIComponent(
    [card.name, card.number ?? "", card.set_name ?? "", selected.finish === "normal" ? "" : selected.finish_label]
      .filter(Boolean)
      .join(" ")
      .trim()
  );

  // Member actions. Wishlist is a POST (it changes state); anonymous visitors are
  // sent through sign-in and land back here. The card's own URL is the return path.
  const here = `/c/${card.slug}-${card.id}?v=${encodeURIComponent(selected.finish)}`;
  const mem = opts.member ?? null;
  const onList = mem?.wishlist ?? null;
  const wishForm = mem
    ? `<form method="post" action="/collection/wishlist" class="inline wish-form">
        <input type="hidden" name="variant_id" value="${selected.id}"><input type="hidden" name="next" value="${esc(here)}">
        ${onList ? `<a class="btn wish on" href="/collection/wishlist" title="On your wishlist${onList.target_cents != null ? ` · target ${money(onList.target_cents)}` : ""}">♥ On your wishlist</a>` : `<span class="price-in wish-target"><span>$</span><input type="text" name="target" class="mono" inputmode="decimal" placeholder="target" aria-label="Target price (optional)"></span><button class="btn wish" type="submit" title="Add to your wishlist — set a target price to be alerted">♡ Wishlist</button>`}
      </form>`
    : `<a class="btn wish" href="/login?next=${encodeURIComponent(here)}" title="Sign in to keep a wishlist">♡ Wishlist</a>`;
  const ownStrip = mem && (mem.owned || onList)
    ? `<div class="own-strip">${mem.owned ? `<span>✓ You own <b>${mem.owned}</b> cop${mem.owned === 1 ? "y" : "ies"}</span>` : ""}${onList ? `<span>♥ On your wishlist${onList.target_cents != null ? ` · target <b class="mono">${money(onList.target_cents)}</b>${market && market.price_cents <= onList.target_cents ? ` · <b class="ok">at your price now</b>` : ""}` : ""}</span>` : ""}<a href="/collection/cards">My collection →</a></div>`
    : "";
  const addPrefill = `${card.name} ${card.number ?? ""} ${card.set_name ?? ""} ${selected.finish_label}`;

  const html = `<div class="wrap">
    ${breadcrumb([
      { label: card.game_name ?? "", href: `/g/${card.game_slug}` },
      { label: card.set_name ?? "", href: `/s/${card.set_slug}` },
      { label: card.name },
    ])}
    ${opts.msg ? `<div class="flash">${esc(opts.msg)}</div>` : ""}
    <div class="card-detail">
      <div class="card-img-col">
        <div class="frame">${card.image_large || card.image_small ? `<img src="${esc(card.image_large || card.image_small!)}" alt="${esc(card.name)}" width="400" height="558">` : `<div style="aspect-ratio:63/88;display:grid;place-items:center;color:var(--muted)">No image</div>`}</div>
        ${card.artist ? `<div class="arts">Illustrated by ${esc(card.artist)}</div>` : ""}
      </div>
      <div class="card-main">
        <div class="card-head">
          <div class="eyebrow">${esc(card.set_name ?? "")}${card.number ? " · #" + esc(card.number) : ""}</div>
          <h1>${esc(card.name)}</h1>
          <div class="card-sub">
            <a href="/s/${card.set_slug}">${esc(card.set_name ?? "")}</a>
            ${card.rarity ? ` · ${esc(card.rarity)}` : ""}
            ${finishChip(selected)}
          </div>
        </div>

        <div class="variant-switch">${variantSwitch}</div>

        ${
          noPrice
            ? `<div class="price-panel" style="padding:22px">${demoNote("No market price is available for this printing yet.")}</div>`
            : `<div class="price-panel">
          <div class="price-head">
            <div>
              <div class="lbl">Market price · ${esc(selected.finish_label)}</div>
              <div class="big">${market ? money(market.price_cents, market.currency) : "—"} ${delta}</div>
            </div>
            <div class="rng">${hasHistory ? `Range ${money(lo)} – ${money(hi)}<br>last ${range} days` : ""}</div>
          </div>
          <div class="ranges">${rangeLinks}</div>
          ${hasHistory ? priceChart(history, market?.currency ?? "USD") : `<div class="chart" style="padding:20px;color:var(--muted)">No price history.</div>`}
          ${
            stripRows.length
              ? `<div class="grade-strip"><table>
              <thead><tr><th>Grade</th><th style="text-align:right">Value</th><th style="text-align:right">Volume</th></tr></thead>
              <tbody>${stripRows.join("")}</tbody></table></div>`
              : ""
          }
          ${
            spread.low != null || spread.mid != null || spread.high != null
              ? `<div class="lbl" style="margin-top:10px">TCGplayer spread${spread.observed_on ? ` · ${esc(fmtDate(spread.observed_on))}` : ""} — ${[
                  spread.low != null ? `Low ${money(spread.low)}` : "",
                  spread.mid != null ? `Mid ${money(spread.mid)}` : "",
                  spread.high != null ? `High ${money(spread.high)}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}</div>`
              : ""
          }
        </div>`
        }

        ${ownStrip}
        <div class="actions">
          ${wishForm}
          <a class="btn primary" href="/collection/add?mode=collection&amp;add=${encodeURIComponent(addPrefill)}" title="Add this card to your collection">+ Add to collection</a>
          ${card.tcgplayer_url ? `<a class="btn" href="${esc(card.tcgplayer_url)}" target="_blank" rel="noopener nofollow">Buy on TCGplayer ↗</a>` : ""}
          <a class="btn" href="https://www.ebay.com/sch/i.html?_nkw=${ebayQuery}" target="_blank" rel="noopener nofollow" title="Current eBay listings for this card">Find on eBay ↗</a>
          <a class="btn" href="/sales?q=${encodeURIComponent(`${card.name} ${card.number ?? ""} ${card.set_name ?? ""}`.trim())}" title="Archived sold prices for this card">Sold prices</a>
        </div>

        ${
          useArchive
            ? demoNote(
                `<b>Market prices</b> are synced daily from TCGplayer. <b>Sold comps below come from the sold-sales archive</b>${archive.every((s) => s.is_demo) ? " (sample data)" : ""}, tied to this exact card. Per-grade values and the history chart are demo data until real depth accrues.`
              )
            : demoNote(
                "<b>Market prices</b> are synced daily from TCGplayer. <b>Per-grade values, the price-history chart and sold comps below are demo data</b> until the sold-sales archive holds real sales for this card."
              )
        }

        <div class="panel" id="comps">
          <h2>Sold comps</h2>
          <div class="sub">${useArchive ? "What copies of this exact card actually sold for — accepted Best Offer prices included." : "Recent sales for this printing, by grade and source."}</div>
          <div class="comps-tabs">${compTabs}</div>
          <div class="comps-wrap">${compsTable}</div>
        </div>

        ${
          ebayConfigured()
            ? `<div class="panel" id="ebay-live">
          <h2>Live on eBay</h2>
          <div class="sub">Current listings for this card, from eBay's Browse API. Loaded on demand.</div>
          <button class="btn" id="ebay-load" data-card="${card.id}" data-v="${esc(selected.finish)}">Load live listings</button>
          <div class="comps-wrap" id="ebay-rows" hidden></div>
        </div>
        <script>(function(){
          var b=document.getElementById('ebay-load');if(!b)return;
          b.addEventListener('click',async function(){
            b.disabled=true;b.textContent='Loading…';
            var w=document.getElementById('ebay-rows');
            try{
              var r=await fetch('/api/ebay/listed?card='+encodeURIComponent(b.dataset.card)+'&v='+encodeURIComponent(b.dataset.v));
              var j=await r.json();
              w.hidden=false;
              if(j.error){w.textContent='⚠ '+j.error;b.disabled=false;b.textContent='Retry';return;}
              if(!j.items||!j.items.length){w.textContent='No live listings found for this card right now.';b.remove();return;}
              var t=document.createElement('table');t.className='comps';
              t.innerHTML='<thead><tr><th>Listing</th><th>Type</th><th>Condition</th><th class="price">Price</th></tr></thead>';
              var tb=document.createElement('tbody');
              j.items.forEach(function(it){
                var tr=document.createElement('tr');
                var td1=document.createElement('td');
                if(it.url){var a=document.createElement('a');a.href=it.url;a.target='_blank';a.rel='noopener nofollow';a.textContent=it.title;td1.appendChild(a);}
                else td1.textContent=it.title;
                var td2=document.createElement('td');td2.textContent=it.buying||'';
                var td3=document.createElement('td');td3.textContent=it.condition||'';
                var td4=document.createElement('td');td4.className='price';
                td4.textContent=it.price_cents!=null?((it.currency==='USD'?'$':it.currency+' ')+(it.price_cents/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})):'—';
                tr.appendChild(td1);tr.appendChild(td2);tr.appendChild(td3);tr.appendChild(td4);
                tb.appendChild(tr);
              });
              t.appendChild(tb);w.innerHTML='';w.appendChild(t);b.remove();
            }catch(e){w.hidden=false;w.textContent='⚠ Could not reach the server.';b.disabled=false;b.textContent='Retry';}
          });
        })();</script>`
            : ""
        }

        ${
          tcgConfigured()
            ? `<div class="panel" id="tcg-cond">
          <h2>TCGplayer by condition</h2>
          <div class="sub">SKU-level NM/LP/MP/HP market prices, per printing. Loaded on demand.</div>
          <button class="btn" id="tcg-load" data-card="${card.id}" data-v="${esc(selected.finish)}">Load condition prices</button>
          <div class="comps-wrap" id="tcg-rows" hidden></div>
        </div>
        <script>(function(){
          var b=document.getElementById('tcg-load');if(!b)return;
          b.addEventListener('click',async function(){
            b.disabled=true;b.textContent='Loading…';
            var w=document.getElementById('tcg-rows');
            try{
              var r=await fetch('/api/tcgplayer/conditions?card='+encodeURIComponent(b.dataset.card)+'&v='+encodeURIComponent(b.dataset.v));
              var j=await r.json();
              w.hidden=false;
              if(j.error){w.textContent='⚠ '+j.error;b.disabled=false;b.textContent='Retry';return;}
              var groups=j.groups||[];
              if(!groups.length){w.textContent='No condition prices available for this product.';b.remove();return;}
              var t=document.createElement('table');t.className='comps';
              t.innerHTML='<thead><tr><th>Condition</th><th>Printing</th><th class="price">Low</th><th class="price">Market</th></tr></thead>';
              var tb=document.createElement('tbody');
              var fmt=function(c){return c!=null?('$'+(c/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})):'—';};
              groups.forEach(function(g){
                (g.rows||[]).forEach(function(row){
                  var tr=document.createElement('tr');
                  var td1=document.createElement('td');td1.textContent=row.condition+' ('+row.abbr+')';
                  var td2=document.createElement('td');td2.textContent=g.printing;
                  var td3=document.createElement('td');td3.className='price';td3.textContent=fmt(row.low_cents);
                  var td4=document.createElement('td');td4.className='price';td4.textContent=fmt(row.market_cents);
                  tr.appendChild(td1);tr.appendChild(td2);tr.appendChild(td3);tr.appendChild(td4);
                  tb.appendChild(tr);
                });
              });
              t.appendChild(tb);w.innerHTML='';w.appendChild(t);b.remove();
            }catch(e){w.hidden=false;w.textContent='⚠ Could not reach the server.';b.disabled=false;b.textContent='Retry';}
          });
        })();</script>`
            : ""
        }
      </div>
    </div>
  </div>`;

  const priceForLd = market?.price_cents ?? graded[0]?.price_cents ?? null;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: `${card.name} · ${card.set_name}${card.number ? " #" + card.number : ""}`,
      image: card.image_large || card.image_small || undefined,
      category: `${card.game_name} trading card`,
      ...(priceForLd
        ? {
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: market?.currency ?? "USD",
              lowPrice: (priceForLd / 100).toFixed(2),
              availability: "https://schema.org/InStock",
            },
          }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: card.game_name, item: `/g/${card.game_slug}` },
        { "@type": "ListItem", position: 2, name: card.set_name, item: `/s/${card.set_slug}` },
        { "@type": "ListItem", position: 3, name: card.name },
      ],
    },
  ];

  return {
    html,
    title: `${card.name} ${card.number ? "#" + card.number + " " : ""}price — ${card.set_name} | CardIndex`,
    description: `${card.name} (${card.set_name}${card.number ? " #" + card.number : ""}) ${market ? "market price " + money(market.price_cents, market.currency) + ", " : ""}with variants, price history and sold comps.`,
    jsonLd,
    ogImage: card.image_large || card.image_small || null,
  };
}

// ---- Search results -------------------------------------------------------
function facetGroup(title: string, dim: string, options: FacetOption[], p: SearchParams): string {
  if (!options.length) return "";
  const opts = options
    .map((o) => {
      const params = { ...p, page: undefined } as Record<string, unknown>;
      if (o.active) delete params[dim];
      else params[dim] = o.key;
      return `<div class="facet-opt${o.active ? " active" : ""}">
        <a href="/search?${qs(params)}"><span class="box"></span>${esc(o.label)}</a>
        <span class="c">${o.count}</span>
      </div>`;
    })
    .join("");
  return `<div class="facet-group"><h3>${esc(title)}</h3>${opts}</div>`;
}

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    u.set(k, String(v));
  }
  return u.toString();
}

export function renderSearch(p: SearchParams, r: SearchResult): { html: string; title: string; description: string; jsonLd: unknown[] } {
  const sorts = [
    ["", "Relevance"],
    ["price_desc", "Price ↓"],
    ["price_asc", "Price ↑"],
    ["name", "Name"],
    ["number", "Newest set"],
  ];
  const sortLinks = sorts
    .map(([k, label]) => {
      const cur = (p.sort ?? "") === k;
      return `<a class="${cur ? "active" : ""}" href="/search?${qs({ ...p, sort: k || undefined, page: undefined })}">${label}</a>`;
    })
    .join("");

  const applied: string[] = [];
  const chip = (dim: string, label: string) => {
    const params = { ...p } as Record<string, unknown>;
    delete params[dim];
    delete params.page;
    return `<span class="tag">${esc(label)} <a href="/search?${qs(params)}" aria-label="Remove ${esc(label)}">×</a></span>`;
  };
  if (p.game) applied.push(chip("game", r.facets.game.find((f) => f.active)?.label ?? p.game));
  if (p.set) applied.push(chip("set", r.facets.set.find((f) => f.active)?.label ?? p.set));
  if (p.rarity) applied.push(chip("rarity", p.rarity));
  if (p.finish) applied.push(chip("finish", r.facets.finish.find((f) => f.active)?.label ?? p.finish));
  if (p.min != null || p.max != null) applied.push(chip("price", `${p.min != null ? "$" + p.min : "$0"}–${p.max != null ? "$" + p.max : "∞"}`));

  const facets = `<aside class="facets">
    ${facetGroup("Game", "game", r.facets.game, p)}
    ${facetGroup("Set", "set", r.facets.set, p)}
    ${facetGroup("Rarity", "rarity", r.facets.rarity, p)}
    ${facetGroup("Finish", "finish", r.facets.finish, p)}
    <div class="facet-group"><h3>Price (USD)</h3>
      <form class="pricefilter" action="/search" method="get">
        ${hidden(p, ["min", "max", "page"])}
        <input type="number" name="min" placeholder="min" value="${p.min ?? ""}" aria-label="Min price" min="0">
        <input type="number" name="max" placeholder="max" value="${p.max ?? ""}" aria-label="Max price" min="0">
        <button type="submit">Go</button>
      </form>
    </div>
    ${applied.length ? `<a class="clear-filters" href="/search?${qs({ q: p.q })}">Clear all filters</a>` : ""}
  </aside>`;

  const baseForPager = `/search?${qs({ ...p, page: undefined })}`;

  let content: string;
  if (r.total === 0) {
    content = `<div class="empty">
      <h2>No cards found</h2>
      <p>Nothing matched${p.q ? ` “${esc(p.q)}”` : " those filters"}.</p>
      ${r.suggestions.length ? `<div class="did-you-mean">Did you mean ${r.suggestions.map((s) => `<a href="/search?q=${encodeURIComponent(s)}">${esc(s)}</a>`).join(" · ")}?</div>` : ""}
    </div>`;
  } else {
    content = `
      <div class="results-top">
        <div class="count"><b>${r.total.toLocaleString()}</b> ${r.total === 1 ? "card" : "cards"}${p.q ? ` for “${esc(p.q)}”` : ""}${r.parsedChips.map((c) => ` <span class="chip" title="Understood from your search">${esc(c)}</span>`).join("")}</div>
        <div class="sort">Sort ${sortLinks}</div>
      </div>
      ${applied.length ? `<div class="applied">${applied.join("")}</div>` : ""}
      ${r.fuzzyFor ? `<div class="did-you-mean">No exact matches for “${esc(r.fuzzyFor)}” — showing the closest cards.</div>` : ""}
      <div class="grid cards">${r.rows
        .map((row) =>
          cardTile({
            ...row,
            price_cents: row.price_cents,
            currency: row.currency ?? "USD",
            price_label: r.gradeApplied,
            link_suffix: r.gradeApplied ? `?tab=${encodeURIComponent(r.gradeApplied)}#comps` : "",
          })
        )
        .join("")}</div>
      ${pager(baseForPager, r.page, r.totalPages)}`;
  }

  const html = `<div class="wrap">
    ${breadcrumb([{ label: "Search" }])}
    <div class="two-col">
      ${facets}
      <div>${content}</div>
    </div>
  </div>`;

  return {
    html,
    title: p.q ? `“${p.q}” — card search | CardIndex` : "Search cards | CardIndex",
    description: `Search results${p.q ? ` for ${p.q}` : ""} across trading card prices on CardIndex.`,
    jsonLd: [],
  };
}

function hidden(p: SearchParams, omit: string[]): string {
  const keep: Array<[string, unknown]> = [
    ["q", p.q],
    ["game", p.game],
    ["set", p.set],
    ["rarity", p.rarity],
    ["finish", p.finish],
    ["sort", p.sort],
    ["min", p.min],
    ["max", p.max],
  ];
  return keep
    .filter(([k, v]) => v != null && v !== "" && !omit.includes(k))
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(String(v))}">`)
    .join("");
}

// ---- sitemap --------------------------------------------------------------
export async function sitemapUrls(): Promise<string[]> {
  const urls = ["/", "/browse", "/search"];
  for (const g of await getGames()) urls.push(`/g/${g.slug}`);
  const sets = await getAllSets();
  for (const s of sets) urls.push(`/s/${s.slug}`);
  const cardLists = await Promise.all(sets.map((s) => getCardsInSet(s.id)));
  const cards = cardLists.flatMap((list) => list.map((c) => `/c/${c.slug}-${c.id}`));
  return urls.concat(cards);
}
