// Member-area page renderers: the collection home, the collection itself, the
// wishlist, uploads history, inbox and settings — plus the shared chrome
// (sidebar, page head, flash, progressive-enhancement script) that the add /
// review pages in collection-add.ts reuse. Server-rendered like the public
// site; edits are plain HTML forms (POST → redirect) so everything works
// without JavaScript, and APP_JS layers on bulk-select, the photo dropzone,
// keyboard shortcuts and auto-submit.

import { esc, money } from "../util.ts";
import { getAllSets } from "../pg.ts";
import { finishChip } from "./components.ts";
import {
  getMember, collectionStats, listCollection, listBatchesWithStats, memberCounts, wishlistStats, listWishlist,
  WISHLIST_FREE_MAX,
  type BatchStats, type CollectionFilter, type CollectionRow, type WishlistRow,
} from "../app/collection.ts";
import { CONDITIONS, LANGUAGES } from "../app/conditions.ts";
import { parseMatchingPrefs, prefsToForm, describePrefs, isEmptyPrefs, type SetRef } from "../app/matching.ts";
import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL, isPro } from "../app/billing.ts";
import { FEEDBACK_KINDS, FEEDBACK_TITLE_MAX, FEEDBACK_BODY_MAX, type Feedback } from "../app/feedback.ts";
import { currentAccount } from "../app/session-context.ts";

export type Page = { html: string; title: string; description: string };

export const dollars = (c: number | null | undefined): string => (c == null ? "" : (c / 100).toFixed(2));

export function opt(value: string, label: string, selected: string): string {
  return `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
}
export function conditionOptions(sel: string): string {
  return CONDITIONS.map((c) => opt(c.key, `${c.key} · ${c.label}`, sel)).join("");
}
export function languageOptions(sel: string): string {
  return LANGUAGES.map((l) => opt(l, l, sel)).join("");
}

// ---- chrome ---------------------------------------------------------------

/** Nav keys whose page takes cards in — no "+ Add cards" button is added on these. */
const ADD_KEYS = new Set(["add", "paste", "graded", "from-set", "price"]);
/** Nav keys behind the Pro plan (mirrors `proRequired()` in server.ts). */
const PRO_KEYS = new Set(["add", "graded", "from-set", "cards"]);

// 20×20 stroke icons; the collapsed rail shows only these.
export const NAV_ICONS: Record<string, string> = {
  home: `<path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z"/>`,
  add: `<path d="M3 7h3l1.5-2h5L14 7h3v9H3z"/><circle cx="10" cy="11.5" r="2.5"/>`,
  paste: `<path d="M5 3h7l4 4v10H5z"/><path d="M12 3v4h4"/><path d="M8 11h5M8 14h5"/>`,
  graded: `<circle cx="10" cy="8" r="4.5"/><path d="M7 11.5 6 17l4-2 4 2-1-5.5"/>`,
  "from-set": `<path d="M4 5h9M4 10h9M4 15h6M15 12v6M12 15h6"/>`,
  price: `<path d="M3 10V4h6l8 8-6 6z"/><circle cx="6.5" cy="7.5" r="1"/>`,
  cards: `<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>`,
  wishlist: `<path d="M10 17s-6-3.8-6-8a3.5 3.5 0 0 1 6-2.4A3.5 3.5 0 0 1 16 9c0 4.2-6 8-6 8z"/>`,
  uploads: `<path d="m10 4 7 3.5-7 3.5-7-3.5z"/><path d="m3 11 7 3.5 7-3.5"/>`,
  search: `<circle cx="9" cy="9" r="5"/><path d="m13 13 4 4"/>`,
  sales: `<path d="M3 15l5-5 3 3 6-6"/><path d="M13 7h4v4"/>`,
  inbox: `<path d="M3 11h4l1.5 2h3L13 11h4v6H3z"/><path d="M5 11V4h10v7"/>`,
  settings: `<path d="M4 6h12M4 10h12M4 14h12"/><circle cx="8" cy="6" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="7" cy="14" r="1.5"/>`,
  review: `<path d="M4 10.5 8 14l8-8"/>`,
  share: `<path d="M8 12l4-4"/><path d="M11 5.5 12.5 4a2.5 2.5 0 0 1 3.5 3.5L14.5 9"/><path d="M9 15l-1.5 1.5A2.5 2.5 0 0 1 4 13l1.5-1.5"/>`,
};
export function navIcon(key: string): string {
  return `<svg class="nav-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${NAV_ICONS[key] ?? ""}</svg>`;
}

/** Is the member area being viewed on a Pro plan? (Owner mode uses the member's plan.) */
export function currentPlanIsPro(): boolean {
  const a = currentAccount();
  if (!a) return true;
  if (a.acting) return a.acting.owner || isPro(a.acting.plan_tier);
  if (a.id == null) return true;
  return isPro(a.plan_tier);
}

export type NavMode = "auto" | "open" | "collapsed";

// Collapse control: the choice persists per browser (auto pages). Pages that
// pass a forced mode (review grid → collapsed, settings → open) start there but
// the button still works for the visit; only 'auto' pages save the preference.
const NAV_JS = `<script>(function(){
  var s=document.currentScript,nav=s&&s.previousElementSibling;if(!nav||!nav.classList.contains('ws-nav'))return;
  var wrap=nav.parentElement,mode=nav.getAttribute('data-mode')||'auto',KEY='ci-ws-nav';
  function saved(){try{return localStorage.getItem(KEY);}catch(e){return null;}}
  var collapsed=mode==='collapsed'?true:mode==='open'?false:saved()==='collapsed';
  var btn=nav.querySelector('.ws-collapse');
  function apply(){wrap.classList.toggle('nav-collapsed',collapsed);if(btn){btn.setAttribute('aria-expanded',collapsed?'false':'true');btn.title=collapsed?'Expand menu':'Collapse menu';}}
  apply();
  if(btn)btn.addEventListener('click',function(){collapsed=!collapsed;apply();if(mode==='auto'){try{localStorage.setItem(KEY,collapsed?'collapsed':'open');}catch(e){}}});
})();</script>`;

