// Seller-workspace page renderers (spec Phase 1: scan → review → price → list).
// Server-rendered like the public site; reuses the same design tokens. Edits use
// plain HTML forms (POST → redirect) so the flow works without JavaScript; a thin
// progressive-enhancement script adds bulk-select, keyboard shortcuts, and
// auto-submit. Rendered inside the shared page() shell by the server.

import { esc, money } from "../util.ts";
import { getVariants, getAllSets } from "../pg.ts";
import { finishChip } from "./components.ts";
import {
  getSeller, listInventory, inventoryStats, listBatches, listBatchesOfKind, listBatchesWithStats, workspaceCounts, getBatch, getItems,
  listingsFor, listListings, marketCents, getVariantFull, getInventoryItem, scheduledCounts,
  type ScanItem, type ScanBatch, type Seller, type InventoryRow, type VariantFull,
  type InventoryFilter, type BatchStats,
} from "../app/store.ts";
import { PRICE_MODES, ruleKey, ruleLabel, CONDITIONS, LANGUAGES, AUTO_PRICE_PREFS, parseAutoPricePref } from "../app/pricing.ts";
import { scanItemTitle, inventoryListingPreview, sampleTitleFields, sellerTitle } from "../app/compose.ts";
import {
  EBAY_TITLE_MAX, DESCRIPTION_VARS, DESCRIPTION_TEMPLATE_MAX, DEFAULT_DESCRIPTION_TEMPLATE,
  parseDescriptionTemplates, fillDescriptionTemplate,
} from "../app/listing.ts";
import { parseMatchingPrefs, prefsToForm, describePrefs, isEmptyPrefs, type SetRef } from "../app/matching.ts";
import {
  DEFAULT_STRUCTURE, TITLE_TOKENS, TITLE_MAX, parseStructure, serializeStructure, renderStructuredTitle,
} from "../app/title.ts";
import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL, isPro } from "../app/billing.ts";
import { maxUploadFiles, MAX_UPLOAD_FILES_PRO, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_FILES, UPLOAD_MAX_EDGE } from "../upload.ts";
import { GRADERS, GRADE_VALUES, certUrl, splitGrade } from "../app/graded.ts";
import { EXPORT_FORMATS, parseChannelPrefs } from "../app/exporters.ts";
import { marketCentsAt } from "../app/store.ts";
import { ebaySellConfigured, ebayIsMock, ebayMarketplace, getConnection, policiesOf, policyIdsOf, locationOf } from "../app/ebay-sell.ts";
import { currentAccount } from "../app/session-context.ts";

const dollars = (c: number | null | undefined): string => (c == null ? "" : (c / 100).toFixed(2));

export function opt(value: string, label: string, selected: string): string {
  return `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
}
export function conditionOptions(sel: string): string {
  return CONDITIONS.map((c) => opt(c.key, `${c.key} · ${c.label}`, sel)).join("");
}
export function languageOptions(sel: string): string {
  return LANGUAGES.map((l) => opt(l, l, sel)).join("");
}
export function ruleOptions(sel: string): string {
  return PRICE_MODES.map((m) => opt(m.key, m.label, sel)).join("");
}

// ---- workspace chrome -----------------------------------------------------

// The sidebar. Groups are named by what the seller DOES there, so the pages
// that take cards in ("Add cards") read as one block, and the read-only tools
// ("Look up") and stock/orders ("Manage") don't look like places to upload.
// Free accounts see a "Pro" marker on gated pages before they click.
// (Sept 8 CardUploader research: their List Cards / Tools split is the only
// signal of which pages upload, and their dashboard has no upload control.)

/** Nav keys whose page takes cards in — no "+ Add cards" button is added on these. */
const ADD_KEYS = new Set(["scan", "graded", "creator", "blank", "pricing-tool"]);
/** Nav keys behind the Pro plan (mirrors `proRequired()` in server.ts). */
const PRO_KEYS = new Set(["scan", "graded", "creator", "blank", "batches", "inventory", "automatic", "listings", "orders"]);

// 20×20 stroke icons; the collapsed rail shows only these.
const NAV_ICONS: Record<string, string> = {
  home: `<path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z"/>`,
  scan: `<path d="M3 7h3l1.5-2h5L14 7h3v9H3z"/><circle cx="10" cy="11.5" r="2.5"/>`,
  graded: `<circle cx="10" cy="8" r="4.5"/><path d="M7 11.5 6 17l4-2 4 2-1-5.5"/>`,
  creator: `<path d="M4 5h9M4 10h9M4 15h6M15 12v6M12 15h6"/>`,
  blank: `<path d="M5 3h7l4 4v10H5z"/><path d="M12 3v4h4"/>`,
  "pricing-tool": `<path d="M3 10V4h6l8 8-6 6z"/><circle cx="6.5" cy="7.5" r="1"/>`,
  batches: `<path d="m10 4 7 3.5-7 3.5-7-3.5z"/><path d="m3 11 7 3.5 7-3.5"/>`,
  inventory: `<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>`,
  automatic: `<path d="M16 9a6 6 0 0 0-11-2M4 11a6 6 0 0 0 11 2"/><path d="M15 3v4h-4M5 17v-4h4"/>`,
  listings: `<path d="M3 8l1.5-4h11L17 8M4 8v9h12V8M8 17v-5h4v5"/>`,
  orders: `<path d="m3 6 7-3 7 3v8l-7 3-7-3z"/><path d="M3 6l7 3 7-3M10 9v8"/>`,
  "card-search": `<circle cx="9" cy="9" r="5"/><path d="m13 13 4 4"/>`,
  sales: `<path d="M3 15l5-5 3 3 6-6"/><path d="M13 7h4v4"/>`,
  inbox: `<path d="M3 11h4l1.5 2h3L13 11h4v6H3z"/><path d="M5 11V4h10v7"/>`,
  settings: `<path d="M4 6h12M4 10h12M4 14h12"/><circle cx="8" cy="6" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="7" cy="14" r="1.5"/>`,
};
function navIcon(key: string): string {
  return `<svg class="nav-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${NAV_ICONS[key] ?? ""}</svg>`;
}

/** Is the workspace being viewed on a Pro plan? (Owner mode uses the customer's plan.) */
function currentPlanIsPro(): boolean {
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
// Runs inline right after the nav so the collapsed rail paints without a flash.
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
    ["", [["/app", "Dashboard", "home"]]],
    [
      "Add cards",
      [
        ["/app/scan?mode=inventory", "Ungraded", "scan"],
        ["/app/graded", "Graded", "graded"],
        ["/app/listing-creator", "Listing creator", "creator"],
        ["/app/blank-listing", "Blank listing", "blank"],
        ["/app/scan?mode=price", "Pricing tool", "pricing-tool"],
      ],
    ],
    [
      "Manage",
      [
        ["/app/batches", "Batches", "batches"],
        ["/app/inventory", "Inventory", "inventory"],
        ["/app/inventory/automatic", "Automatic inventory", "automatic"],
        ["/app/listings", "Listings", "listings"],
        ["/app/orders", "Orders", "orders"],
      ],
    ],
    ["Look up", [["/app/card-search", "Card search", "card-search"], ["/app/sales-lookup", "Sales lookup", "sales"]]],
    ["Account", [["/app/inbox", "Inbox", "inbox"], ["/app/settings", "Settings", "settings"]]],
  ];
  const item = ([href, text, key]: [string, string, string]) =>
    `<a href="${href}" class="${key === active ? "active" : ""}${ADD_KEYS.has(key) ? " adds" : ""}" title="${esc(text)}${ADD_KEYS.has(key) ? " — takes cards in" : ""}">${navIcon(key)}<span class="nav-t">${text}</span>${
      !pro && PRO_KEYS.has(key) ? `<span class="nav-pro" title="Pro plan">Pro</span>` : ""
    }</a>`;
  const collapse = `<button type="button" class="ws-collapse" aria-expanded="true" title="Collapse menu"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M12 5l-5 5 5 5"/><path d="M4 4v12" /></svg><span class="sr-only">Collapse menu</span></button>`;
  return `<nav class="ws-nav" aria-label="Workspace" data-mode="${navMode}">${collapse}${groups
    .map(
      ([label, items]) =>
        `<div class="ws-group">${label ? `<span class="ws-glabel">${label}</span>` : ""}${items.map(item).join("")}</div>`
    )
    .join("")}</nav>${NAV_JS}`;
}

const DEFAULT_SHOP_NAME = "My card shop";

// ---- Dashboard home -------------------------------------------------------
// CardUploader's logged-in home: plan card, stat tiles, quick actions, a
// getting-started checklist, recent batches, and a help accordion. Ours adds
// the two things their stats don't show — market value vs. your prices, and
// how many cards are waiting in review.

