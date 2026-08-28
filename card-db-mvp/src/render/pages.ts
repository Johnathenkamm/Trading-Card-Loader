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
  trendingCards,
  counts,
  cardHeadlinePrice,
} from "../pg.ts";
import type { Game, CardSet, Card, Variant } from "../db.ts";
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
  const yourCents = hero ? Math.floor((hero.price_cents * 1.05) / 100) * 100 + 99 : 0;

  const heroVisual = hero
    ? `<div class="hero-visual">
        <div class="glow" aria-hidden="true"></div>
        <div class="device">
          <div class="device-card">${(hero.image_large || hero.image_small) ? `<img src="${esc(hero.image_large || hero.image_small!)}" alt="${esc(hero.name)}" loading="eager" width="245" height="342">` : ""}</div>
          <div class="device-panel">
            <div class="dp-name">${esc(hero.name)}</div>
            <div class="dp-sub">${esc(hero.set_name)}${hero.number ? " · #" + esc(hero.number) : ""}</div>
            <span class="dp-chip">Near Mint ▾</span>
            <div class="dp-row"><span>Market Price</span><b class="mono">${money(hero.price_cents, hero.currency)}</b></div>
            <div class="dp-row"><span>Your Price</span><b class="mono accent">${money(yourCents, hero.currency)}</b></div>
            <a class="dp-btn" href="/app/scan">Add to Inventory</a>
            <div class="dp-tabs"><span class="on">Details</span><span>Pricing</span><span>History</span></div>
          </div>
        </div>
      </div>`
    : "";

  const html = `
<section class="home-hero">
  <div class="wrap home-hero-grid">
    <div class="home-hero-copy">
      <div class="tag">All-in-one TCG seller platform</div>
      <h1>Scan once.<br>List <span class="hl">everywhere.</span></h1>
      <p class="lead">Scan, identify, price and list your trading cards on eBay, TCGplayer, Whatnot and more — from one place. Backed by a live price catalog of ${c.cards.toLocaleString()} cards.</p>
      <div class="cta-row">
        <a class="btn primary lg" href="/app/scan">Start Scanning →</a>
        <a class="btn lg ghost" href="#how">See how it works</a>
      </div>
      <div class="mk-strip">
        <span class="mk-lbl">List to multiple marketplaces</span>
        <div class="mk-logos"><span class="mk">eBay</span><span class="mk">TCGplayer</span><span class="mk">Whatnot</span><span class="mk">Shopify</span><span class="mk more">+ More</span></div>
      </div>
    </div>
    ${heroVisual}
  </div>
</section>

<section class="feature-row">
  <div class="wrap feats">
    ${feature("scan", "Scan Any Card", "Use your scanner or phone to add single cards or entire collections.")}
    ${feature("ai", "AI Identification", "Instantly identifies cards, sets, variants and conditions.")}
    ${feature("price", "Get Market Prices", "Real-time pricing from TCGplayer and eBay to price with confidence.")}
    ${feature("box", "Manage Inventory", "Organize, track and price your collection with SKUs and bulk tools.")}
    ${feature("rocket", "List & Sell", "List to eBay, TCGplayer, Whatnot and more with a few clicks.")}
  </div>
</section>

<section class="how" id="how">
  <div class="wrap">
    <div class="how-head"><h2>How it works</h2><p>From scan to sale in just a few steps.</p></div>
    <div class="steps">
      ${step(1, "scan", "Scan", "Scan your cards using a scanner or phone.")}
      ${step(2, "ai", "Identify", "AI identifies the card details instantly.")}
      ${step(3, "price", "Price", "Review market prices and set your price.")}
      ${step(4, "box", "Organize", "Add to inventory, set conditions, SKUs and quantities.")}
      ${step(5, "send", "List", "Export and list to your favorite marketplaces.", true)}
    </div>
    <div class="how-cta"><a class="btn primary" href="/app/scan">Start your free scan</a></div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec-head"><h2>Trending by value</h2><a href="/search?sort=price_desc">Browse the price catalog →</a></div>
    <div class="grid cards">${trending.map((t) => cardTile({ ...t, set_name: t.set_name })).join("")}</div>
  </div>
</section>

<section class="trust-bar">
  <div class="wrap trust-grid">
    <div class="tb"><div class="tb-ic">${ICONS.scan}</div><div><b>50+ TCGs supported</b><span>Pokémon, One Piece, Yu-Gi-Oh, Magic, Lorcana and more.</span></div></div>
    <div class="tb"><div class="tb-ic">${ICONS.price}</div><div><b>Graded &amp; ungraded</b><span>Supports PSA, BGS, CGC, TAG and raw cards.</span></div></div>
    <div class="tb"><div class="tb-ic">${ICONS.box}</div><div><b>Bulk scanning</b><span>Scan and process hundreds of cards at once.</span></div></div>
    <div class="tb"><div class="tb-ic">${ICONS.ai}</div><div><b>Secure &amp; private</b><span>Your data is yours — never sold or shared.</span></div></div>
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
    title: "CardIndex — scan, price & list your trading cards",
    description: `Scan, identify, price and list TCG cards on eBay, TCGplayer, Whatnot and more. Backed by a live catalog of ${c.cards.toLocaleString()} cards with variant-aware prices.`,
    jsonLd,
  };
}

// ---- Browse / game --------------------------------------------------------
export async function renderBrowse(game?: Game): Promise<{ html: string; title: string; description: string; jsonLd: unknown[] }> {
  const sets = game
    ? (await getSetsForGame(game.id)).map((s) => ({ ...s, game_name: game.name, game_slug: game.slug }))
    : await getAllSets();
  const grouped: Record<string, CardSet[]> = {};
  for (const s of sets) (grouped[s.game_name ?? "Other"] ??= []).push(s);

  const sections = Object.entries(grouped)
    .map(
      ([gn, ss]) => `<div class="sec-head" style="margin-top:8px"><h2>${esc(gn)}</h2><span class="eyebrow">${ss.length} sets</span></div>
      <div class="grid cards">${ss.map(setTile).join("")}</div>`
    )
    .join("");

  const html = `<div class="wrap">
    ${breadcrumb(game ? [{ label: game.name }] : [{ label: "Browse" }])}
    <div class="sec">
      <h1 style="font-size:1.9rem;margin-bottom:6px">${game ? esc(game.name) + " sets" : "Browse all sets"}</h1>
      <p style="color:var(--muted);margin:0 0 20px">Pick a set to see its checklist with prices, or search across everything.</p>
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
export async function renderCard(
  card: Card,
  opts: { variantFinish?: string; range?: number; gradeTab?: string }
): Promise<{ html: string; title: string; description: string; jsonLd: unknown[]; ogImage: string | null } | null> {
  const variants = await getVariants(card.id);
  if (variants.length === 0) return null;
  const selected = variants.find((v) => v.finish === opts.variantFinish) ?? variants.find((v) => v.is_default) ?? variants[0];

  const [market, fullHistory, graded, sold] = await Promise.all([
    latestMarket(selected.id),
    priceHistory(selected.id),
    gradedValues(selected.id),
    soldComps(selected.id),
  ]);
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
  for (const s of sold) soldByGrade[s.grade ?? "Ungraded"] = (soldByGrade[s.grade ?? "Ungraded"] ?? 0) + 1;
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
  const grades = ["all", ...Array.from(new Set(sold.map((s) => s.grade ?? "Ungraded")))];
  const tab = opts.gradeTab && grades.includes(opts.gradeTab) ? opts.gradeTab : "all";
  const compTabs = grades
    .map((gr) => {
      const u = `/c/${card.slug}-${card.id}?v=${encodeURIComponent(selected.finish)}&tab=${encodeURIComponent(gr)}#comps`;
      const label = gr === "all" ? "All" : gr;
      return `<a class="${gr === tab ? "active" : ""}" href="${u}">${esc(label)}</a>`;
    })
    .join("");
  const compRows = sold
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

  const noPrice = !market && graded.length === 0;

  const html = `<div class="wrap">
    ${breadcrumb([
      { label: card.game_name ?? "", href: `/g/${card.game_slug}` },
      { label: card.set_name ?? "", href: `/s/${card.set_slug}` },
      { label: card.name },
    ])}
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
        </div>`
        }

        <div class="actions">
          <a class="btn primary" href="/app/scan?add=${encodeURIComponent(`${card.name} ${card.number ?? ""} ${card.set_name ?? ""} ${selected.finish_label}`)}">+ Add to my inventory</a>
          <a class="btn" href="/app/scan?add=${encodeURIComponent(`${card.name} ${card.number ?? ""} ${card.set_name ?? ""} ${selected.finish_label}`)}">List on eBay</a>
        </div>

        ${demoNote(
          "<b>Market prices</b> are live from TCGplayer/Scryfall. <b>Per-grade values, the price-history chart and sold comps below are demo data</b> — real sold-comp feeds are gated to approved partners, and price history accrues from daily snapshots once live (see the research report’s integrations section)."
        )}

        <div class="panel" id="comps">
          <h2>Sold comps</h2>
          <div class="sub">Recent sales for this printing, by grade and source.</div>
          <div class="comps-tabs">${compTabs}</div>
          <div class="comps-wrap">
            ${
              compRows
                ? `<table class="comps"><thead><tr><th>Date</th><th>Source</th><th>Grade</th><th class="price">Price</th></tr></thead><tbody>${compRows}</tbody></table>`
                : `<div style="padding:16px;color:var(--muted)">No sold comps for this filter.</div>`
            }
          </div>
        </div>
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
        <div class="count"><b>${r.total.toLocaleString()}</b> ${r.total === 1 ? "card" : "cards"}${p.q ? ` for “${esc(p.q)}”` : ""}${r.parsedGrade ? ` <span class="chip">${esc(r.parsedGrade)}</span>` : ""}</div>
        <div class="sort">Sort ${sortLinks}</div>
      </div>
      ${applied.length ? `<div class="applied">${applied.join("")}</div>` : ""}
      <div class="grid cards">${r.rows.map((row) => cardTile({ ...row, price_cents: row.price_cents, currency: row.currency ?? "USD" })).join("")}</div>
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