function subnav(active: string, navMode: NavMode = "auto"): string {
  const pro = currentPlanIsPro();
  const groups: Array<[string, Array<[string, string, string]>]> = [
    ["", [["/collection", "My collection", "home"]]],
    [
      "Add cards",
      [
        ["/collection/add?mode=collection", "Identify from photos", "add"],
        ["/collection/add?mode=collection#paste", "Paste a list", "paste"],
        ["/collection/graded", "Graded slabs", "graded"],
        ["/collection/from-set", "From a set", "from-set"],
        ["/collection/add?mode=price", "Price check", "price"],
      ],
    ],
    [
      "My cards",
      [
        ["/collection/cards", "Collection", "cards"],
        ["/collection/wishlist", "Wishlist", "wishlist"],
        ["/collection/uploads", "Uploads", "uploads"],
      ],
    ],
    ["Look up", [["/search", "Search cards", "search"], ["/sales", "Sold prices", "sales"]]],
    ["Account", [["/collection/inbox", "Inbox", "inbox"], ["/collection/settings", "Settings", "settings"]]],
  ];
  const item = ([href, text, key]: [string, string, string]) =>
    `<a href="${href}" class="${key === active ? "active" : ""}${ADD_KEYS.has(key) ? " adds" : ""}" title="${esc(text)}">${navIcon(key)}<span class="nav-t">${text}</span>${
      !pro && PRO_KEYS.has(key) ? `<span class="nav-pro" title="Pro plan">Pro</span>` : ""
    }</a>`;
  const collapse = `<button type="button" class="ws-collapse" aria-expanded="true" title="Collapse menu"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M12 5l-5 5 5 5"/><path d="M4 4v12" /></svg><span class="sr-only">Collapse menu</span></button>`;
  return `<nav class="ws-nav" aria-label="My collection" data-mode="${navMode}">${collapse}${groups
    .map(([label, items]) => `<div class="ws-group">${label ? `<span class="ws-glabel">${label}</span>` : ""}${items.map(item).join("")}</div>`)
    .join("")}</nav>${NAV_JS}`;
}

// The nav is emitted as a sibling of the header (not inside it) so the page
// grid can place it in a sidebar column on desktop; see `.wrap.ws` in styles.css.
// Every page that doesn't itself take cards in gets a "+ Add cards" action.
export function wsHead(active: string, title: string, sub: string, actions = "", opts: { navMode?: NavMode } = {}): string {
  const addCta = ADD_KEYS.has(active) || actions.includes('href="/collection/add"') ? "" : `<a class="btn primary" href="/collection/add">+ Add cards</a>`;
  return `${subnav(active, opts.navMode ?? "auto")}<div class="ws-head">
    <div class="ws-title-row">
      <div>
        <div class="eyebrow">My collection</div>
        <h1>${esc(title)}</h1>
        <p class="ws-sub">${sub}</p>
      </div>
      <div class="ws-actions">${actions}${addCta}</div>
    </div>
  </div>`;
}

export function flash(msg: string | undefined): string {
  if (!msg) return "";
  return `<div class="flash">${esc(msg)}</div>`;
}

export const TITLE_SUFFIX = "— My collection | CardIndex";

// ---- Collection home ------------------------------------------------------