export async function renderWorkspaceHome(msg?: string): Promise<{ html: string; title: string; description: string }> {
  const [seller, stats, counts, batches] = await Promise.all([getSeller(), inventoryStats(), workspaceCounts(), listBatchesWithStats(5)]);
  const pro = isPro(seller.plan_tier);
  const policiesDone = !!(seller.ebay_shipping_policy && seller.ebay_return_policy && seller.ebay_payment_policy);

  const planCard = `<div class="home-plan">
    <div>
      <div class="eyebrow">Your plan</div>
      <div class="plan-line"><b>${pro ? "Pro" : "Free"}</b>${pro ? ` · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}` : ""} <span class="plan-dot${pro ? "" : " free"}">${pro ? "Active" : "Free"}</span></div>
      <p class="hint">${
        pro
          ? "Unlimited scans, inventory and listings."
          : "Pricing tool, card search and sales lookup are included. Pro adds scanning, inventory and eBay listings."
      } <a href="/pricing${pro ? "" : "?upgrade=1"}">${pro ? "Plans &amp; pricing" : "Upgrade to Pro"}</a></p>
    </div>
    <div class="home-plan-shop"><div class="eyebrow">Shop</div><b>${esc(seller.display_name)}</b><div class="hint">Next SKU <span class="mono">${esc(seller.sku_prefix)}-${String(seller.sku_next).padStart(seller.sku_pad, "0")}</span></div></div>
  </div>`;

  const diff = stats.market_cents - stats.value_cents;
  const statCards = `<div class="stat-cards home-stats">
    <div class="stat"><div class="k">Inventory value</div><div class="v mono">${money(stats.value_cents)}</div><div class="s">your prices × quantity</div></div>
    <div class="stat"><div class="k">Market value</div><div class="v mono">${money(stats.market_cents)}</div><div class="s">${stats.count ? `catalog market · ${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))} vs. yours` : "catalog market price × quantity"}</div></div>
    <div class="stat"><div class="k">Cards in stock</div><div class="v mono">${stats.units}</div><div class="s">${stats.count} record${stats.count === 1 ? "" : "s"} · ${stats.listed} listed · ${counts.sold} sold</div></div>
    <div class="stat${counts.review_items ? " attn" : ""}"><div class="k">Awaiting review</div><div class="v mono">${counts.review_items}</div><div class="s">${counts.review_items ? `<a href="/app/batches">open batches →</a>` : "nothing waiting on you"}</div></div>
  </div>`;

  // Free accounts see which tiles are Pro before they click (mirrors the nav).
  const proTag = pro ? "" : `<span class="nav-pro">Pro</span>`;
  const quick = `<div class="quick-grid">
    <a class="quick" href="/app/scan?mode=inventory"><span class="qi">📷</span><b>Ungraded cards ${proTag}</b><span>Upload photos or paste a list → identified, priced, queued for review.</span></a>
    <a class="quick" href="/app/graded"><span class="qi">🏅</span><b>Graded cards ${proTag}</b><span>Paste cert numbers; priced at the grade, listed with the slab details.</span></a>
    <a class="quick" href="/app/listing-creator"><span class="qi">🗂️</span><b>Listing creator ${proTag}</b><span>Build listings from catalog images — browse a set, tick the cards.</span></a>
    <a class="quick" href="/app/scan?mode=price"><span class="qi">🔎</span><b>Pricing tool</b><span>Free: price a binder or a list and share the result by link — nothing added to stock.</span></a>
    <a class="quick" href="/app/orders"><span class="qi">📦</span><b>Orders ${proTag}</b><span>Pull sheets, picklists, and stock that comes off when you ship.</span></a>
    <a class="quick" href="/app/settings"><span class="qi">⚙️</span><b>Settings</b><span>SKUs, pricing, matching, titles, descriptions, every channel.</span></a>
  </div>`;

  const steps: Array<[boolean, string, string, string]> = [
    [seller.display_name !== DEFAULT_SHOP_NAME || seller.sku_prefix !== "CARD", "Name your shop and set a SKU prefix", "Every card you add gets a unique SKU like CARD-000001.", "/app/settings#s-shop"],
    [!!seller.title_structure, "Save a title structure", "Drag the blocks into the order you want; titles auto-fit eBay's 80 characters.", "/app/settings#s-titles"],
    [policiesDone, "Fill in your eBay business policies", "Shipping, return and payment policy names must match your eBay account exactly or the upload fails.", "/app/settings#s-ebay"],
    [counts.batches > 0, "Scan or paste your first batch", "Every match shows a confidence score; anything uncertain waits in review.", "/app/scan"],
    [stats.count > 0, "Add reviewed cards to inventory", "Approve a batch to assign SKUs and record the prices you chose.", counts.batches ? "/app/batches" : "/app/scan"],
    [counts.listings > 0, "Create a listing draft or export a CSV", "Drafts export to an eBay File Exchange CSV with your policies filled in.", stats.count ? "/app/inventory" : "/app/scan"],
  ];
  const done = steps.filter((s) => s[0]).length;
  const checklist = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Getting started</h2><span class="eyebrow">${done} of ${steps.length} done</span></div>
    <ol class="checklist">${steps
      .map(([ok, t, sub, href]) => `<li class="${ok ? "done" : ""}"><span class="ck">${ok ? "✓" : ""}</span><div><a href="${href}">${esc(t)}</a><div class="sub">${esc(sub)}</div></div></li>`)
      .join("")}</ol>
  </div>`;

  const recent = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Recent batches</h2><a href="/app/batches">All batches →</a></div>
    ${batches.length ? `<div class="batch-list">${batches.map(batchRow).join("")}</div>` : `<p class="hint">No batches yet — <a href="/app/scan">scan or paste cards</a> to start one.</p>`}
  </div>`;

  const help = `<div class="ws-panel help-panel">
    <div class="ws-panel-head"><h2>How it works</h2></div>
    <details><summary>How are cards identified?</summary><p>Photos go through the configured recognizer and pasted lines are parsed for name, number, set, finish, condition, language and quantity. Both resolve against the catalog and get a confidence score: <b>90%+ auto-matches</b>, anything lower waits in review with alternatives and a manual search. Use <b>Advanced Matching Options</b> on the scan page to prioritize or exclude sets and keywords when you know what a binder holds.</p></details>
    <details><summary>How are prices chosen?</summary><p>Each card resolves a price from your rule (Market, Market ± %, or Fixed). If you've listed the same printing before, that previous price is remembered and — depending on your <a href="/app/settings#s-pricing">automatic pricing preference</a> — used first. A floor stops automatic prices dropping below a minimum. You can always type an exact price.</p></details>
    <details><summary>What if a card isn't in the catalog?</summary><p>It lands in review as "No match". Search manually for the closest printing, or skip it. The public catalog grows by set sync; tell us which set is missing.</p></details>
    <details><summary>How do listings reach eBay?</summary><p>Listing drafts carry your title, item specifics, description template, price and policies. Export them as an eBay File Exchange CSV, or connect eBay for direct publishing (next integration). Policy names are validated before export so the CSV isn't rejected.</p></details>
    <details><summary>Where are my previous batches?</summary><p><a href="/app/batches">Batches</a> keeps every scan with matched / review / failed counts and the value that reached inventory. Reopen any batch to finish reviewing it.</p></details>
  </div>`;

  const html = `<div class="wrap ws">
    ${wsHead("home", "Dashboard", `Where your stock stands and what's waiting on you.`, `<a class="btn primary" href="/app/scan">+ Scan cards</a>`)}
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
  return { html, title: "Dashboard — Seller workspace | CardIndex", description: "Your seller workspace overview." };
}

function batchRow(b: BatchStats): string {
  const st = b.review ? `<span class="warn">${b.review} to review</span>` : b.approved === b.total && b.total ? `<span class="ok">in inventory</span>` : b.status;
  return `<a class="batch-row" href="/app/review/${b.id}">
    <span class="bid">#${b.id}</span>
    <span class="blabel">${esc(b.label || (b.source === "sample" ? "Sample batch" : b.source === "upload" ? "Photo batch" : "Pasted batch"))}</span>
    <span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"} · ${st}</span>
  </a>`;
}

// ---- Previous batches -----------------------------------------------------

export async function renderBatches(msg?: string): Promise<{ html: string; title: string; description: string }> {
  const rows = await listBatchesWithStats(200);
  const body = rows
    .map((b) => {
      const when = b.created_at.slice(0, 10);
      const state = b.review
        ? `<span class="pill review">${b.review} to review</span>`
        : b.total && b.approved === b.total
        ? `<span class="pill sold">In inventory</span>`
        : b.approved
        ? `<span class="pill listed">${b.approved}/${b.total} added</span>`
        : `<span class="pill">${esc(b.status)}</span>`;
      return `<tr>
        <td class="mono">#${b.id}</td>
        <td><a href="/app/review/${b.id}"><b>${esc(b.label || (b.source === "upload" ? "Photo batch" : b.source === "sample" ? "Sample batch" : "Pasted batch"))}</b></a><div class="sub">${esc(b.source)} · ${esc(when)}</div></td>
        <td class="mono">${b.total}</td>
        <td class="mono ok">${b.matched}</td>
        <td class="mono${b.review ? " warn" : ""}">${b.review}</td>
        <td class="mono${b.failed ? " bad" : ""}">${b.failed}</td>
        <td class="mono">${money(b.value_cents)}</td>
        <td>${state}</td>
        <td class="act"><a class="btn sm" href="/app/review/${b.id}">${b.review ? "Review →" : "Open"}</a></td>
      </tr>`;
    })
    .join("");

  const html = `<div class="wrap ws">
    ${wsHead("batches", "Previous batches", "Every scan and paste, with what matched, what's waiting on you, and what reached inventory.", `<a class="btn primary" href="/app/scan">+ New batch</a>`)}
    ${flash(msg)}
    ${
      rows.length
        ? `<div class="tablewrap"><table class="inv-table batches-table"><thead><tr><th>#</th><th>Batch</th><th>Cards</th><th>Matched</th><th>Review</th><th>Failed</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<div class="ws-empty"><h3>No batches yet</h3><p>Your scans and pasted lists will appear here.</p><a class="btn primary" href="/app/scan">Scan / add cards</a></div>`
    }
    ${APP_JS}
  </div>`;
  return { html, title: "Batches — Seller workspace | CardIndex", description: "Your previous scan batches." };
}

// The nav is emitted as a sibling of the header (not inside it) so the page
// grid can place it in a sidebar column on desktop; see `.wrap.ws` in styles.css.
// Every page that doesn't itself take cards in gets a "+ Add cards" action, so
// Orders, Inventory, Card search etc. always offer the way in.
export function wsHead(active: string, title: string, sub: string, actions = "", opts: { navMode?: NavMode } = {}): string {
  const addCta =
    ADD_KEYS.has(active) || actions.includes('href="/app/scan"') ? "" : `<a class="btn primary" href="/app/scan">+ Add cards</a>`;
  return `${subnav(active, opts.navMode ?? "auto")}<div class="ws-head">
    <div class="ws-title-row">
      <div>
        <div class="eyebrow">Seller workspace</div>
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

// ---- Inventory / dashboard ------------------------------------------------

export async function renderInventory(filter: InventoryFilter, msg?: string): Promise<{ html: string; title: string; description: string }> {
  const [seller, stats, rows, batches] = await Promise.all([
    getSeller(),
    inventoryStats(),
    listInventory(filter),
    listBatches(6),
  ]);

  // CardUploader's inventory header pair — "Price $ · Market $" — plus counts.
  const statCards = `<div class="stat-cards">
    <div class="stat"><div class="k">Inventory value</div><div class="v mono">${money(stats.value_cents)}</div><div class="s">your prices × quantity · ${stats.units} unit${stats.units === 1 ? "" : "s"}</div></div>
    <div class="stat"><div class="k">Market value</div><div class="v mono">${money(stats.market_cents)}</div><div class="s">catalog market price × quantity</div></div>
    <div class="stat"><div class="k">Cards in stock</div><div class="v mono">${stats.count}</div><div class="s">${stats.listed} listed · next SKU <span class="mono">${esc(seller.sku_prefix)}-${String(seller.sku_next).padStart(seller.sku_pad, "0")}</span></div></div>
    <div class="stat"><div class="k">Default pricing</div><div class="v" style="font-size:1.3rem">${esc(ruleLabel({ mode: seller.price_mode, pct: seller.price_pct, fixed_cents: seller.price_fixed_cents }))}</div><div class="s"><a href="/app/settings#s-pricing">Change defaults →</a></div></div>
  </div>`;

  const statusTabs = ["all", "in_stock", "listed", "sold"]
    .map((s) => {
      const label = s === "all" ? "All" : s === "in_stock" ? "In stock" : s === "listed" ? "Listed" : "Sold";
      const cur = (filter.status ?? "all") === s;
      const params = new URLSearchParams();
      if (s !== "all") params.set("status", s);
      if (filter.q) params.set("q", filter.q);
      if (filter.sort) params.set("sort", filter.sort);
      return `<a href="/app/inventory${params.toString() ? "?" + params : ""}" class="${cur ? "active" : ""}">${label}</a>`;
    })
    .join("");

  let table: string;
  if (rows.length === 0) {
    table = `<div class="ws-empty">
      <h3>No cards in inventory yet</h3>
      <p>Scan or paste a list of cards to identify them, price them, and add them to inventory.</p>
      <a class="btn primary" href="/app/scan">Scan / add cards</a>
    </div>`;
  } else {
    const body = (
      await Promise.all(
        rows.map(async (r) => {
        const market = await marketCents(r.variant_id);
        const img = r.image_small || r.image_large;
        return `<tr>
        <td class="chk"><input type="checkbox" class="rowsel" value="${r.id}" aria-label="Select ${esc(r.card_name)}"></td>
        <td class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}</td>
        <td class="card">
          <a href="/c/${esc(r.card_slug)}-${r.card_id}" target="_blank" rel="noopener">${esc(r.card_name)}</a>
          <div class="sub">${esc(r.set_name)}${r.number ? " · #" + esc(r.number) : ""} · ${finishChip({ finish: r.finish, finish_label: r.finish_label })}${r.grade ? ` · <span class="chip grade">${esc(r.grade)}</span>` : ""}</div>
        </td>
        <td>${r.grade ? `<b>${esc(r.grade)}</b>` : esc(r.condition)}</td>
        <td>${esc(r.language)}</td>
        <td class="mono">${r.quantity}</td>
        <td class="mono sku">${esc(r.sku)}</td>
        <td class="mono price">${money(r.price_cents)}<div class="mkt">mkt ${money(market)}</div></td>
        <td><span class="pill ${r.status}">${r.status === "in_stock" ? "In stock" : r.status === "listed" ? "Listed" : "Sold"}</span></td>
        <td class="act">
          <a class="btn sm" href="/app/list/${r.id}">List →</a>
        </td>
      </tr>`;
        })
      )
    ).join("");

    table = `<div class="inv-toolbar">
        <div class="tabs">${statusTabs}</div>
        <form class="inv-search" method="get" action="/app/inventory">
          ${filter.status ? `<input type="hidden" name="status" value="${esc(filter.status)}">` : ""}
          <input type="search" name="q" value="${esc(filter.q ?? "")}" placeholder="Search name or SKU…" aria-label="Search inventory">
          <select name="sort" onchange="this.form.submit()" aria-label="Sort">
            ${opt("", "Newest", filter.sort ?? "")}${opt("value", "Value", filter.sort ?? "")}${opt("name", "Name", filter.sort ?? "")}${opt("sku", "SKU", filter.sort ?? "")}
          </select>
          <button class="btn sm" type="submit">Go</button>
        </form>
      </div>
      <form id="bulkform" method="post" action="/app/inventory/bulk">
      <input type="hidden" name="ids" id="bulk-ids">
      <div class="bulkbar" id="bulkbar" hidden>
        <span class="n"><b id="bulk-count">0</b> selected</span>
        <label>Condition <select name="condition">${opt("", "—", "")}${conditionOptions("")}</select></label>
        <label>Pricing <select name="rule">${opt("", "—", "")}${ruleOptions("")}</select></label>
        <button class="btn sm" name="do" value="apply" type="submit">Apply</button>
        <span class="bulk-exports">Export ${EXPORT_FORMATS.map((f) => `<button class="btn sm" name="do" value="export" type="submit" formaction="/app/export/${f.key}.csv" formmethod="get" formtarget="_blank" title="${esc(f.label)}">${esc(f.label.replace(/ \(.*\)$/, ""))}</button>`).join("")}</span>
        <button class="btn sm primary" name="do" value="list" type="submit">Create listings</button>
      </div>
      <div class="tablewrap">
      <table class="inv-table">
        <thead><tr>
          <th class="chk"><input type="checkbox" id="selall" aria-label="Select all"></th>
          <th></th><th>Card</th><th>Cond</th><th>Lang</th><th>Qty</th><th>SKU</th><th>Price</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      </div>
    </form>`;
  }

  const recent = batches.length
    ? `<div class="ws-panel">
        <div class="ws-panel-head"><h2>Recent batches</h2><a href="/app/batches">All batches →</a></div>
        <div class="batch-list">${batches
          .map(
            (b) => `<a class="batch-row" href="/app/review/${b.id}">
              <span class="bid">#${b.id}</span>
              <span class="blabel">${esc(b.label || (b.source === "sample" ? "Sample batch" : "Scan batch"))}</span>
              <span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"} · ${b.status}</span>
            </a>`
          )
          .join("")}</div>
      </div>`
    : "";

  const html = `<div class="wrap ws">
    ${wsHead("inventory", "Inventory", `Your confirmed stock. Every card carries a unique SKU and a price you can push to a marketplace.`, `<a class="btn primary" href="/app/scan">+ Scan cards</a>`)}
    ${flash(msg)}
    ${statCards}
    ${table}
    ${recent}
    ${APP_JS}
  </div>`;

  return { html, title: "Inventory — Seller workspace | CardIndex", description: "Your card inventory, SKUs, pricing and listings." };
}