export async function renderCollectionHome(msg?: string): Promise<Page> {
  const [member, stats, counts, wish, batches] = await Promise.all([getMember(), collectionStats(), memberCounts(), wishlistStats(), listBatchesWithStats(5)]);
  const pro = isPro(member.plan_tier);

  const planCard = `<div class="home-plan">
    <div>
      <div class="eyebrow">Your plan</div>
      <div class="plan-line"><b>${pro ? "Pro" : "Free"}</b>${pro ? ` · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}` : ""} <span class="plan-dot${pro ? "" : " free"}">${pro ? "Active" : "Free"}</span></div>
      <p class="hint">${
        pro
          ? "Collection tracking, unlimited wishlist with target-price alerts, and collection export."
          : `Price checks, sold-price lookup and a wishlist of up to ${WISHLIST_FREE_MAX} cards are included. Pro adds your collection, unlimited wishlist and price alerts.`
      } <a href="/pricing${pro ? "" : "?upgrade=1"}">${pro ? "Plans &amp; pricing" : "Upgrade to Pro"}</a></p>
    </div>
    <div class="home-plan-shop"><div class="eyebrow">Member</div><b>${esc(member.display_name)}</b><div class="hint">${member.email ? esc(member.email) : "no email on file"}</div></div>
  </div>`;

  const gain = stats.market_cents - stats.paid_cents;
  const statCards = `<div class="stat-cards home-stats">
    <div class="stat"><div class="k">Collection value</div><div class="v mono">${money(stats.market_cents)}</div><div class="s">market price × copies${stats.graded ? ` · ${stats.graded} graded` : ""}</div></div>
    <div class="stat"><div class="k">Cards owned</div><div class="v mono">${stats.units}</div><div class="s">${stats.count} printing${stats.count === 1 ? "" : "s"} in your collection</div></div>
    <div class="stat"><div class="k">Paid</div><div class="v mono">${stats.paid_units ? money(stats.paid_cents) : "—"}</div><div class="s">${stats.paid_units ? `${gain >= 0 ? "+" : "−"}${money(Math.abs(gain))} vs. market on ${stats.paid_units} card${stats.paid_units === 1 ? "" : "s"} with a paid price` : "add what you paid in review to track gains"}</div></div>
    <div class="stat${wish.hit ? " attn" : ""}"><div class="k">Wishlist</div><div class="v mono">${wish.count}</div><div class="s">${wish.hit ? `<a href="/collection/wishlist">${wish.hit} at your target price →</a>` : wish.count ? "none at target price yet" : `<a href="/search">find cards to want →</a>`}</div></div>
  </div>`;

  const proTag = pro ? "" : `<span class="nav-pro">Pro</span>`;
  const quick = `<div class="quick-grid">
    <a class="quick" href="/collection/add?mode=price"><span class="qi">🔎</span><b>Price check</b><span>Free: snap photos or paste a list → every card identified and priced. Share the list by link.</span></a>
    <a class="quick" href="/collection/add?mode=collection"><span class="qi">📷</span><b>Add from photos ${proTag}</b><span>Photograph the cards you own; confirm the matches and they're in your collection.</span></a>
    <a class="quick" href="/collection/graded"><span class="qi">🏅</span><b>Add graded slabs ${proTag}</b><span>Paste cert numbers; each slab is valued at its grade.</span></a>
    <a class="quick" href="/collection/from-set"><span class="qi">🗂️</span><b>Add from a set ${proTag}</b><span>Tick the cards you have off a set checklist.</span></a>
    <a class="quick" href="/collection/wishlist"><span class="qi">♡</span><b>Wishlist</b><span>Cards you want, with the price you'd pay. We flag them when the market drops to it.</span></a>
    <a class="quick" href="/sales"><span class="qi">📈</span><b>Sold prices</b><span>What cards actually sold for on eBay, Goldin and Fanatics.</span></a>
  </div>`;

  const steps: Array<[boolean, string, string, string]> = [
    [member.display_name !== "Collector", "Choose your display name", "It shows on price lists you share.", "/collection/settings#s-account"],
    [wish.count > 0, "Add a card to your wishlist", "Open any card page and press ♡ Wishlist. Set a target price to get alerted.", "/search"],
    [counts.batches > 0, "Run your first price check", "Photos or a pasted list — every card identified and priced from the catalog.", "/collection/add?mode=price"],
    [stats.count > 0, pro ? "Add cards to your collection" : "Add cards to your collection (Pro)", "Confirm the matches in review and they land in your collection with a value.", pro ? "/collection/add?mode=collection" : "/pricing?upgrade=1"],
    [stats.paid_units > 0, "Record what you paid", "Type a paid price in review or on a collection row to see gains and losses.", stats.count ? "/collection/cards" : "/collection/add?mode=collection"],
  ];
  const done = steps.filter((s) => s[0]).length;
  const checklist = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Getting started</h2><span class="eyebrow">${done} of ${steps.length} done</span></div>
    <ol class="checklist">${steps
      .map(([ok, t, sub, href]) => `<li class="${ok ? "done" : ""}"><span class="ck">${ok ? "✓" : ""}</span><div><a href="${href}">${esc(t)}</a><div class="sub">${esc(sub)}</div></div></li>`)
      .join("")}</ol>
  </div>`;

  const recent = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Recent uploads</h2><a href="/collection/uploads">All uploads →</a></div>
    ${batches.length ? `<div class="batch-list">${batches.map(batchRow).join("")}</div>` : `<p class="hint">No uploads yet — <a href="/collection/add">identify some cards</a> to start.</p>`}
  </div>`;

  const help = `<div class="ws-panel help-panel">
    <div class="ws-panel-head"><h2>How it works</h2></div>
    <details><summary>How are cards identified?</summary><p>Photos go through the recognizer and pasted lines are parsed for name, number, set, finish, condition, language and quantity. Both resolve against the catalog and get a confidence score: <b>90%+ auto-matches</b>, anything lower waits in review with alternatives and a manual search. Use <b>Advanced matching options</b> when you know which sets a binder holds.</p></details>
    <details><summary>Where do the prices come from?</summary><p>Market prices are TCGplayer market values per printing, refreshed daily. Graded cards use the catalog's value at that grade when one exists. Sold prices come from the sold-sales archive (eBay, Goldin, Fanatics) and are tied to the exact card, not a title keyword.</p></details>
    <details><summary>What if a card isn't in the catalog?</summary><p>It lands in review as "No match". Search manually for the closest printing, or skip it. The catalog grows by set sync; tell us which set is missing from the <a href="/collection/inbox">inbox</a>.</p></details>
    <details><summary>Is my collection private?</summary><p>Yes. Nobody else can see your collection or wishlist. The only thing that leaves your account is a price list you deliberately share by link, and you can stop sharing at any time.</p></details>
  </div>`;

  const html = `<div class="wrap ws">
    ${wsHead("home", "My collection", `What you own, what it's worth, and what you're watching for.`, `<a class="btn primary" href="/collection/add">+ Add cards</a>`)}
    ${flash(msg)}
    ${planCard}
    ${statCards}
    ${quick}
    <div class="home-grid">
      <div>${checklist}${recent}</div>
      <div>${help}</div>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: "My collection | CardIndex", description: "Your collection at a glance." };
}

export function batchLabel(b: { label: string | null; source: string; kind: string }): string {
  if (b.label) return b.label;
  if (b.kind === "pricing") return "Price check";
  return b.source === "upload" ? "Photo upload" : b.source === "certs" ? "Graded slabs" : b.source === "catalog" ? "Set picks" : "Pasted list";
}

export function batchHref(b: { id: number; kind: string }): string {
  return b.kind === "pricing" ? `/collection/priced/${b.id}` : `/collection/review/${b.id}`;
}

function batchRow(b: BatchStats): string {
  const st = b.review ? `<span class="warn">${b.review} to review</span>` : b.approved === b.total && b.total ? `<span class="ok">in collection</span>` : b.kind === "pricing" ? "priced" : b.status;
  return `<a class="batch-row" href="${batchHref(b)}">
    <span class="bid">#${b.id}</span>
    <span class="blabel">${esc(batchLabel(b))}</span>
    <span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"} · ${st}</span>
  </a>`;
}

// ---- Uploads --------------------------------------------------------------

export async function renderUploads(msg?: string): Promise<Page> {
  const rows = await listBatchesWithStats(200);
  const body = rows
    .map((b) => {
      const when = b.created_at.slice(0, 10);
      const state = b.review
        ? `<span class="pill review">${b.review} to review</span>`
        : b.kind === "pricing"
        ? `<span class="pill listed">Priced${b.share_token ? " · shared" : ""}</span>`
        : b.total && b.approved === b.total
        ? `<span class="pill sold">In collection</span>`
        : b.approved
        ? `<span class="pill listed">${b.approved}/${b.total} added</span>`
        : `<span class="pill">${esc(b.status)}</span>`;
      return `<tr>
        <td class="mono">#${b.id}</td>
        <td><a href="${batchHref(b)}"><b>${esc(batchLabel(b))}</b></a><div class="sub">${esc(b.source === "upload" ? "photos" : b.source === "certs" ? "cert numbers" : b.source === "catalog" ? "set checklist" : "pasted list")} · ${esc(when)}</div></td>
        <td class="mono">${b.total}</td>
        <td class="mono ok">${b.matched}</td>
        <td class="mono${b.review ? " warn" : ""}">${b.review}</td>
        <td class="mono${b.failed ? " bad" : ""}">${b.failed}</td>
        <td class="mono">${money(b.value_cents)}</td>
        <td>${state}</td>
        <td class="act"><a class="btn sm" href="${batchHref(b)}">${b.review ? "Review →" : "Open"}</a></td>
      </tr>`;
    })
    .join("");

  const html = `<div class="wrap ws">
    ${wsHead("uploads", "Uploads", "Every photo upload, pasted list, cert batch and set pick — what matched, what's waiting on you, and what reached your collection.", `<a class="btn primary" href="/collection/add">+ Add cards</a>`)}
    ${flash(msg)}
    ${
      rows.length
        ? `<div class="tablewrap"><table class="inv-table batches-table"><thead><tr><th>#</th><th>Upload</th><th>Cards</th><th>Matched</th><th>Review</th><th>No match</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<div class="ws-empty"><h3>No uploads yet</h3><p>Your photo uploads and pasted lists will appear here.</p><a class="btn primary" href="/collection/add">Add cards</a></div>`
    }
    ${APP_JS}
  </div>`;
  return { html, title: `Uploads ${TITLE_SUFFIX}`, description: "Your identify batches." };
}

// ---- Collection -----------------------------------------------------------

export async function renderCards(filter: CollectionFilter, msg?: string): Promise<Page> {
  const [stats, rows] = await Promise.all([collectionStats(), listCollection(filter)]);
  const pro = currentPlanIsPro();
  const gain = stats.market_cents - stats.paid_cents;

  const statCards = `<div class="stat-cards">
    <div class="stat"><div class="k">Collection value</div><div class="v mono">${money(stats.market_cents)}</div><div class="s">market price × copies · ${stats.units} card${stats.units === 1 ? "" : "s"}</div></div>
    <div class="stat"><div class="k">Paid</div><div class="v mono">${stats.paid_units ? money(stats.paid_cents) : "—"}</div><div class="s">${stats.paid_units ? `${stats.paid_units} card${stats.paid_units === 1 ? "" : "s"} with a paid price` : "no paid prices recorded yet"}</div></div>
    <div class="stat"><div class="k">Gain / loss</div><div class="v mono ${stats.paid_units ? (gain >= 0 ? "ok" : "bad") : ""}">${stats.paid_units ? `${gain >= 0 ? "+" : "−"}${money(Math.abs(gain))}` : "—"}</div><div class="s">market vs. what you paid</div></div>
    <div class="stat"><div class="k">Graded</div><div class="v mono">${stats.graded}</div><div class="s">slab${stats.graded === 1 ? "" : "s"} · ${stats.count} printing${stats.count === 1 ? "" : "s"} total</div></div>
  </div>`;

  let table: string;
  if (rows.length === 0) {
    table = `<div class="ws-empty">
      <h3>${filter.q || filter.game ? "No cards match" : "Your collection is empty"}</h3>
      <p>${filter.q || filter.game ? "Try a different search." : "Photograph your cards, paste a list, or tick them off a set checklist — confirmed cards land here with their value."}</p>
      <a class="btn primary" href="/collection/add?mode=collection">Add cards</a>
    </div>`;
  } else {
    const body = rows.map(cardRow).join("");
    const params = (over: Record<string, string | undefined>) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries({ q: filter.q, sort: filter.sort, game: filter.game, ...over })) if (v) p.set(k, v);
      return p.toString() ? "?" + p : "";
    };
    table = `<div class="inv-toolbar">
        <div class="tabs"><a href="/collection/cards${params({ game: undefined })}" class="${filter.game ? "" : "active"}">All games</a>${[...new Set(rows.map((r) => r.game_slug + "|" + r.game_name))]
          .map((gs) => gs.split("|"))
          .map(([slug, name]) => `<a href="/collection/cards${params({ game: slug })}" class="${filter.game === slug ? "active" : ""}">${esc(name)}</a>`)
          .join("")}</div>
        <form class="inv-search" method="get" action="/collection/cards">
          ${filter.game ? `<input type="hidden" name="game" value="${esc(filter.game)}">` : ""}
          <input type="search" name="q" value="${esc(filter.q ?? "")}" placeholder="Search your cards…" aria-label="Search your collection">
          <select name="sort" onchange="this.form.submit()" aria-label="Sort">
            ${opt("", "Newest", filter.sort ?? "")}${opt("value", "Value", filter.sort ?? "")}${opt("name", "Name", filter.sort ?? "")}${opt("set", "Set", filter.sort ?? "")}${opt("paid", "Paid", filter.sort ?? "")}
          </select>
          <button class="btn sm" type="submit">Go</button>
        </form>
      </div>
      <form id="bulkform" method="post" action="/collection/cards/bulk">
      <input type="hidden" name="ids" id="bulk-ids">
      <div class="bulkbar" id="bulkbar" hidden>
        <span class="n"><b id="bulk-count">0</b> selected</span>
        <label>Condition <select name="condition">${opt("", "—", "")}${conditionOptions("")}</select></label>
        <button class="btn sm" name="do" value="apply" type="submit">Apply</button>
        <button class="btn sm ghost" name="do" value="remove" type="submit" onclick="return confirm('Remove the selected cards from your collection?')">Remove</button>
      </div>
      <div class="tablewrap">
      <table class="inv-table">
        <thead><tr>
          <th class="chk"><input type="checkbox" id="selall" aria-label="Select all"></th>
          <th></th><th>Card</th><th>Cond</th><th>Lang</th><th>Qty</th><th>Paid</th><th>Value</th><th></th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      </div>
    </form>${rowForms(rows)}`;
  }

  const exportBtn = rows.length
    ? pro
      ? `<a class="btn" href="/collection/export.csv${filter.game ? "?game=" + encodeURIComponent(filter.game) : ""}" title="Download your collection as a spreadsheet">Export CSV</a>`
      : `<a class="btn" href="/pricing?upgrade=1" title="Collection export is part of Pro">Export CSV <span class="nav-pro">Pro</span></a>`
    : "";

  const html = `<div class="wrap ws">
    ${wsHead("cards", "Collection", `Every card you've confirmed, valued at today's market price. Private to you.`, `${exportBtn}<a class="btn primary" href="/collection/add?mode=collection">+ Add cards</a>`)}
    ${flash(msg)}
    ${statCards}
    ${table}
    ${APP_JS}
  </div>`;

  return { html, title: `Collection ${TITLE_SUFFIX}`, description: "Your card collection and its value." };
}

function cardRow(r: CollectionRow): string {
  const img = r.image_small || r.image_large;
  const diff = r.paid_cents != null && r.market_cents != null ? (r.market_cents - r.paid_cents) * r.quantity : null;
  return `<tr>
    <td class="chk"><input type="checkbox" class="rowsel" value="${r.id}" aria-label="Select ${esc(r.card_name)}"></td>
    <td class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}</td>
    <td class="card">
      <a href="/c/${esc(r.card_slug)}-${r.card_id}" target="_blank" rel="noopener">${esc(r.card_name)}</a>
      <div class="sub">${esc(r.set_name)}${r.number ? " · #" + esc(r.number) : ""} · ${finishChip({ finish: r.finish, finish_label: r.finish_label })}${r.grade ? ` · <span class="chip grade">${esc(r.grade)}</span>` : ""}${r.cert ? ` · <span class="mono">${esc(r.cert)}</span>` : ""}</div>
    </td>
    <td>${r.grade ? `<b>${esc(r.grade)}</b>` : esc(r.condition)}</td>
    <td>${esc(r.language)}</td>
    <td class="mono">${r.quantity}</td>
    <td class="mono">${r.paid_cents != null ? money(r.paid_cents) : "—"}</td>
    <td class="mono price">${money(r.market_cents)}${diff != null ? `<div class="mkt ${diff >= 0 ? "ok" : "bad"}">${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))}</div>` : ""}</td>
    <td class="act">
      <details class="img-ctl row-edit"><summary>Edit</summary>
        <div class="row-edit-form">
          <label>Qty <input type="number" name="quantity" min="1" value="${r.quantity}" class="mono" form="rf${r.id}"></label>
          <label>Paid $ <input type="text" name="paid" value="${dollars(r.paid_cents)}" class="mono" inputmode="decimal" placeholder="—" form="rf${r.id}"></label>
          <label>Cond <select name="condition" form="rf${r.id}">${conditionOptions(r.condition)}</select></label>
          <button class="btn sm" type="submit" form="rf${r.id}">Save</button>
        </div>
      </details>
    </td>
  </tr>`;
}

/** The per-row edit forms live OUTSIDE the bulk form (forms can't nest); inputs point at them via form="rf<id>". */
function rowForms(rows: CollectionRow[]): string {
  return rows.map((r) => `<form id="rf${r.id}" method="post" action="/collection/cards/${r.id}" hidden></form>`).join("");
}

// ---- Wishlist -------------------------------------------------------------

export async function renderWishlist(msg?: string): Promise<Page> {
  const [rows, member] = await Promise.all([listWishlist(), getMember()]);
  const pro = isPro(member.plan_tier);
  const hits = rows.filter((r) => r.hit).length;
  const cap = pro ? null : WISHLIST_FREE_MAX;

  const body = rows.map(wishRow).join("");
  const table = rows.length
    ? `<div class="tablewrap"><table class="inv-table wish-table"><thead><tr><th></th><th>Card</th><th>Market</th><th>Your target</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<div class="ws-empty"><h3>Nothing on your wishlist yet</h3><p>Open any card page and press <b>♡ Wishlist</b>. Add a target price and we'll flag the card when the market reaches it.</p><a class="btn primary" href="/search">Search cards</a></div>`;

  const capNote = cap != null
    ? `<p class="hint">${rows.length} of ${cap} wishlist cards on Free · <a href="/pricing?upgrade=1">Pro</a> lifts the cap and emails you when a target is hit.</p>`
    : `<p class="hint">${rows.length} card${rows.length === 1 ? "" : "s"} · targets are checked after every daily price sync and you're emailed when one is met.</p>`;

  const html = `<div class="wrap ws">
    ${wsHead("wishlist", "Wishlist", `Cards you want and the most you'd pay. ${hits ? `<b>${hits} at or below your target right now.</b>` : "We flag each one the moment the market drops to your price."}`)}
    ${flash(msg)}
    ${table}
    ${capNote}
    ${APP_JS}
  </div>`;
  return { html, title: `Wishlist ${TITLE_SUFFIX}`, description: "Cards you want, with target prices." };
}

function wishRow(r: WishlistRow & { tcgplayer_url: string | null }): string {
  const img = r.image_small || r.image_large;
  return `<tr class="${r.hit ? "wish-hit" : ""}">
    <td class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}</td>
    <td class="card">
      <a href="/c/${esc(r.card_slug)}-${r.card_id}?v=${encodeURIComponent(r.finish)}">${esc(r.card_name)}</a>
      <div class="sub">${esc(r.set_name)}${r.number ? " · #" + esc(r.number) : ""} · ${finishChip({ finish: r.finish, finish_label: r.finish_label })}</div>
    </td>
    <td class="mono">${money(r.market_cents)}</td>
    <td>
      <form method="post" action="/collection/wishlist/${r.id}/target" class="inline target-form">
        <span class="price-in"><span>$</span><input type="text" name="target" value="${dollars(r.target_cents)}" class="mono" inputmode="decimal" placeholder="any"></span>
        <button class="btn sm" type="submit">Set</button>
      </form>
    </td>
    <td>${r.hit ? `<span class="pill sold">At your price</span>` : r.target_cents != null && r.market_cents != null ? `<span class="pill">${money(r.market_cents - r.target_cents)} above</span>` : `<span class="pill">Watching</span>`}</td>
    <td class="act">
      ${r.tcgplayer_url ? `<a class="btn sm" href="${esc(r.tcgplayer_url)}" target="_blank" rel="noopener nofollow">Buy ↗</a>` : ""}
      <form method="post" action="/collection/wishlist/${r.id}/remove" class="inline"><button class="btn sm ghost" type="submit">Remove</button></form>
    </td>
  </tr>`;
}

// ---- Inbox ----------------------------------------------------------------

export function renderInbox(rows: Feedback[], msg?: string): Page {
  const list = rows.length
    ? rows
        .map(
          (f) => `<div class="fb ws-panel ${esc(f.status)}">
        <div class="fb-head"><span class="pill ${esc(f.kind)}">${esc(FEEDBACK_KINDS.find((k) => k.key === f.kind)?.label ?? f.kind)}</span><b>${esc(f.title)}</b><span class="hint">${esc(f.created_at.slice(0, 10))}</span><span class="pill ${f.status === "answered" ? "sold" : ""}">${esc(f.status)}</span></div>
        <p class="fb-body">${esc(f.body)}</p>
        ${f.reply ? `<div class="fb-reply"><span class="te-lbl">Reply · ${esc((f.replied_at ?? "").slice(0, 10))}</span><p>${esc(f.reply)}</p></div>` : ""}
      </div>`
        )
        .join("")
    : `<div class="ws-empty"><h3>Inbox is empty</h3><p>Questions, bug reports and missing-card notes you send show up here with replies.</p></div>`;
  const html = `<div class="wrap ws">
    ${wsHead("inbox", "Inbox", "Ask a question, report a problem, or tell us a card is missing from the catalog — replies land here.")}
    ${flash(msg)}
    <div class="home-grid">
      <div>${list}</div>
      <form class="ws-panel" method="post" action="/collection/inbox">
        <div class="ws-panel-head"><h2>Send a note</h2></div>
        <label class="fld"><span>Type</span><select name="kind">${FEEDBACK_KINDS.map((k) => opt(k.key, k.label, "feedback")).join("")}</select></label>
        <label class="fld"><span>Title</span><input name="title" maxlength="${FEEDBACK_TITLE_MAX}" required placeholder="Short summary"></label>
        <label class="fld"><span>Details</span><textarea name="body" rows="6" maxlength="${FEEDBACK_BODY_MAX}" placeholder="What happened, which card, what you expected…"></textarea></label>
        <button class="btn primary" type="submit">Send</button>
        <p class="hint" style="margin-top:10px">Missing card? Include the game, set and card number and it's added on the next catalog sync.</p>
      </form>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: `Inbox ${TITLE_SUFFIX}`, description: "Your notes and replies." };
}