// ---- Scan / add -----------------------------------------------------------

const SAMPLE_LINES = [
  "Charizard 4/102 Base Set holo NM",
  "Blastoise 2/102 Base holo",
  "Pikachu 58/102 Base",
  "3x Mewtwo 10/102 Base holo",
  "Hisuian Zoroark VSTAR 200/172",
  "The Wandering Emperor Neon Dynasty foil",
  "Dragonair 18/102 reverse holo LP",
  "psa 10 Charizard base set",
].join("\n");

/**
 * Advanced Matching Options panel (CardUploader's Ungraded page): prioritize or
 * exclude sets and keywords for this batch. Prefilled from the seller's saved
 * defaults; "save as my defaults" persists the panel. Set names complete from a
 * shared <datalist id="setlist"> rendered once per page.
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
    <p class="hint">Excluded sets and keywords are dropped before scoring; prioritized ones get a boost so a card from a set you know you're scanning wins ties over the same name elsewhere.</p>
  </details>`;
}

export function setDatalist(sets: SetRef[]): string {
  return `<datalist id="setlist">${sets.map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist>`;
}

// ---- Add cards (one page, two outcomes) --------------------------------------
// The former Scan page and Pricing tool shared the same two forms and the same
// server code; the only difference was where a batch ended up. Now the seller
// picks the outcome first, and each choice shows what happens to the photos:
//   price     → identified, priced at market, shown as a shareable table; the
//               photos are kept only as thumbnails on that list.  (Free)
//   inventory → identified, confirmed in review, given SKUs; the photos are
//               stored with each card and become its listing images.  (Pro)

export type AddMode = "price" | "inventory";

const FLOW_ICONS: Record<string, string> = {
  photo: NAV_ICONS.scan,
  identify: NAV_ICONS["card-search"],
  price: NAV_ICONS["pricing-tool"],
  share: `<path d="M8 12l4-4"/><path d="M11 5.5 12.5 4a2.5 2.5 0 0 1 3.5 3.5L14.5 9"/><path d="M9 15l-1.5 1.5A2.5 2.5 0 0 1 4 13l1.5-1.5"/>`,
  review: `<path d="M4 10.5 8 14l8-8"/>`,
  inventory: NAV_ICONS.inventory,
  listing: NAV_ICONS.listings,
};

function flow(steps: Array<[string, string]>): string {
  return `<div class="mode-flow" aria-hidden="true">${steps
    .map(
      ([ic, label], i) =>
        `${i ? `<span class="mf-arr">→</span>` : ""}<span class="mf-step"><svg class="nav-ic" viewBox="0 0 20 20">${FLOW_ICONS[ic]}</svg><small>${label}</small></span>`
    )
    .join("")}</div>`;
}

function modeChooser(mode: AddMode, pro: boolean, prefill: string): string {
  const keep = prefill ? `&add=${encodeURIComponent(prefill)}` : "";
  const card = (m: AddMode, name: string, plan: string, steps: Array<[string, string]>, body: string) =>
    `<a class="mode-card${mode === m ? " on" : ""}" href="/app/scan?mode=${m}${keep}"${mode === m ? ' aria-current="page"' : ""}>
      <div class="mode-head"><span class="mode-name">${name}</span><span class="pill ${plan === "Pro" ? (pro ? "sold" : "") : "listed"}">${plan}</span></div>
      ${flow(steps)}
      <p>${body}</p>
    </a>`;
  return `<div class="mode-pick" role="group" aria-label="What should happen with these cards?">
    ${card(
      "price",
      "Price only",
      "Free",
      [["photo", "photos or list"], ["identify", "identified"], ["price", "market price"], ["share", "share by link"]],
      `Each card is read, matched to the catalog and priced at market, then shown as a table you can share by link. <b>Nothing goes into inventory</b>; photos are kept only as thumbnails on that list.`
    )}
    ${card(
      "inventory",
      "Add to inventory",
      "Pro",
      [["photo", "photos or list"], ["identify", "identified"], ["review", "you confirm"], ["inventory", "SKU + stock"], ["listing", "listing images"]],
      `Each card is read and matched, you confirm anything uncertain in review, and every card gets a SKU in your inventory. <b>Photos are stored with the card</b> and become its listing images.`
    )}
  </div>`;
}

export async function renderScan(
  msg?: string,
  prefill?: string,
  opts: { mode?: AddMode; pro?: boolean } = {}
): Promise<{ html: string; title: string; description: string }> {
  const pro = opts.pro ?? true;
  const mode: AddMode = opts.mode ?? (pro ? "inventory" : "price");
  const priceMode = mode === "price";
  const [seller, batches, sets] = await Promise.all([
    getSeller(),
    priceMode ? listBatchesOfKind("pricing", 8) : listBatches(8),
    getAllSets(),
  ]);
  const pref = (prefill ?? "").replace(/\s+/g, " ").trim();
  const prefs = parseMatchingPrefs(seller.matching_prefs);
  const matchVals = prefsToForm(prefs, sets);
  const savedMatching = !isEmptyPrefs(prefs);
  const modeField = `<input type="hidden" name="mode" value="${mode}">`;

  const sub = priceMode
    ? "Price a binder page, a stack, or a list against the catalog. Nothing is added to inventory, and the priced list can be shared by link."
    : "Upload photos or paste a list. Every card is identified against the catalog, scored for confidence, and anything uncertain waits in review before it reaches inventory.";

  // Fields that only matter when cards are going into stock.
  const stockFields = priceMode
    ? ""
    : `<div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(seller.price_mode, seller.price_pct))}</select></label>
            <label class="fld"><span>SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
          </div>`;
  const languageField = priceMode
    ? ""
    : `<label class="fld"><span>Default language</span><select name="language">${languageOptions(seller.default_language)}</select></label>`;

  const uploadForm = `<form class="ws-panel upload-form" method="post" action="/app/scan/upload" enctype="multipart/form-data">
          ${modeField}
          <div class="ws-panel-head"><h2>Upload photos</h2><span class="eyebrow">${priceMode ? "single cards · binder pages · loose cards" : "phone or scanner"}</span></div>
          <label class="dropzone" id="dropzone" data-max-files="${maxUploadFiles(pro)}" data-max-bytes="${MAX_UPLOAD_BYTES}" data-chunk="${UPLOAD_CHUNK_FILES}" data-max-edge="${UPLOAD_MAX_EDGE}">
            <input type="file" name="images" id="imgInput" accept="image/*" capture="environment" multiple hidden>
            <div class="dz-inner">
              <div class="dz-ic">📷</div>
              <div class="dz-main"><b>Tap to choose</b> or drag &amp; drop card photos</div>
              <div class="dz-hint">JPG / PNG / WebP / HEIC · one card per image · front side · up to ${maxUploadFiles(pro)} photos per batch${pro ? "" : ` (${MAX_UPLOAD_FILES_PRO} on Pro)`} · resized to ${UPLOAD_MAX_EDGE} px on your device and sent in groups of ${UPLOAD_CHUNK_FILES}</div>
              <div class="dz-what">${
                priceMode
                  ? `These photos are used to <b>identify and price</b> the cards. They stay only as thumbnails on the priced list.`
                  : `These photos are <b>stored with each card</b> and become its listing images.`
              }</div>
            </div>
            <div class="dz-preview" id="dzPreview" hidden></div>
          </label>
          <div class="fld-row">
            <label class="fld"><span>${priceMode ? "Label" : "Batch label"}</span><input type="text" name="label" placeholder="${priceMode ? "e.g. Binder page 4" : "e.g. Binder A"}"></label>
            <label class="fld"><span>${priceMode ? "Condition" : "Default condition"}</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
            ${languageField}
          </div>
          ${stockFields}
          ${matchingPanel(matchVals, savedMatching, "u")}
          <div class="scan-submit">
            <button class="btn primary" type="submit" id="uploadBtn">${priceMode ? "Price photos →" : "Upload &amp; identify →"}</button>
            <span class="hint" id="dzCount">No photos selected yet</span>
          </div>
        </form>`;

  const pasteForm = `<form class="scan-form ws-panel" method="post" action="/app/scan" id="paste">
          ${modeField}
          <div class="ws-panel-head"><h2>Or paste a list</h2><button type="button" class="btn sm" id="loadsample">Load sample</button></div>
          <label class="fld">
            <span>Cards <small>one per line — name, number (4/102 or #119), set, finish, condition, language, qty (e.g. 3x)</small></span>
            <textarea name="lines" id="lines" rows="7" placeholder="Charizard 4/102 Base Set holo NM&#10;3x Pikachu 58/102 Base&#10;The Wandering Emperor Neon Dynasty foil">${esc(pref)}</textarea>
          </label>
          <div class="fld-row">
            <label class="fld"><span>${priceMode ? "Label" : "Batch label"}</span><input type="text" name="label" placeholder="${priceMode ? "e.g. Trade binder" : "e.g. Box break 8/25"}"></label>
            <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
            ${priceMode ? "" : `<label class="fld"><span>Language</span><select name="language">${languageOptions(seller.default_language)}</select></label>`}
          </div>
          ${
            priceMode
              ? ""
              : `<div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(seller.price_mode, seller.price_pct))}</select></label>
            <label class="fld"><span>SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
            <label class="fld ckbox"><input type="checkbox" name="save_defaults" value="1"> <span>Save as my defaults</span></label>
          </div>`
          }
          ${matchingPanel(matchVals, savedMatching, "p")}
          <div class="scan-submit">
            <button class="btn primary" type="submit">${priceMode ? "Price list →" : "Identify cards →"}</button>
            <span class="hint">${priceMode ? "Market prices from the catalog; nothing is added to inventory." : "You'll review and edit every match before anything is added to inventory."}</span>
          </div>
        </form>`;

  // A Free account that picks "Add to inventory" sees what it unlocks, not a
  // form that would bounce on submit.
  const locked = `<div class="ws-panel mode-lock">
          <div class="ws-panel-head"><h2>Add to inventory is part of Pro</h2><span class="pill">Pro · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}</span></div>
          <p>With Pro, the same photos and lists go through review into your inventory: every card gets a SKU, its photos are stored as listing images, and it's ready to publish to eBay or export.</p>
          <div class="scan-submit"><a class="btn primary" href="/pricing?upgrade=1">Upgrade to Pro</a><a class="btn" href="/app/scan?mode=price">Price these cards for free instead</a></div>
        </div>`;

  const forms = mode === "inventory" && !pro ? locked : `${uploadForm}\n${pasteForm}`;

  const aside = priceMode
    ? `<aside class="ws-panel scan-side">
        <h2>Recent pricings</h2>
        ${
          batches.length
            ? `<div class="batch-list">${batches
                .map(
                  (b) => `<a class="batch-row" href="/app/pricing/${b.id}"><span class="bid">#${b.id}</span><span class="blabel">${esc(b.label || "Pricing")}</span><span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"}${b.share_token ? " · shared" : ""}</span></a>`
                )
                .join("")}</div>`
            : `<p class="hint">No pricings yet.</p>`
        }
        <h3 style="margin-top:18px">What happens to the photos</h3>
        <p>Each photo is read by the recognizer and matched to a catalog printing. The priced list keeps a thumbnail so you and whoever you share it with can see which card is which. Nothing is created in inventory, and any pricing can be turned into an inventory batch later from its results page.</p>
        <div class="seam-note"><span class="i">◆</span><div><b>Binder-page detection</b> (several cards in one photo, auto-cropped) plugs into the same upload — today each photo is treated as one card.</div></div>
      </aside>`
    : `<aside class="ws-panel scan-side">
        <h2>What happens to the photos</h2>
        <p><b>Photos</b> are stored and dropped straight into the review queue, one item per image. The recognizer reads each card (or we take a first guess from the filename, e.g. <span class="mono">charizard-4-102.jpg</span>); anything we can't place waits in the queue where you <b>search and confirm</b> it. Approved cards keep their photo as the listing image.</p>
        <p><b>Pasted lines</b> are parsed for name, number, set, finish, condition, language and quantity, then matched against the catalog — <b>${Math.round(0.9 * 100)}%+</b> auto-matches, the rest route to review.</p>
        <p><b>Know what's in the binder?</b> Open <b>Advanced matching options</b> and prioritize its sets — same-name cards from other sets stop stealing matches. Exclude sets or keywords you never sell.</p>
        <p><b>Prices</b> follow your rule, or the price you last listed the same printing at (<a href="/app/settings#s-pricing">automatic pricing</a>).</p>
        <div class="seam-note"><span class="i">◆</span><div><b>Reading the card from the pixels is the remaining seam.</b> A vision model (photo → identity, front/back, auto-crop) and graded-slab OCR/QR + cert lookup drop in behind the same review queue and identify contract — upload, storage, and review already work end-to-end.</div></div>
        ${
          batches.length
            ? `<h3 style="margin-top:18px">Recent batches</h3><div class="batch-list">${batches
                .map(
                  (b) => `<a class="batch-row" href="${b.kind === "pricing" ? `/app/pricing/${b.id}` : `/app/review/${b.id}`}"><span class="bid">#${b.id}</span><span class="blabel">${esc(b.label || "Batch")}</span><span class="bmeta">${b.total} · ${b.status}</span></a>`
                )
                .join("")}</div>`
            : ""
        }
      </aside>`;

  const html = `<div class="wrap ws">
    ${wsHead(priceMode ? "pricing-tool" : "scan", "Add cards", sub)}
    ${flash(msg)}
    ${setDatalist(sets)}
    ${modeChooser(mode, pro, pref)}
    <div class="scan-grid">
      <div class="scan-main">
        ${forms}
      </div>
      ${aside}
    </div>
    <script>window.__SAMPLE__=${JSON.stringify(SAMPLE_LINES)};</script>
    ${APP_JS}
  </div>`;

  return {
    html,
    title: `${priceMode ? "Price cards" : "Add cards"} — Seller workspace | CardIndex`,
    description: priceMode ? "Free ungraded card pricing." : "Bulk-identify cards and route them to a review queue.",
  };
}

// ---- Review queue ---------------------------------------------------------

function confBadge(item: ScanItem): string {
  const pctN = Math.round(item.ai_confidence * 100);
  if (item.status === "failed") return `<span class="conf bad">No match</span>`;
  if (item.status === "approved") return `<span class="conf ok">✓ Approved</span>`;
  if (item.status === "skipped") return `<span class="conf muted">Skipped</span>`;
  const cls = item.ai_confidence >= 0.9 ? "ok" : "warn";
  return `<span class="conf ${cls}">${pctN}% match</span>`;
}

/** Per-item front/back photo upload + thumbnails (spec §2: front and back images). */
function imageControl(item: ScanItem, batch: ScanBatch): string {
  const action = `/app/review/${batch.id}/item/${item.id}/image`;
  return `<details class="img-ctl">
    <summary>${item.image_url ? "Photos" : "Add photo"}</summary>
    <form method="post" action="${action}" enctype="multipart/form-data" class="img-form">
      <div class="img-slots">
        <div class="img-slot">${item.image_url ? `<img src="${esc(item.image_url)}" alt="front">` : `<span>front</span>`}</div>
        <div class="img-slot">${item.back_image_url ? `<img src="${esc(item.back_image_url)}" alt="back">` : `<span>back</span>`}</div>
      </div>
      <input type="file" name="image" accept="image/*" capture="environment" required>
      <div class="img-btns">
        <button class="btn sm" name="slot" value="front" type="submit">Set front</button>
        <button class="btn sm" name="slot" value="back" type="submit">Set back</button>
      </div>
    </form>
  </details>`;
}

async function reviewItem(item: ScanItem, batch: ScanBatch): Promise<string> {
  const alts: Array<{ variant_id: number; card_id: number; label: string; set: string; finish: string; image: string | null; score: number }> =
    JSON.parse(item.alternatives || "[]");
  const variants = item.matched_card_id ? await getVariants(item.matched_card_id) : [];
  const market = item.matched_variant_id ? await marketCentsAt(item.matched_variant_id, item.grade) : null;
  const g = splitGrade(item.grade);
  const title = item.title ?? ((await scanItemTitle(item)) || "");
  const vf = await vfOf(item);
  const cardImg = vf ? vf.image_small || vf.image_large : null;
  // Primary thumb is the seller's uploaded scan when present, else the catalog image.
  const scanImg = item.image_url || cardImg;
  // Resolve each variant's market price once (used in the printing dropdown).
  const vMarket = new Map<number, number | null>(
    await Promise.all(variants.map(async (v) => [v.id, await marketCents(v.id)] as const))
  );

  const action = `/app/review/${batch.id}/item/${item.id}`;
  const dup = item.dup_of_item_id
    ? `<div class="dup-note">⚠ Duplicate of item #${item.dup_of_item_id} in this batch — <b>merge</b> folds its quantity in on commit.</div>`
    : "";
  const certLink = certUrl(item.grader ?? g?.grader, item.cert);
  const certLine = item.cert
    ? `<div class="cert-line">🏅 ${esc(item.grader ?? g?.grader ?? "")} cert <span class="mono">${esc(item.cert)}</span>${item.grade ? ` · <b>${esc(item.grade)}</b>` : " · grade not set"}${certLink ? ` · <a href="${esc(certLink)}" target="_blank" rel="noopener">verify ↗</a>` : ""}</div>`
    : "";

  // When there's an uploaded photo AND a catalog match, show the catalog image
  // beside the name so the seller can eyeball that the identification is right.
  const compareThumb = item.image_url && cardImg
    ? `<img class="ri-catalog" src="${esc(cardImg)}" alt="catalog match" title="Catalog image — compare with your scan" loading="lazy">`
    : "";
  const matchBlock = vf
    ? `<div class="ri-match">
        ${compareThumb}
        <div class="ri-match-txt">
          <a href="/c/${esc(vf.card_slug)}-${vf.card_id}" class="ri-name" target="_blank" rel="noopener">${esc(vf.card_name)}</a>
          <div class="ri-sub">${esc(vf.set_name)}${vf.number ? " · #" + esc(vf.number) : ""}</div>
        </div>
      </div>`
    : `<div class="ri-match ri-nomatch">No catalog match — search below to identify this photo.</div>`;

  const altChips = alts.length
    ? `<div class="alts"><span class="alts-lbl">Alternatives:</span>${alts
        .map(
          (a) => `<form method="post" action="${action}" class="alt">
            <input type="hidden" name="do" value="replace"><input type="hidden" name="variant_id" value="${a.variant_id}">
            <button type="submit" title="${esc(a.set)} · ${esc(a.finish)}">${esc(a.label)} <span class="asc">${a.score}%</span></button>
          </form>`
        )
        .join("")}</div>`
    : "";

  const manual = `<details class="manual"><summary>Search manually</summary>
    <div class="manual-box" data-action="${action}">
      <input type="search" class="manual-q" placeholder="Type a card name or number…" aria-label="Manual card search">
      <div class="manual-results"></div>
    </div></details>`;

  const priceHint = `${market != null ? `mkt ${money(market)}` : "no market price"}${item.prev_price_cents != null ? ` · <span class="prev">you listed at ${money(item.prev_price_cents)}</span>` : ""}`;

  return `<div class="review-item status-${item.status}" data-item="${item.id}" tabindex="0">
    <div class="ri-left">
      <div class="ri-thumb${item.image_url ? " is-scan" : ""}">${scanImg ? `<img src="${esc(scanImg)}" alt="" loading="lazy">` : `<span class="noimg">?</span>`}${item.image_url ? `<span class="scan-tag">your scan</span>` : ""}</div>
      ${confBadge(item)}
      ${imageControl(item, batch)}
    </div>
    <div class="ri-mid">
      <div class="ri-raw">${esc(item.raw_input)}</div>
      ${matchBlock}
      ${certLine}
      ${altChips}
      ${manual}
      ${dup}
    </div>
    <form class="ri-edit" method="post" action="${action}">
      <input type="hidden" name="shown_price" value="${dollars(item.price_cents)}">
      <div class="edit-grid">
        ${
          variants.length
            ? `<label>Printing<select name="variant_id" data-autosubmit>${variants
                .map((v) => {
                  const mc = vMarket.get(v.id) ?? null;
                  return opt(String(v.id), `${v.finish_label}${mc != null ? " · " + money(mc) : ""}`, String(item.matched_variant_id ?? ""));
                })
                .join("")}</select></label>`
            : ""
        }
        <label>Condition<select name="condition" data-autosubmit>${conditionOptions(item.condition)}</select></label>
        <label>Lang<select name="language">${languageOptions(item.language)}</select></label>
        <label>Grader<select name="grader">${opt("", "Raw", g?.grader ?? item.grader ?? "")}${GRADERS.map((x) => opt(x.key, x.key, g?.grader ?? item.grader ?? "")).join("")}</select></label>
        <label>Grade<select name="grade_value" data-autosubmit>${opt("", "—", g?.value ?? "")}${GRADE_VALUES.map((v) => opt(v, v, g?.value ?? "")).join("")}</select></label>
        <label>Qty<input type="number" name="quantity" min="1" value="${item.quantity}" class="mono"></label>
        <label>Pricing<select name="rule" data-autosubmit>${ruleOptions(ruleKey(item.price_mode, item.price_pct))}</select></label>
        <label>Price<div class="price-in"><span>$</span><input type="text" name="price" value="${dollars(item.price_cents)}" class="mono" inputmode="decimal"></div></label>
        <label>SKU<input type="text" name="sku" value="${esc(item.sku ?? "")}" placeholder="auto" class="mono"></label>
      </div>
      <label class="title-fld">Title <small>${EBAY_TITLE_MAX} char max · auto</small>
        <input type="text" name="title" value="${esc(title)}" maxlength="${EBAY_TITLE_MAX}">
      </label>
      <div class="price-hint">${priceHint}</div>
      <div class="ri-buttons">
        <button class="btn sm" name="do" value="save" type="submit">Save</button>
        <button class="btn sm" name="do" value="regen" type="submit" title="Regenerate title from fields">↻ Title</button>
        <button class="btn sm ok" name="do" value="approve" type="submit" ${item.matched_variant_id ? "" : "disabled"}>✓ Approve</button>
        <button class="btn sm ghost" name="do" value="skip" type="submit">Skip</button>
      </div>
    </form>
  </div>`;
}