// ---- Settings -------------------------------------------------------------

export async function renderSettings(msg?: string): Promise<Page> {
  const [s, sets] = await Promise.all([getMember(), getAllSets()]);
  const pro = isPro(s.plan_tier);
  const prefs = parseMatchingPrefs(s.matching_prefs);
  const matchVals = prefsToForm(prefs, sets);

  const planPanel = `<div class="ws-panel plan-panel" id="s-plan">
    <div>
      <div class="eyebrow">Your plan</div>
      <div class="plan-line">
        <b>${pro ? "Pro" : "Free"}</b>${pro ? ` · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}` : ""}
        <span class="plan-dot${pro ? "" : " free"}">${pro ? "Active" : "Free"}</span>
      </div>
      <p class="hint">${
        pro
          ? "Thanks for subscribing. Online billing management is coming soon."
          : `Free includes price checks, sold-price lookup and a ${WISHLIST_FREE_MAX}-card wishlist. Pro adds your collection, unlimited wishlist with alerts, and export.`
      } <a href="/pricing${pro ? "" : "?upgrade=1"}">${pro ? "View plans" : "Upgrade to Pro"}</a></p>
    </div>
  </div>`;

  const html = `<div class="wrap ws">
    ${wsHead("settings", "Settings", "Your name, the defaults used when cards are identified, and how matching behaves.", "", { navMode: "open" })}
    ${flash(msg)}
    ${planPanel}
    ${setDatalist(sets)}
    <form class="ws-panel settings-form" method="post" action="/collection/settings">
      <div class="set-section" id="s-account">
        <h2>Account</h2>
        <div class="fld-row">
          <label class="fld"><span>Display name <small>shown on price lists you share</small></span><input name="display_name" value="${esc(s.display_name)}" maxlength="80"></label>
          <label class="fld"><span>Email</span><input value="${esc(s.email ?? "")}" disabled></label>
        </div>
      </div>

      <div class="set-section" id="s-defaults">
        <h2>Defaults when adding cards</h2>
        <p class="hint">Pre-selected on every upload; you can change them per card in review.</p>
        <div class="fld-row">
          <label class="fld"><span>Default condition</span><select name="default_condition">${conditionOptions(s.default_condition)}</select></label>
          <label class="fld"><span>Default language</span><select name="default_language">${languageOptions(s.default_language)}</select></label>
        </div>
      </div>

      <div class="set-section" id="s-matching">
        <h2>Default matching options</h2>
        <p class="hint">Applied to every identify run unless you change them on the add page. ${isEmptyPrefs(prefs) ? "Nothing set — the matcher considers every set equally." : `Currently: <b>${esc(describePrefs(prefs, sets))}</b>.`}</p>
        <div class="fld-row">
          <label class="fld"><span>Prioritize sets <small>comma-separated set names</small></span><input type="text" name="prioritize_sets" list="setlist" value="${esc(matchVals.prioritize_sets)}" placeholder="e.g. Base Set, Jungle" autocomplete="off"></label>
          <label class="fld"><span>Exclude sets</span><input type="text" name="exclude_sets" list="setlist" value="${esc(matchVals.exclude_sets)}" placeholder="e.g. Vivid Voltage" autocomplete="off"></label>
        </div>
        <div class="fld-row">
          <label class="fld"><span>Prioritize keywords</span><input type="text" name="prioritize_terms" value="${esc(matchVals.prioritize_terms)}" placeholder="e.g. holo, japanese"></label>
          <label class="fld"><span>Exclude keywords</span><input type="text" name="exclude_terms" value="${esc(matchVals.exclude_terms)}" placeholder="e.g. promo"></label>
        </div>
      </div>

      <div class="set-section" id="s-privacy">
        <h2>Privacy</h2>
        <label class="ckbox"><input type="checkbox" name="training_opt_in" value="1" ${s.training_opt_in ? "checked" : ""}> <span>Let my confirmed matches help improve card identification <small>(off by default — your photos and collection stay yours)</small></span></label>
      </div>

      <button class="btn primary" type="submit">Save settings</button>
    </form>
    ${APP_JS}
  </div>`;

  return { html, title: `Settings ${TITLE_SUFFIX}`, description: "Account settings." };
}