// Joined variant lookup for display, memoized per render pass (cleared at the
// top of renderReview) to avoid re-querying the same variant across items.
const _vfCache = new Map<number, VariantFull | undefined>();
async function vfOf(item: ScanItem): Promise<VariantFull | undefined> {
  if (!item.matched_variant_id) return undefined;
  if (_vfCache.has(item.matched_variant_id)) return _vfCache.get(item.matched_variant_id);
  const vf = await getVariantFull(item.matched_variant_id);
  _vfCache.set(item.matched_variant_id, vf);
  return vf;
}

export async function renderReview(batchId: number, filterTab: string | undefined, msg?: string): Promise<{ html: string; title: string; description: string } | null> {
  const batch = await getBatch(batchId);
  if (!batch) return null;
  _vfCache.clear();
  const all = await getItems(batchId);
  const auto = all.filter((i) => i.status === "matched" || i.status === "approved").length;
  const review = all.filter((i) => i.status === "needs_review").length;
  const failed = all.filter((i) => i.status === "failed").length;
  const approved = all.filter((i) => i.status === "approved").length;
  const pctDone = batch.total ? Math.round((batch.processed / batch.total) * 100) : 100;

  const tab = filterTab ?? "all";
  const tabs: Array<[string, string, number]> = [
    ["all", "All", all.length],
    ["needs_review", "Needs review", review],
    ["failed", "Failed", failed],
    ["matched", "Matched", auto],
  ];
  const filtered = all.filter((i) => {
    if (tab === "all") return true;
    if (tab === "matched") return i.status === "matched" || i.status === "approved";
    return i.status === tab;
  });

  const items =
    (await Promise.all(filtered.map((i) => reviewItem(i, batch)))).join("") ||
    `<div class="ws-empty"><p>No cards in this view.</p></div>`;

  const commitReady = all.filter((i) => i.matched_variant_id && (i.status === "matched" || i.status === "approved")).length;

  const html = `<div class="wrap ws">
    ${wsHead("scan", `Review batch #${batch.id}`, esc(batch.label || "Identify, correct, price, then add to inventory."), `<a class="btn" href="/app/scan">New batch</a>`, { navMode: "collapsed" })}
    ${flash(msg)}
    <div class="batch-progress">
      <div class="bp-bar"><div class="bp-fill" style="width:${pctDone}%"></div></div>
      <div class="bp-stats">
        <span><b>${batch.total}</b> cards</span>
        <span class="ok">✅ ${auto} matched</span>
        <span class="warn">⚠ ${review} need review</span>
        <span class="bad">✖ ${failed} failed</span>
      </div>
    </div>

    <div class="review-toolbar">
      <div class="tabs">${tabs
        .map(([k, label, n]) => `<a href="/app/review/${batch.id}?tab=${k}" class="${k === tab ? "active" : ""}">${label} <span class="c">${n}</span></a>`)
        .join("")}</div>
      <form method="post" action="/app/review/${batch.id}/commit" class="commit-form" onsubmit="return confirm('Add ${commitReady} matched card(s) to inventory?')">
        <label class="ckbox sm"><input type="checkbox" name="merge" value="1" checked> merge duplicates</label>
        <button class="btn primary" type="submit" ${commitReady ? "" : "disabled"}>Add ${commitReady} to inventory →</button>
      </form>
    </div>

    <div class="review-list">${items}</div>
    ${APP_JS}
  </div>`;

  return { html, title: `Review batch #${batch.id} — Seller workspace | CardIndex`, description: "Review, correct and price identified cards before adding to inventory." };
}

// ---- Listing builder ------------------------------------------------------

export async function renderListingBuilder(invId: number, msg?: string): Promise<{ html: string; title: string; description: string } | null> {
  const inv = await getInventoryItem(invId);
  if (!inv) return null;
  const [seller, preview, existing, market, ebayConn] = await Promise.all([
    getSeller(),
    inventoryListingPreview(inv),
    listingsFor(invId),
    marketCentsAt(inv.variant_id, inv.grade),
    getConnection(),
  ]);
  if (!preview) return null;

  const specRows = Object.entries(preview.specifics)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("");

  const img = inv.image_large || inv.image_small;
  const exportUrl = `/app/export/ebay.csv?ids=${inv.id}`;

  const html = `<div class="wrap ws">
    ${wsHead("inventory", "Build listing", `Generate an eBay listing for this card. Saved drafts export to a File Exchange CSV; live publish uses the eBay Sell API (seam).`, `<a class="btn" href="/app/inventory">← Inventory</a>`)}
    ${flash(msg)}
    <div class="list-grid">
      <div class="list-card ws-panel">
        <div class="lc-img">${img ? `<img src="${esc(img)}" alt="${esc(inv.card_name)}">` : ""}</div>
        <div class="lc-info">
          <h2>${esc(inv.card_name)}</h2>
          <div class="ri-sub">${esc(inv.set_name)}${inv.number ? " · #" + esc(inv.number) : ""}</div>
          <div class="lc-chips">${finishChip({ finish: inv.finish, finish_label: inv.finish_label })} <span class="chip">${esc(inv.condition)}</span> <span class="chip">${esc(inv.language)}</span></div>
          <div class="lc-price">SKU <b class="mono">${esc(inv.sku)}</b> · mkt <b class="mono">${money(market)}</b> · your price <b class="mono">${money(inv.price_cents)}</b></div>
          <div class="spec-table"><h3>Item specifics</h3><table>${specRows}</table></div>
        </div>
      </div>

      <form class="ws-panel list-form" method="post" action="/app/list/${inv.id}">
        <div class="ws-panel-head"><h2>Listing details</h2></div>
        <label class="title-fld">Title <small>${EBAY_TITLE_MAX} max</small>
          <input type="text" name="title" value="${esc(preview.title)}" maxlength="${EBAY_TITLE_MAX}">
        </label>
        <div class="fld-row">
          <label class="fld"><span>Format</span><select name="format" id="fmt">${opt("fixed", "Fixed price (Buy It Now)", "fixed")}${opt("auction", "Auction", "fixed")}</select></label>
          <label class="fld"><span>Price / Buy It Now ($)</span><input type="text" name="price" value="${dollars(inv.price_cents)}" class="mono"></label>
          <label class="fld" data-auc hidden><span>Auction duration</span><select name="duration">${[3, 5, 7, 10].map((d) => opt(String(d), d + " days", "7")).join("")}</select></label>
        </div>
        <div class="fld-row">
          <label class="fld"><span>Quantity</span><input type="number" name="quantity" min="1" value="${inv.quantity}" class="mono"></label>
          <label class="fld"><span>Grade (optional)</span><input type="text" name="grade" placeholder="e.g. PSA 10" value=""></label>
          <label class="fld"><span>Schedule (optional)</span><input type="datetime-local" name="scheduled_at"><input type="hidden" name="tz_offset" class="tz-offset"></label>
        </div>
        <label class="fld"><span>eBay category</span><input type="text" name="category" value="${esc(preview.category)}" class="mono"></label>
        <label class="fld"><span>Description</span><textarea name="description" rows="7">${esc(preview.description)}</textarea></label>
        <div class="policy-note">Business policies applied from <a href="/app/settings#s-ebay">settings</a>: shipping <b>${esc(seller.ebay_shipping_policy || "—")}</b>, returns <b>${esc(seller.ebay_return_policy || "—")}</b>, payment <b>${esc(seller.ebay_payment_policy || "—")}</b>, location <b>${esc(seller.item_location || "—")}</b>.</div>
        <div class="list-actions">
          <button class="btn primary" name="do" value="draft" type="submit">Save listing draft</button>
          ${ebayConn ? `<button class="btn primary" name="do" value="publish" type="submit">Save &amp; publish to eBay →</button>` : ""}
          <a class="btn" href="${exportUrl}" target="_blank">Download eBay CSV</a>
        </div>
        ${
          ebayConn
            ? `<p class="hint">Publishing runs a pre-flight (policies by ID, ship-from location, image, title length) and then creates the eBay listing directly — no CSV to upload.</p>`
            : `<div class="seam-note"><span class="i">◆</span><div><a href="/app/settings#s-ebay"><b>Connect your eBay account</b></a> to publish and revise listings directly and pull orders. Until then, drafts export as a File Exchange CSV.</div></div>`
        }
      </form>
    </div>

    ${
      existing.length
        ? `<div class="ws-panel"><div class="ws-panel-head"><h2>Listing drafts for this card</h2></div><div class="tablewrap"><table class="inv-table"><thead><tr><th>#</th><th>Marketplace</th><th>Format</th><th>Title</th><th>Price</th><th>Status</th></tr></thead><tbody>${existing
            .map(
              (l) => `<tr><td class="mono">${l.id}</td><td>${esc(l.marketplace)}</td><td>${esc(l.format)}</td><td>${esc(l.title)}</td><td class="mono">${money(l.price_cents)}</td><td><span class="pill ${l.status}">${esc(l.status)}</span></td></tr>`
            )
            .join("")}</tbody></table></div></div>`
        : ""
    }
    ${APP_JS}
  </div>`;

  return { html, title: `List ${inv.card_name} — Seller workspace | CardIndex`, description: "Build an eBay listing for this card." };
}

// ---- Listings list --------------------------------------------------------

export async function renderListings(msg?: string): Promise<{ html: string; title: string; description: string }> {
  const [rows, ebayConn, sched] = await Promise.all([listListings(), getConnection(), scheduledCounts()]);
  const ebayItemUrl = (id: string) => (ebayIsMock() ? "#" : `https://www.${ebayMarketplace() === "EBAY_GB" ? "ebay.co.uk" : "ebay.com"}/itm/${encodeURIComponent(id)}`);
  const body = rows.length
    ? rows
        .map(
          (l) => `<tr class="${l.last_error ? "has-error" : ""}">
        <td class="chk"><input type="checkbox" class="rowsel" name="sel" value="${l.id}" aria-label="Select listing ${l.id}"></td>
        <td class="mono">${l.id}</td>
        <td class="thumb">${l.image_small ? `<img src="${esc(l.image_small)}" alt="" loading="lazy">` : ""}</td>
        <td>${esc(l.title)}<div class="sub mono">${esc(l.sku ?? "")}${l.inventory_id == null ? " · blank" : ""}</div>${l.last_error ? `<div class="sub err">⚠ ${esc(l.last_error)}</div>` : ""}</td>
        <td>${esc(l.marketplace)}${l.status === "published" && l.external_ref ? `<div class="sub"><a href="${ebayItemUrl(l.external_ref)}" target="_blank" rel="noopener" class="mono">${esc(l.external_ref)}</a></div>` : ""}</td>
        <td>${esc(l.format)}</td>
        <td class="mono">${money(l.price_cents ?? l.start_cents)}<div class="mkt">× ${l.quantity}</div></td>
        <td>${l.scheduled_at ? `${esc(l.scheduled_at.replace("T", " ").slice(0, 16))}${l.status === "scheduled" && l.publish_attempts ? `<div class="mkt warn">${l.publish_attempts} failed attempt${l.publish_attempts === 1 ? "" : "s"}</div>` : ""}` : "immediate"}</td>
        <td><span class="pill ${l.status}">${esc(l.status)}</span></td>
        <td class="act">${
          ebayConn
            ? `<form method="post" action="/app/listings/${l.id}/publish" class="inline"><button class="btn sm${l.status === "published" ? "" : " primary"}" type="submit" title="${l.status === "published" ? "Push current title, price and quantity to the live listing" : "Run pre-flight and create the eBay listing"}">${l.status === "published" ? "Revise" : "Publish"}</button></form>${l.status === "published" ? `<form method="post" action="/app/listings/${l.id}/end" class="inline" onsubmit="return confirm('End this eBay listing?')"><button class="btn sm ghost" type="submit">End</button></form>` : ""}`
            : `<a class="btn sm" href="/app/settings#s-ebay" title="Connect eBay to publish directly">Connect eBay</a>`
        }</td>
      </tr>`
        )
        .join("")
    : "";

  const exportAll = rows.length
    ? `<span class="bulk-exports">Export all ${EXPORT_FORMATS.map((f) => `<a class="btn sm" href="/app/export/${f.key}.csv?all=1" target="_blank">${esc(f.label.replace(/ \(.*\)$/, ""))}</a>`).join("")}</span>`
    : "";
  const html = `<div class="wrap ws">
    ${wsHead("listings", "Listings", "Draft, scheduled and exported listings across channels — catalog cards and blank items alike. Export to eBay, TCGplayer, Whatnot or Shopify files with your channel preferences applied.", `${exportAll}<a class="btn" href="/app/blank-listing">+ Blank listing</a>`)}
    ${flash(msg)}
    ${
      rows.length
        ? `<form id="bulkform" method="post" action="/app/listings/bulk">
           <input type="hidden" name="ids" id="bulk-ids"><input type="hidden" name="tz_offset" class="tz-offset">
           <div class="bulkbar" id="bulkbar" hidden>
             <span class="n"><b id="bulk-count">0</b> selected</span>
             ${ebayConn ? `<button class="btn sm primary" name="do" value="publish" type="submit">Publish now</button>` : ""}
             <label>Start <input type="datetime-local" name="start" class="mono"></label>
             <label>every <input type="number" name="gap" value="5" min="0" max="1440" class="mono" style="width:64px"> min</label>
             <button class="btn sm" name="do" value="schedule" type="submit" title="Space the selected listings out from the start time (CardUploader's Space Out)">Schedule &amp; space out</button>
             <button class="btn sm" name="do" value="unschedule" type="submit">Back to draft</button>
             ${ebayConn ? `<button class="btn sm ghost" name="do" value="end" type="submit">End</button>` : ""}
           </div>
           <div class="tablewrap"><table class="inv-table"><thead><tr><th class="chk"><input type="checkbox" id="selall" aria-label="Select all"></th><th>#</th><th></th><th>Title</th><th>Channel</th><th>Format</th><th>Price</th><th>Schedule</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
           </form>
           ${
             sched.scheduled
               ? `<div class="sched-note"><b>${sched.scheduled}</b> scheduled${sched.due ? ` · <b class="warn">${sched.due} due now</b>` : ""} — the runner checks every minute${ebayConn ? "" : " (needs your eBay connection to publish)"}. ${ebayConn && sched.due ? `<form method="post" action="/app/listings/bulk" class="inline"><input type="hidden" name="do" value="run-due"><button class="btn sm" type="submit">Publish due now</button></form>` : ""}</div>`
               : ""
           }
           ${
             ebayConn
               ? `<p class="hint" style="margin-top:12px"><b>Publish</b> creates the live eBay listing through the Inventory API (pre-flight first); <b>Revise</b> pushes title, price and quantity to a live listing; <b>End</b> withdraws it. Select rows to publish in bulk or <b>schedule &amp; space out</b> — one listing every N minutes from a start time. Shipping a non-eBay order syncs quantity to eBay automatically.</p>`
               : `<div class="seam-note" style="margin-top:16px"><span class="i">◆</span><div><a href="/app/settings#s-ebay"><b>Connect eBay</b></a> to publish, revise and end listings from here and pull orders. Drafts export as a File Exchange CSV meanwhile; scheduling still works and publishes once connected.</div></div>`
           }`
        : `<div class="ws-empty"><h3>No listings yet</h3><p>Open a card in your <a href="/app/inventory">inventory</a> and build a listing.</p></div>`
    }
    ${APP_JS}
  </div>`;

  return { html, title: "Listings — Seller workspace | CardIndex", description: "Your marketplace listing drafts." };
}

// ---- Settings -------------------------------------------------------------