/**
 * Advanced Matching Options panel: prioritize or exclude sets and keywords for
 * this batch. Prefilled from saved defaults; "save as my defaults" persists it.
 * Set names complete from a shared <datalist id="setlist"> rendered once per page.
 */
export function matchingPanel(vals: Record<string, string>, saved: boolean, suffix: string): string {
  const has = Object.values(vals).some((v) => v && v.trim());
  return `<details class="adv-match"${has ? " open" : ""}>
    <summary><b>Advanced matching options</b> <span class="hint">prioritize or exclude specific sets and keywords during matching${saved ? " · using your saved defaults" : ""}</span></summary>
    <div class="fld-row">
      <label class="fld"><span>Prioritize sets <small>comma-separated</small></span><input type="text" name="prioritize_sets" list="setlist" value="${esc(vals.prioritize_sets ?? "")}" placeholder="e.g. Base Set, Jungle" autocomplete="off"></label>
      <label class="fld"><span>Exclude sets</span><input type="text" name="exclude_sets" list="setlist" value="${esc(vals.exclude_sets ?? "")}" placeholder="e.g. Vivid Voltage" autocomplete="off"></label>
    </div>
    <div class="fld-row">
      <label class="fld"><span>Prioritize keywords</span><input type="text" name="prioritize_terms" value="${esc(vals.prioritize_terms ?? "")}" placeholder="e.g. holo, japanese"></label>
      <label class="fld"><span>Exclude keywords</span><input type="text" name="exclude_terms" value="${esc(vals.exclude_terms ?? "")}" placeholder="e.g. promo"></label>
    </div>
    <label class="fld ckbox"><input type="checkbox" name="save_matching" value="1" id="save_matching_${suffix}"> <span>Save as my default matching options</span></label>
    <p class="hint">Excluded sets and keywords are dropped before scoring; prioritized ones get a boost so a card from a set you know you're holding wins ties over the same name elsewhere.</p>
  </details>`;
}