export async function renderSettings(msg?: string): Promise<{ html: string; title: string; description: string }> {
  const [s, sets, sampleFields] = await Promise.all([getSeller(), getAllSets(), sampleTitleFields()]);
  const structure = parseStructure(s.title_structure) ?? DEFAULT_STRUCTURE;
  const initialJson = serializeStructure(structure);
  const initialPreview = renderStructuredTitle(sampleFields, structure);
  const pro = isPro(s.plan_tier);
  const autoPref = parseAutoPricePref(s.auto_price_pref);
  const prefs = parseMatchingPrefs(s.matching_prefs);
  const matchVals = prefsToForm(prefs, sets);
  const tpls = parseDescriptionTemplates(s.description_templates);
  const sampleTitle = sellerTitle(sampleFields, s);
  const SAMPLE_PRICE = 1250;
  const tplItems = Array.from({ length: DESCRIPTION_TEMPLATE_MAX }, (_, i) => tpls.items[i] ?? { name: `Description ${i + 1}`, body: i === 0 && !tpls.items.length ? DEFAULT_DESCRIPTION_TEMPLATE : "" });
  const activeBody = tplItems[tpls.active]?.body || DEFAULT_DESCRIPTION_TEMPLATE;
  const descPreview = fillDescriptionTemplate(activeBody, sampleFields, SAMPLE_PRICE, sampleTitle);

  const ch = parseChannelPrefs(s.channel_prefs);
  const conn = await getConnection();
  const pol = policiesOf(conn);
  const ids = policyIdsOf(conn);
  const loc = locationOf(conn);
  const policySelect = (k: "fulfillment" | "payment" | "return", label: string) =>
    `<label class="fld"><span>${label} policy</span>${
      pol[k].length
        ? `<select name="policy_${k}">${opt("", "— choose —", ids[k])}${pol[k].map((p) => opt(p.id, `${p.name}`, ids[k])).join("")}</select>`
        : `<input value="${esc(ids[k])}" name="policy_${k}" placeholder="sync policies first" ${conn ? "" : "disabled"}>`
    }</label>`;
  const ebayCard = !ebaySellConfigured()
    ? `<div class="ebay-card off"><div><b>eBay isn't configured on this server.</b><div class="hint">Add <span class="mono">EBAY_CLIENT_ID</span>, <span class="mono">EBAY_CLIENT_SECRET</span> and <span class="mono">EBAY_RU_NAME</span> to <span class="mono">.env</span> (see .env.example), or <span class="mono">EBAY_MOCK=1</span> to try the flow. Until then, listings export as a File Exchange CSV and policy <em>names</em> below drive the file.</div></div></div>`
    : conn
    ? `<div class="ebay-card on">
        <div><span class="plan-dot">Connected</span> <b>${esc(conn.ebay_user ?? "eBay account")}</b> <span class="hint">· ${esc(conn.marketplace)}${ebayIsMock() ? " · mock mode" : ""} · since ${esc(conn.connected_at.slice(0, 10))}${conn.last_policy_sync ? ` · policies synced ${esc(conn.last_policy_sync.slice(0, 10))}` : " · policies not synced yet"}</span></div>
        <div class="ebay-actions"><form method="post" action="/app/ebay/sync-policies" class="inline"><button class="btn sm" type="submit">Sync policies from eBay</button></form><form method="post" action="/app/ebay/disconnect" class="inline" onsubmit="return confirm('Disconnect eBay? Published listings stay live on eBay; you just lose direct publish/orders here.')"><button class="btn sm ghost" type="submit">Disconnect</button></form></div>
      </div>`
    : `<div class="ebay-card"><div><b>Not connected.</b><div class="hint">Connect to publish and revise listings directly, pull orders, and keep quantities in sync. You sign in on eBay's own page; no password is entered here.</div></div><a class="btn primary" href="/app/ebay/connect">Connect eBay account →</a></div>`;
  const ebayLive = conn
    ? `<h3 class="set-sub">Business policies <small class="hint">chosen by ID — the pre-flight rejects a listing whose policy no longer exists, before eBay does</small></h3>
      <div class="fld-row">${policySelect("fulfillment", "Shipping")}${policySelect("payment", "Payment")}${policySelect("return", "Return")}</div>
      <h3 class="set-sub">Ship-from location <small class="hint">eBay requires one per seller; created on save</small></h3>
      <div class="fld-row">
        <label class="fld"><span>Postal code *</span><input name="loc_postal" value="${esc(loc.postalCode)}" class="mono" required></label>
        <label class="fld"><span>Country</span><input name="loc_country" value="${esc(loc.country)}" maxlength="2" class="mono"></label>
        <label class="fld"><span>City</span><input name="loc_city" value="${esc(loc.city)}"></label>
        <label class="fld"><span>State / province</span><input name="loc_state" value="${esc(loc.stateOrProvince)}"></label>
      </div>
      ${conn.location_key ? `<p class="hint">Location <span class="mono">${esc(conn.location_key)}</span> is on file.</p>` : `<p class="hint warn">No ship-from location yet — save the form to create it.</p>`}`
    : "";
  const sectionNav = `<nav class="set-tabs" aria-label="Settings sections">
    <a href="#s-shop">Shop &amp; SKUs</a><a href="#s-pricing">Pricing</a><a href="#s-matching">Matching</a><a href="#s-titles">Titles</a><a href="#s-desc">Descriptions</a><a href="#s-ebay">eBay</a><a href="#s-shopify">Shopify</a><a href="#s-whatnot">Whatnot</a><a href="#s-tcgplayer">TCGplayer</a><a href="#s-manapool">Mana Pool</a>
  </nav>`;
  const channelSections = `
      <div class="set-section" id="s-shopify">
        <h2>Shopify</h2>
        <p class="hint">Applied to the Shopify product-import CSV (one product per card, one variant). Store linking with two-way inventory sync is the next integration.</p>
        <div class="fld-row">
          <label class="fld"><span>Vendor</span><input name="shopify_vendor" value="${esc(ch.shopify_vendor)}" placeholder="${esc(s.display_name)}"></label>
          <label class="fld"><span>Inventory location</span><input name="shopify_location" value="${esc(ch.shopify_location)}" placeholder="e.g. Shop floor"></label>
          <label class="fld"><span>Variant grams</span><input name="shopify_grams" value="${esc(ch.shopify_grams)}" class="mono"></label>
          <label class="fld"><span>Base tags</span><input name="shopify_tags" value="${esc(ch.shopify_tags)}" placeholder="trading cards"></label>
        </div>
      </div>
      <div class="set-section" id="s-whatnot">
        <h2>Whatnot</h2>
        <p class="hint">Applied to the Whatnot bulk-listing CSV.</p>
        <div class="fld-row">
          <label class="fld"><span>Category</span><input name="whatnot_category" value="${esc(ch.whatnot_category)}"></label>
          <label class="fld"><span>Shipping profile</span><input name="whatnot_shipping_profile" value="${esc(ch.whatnot_shipping_profile)}" placeholder="exact profile name from Whatnot"></label>
          <label class="fld ckbox"><input type="checkbox" name="whatnot_offerable" value="1"${ch.whatnot_offerable ? " checked" : ""}> <span>Accept offers</span></label>
        </div>
      </div>
      <div class="set-section" id="s-tcgplayer">
        <h2>TCGplayer</h2>
        <p class="hint">Applied to the TCGplayer inventory CSV (ungraded only — TCGplayer doesn't list slabs). Rows are keyed by TCGplayer product id when the catalog has one.</p>
        <label class="fld ckbox"><input type="checkbox" name="tcg_my_store" value="1"${ch.tcg_my_store ? " checked" : ""}> <span><b>My Store channel (Pro Seller)</b> — populate My Store Price and Reserve Quantity columns</span></label>
        <div class="fld-row">
          <label class="fld"><span>My Store price multiplier <small>× your price</small></span><input name="tcg_store_multiplier" value="${esc(ch.tcg_store_multiplier)}" class="mono" inputmode="decimal"></label>
          <label class="fld"><span>My Store reserve quantity</span><input name="tcg_reserve_qty" value="${esc(ch.tcg_reserve_qty)}" class="mono" inputmode="numeric"></label>
        </div>
      </div>
      <div class="set-section" id="s-manapool">
        <h2>Mana Pool</h2>
        <p class="hint">Mana Pool sells Magic singles keyed by TCGplayer SKU. Live listing and order sync needs a Mana Pool API connection — the next integration after eBay. Notes you keep here ride along on exports.</p>
        <label class="fld"><span>Notes</span><input name="manapool_note" value="${esc(ch.manapool_note)}" placeholder="e.g. store slug, pricing policy"></label>
        <div class="seam-note"><span class="i">◆</span><div><b>Connect Mana Pool</b> (API key) → fetch orders, auto mark-shipped when picked, quantity sync on Listed / Sold.</div></div>
      </div>`;
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
          : "Free includes the pricing tool, card search and sales lookup. Pro adds scanning, inventory and listings."
      } <a href="/pricing${pro ? "" : "?upgrade=1"}">${pro ? "View plans" : "Upgrade to Pro"}</a></p>
    </div>
  </div>`;

  const html = `<div class="wrap ws">
    ${wsHead("settings", "Settings", "Set once, reuse on every scan and listing — SKU scheme, pricing, matching, titles, descriptions, and eBay preferences.", "", { navMode: "open" })}
    ${flash(msg)}
    ${planPanel}
    ${sectionNav}
    ${setDatalist(sets)}
    <form class="ws-panel settings-form" method="post" action="/app/settings">
      <div class="set-section" id="s-shop">
        <h2>Shop &amp; SKUs</h2>
        <div class="fld-row">
          <label class="fld"><span>Shop name</span><input name="display_name" value="${esc(s.display_name)}"></label>
          <label class="fld"><span>SKU prefix</span><input name="sku_prefix" value="${esc(s.sku_prefix)}" maxlength="12"></label>
          <label class="fld"><span>SKU digits</span><input type="number" name="sku_pad" min="3" max="9" value="${s.sku_pad}" class="mono"></label>
          <label class="fld"><span>Next SKU number</span><input type="number" name="sku_next" min="1" value="${s.sku_next}" class="mono"></label>
        </div>
        <p class="hint">Next SKU: <b class="mono">${esc(s.sku_prefix)}-${String(s.sku_next).padStart(s.sku_pad, "0")}</b></p>
      </div>

      <div class="set-section" id="s-pricing">
        <h2>Default pricing &amp; condition</h2>
        <div class="fld-row">
          <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(s.price_mode, s.price_pct))}</select></label>
          <label class="fld"><span>Fixed price ($, if rule = Fixed)</span><input name="price_fixed" value="${dollars(s.price_fixed_cents)}" class="mono"></label>
          <label class="fld"><span>Default condition</span><select name="default_condition">${conditionOptions(s.default_condition)}</select></label>
          <label class="fld"><span>Default language</span><select name="default_language">${languageOptions(s.default_language)}</select></label>
        </div>
        <h3 class="set-sub">Automatic pricing</h3>
        <p class="hint">How a freshly identified card gets its first price. We remember what you listed each printing at (per condition); choose whether that memory beats the rule.</p>
        <div class="radio-list">${AUTO_PRICE_PREFS.map(
          (p) => `<label class="radio-row"><input type="radio" name="auto_price_pref" value="${p.key}"${p.key === autoPref ? " checked" : ""}><span><b>${esc(p.label)}</b><small>${esc(p.hint)}</small></span></label>`
        ).join("")}</div>
        <div class="fld-row">
          <label class="fld"><span>Never price below ($) <small>optional floor for automatic prices</small></span><input name="price_floor" value="${dollars(s.price_floor_cents)}" class="mono" placeholder="e.g. 0.99" inputmode="decimal"></label>
        </div>
      </div>

      <div class="set-section" id="s-matching">
        <h2>Default matching options</h2>
        <p class="hint">Applied to every scan unless you change them on the scan page. ${isEmptyPrefs(prefs) ? "Nothing set — the matcher considers every set equally." : `Currently: <b>${esc(describePrefs(prefs, sets))}</b>.`}</p>
        <div class="fld-row">
          <label class="fld"><span>Prioritize sets <small>comma-separated set names</small></span><input type="text" name="prioritize_sets" list="setlist" value="${esc(matchVals.prioritize_sets)}" placeholder="e.g. Base Set, Jungle" autocomplete="off"></label>
          <label class="fld"><span>Exclude sets</span><input type="text" name="exclude_sets" list="setlist" value="${esc(matchVals.exclude_sets)}" placeholder="e.g. Vivid Voltage" autocomplete="off"></label>
        </div>
        <div class="fld-row">
          <label class="fld"><span>Prioritize keywords</span><input type="text" name="prioritize_terms" value="${esc(matchVals.prioritize_terms)}" placeholder="e.g. holo, japanese"></label>
          <label class="fld"><span>Exclude keywords</span><input type="text" name="exclude_terms" value="${esc(matchVals.exclude_terms)}" placeholder="e.g. promo"></label>
        </div>
      </div>

      <div class="set-section title-editor" id="s-titles" data-max="${TITLE_MAX}">
        <div class="te-top">
          <h2>Title structure editor</h2>
          <label class="te-opt"><input type="checkbox" id="te-optimize"${structure.optimize ? " checked" : ""}> <span>Title optimization <small>auto-trim to ${TITLE_MAX} chars</small></span></label>
        </div>
        <p class="hint">Click a block to add it, drag blocks to reorder, and toggle <b>CAPS</b> per block. The preview updates live against a sample card — <b>the same builder writes your review-queue titles and eBay CSV</b>, so nothing ever lists over ${TITLE_MAX} characters.</p>

        <div class="te-avail-wrap">
          <div class="te-lbl">Building blocks</div>
          <div class="te-avail" id="te-avail"></div>
          <div class="te-custom">
            <input type="text" id="te-custom" placeholder="Add custom text (e.g. your shop name)…" maxlength="24">
            <button type="button" class="btn sm" id="te-custom-add">+ Add text</button>
          </div>
        </div>

        <div class="te-struct-wrap">
          <div class="te-lbl">Title structure <span class="te-hint2">drag to reorder</span></div>
          <div class="te-struct" id="te-struct"></div>
        </div>

        <div class="te-preview">
          <div class="te-preview-top"><span class="te-lbl">Preview</span><span class="te-count" id="te-count">${initialPreview.length}/${TITLE_MAX}</span></div>
          <div class="te-preview-text" id="te-ptext">${esc(initialPreview.title || "—")}</div>
          <div class="te-warn" id="te-warn"${initialPreview.over ? "" : " hidden"}>⚠ Over ${TITLE_MAX} characters — eBay rejects longer titles. Turn on optimization or remove a block.</div>
        </div>

        <input type="hidden" name="title_structure" id="te-json" value="${esc(initialJson)}">
      </div>
      <script>window.__TITLE__=${JSON.stringify({ tokens: TITLE_TOKENS.map((t) => ({ k: t.k, label: t.label })), structure, max: TITLE_MAX })};</script>

      <div class="set-section desc-editor" id="s-desc">
        <h2>Description templates</h2>
        <p class="hint">Up to ${DESCRIPTION_TEMPLATE_MAX} templates; the <b>active</b> one is used when generating listings and CSV exports. Click a variable to insert it at the cursor. Lines whose variable is empty for a card (e.g. <span class="mono">Grade: {grade}</span> on an ungraded card) are dropped automatically.</p>
        <div class="desc-tabs" role="tablist">${tplItems
          .map((t, i) => `<button type="button" class="desc-tab${i === tpls.active ? " on" : ""}" data-i="${i}" role="tab">${esc(t.name || `Description ${i + 1}`)}</button>`)
          .join("")}</div>
        ${tplItems
          .map(
            (t, i) => `<div class="desc-pane" data-i="${i}"${i === tpls.active ? "" : " hidden"}>
          <div class="fld-row desc-head">
            <label class="fld"><span>Template name</span><input type="text" name="desc_name_${i}" value="${esc(t.name)}" maxlength="40"></label>
            <label class="fld ckbox radio"><input type="radio" name="desc_active" value="${i}"${i === tpls.active ? " checked" : ""}> <span>Active — use this template</span></label>
          </div>
          <textarea name="desc_body_${i}" class="desc-body" rows="9" placeholder="Leave empty to use the built-in description.">${esc(t.body)}</textarea>
        </div>`
          )
          .join("")}
        <div class="desc-vars">
          <div class="te-lbl">Available variables <span class="te-hint2">click to insert</span></div>
          <div class="te-avail">${DESCRIPTION_VARS.map((v) => `<button type="button" class="te-chip add desc-var" data-k="${v.k}" title="${esc(v.hint)}">${esc(v.label)}</button>`).join("")}</div>
        </div>
        <div class="te-preview">
          <div class="te-preview-top"><span class="te-lbl">Preview <span class="te-hint2">sample card · ${esc(sampleFields.name)}${sampleFields.number ? " #" + esc(sampleFields.number) : ""}</span></span><button type="button" class="btn sm" id="desc-reset">Reset to built-in</button></div>
          <pre class="desc-preview" id="desc-preview">${esc(descPreview)}</pre>
        </div>
      </div>
      <script>window.__DESC__=${JSON.stringify({ active: tpls.active, defaultBody: DEFAULT_DESCRIPTION_TEMPLATE, sampleTitle })};</script>

      <div class="set-section" id="s-ebay">
        <h2>eBay</h2>
        ${ebayCard}
        ${ebayLive}
        <h3 class="set-sub">Listing preferences ${conn ? `<small class="hint">policy names below are filled from your selections and used by the CSV export</small>` : `<small class="hint">names must match your eBay business policies exactly for the CSV upload to work</small>`}</h3>
        <div class="fld-row">
          <label class="fld"><span>Store category</span><input name="ebay_store_category" value="${esc(s.ebay_store_category ?? "")}"></label>
          <label class="fld"><span>Item location</span><input name="item_location" value="${esc(s.item_location ?? "")}" placeholder="City, ST, United States"></label>
        </div>
        <div class="fld-row">
          <label class="fld"><span>Shipping policy</span><input name="ebay_shipping_policy" value="${esc(s.ebay_shipping_policy ?? "")}"></label>
          <label class="fld"><span>Return policy</span><input name="ebay_return_policy" value="${esc(s.ebay_return_policy ?? "")}"></label>
          <label class="fld"><span>Payment policy</span><input name="ebay_payment_policy" value="${esc(s.ebay_payment_policy ?? "")}"></label>
        </div>
        <label class="ckbox"><input type="checkbox" name="training_opt_in" value="1" ${s.training_opt_in ? "checked" : ""}> <span>Opt in to improving identification from my confirmed matches <small>(off by default — the opposite of a perpetual training licence)</small></span></label>
      </div>

      ${channelSections}

      <button class="btn primary" type="submit">Save settings</button>
    </form>
    ${APP_JS}${TITLE_EDITOR_JS}${DESC_EDITOR_JS}
  </div>`;

  return { html, title: "Settings — Seller workspace | CardIndex", description: "Seller workspace settings." };
}

// ---- Description template editor (settings) -------------------------------
// Tabs between the three templates, inserts {variables} at the cursor, and
// previews the visible template through the real fill function on the server
// (/api/description-preview). Without JS all three textareas still submit.
const DESC_EDITOR_JS = `<script>(function(){
  var root=document.getElementById('s-desc'); if(!root||!window.__DESC__)return;
  var D=window.__DESC__, tabs=[].slice.call(root.querySelectorAll('.desc-tab')), panes=[].slice.call(root.querySelectorAll('.desc-pane')),
      prev=document.getElementById('desc-preview'), reset=document.getElementById('desc-reset'), cur=D.active||0, t;
  function pane(i){return panes[i];}
  function body(i){return pane(i).querySelector('.desc-body');}
  function show(i){cur=i;tabs.forEach(function(b,j){b.classList.toggle('on',j===i);});panes.forEach(function(p,j){p.hidden=j!==i;});preview();}
  tabs.forEach(function(b){b.addEventListener('click',function(){show(parseInt(b.getAttribute('data-i'),10)||0);});});
  panes.forEach(function(p,i){
    var nm=p.querySelector('input[name^=desc_name_]');
    if(nm)nm.addEventListener('input',function(){tabs[i].textContent=nm.value||('Description '+(i+1));});
    body(i).addEventListener('input',preview);
  });
  root.querySelectorAll('.desc-var').forEach(function(btn){
    btn.addEventListener('click',function(){
      var ta=body(cur), k='{'+btn.getAttribute('data-k')+'}';
      var s=ta.selectionStart||0, e=ta.selectionEnd||0;
      ta.value=ta.value.slice(0,s)+k+ta.value.slice(e);
      ta.focus(); ta.selectionStart=ta.selectionEnd=s+k.length; preview();
    });
  });
  if(reset)reset.addEventListener('click',function(){body(cur).value=D.defaultBody;preview();});
  function preview(){
    clearTimeout(t);
    t=setTimeout(function(){
      var v=body(cur).value;
      fetch('/api/description-preview',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'t='+encodeURIComponent(v)})
        .then(function(r){return r.json();}).then(function(d){prev.textContent=d.text||'\\u2014';}).catch(function(){});
    },150);
  }
})();</script>`;

// ---- Title Structure Editor (settings) ------------------------------------
// Progressive enhancement: builds the interactive block editor from window.__TITLE__,
// keeps a hidden JSON field in sync, and live-previews via /api/title-preview
// (the real server-side builder). Without JS the saved structure still persists.
const TITLE_EDITOR_JS = `<script>(function(){
  var root=document.getElementById('s-titles'); if(!root||!window.__TITLE__)return;
  var D=window.__TITLE__, TOKENS=D.tokens, MAX=D.max;
  var state={blocks:(D.structure.blocks||[]).slice(), optimize:!!D.structure.optimize};
  var avail=document.getElementById('te-avail'), struct=document.getElementById('te-struct'),
      json=document.getElementById('te-json'), ptext=document.getElementById('te-ptext'),
      count=document.getElementById('te-count'), warn=document.getElementById('te-warn'),
      optcb=document.getElementById('te-optimize'), custom=document.getElementById('te-custom'),
      customAdd=document.getElementById('te-custom-add');
  var tokenLabel={}; TOKENS.forEach(function(t){tokenLabel[t.k]=t.label;});
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function labelOf(b){return b.t==='text'?('\\u201c'+b.v+'\\u201d'):(tokenLabel[b.k]||b.k);}

  function renderAvail(){
    avail.innerHTML='';
    TOKENS.forEach(function(t){
      var b=document.createElement('button');
      b.type='button'; b.className='te-chip add'; b.textContent='+ '+t.label; b.title='Add '+t.label;
      b.addEventListener('click',function(){state.blocks.push({t:'token',k:t.k});sync();});
      avail.appendChild(b);
    });
  }

  var dragIdx=-1;
  function renderStruct(){
    struct.innerHTML='';
    if(!state.blocks.length){struct.innerHTML='<div class="te-empty">No blocks yet — add some from above.</div>';return;}
    state.blocks.forEach(function(b,i){
      var el=document.createElement('div');
      el.className='te-block'+(b.caps?' caps':'')+(b.t==='text'?' text':''); el.draggable=true;
      el.innerHTML='<span class="te-grip">\\u2630</span><span class="te-blabel">'+esc(labelOf(b))+'</span>';
      var capsBtn=document.createElement('button');
      capsBtn.type='button'; capsBtn.className='te-caps'; capsBtn.textContent='AA';
      capsBtn.title='Toggle CAPS'; capsBtn.setAttribute('aria-pressed',b.caps?'true':'false');
      capsBtn.addEventListener('click',function(e){e.stopPropagation();b.caps=!b.caps;sync();});
      var rm=document.createElement('button');
      rm.type='button'; rm.className='te-rm'; rm.textContent='\\u00d7'; rm.title='Remove';
      rm.addEventListener('click',function(e){e.stopPropagation();state.blocks.splice(i,1);sync();});
      el.appendChild(capsBtn); el.appendChild(rm);
      el.addEventListener('dragstart',function(){dragIdx=i;el.classList.add('dragging');});
      el.addEventListener('dragend',function(){dragIdx=-1;el.classList.remove('dragging');});
      el.addEventListener('dragover',function(e){e.preventDefault();});
      el.addEventListener('drop',function(e){e.preventDefault();if(dragIdx<0||dragIdx===i)return;var mv=state.blocks.splice(dragIdx,1)[0];state.blocks.splice(i,0,mv);dragIdx=-1;sync();});
      struct.appendChild(el);
    });
  }

  var t;
  function preview(){
    clearTimeout(t);
    t=setTimeout(function(){
      fetch('/api/title-preview?s='+encodeURIComponent(json.value)).then(function(r){return r.json();}).then(function(d){
        ptext.textContent=d.title||'\\u2014';
        count.textContent=(d.length||0)+'/'+MAX;
        count.classList.toggle('over',!!d.over);
        warn.hidden=!d.over;
      }).catch(function(){});
    },120);
  }
  function sync(){
    json.value=JSON.stringify({optimize:state.optimize,blocks:state.blocks});
    renderStruct(); preview();
  }

  optcb.addEventListener('change',function(){state.optimize=optcb.checked;sync();});
  customAdd.addEventListener('click',function(){var v=(custom.value||'').trim();if(!v)return;state.blocks.push({t:'text',v:v});custom.value='';sync();});
  custom.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();customAdd.click();}});
  renderAvail(); sync();
})();</script>`;

// ---- progressive-enhancement script ---------------------------------------
// Included once per app page (idempotent guard). Adds: sample loader, bulk
// select + bar, keyboard shortcuts on review items, auto-submit selects, and
// manual card search.
export const APP_JS = `<script>(function(){
  if(window.__wsInit)return; window.__wsInit=1;

  // datetime-local inputs are wall time; tell the server the browser's offset
  document.querySelectorAll('input.tz-offset').forEach(function(i){i.value=String(new Date().getTimezoneOffset());});

  // load sample lines on the scan page
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
    // Pre-flight the server's limits so a too-big batch is caught before the
    // bytes leave the phone. With script the photos travel in chunks, so the
    // byte limit is per photo; without it the whole form is one request.
    function check(files){
      var n=files.length, total=0, biggest=0; for(var i=0;i<n;i++){var s=files[i].size||0;total+=s;if(s>biggest)biggest=s;}
      var over=[];
      if(n>maxFiles)over.push(n+' photos selected — max '+maxFiles+' per batch');
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

    // ---- chunked upload ----
    // The form's other fields ride along with every request (the server reads
    // condition/rule/matching off each one); the photos are split into groups
    // of chunkN that each stay under the byte limit. The job object remembers
    // how far a batch got so "Retry" resumes after a dropped connection instead of
    // starting over; a new photo selection starts a new batch.
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
        // network blips and server hiccups: wait a moment and send the same request again
        if(tries>0&&(!e.status||e.status>=500))return new Promise(function(ok){setTimeout(ok,1500);}).then(function(){return post(url,fd,tries-1);});
        throw e;
      });
    }
    function groupsOf(files){
      // With shrinking, the sent size is small and unknown up front, so group
      // by count alone; without it the original bytes must fit one request.
      var out=[],cur=[],bytes=0,cap=maxBytes*0.9;
      for(var i=0;i<files.length;i++){
        var f=files[i],s=canShrink?0:(f.size||0);
        if(cur.length&&(cur.length>=chunkN||bytes+s>cap)){out.push(cur);cur=[];bytes=0;}
        cur.push(f);bytes+=s;
      }
      if(cur.length)out.push(cur);
      return out;
    }

    // ---- on-device shrink ----
    // Phone photos are ~12 MP and 3–5 MB; the recognizer only needs ~1600 px
    // (see UPLOAD_MAX_EDGE in upload.ts), so each photo is resized here before
    // it is sent — ~10× fewer bytes, ~6× less server decode time. Photos the
    // browser can't decode (HEIC outside Safari) go up as-is for the server.
    // The result is {blob, name}; a photo already small enough is passed through.
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
    // Shrink a group a few photos at a time (decoding 12 MP images in parallel
    // is memory-hungry on phones).
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
      // prepared groups are cached on the job so a Retry doesn't re-shrink
      function prepped(gi){return job.prepped[gi]||(job.prepped[gi]=prepare(groups[gi]));}
      var start=job.batchId?Promise.resolve(job.batchId):post(base+'/start',fieldsOf(),1).then(function(j){job.batchId=j.batchId;return j.batchId;});
      start.then(function(id){
        var p=Promise.resolve();
        groups.forEach(function(g,gi){p=p.then(function(){
          if(gi<job.next)return;
          progress(job.done,total,'Preparing '+(job.done+1)+'–'+(job.done+g.length)+' of '+total+'…');
          // shrink the next group while this one uploads
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

  // auto-submit selects that change price/title (save the row)
  document.querySelectorAll('select[data-autosubmit]').forEach(function(sel){
    sel.addEventListener('change',function(){
      var form=sel.closest('form'); if(!form)return;
      var save=form.querySelector('button[value=save]');
      if(save&&form.requestSubmit)form.requestSubmit(save); else form.submit();
    });
  });

  // inventory bulk-select
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