export function setDatalist(sets: SetRef[]): string {
  return `<datalist id="setlist">${sets.map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist>`;
}

// ---- progressive-enhancement script ---------------------------------------
// Included once per member page (idempotent guard). Adds: sample loader, the
// chunked photo dropzone, bulk select + bar, keyboard shortcuts on review
// items, auto-submit selects, and manual card search.
export const APP_JS = `<script>(function(){
  if(window.__wsInit)return; window.__wsInit=1;

  // load sample lines on the add page
  var ls=document.getElementById('loadsample');
  if(ls)ls.addEventListener('click',function(){var t=document.getElementById('lines');if(t&&window.__SAMPLE__){t.value=window.__SAMPLE__;t.focus();}});

  // photo-upload dropzone: preview thumbnails, drag & drop, enable submit, and
  // the chunked upload itself (see upload.ts): start → chunk… → finish, so a
  // 500-photo batch is many small requests with a progress bar, never one
  // giant POST. Without fetch/FormData the form posts once, the old way.
  var dz=document.getElementById('dropzone'), inp=document.getElementById('imgInput');
  if(dz&&inp){
    var prev=document.getElementById('dzPreview'), cnt=document.getElementById('dzCount'), btn=document.getElementById('uploadBtn');
    var maxFiles=parseInt(dz.getAttribute('data-max-files'),10)||100, maxBytes=parseInt(dz.getAttribute('data-max-bytes'),10)||60000000, chunkN=parseInt(dz.getAttribute('data-chunk'),10)||20, maxEdge=parseInt(dz.getAttribute('data-max-edge'),10)||1600;
    var canChunk=!!(window.fetch&&window.FormData&&window.Promise);
    var canShrink=canChunk&&!!(window.createImageBitmap&&document.createElement('canvas').toBlob);
    function mb(b){return (b/1000000).toFixed(b<10000000?1:0)+' MB';}
    function check(files){
      var n=files.length, total=0, biggest=0; for(var i=0;i<n;i++){var s=files[i].size||0;total+=s;if(s>biggest)biggest=s;}
      var over=[];
      if(n>maxFiles)over.push(n+' photos selected — max '+maxFiles+' per upload');
      if(canChunk){if(biggest>maxBytes)over.push('one photo is '+mb(biggest)+' — max '+mb(maxBytes)+' per photo');}
      else if(total>maxBytes)over.push(mb(total)+' selected — max '+mb(maxBytes)+' per upload');
      return {n:n,total:total,msg:over.join(' · ')};
    }
    function render(){
      var files=inp.files||[]; var c=check(files); var n=c.n; var bad=!!c.msg;
      if(cnt){
        cnt.textContent = bad ? c.msg+'. Remove some and try again.' : n? (n+' photo'+(n>1?'s':'')+' ready · '+mb(c.total)) : 'No photos selected yet';
        cnt.classList.toggle('is-over',bad);
      }
      dz.classList.toggle('over',bad);
      if(btn)btn.disabled = n===0||bad;
      if(prev){
        prev.innerHTML=''; prev.hidden = n===0;
        for(var i=0;i<Math.min(n,24);i++){(function(f){
          try{var u=URL.createObjectURL(f);var im=document.createElement('img');im.src=u;im.onload=function(){URL.revokeObjectURL(u);};prev.appendChild(im);}catch(e){}
        })(files[i]);}
        if(n>24){var s=document.createElement('span');s.className='dz-more';s.textContent='+'+(n-24);prev.appendChild(s);}
      }
    }
    inp.addEventListener('change',render);
    ['dragenter','dragover'].forEach(function(ev){dz.addEventListener(ev,function(e){e.preventDefault();dz.classList.add('drag');});});
    ['dragleave','drop'].forEach(function(ev){dz.addEventListener(ev,function(e){e.preventDefault();dz.classList.remove('drag');});});
    dz.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length){inp.files=e.dataTransfer.files;job=null;render();}});

    var upForm=dz.closest('form'), job=null;
    function bar(){
      var b=document.getElementById('dzBar');
      if(!b&&cnt){b=document.createElement('div');b.className='dz-progress';b.id='dzBar';b.innerHTML='<i></i>';cnt.parentNode.appendChild(b);}
      return b;
    }
    function progress(done,total,text){
      var b=bar(); if(b){b.hidden=false;b.firstChild.style.width=Math.round(100*done/Math.max(1,total))+'%';}
      if(cnt){cnt.textContent=text;cnt.classList.remove('is-over');}
    }
    function fail(msg){
      if(cnt){cnt.textContent=msg;cnt.classList.add('is-over');}
      if(btn){btn.disabled=false;btn.textContent=job&&job.batchId?'Retry upload →':'Try again →';}
    }
    function fieldsOf(){var fd=new FormData(upForm);fd.delete('images');return fd;}
    function post(url,fd,tries){
      return fetch(url,{method:'POST',body:fd,credentials:'same-origin',headers:{'Accept':'application/json'}}).then(function(r){
        return r.json().catch(function(){return {};}).then(function(j){
          if(r.ok)return j;
          var err=new Error(j.error||('Upload failed (HTTP '+r.status+')'));err.status=r.status;err.redirect=j.redirect;throw err;
        });
      }).catch(function(e){
        if(tries>0&&(!e.status||e.status>=500))return new Promise(function(ok){setTimeout(ok,1500);}).then(function(){return post(url,fd,tries-1);});
        throw e;
      });
    }
    function groupsOf(files){
      var out=[],cur=[],bytes=0,cap=maxBytes*0.9;
      for(var i=0;i<files.length;i++){
        var f=files[i],s=canShrink?0:(f.size||0);
        if(cur.length&&(cur.length>=chunkN||bytes+s>cap)){out.push(cur);cur=[];bytes=0;}
        cur.push(f);bytes+=s;
      }
      if(cur.length)out.push(cur);
      return out;
    }
    // On-device shrink: phone photos are ~12 MP; the recognizer only needs
    // ~1600 px, so each photo is resized before it is sent.
    function shrink(file){
      var asIs={blob:file,name:file.name||'photo.jpg'};
      if(!canShrink||String(file.type||'').indexOf('image/')!==0)return Promise.resolve(asIs);
      return createImageBitmap(file,{imageOrientation:'from-image'}).catch(function(){return createImageBitmap(file);}).then(function(bmp){
        var w=bmp.width,h=bmp.height,s=Math.min(1,maxEdge/Math.max(w,h,1));
        if(s===1&&/jpe?g$/i.test(file.type)){if(bmp.close)bmp.close();return asIs;}
        var tw=Math.max(1,Math.round(w*s)),th=Math.max(1,Math.round(h*s));
        var c=document.createElement('canvas');c.width=tw;c.height=th;
        c.getContext('2d').drawImage(bmp,0,0,tw,th); if(bmp.close)bmp.close();
        return new Promise(function(ok){c.toBlob(function(b){ok(b);},'image/jpeg',0.85);}).then(function(b){
          c.width=c.height=0;
          return b?{blob:b,name:(file.name||'photo').replace(/\\.[^.]+$/,'')+'.jpg'}:asIs;
        });
      }).catch(function(){return asIs;});
    }
    function prepare(files){
      var out=new Array(files.length),i=0,active=0;
      return new Promise(function(done){
        function next(){
          if(i>=files.length&&active===0)return done(out);
          while(active<3&&i<files.length){(function(k){active++;shrink(files[k]).then(function(r){out[k]=r;active--;next();});})(i++);}
        }
        next();
      });
    }
    function warn(e){e.preventDefault();e.returnValue='';}
    function run(){
      var files=Array.prototype.slice.call(inp.files||[]), base=upForm.getAttribute('action'), groups=groupsOf(files), total=files.length;
      if(!job)job={batchId:null,next:0,done:0,prepped:[]};
      if(btn){btn.disabled=true;btn.textContent='Uploading…';}
      window.addEventListener('beforeunload',warn);
      function prepped(gi){return job.prepped[gi]||(job.prepped[gi]=prepare(groups[gi]));}
      var start=job.batchId?Promise.resolve(job.batchId):post(base+'/start',fieldsOf(),1).then(function(j){job.batchId=j.batchId;return j.batchId;});
      start.then(function(id){
        var p=Promise.resolve();
        groups.forEach(function(g,gi){p=p.then(function(){
          if(gi<job.next)return;
          progress(job.done,total,'Preparing '+(job.done+1)+'–'+(job.done+g.length)+' of '+total+'…');
          if(gi+1<groups.length)prepped(gi+1);
          return prepped(gi).then(function(items){
            progress(job.done,total,'Uploading '+(job.done+1)+'–'+(job.done+g.length)+' of '+total+'…');
            var fd=fieldsOf(); items.forEach(function(it){fd.append('images',it.blob,it.name);});
            return post(base+'/'+id+'/chunk',fd,2);
          }).then(function(){job.prepped[gi]=null;job.next=gi+1;job.done+=g.length;progress(job.done,total,job.done+' of '+total+' identified');});
        });});
        return p;
      }).then(function(){
        progress(total,total,'Finishing up…');
        return post(base+'/'+job.batchId+'/finish',fieldsOf(),2);
      }).then(function(j){
        window.removeEventListener('beforeunload',warn);
        window.location.href=j.landing;
      }).catch(function(e){
        window.removeEventListener('beforeunload',warn);
        if(e&&e.redirect){window.location.href=e.redirect;return;}
        fail(((e&&e.message)||'Upload failed')+' — nothing is lost; press Retry to continue.');
      });
    }
    if(upForm)upForm.addEventListener('submit',function(e){
      if(check(inp.files||[]).msg){e.preventDefault();render();return;}
      if(!canChunk){if(btn){btn.disabled=true;btn.textContent='Uploading…';}return;}
      e.preventDefault();
      run();
    });
    inp.addEventListener('change',function(){job=null;var b=document.getElementById('dzBar');if(b)b.hidden=true;});
    render();
  }

  // auto-submit selects that change the row (save it)
  document.querySelectorAll('select[data-autosubmit]').forEach(function(sel){
    sel.addEventListener('change',function(){
      var form=sel.closest('form'); if(!form)return;
      var save=form.querySelector('button[value=save]');
      if(save&&form.requestSubmit)form.requestSubmit(save); else form.submit();
    });
  });

  // collection bulk-select
  var bulkform=document.getElementById('bulkform');
  if(bulkform){
    var bar=document.getElementById('bulkbar'), count=document.getElementById('bulk-count'),
        ids=document.getElementById('bulk-ids'), selall=document.getElementById('selall');
    function sync(){
      var checked=[].slice.call(bulkform.querySelectorAll('.rowsel:checked'));
      ids.value=checked.map(function(c){return c.value;}).join(',');
      if(count)count.textContent=checked.length;
      if(bar)bar.hidden=checked.length===0;
    }
    bulkform.addEventListener('change',function(e){if(e.target.classList.contains('rowsel'))sync();});
    if(selall)selall.addEventListener('change',function(){bulkform.querySelectorAll('.rowsel').forEach(function(c){c.checked=selall.checked;});sync();});
    bulkform.addEventListener('submit',function(e){
      if(!ids.value){e.preventDefault();alert('Select at least one card.');}
    });
  }

  // review keyboard shortcuts: j/k move, y approve, s skip, e focus edit
  var items=[].slice.call(document.querySelectorAll('.review-item'));
  if(items.length){
    var idx=-1;
    function focusItem(i){idx=Math.max(0,Math.min(items.length-1,i));items[idx].focus();items[idx].scrollIntoView({block:'center',behavior:'smooth'});}
    document.addEventListener('keydown',function(e){
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))return;
      var cur=document.activeElement.closest?document.activeElement.closest('.review-item'):null;
      var here=items.indexOf(cur);
      if(e.key==='j'){e.preventDefault();focusItem((here<0?0:here+1));}
      else if(e.key==='k'){e.preventDefault();focusItem((here<0?0:here-1));}
      else if((e.key==='y'||e.key==='s'||e.key==='e')&&cur){
        var form=cur.querySelector('.ri-edit');if(!form)return;
        if(e.key==='e'){e.preventDefault();var inp=cur.querySelector('.ri-edit input,.ri-edit select');if(inp)inp.focus();return;}
        var b=form.querySelector('button[value='+(e.key==='y'?'approve':'skip')+']');
        if(b&&!b.disabled){e.preventDefault();b.click();}
      }
    });
  }

  // manual card search in review
  document.querySelectorAll('.manual-box').forEach(function(box){
    var q=box.querySelector('.manual-q'), out=box.querySelector('.manual-results'), action=box.getAttribute('data-action'), t;
    if(!q)return;
    q.addEventListener('input',function(){
      clearTimeout(t);var v=q.value.trim();
      if(v.length<2){out.innerHTML='';return;}
      t=setTimeout(function(){
        fetch('/api/identify?q='+encodeURIComponent(v)).then(function(r){return r.json();}).then(function(rows){
          out.innerHTML=rows.map(function(r){
            return '<form method="post" action="'+action+'" class="mres"><input type="hidden" name="do" value="replace"><input type="hidden" name="variant_id" value="'+r.variant_id+'"><button type="submit">'+
              (r.image?'<img src="'+r.image+'" alt="">':'')+'<span>'+r.label+'</span><span class="mset">'+r.set+' · '+r.finish+'</span></button></form>';
          }).join('')||'<div class="mnone">No matches</div>';
        }).catch(function(){});
      },160);
    });
  });
})();</script>`;
