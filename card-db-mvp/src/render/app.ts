// Seller-workspace page renderers (spec Phase 1: scan → review → price → list).
// Server-rendered like the public site; reuses the same design tokens. Edits use
// plain HTML forms (POST → redirect) so the flow works without JavaScript; a thin
// progressive-enhancement script adds bulk-select, keyboard shortcuts, and
// auto-submit. Rendered inside the shared page() shell by the server.

import { esc, money } from "../util.ts";
import { getVariants } from "../pg.ts";
import { finishChip } from "./components.ts";
import {
  getSeller, listInventory, inventoryStats, listBatches, getBatch, getItems,
  listingsFor, listListings, marketCents, getVariantFull, getInventoryItem,
  type ScanItem, type ScanBatch, type Seller, type InventoryRow, type VariantFull,
  type InventoryFilter,
} from "../app/store.ts";
import { PRICE_MODES, ruleKey, ruleLabel, CONDITIONS, LANGUAGES } from "../app/pricing.ts";
import { scanItemTitle, inventoryListingPreview, sampleTitleFields } from "../app/compose.ts";
import { EBAY_TITLE_MAX } from "../app/listing.ts";
import {
  DEFAULT_STRUCTURE, TITLE_TOKENS, TITLE_MAX, parseStructure, serializeStructure, renderStructuredTitle,
} from "../app/title.ts";
import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL, isPro } from "../app/billing.ts";

const dollars = (c: number | null | undefined): string => (c == null ? "" : (c / 100).toFixed(2));

function opt(value: string, label: string, selected: string): string {
  return `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
}
function conditionOptions(sel: string): string {
  return CONDITIONS.map((c) => opt(c.key, `${c.key} · ${c.label}`, sel)).join("");
}
function languageOptions(sel: string): string {
  return LANGUAGES.map((l) => opt(l, l, sel)).join("");
}
function ruleOptions(sel: string): string {
  return PRICE_MODES.map((m) => opt(m.key, m.label, sel)).join("");
}

// ---- workspace chrome -----------------------------------------------------

function subnav(active: string): string {
  const items: Array<[string, string, string]> = [
    ["/app", "Inventory", "inventory"],
    ["/app/scan", "Scan / add", "scan"],
    ["/app/listings", "Listings", "listings"],
    ["/app/settings", "Settings", "settings"],
  ];
  return `<div class="ws-nav">${items
    .map(([href, label, key]) => `<a href="${href}" class="${key === active ? "active" : ""}">${label}</a>`)
    .join("")}</div>`;
}

function wsHead(active: string, title: string, sub: string, actions = ""): string {
  return `<div class="ws-head">
    <div class="ws-title-row">
      <div>
        <div class="eyebrow">Seller workspace</div>
        <h1>${esc(title)}</h1>
        <p class="ws-sub">${sub}</p>
      </div>
      <div class="ws-actions">${actions}</div>
    </div>
    ${subnav(active)}
  </div>`;
}

function flash(msg: string | undefined): string {
  if (!msg) return "";
  return `<div class="flash">${esc(msg)}</div>`;
}

// ---- Inventory / dashboard ------------------------------------------------

export async function renderDashboard(filter: InventoryFilter, msg?: string): Promise<{ html: string; title: string; description: string }> {
  const [seller, stats, rows, batches] = await Promise.all([
    getSeller(),
    inventoryStats(),
    listInventory(filter),
    listBatches(6),
  ]);

  const statCards = `<div class="stat-cards">
    <div class="stat"><div class="k">Inventory value</div><div class="v mono">${money(stats.value_cents)}</div><div class="s">${stats.units} unit${stats.units === 1 ? "" : "s"} across ${stats.count} record${stats.count === 1 ? "" : "s"}</div></div>
    <div class="stat"><div class="k">Cards in stock</div><div class="v mono">${stats.count}</div><div class="s">${stats.listed} listed</div></div>
    <div class="stat"><div class="k">SKU counter</div><div class="v mono">${esc(seller.sku_prefix)}-${String(seller.sku_next).padStart(seller.sku_pad, "0")}</div><div class="s">next SKU to assign</div></div>
    <div class="stat"><div class="k">Default pricing</div><div class="v" style="font-size:1.3rem">${esc(ruleLabel({ mode: seller.price_mode, pct: seller.price_pct, fixed_cents: seller.price_fixed_cents }))}</div><div class="s"><a href="/app/settings">Change defaults →</a></div></div>
  </div>`;

  const statusTabs = ["all", "in_stock", "listed", "sold"]
    .map((s) => {
      const label = s === "all" ? "All" : s === "in_stock" ? "In stock" : s === "listed" ? "Listed" : "Sold";
      const cur = (filter.status ?? "all") === s;
      const params = new URLSearchParams();
      if (s !== "all") params.set("status", s);
      if (filter.q) params.set("q", filter.q);
      if (filter.sort) params.set("sort", filter.sort);
      return `<a href="/app${params.toString() ? "?" + params : ""}" class="${cur ? "active" : ""}">${label}</a>`;
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
          <div class="sub">${esc(r.set_name)}${r.number ? " · #" + esc(r.number) : ""} · ${finishChip({ finish: r.finish, finish_label: r.finish_label })}</div>
        </td>
        <td>${esc(r.condition)}</td>
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
        <form class="inv-search" method="get" action="/app">
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
        <button class="btn sm" name="do" value="export" type="submit" formaction="/app/export/ebay.csv" formmethod="get" formtarget="_blank">Export eBay CSV</button>
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
        <div class="ws-panel-head"><h2>Recent batches</h2><a href="/app/scan">New batch →</a></div>
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

export async function renderScan(msg?: string, prefill?: string): Promise<{ html: string; title: string; description: string }> {
  const [seller, batches] = await Promise.all([getSeller(), listBatches(8)]);
  const pref = (prefill ?? "").replace(/\s+/g, " ").trim();

  const html = `<div class="wrap ws">
    ${wsHead("scan", "Scan / add cards", `Paste a list of cards — one per line — and the system identifies each against the catalog, scores its confidence, and routes low-confidence matches to a review queue.`)}
    ${flash(msg)}
    <div class="scan-grid">
      <div class="scan-main">
        <form class="ws-panel upload-form" method="post" action="/app/scan/upload" enctype="multipart/form-data">
          <div class="ws-panel-head"><h2>Upload photos</h2><span class="eyebrow">phone or scanner</span></div>
          <label class="dropzone" id="dropzone">
            <input type="file" name="images" id="imgInput" accept="image/*" capture="environment" multiple hidden>
            <div class="dz-inner">
              <div class="dz-ic">📷</div>
              <div class="dz-main"><b>Tap to choose</b> or drag &amp; drop card photos</div>
              <div class="dz-hint">JPG / PNG / WebP / HEIC · one card per image · front side</div>
            </div>
            <div class="dz-preview" id="dzPreview" hidden></div>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. Binder A"></label>
            <label class="fld"><span>Default condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
            <label class="fld"><span>Default language</span><select name="language">${languageOptions(seller.default_language)}</select></label>
          </div>
          <div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(seller.price_mode, seller.price_pct))}</select></label>
            <label class="fld"><span>SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit" id="uploadBtn">Upload &amp; identify →</button>
            <span class="hint" id="dzCount">No photos selected yet</span>
          </div>
        </form>

        <form class="scan-form ws-panel" method="post" action="/app/scan">
          <div class="ws-panel-head"><h2>Or paste a list</h2><button type="button" class="btn sm" id="loadsample">Load sample</button></div>
          <label class="fld">
            <span>Cards <small>one per line — name, number (4/102 or #119), set, finish, condition, language, qty (e.g. 3x)</small></span>
            <textarea name="lines" id="lines" rows="7" placeholder="Charizard 4/102 Base Set holo NM&#10;3x Pikachu 58/102 Base&#10;The Wandering Emperor Neon Dynasty foil">${esc(pref)}</textarea>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. Box break 8/25"></label>
            <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
            <label class="fld"><span>Language</span><select name="language">${languageOptions(seller.default_language)}</select></label>
          </div>
          <div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(seller.price_mode, seller.price_pct))}</select></label>
            <label class="fld"><span>SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
            <label class="fld ckbox"><input type="checkbox" name="save_defaults" value="1"> <span>Save as my defaults</span></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit">Identify cards →</button>
            <span class="hint">You'll review and edit every match before anything is added to inventory.</span>
          </div>
        </form>
      </div>

      <aside class="ws-panel scan-side">
        <h2>How it works</h2>
        <p><b>Photos</b> are stored and dropped straight into the review queue, one item per image. We take a first guess from the filename (e.g. <span class="mono">charizard-4-102.jpg</span>); anything we can't place waits in the queue where you <b>search and confirm</b> it — the same manual step you'd take to correct any match.</p>
        <p><b>Pasted lines</b> are parsed for name, number, set, finish, condition, language and quantity, then matched against the catalog — <b>${Math.round(0.9 * 100)}%+</b> auto-matches, the rest route to review.</p>
        <div class="seam-note"><span class="i">◆</span><div><b>Reading the card from the pixels is the remaining seam.</b> A vision model (photo → identity, front/back, auto-crop) and graded-slab OCR/QR + cert lookup drop in behind the same review queue and identify contract — upload, storage, and review already work end-to-end.</div></div>
        ${
          batches.length
            ? `<h3 style="margin-top:18px">Recent batches</h3><div class="batch-list">${batches
                .map(
                  (b) => `<a class="batch-row" href="/app/review/${b.id}"><span class="bid">#${b.id}</span><span class="blabel">${esc(b.label || "Batch")}</span><span class="bmeta">${b.total} · ${b.status}</span></a>`
                )
                .join("")}</div>`
            : ""
        }
      </aside>
    </div>
    <script>window.__SAMPLE__=${JSON.stringify(SAMPLE_LINES)};</script>
    ${APP_JS}
  </div>`;

  return { html, title: "Scan / add cards — Seller workspace | CardIndex", description: "Bulk-identify cards and route them to a review queue." };
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
  const market = item.matched_variant_id ? await marketCents(item.matched_variant_id) : null;
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
    ${wsHead("scan", `Review batch #${batch.id}`, esc(batch.label || "Identify, correct, price, then add to inventory."), `<a class="btn" href="/app/scan">New batch</a>`)}
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
  const [seller, preview, existing, market] = await Promise.all([
    getSeller(),
    inventoryListingPreview(inv),
    listingsFor(invId),
    marketCents(inv.variant_id),
  ]);
  if (!preview) return null;

  const specRows = Object.entries(preview.specifics)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("");

  const img = inv.image_large || inv.image_small;
  const exportUrl = `/app/export/ebay.csv?ids=${inv.id}`;

  const html = `<div class="wrap ws">
    ${wsHead("inventory", "Build listing", `Generate an eBay listing for this card. Saved drafts export to a File Exchange CSV; live publish uses the eBay Sell API (seam).`, `<a class="btn" href="/app">← Inventory</a>`)}
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
          <label class="fld"><span>Schedule (optional)</span><input type="datetime-local" name="scheduled_at"></label>
        </div>
        <label class="fld"><span>eBay category</span><input type="text" name="category" value="${esc(preview.category)}" class="mono"></label>
        <label class="fld"><span>Description</span><textarea name="description" rows="7">${esc(preview.description)}</textarea></label>
        <div class="policy-note">Business policies applied from <a href="/app/settings">settings</a>: shipping <b>${esc(seller.ebay_shipping_policy || "—")}</b>, returns <b>${esc(seller.ebay_return_policy || "—")}</b>, payment <b>${esc(seller.ebay_payment_policy || "—")}</b>, location <b>${esc(seller.item_location || "—")}</b>.</div>
        <div class="list-actions">
          <button class="btn primary" name="do" value="draft" type="submit">Save listing draft</button>
          <a class="btn" href="${exportUrl}" target="_blank">Download eBay CSV</a>
        </div>
        <div class="seam-note"><span class="i">◆</span><div>Live <b>publish/revise/orders</b> uses the eBay Sell API (OAuth + production keyset) — the next integration. Scheduling &amp; auction fields are captured on the draft now and drive that step and the CSV export.</div></div>
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
  const rows = await listListings();
  const body = rows.length
    ? rows
        .map(
          (l) => `<tr>
        <td class="mono">${l.id}</td>
        <td class="thumb">${l.image_small ? `<img src="${esc(l.image_small)}" alt="" loading="lazy">` : ""}</td>
        <td>${esc(l.title)}<div class="sub mono">${esc(l.sku ?? "")}</div></td>
        <td>${esc(l.marketplace)}</td>
        <td>${esc(l.format)}</td>
        <td class="mono">${money(l.price_cents)}</td>
        <td>${l.scheduled_at ? esc(l.scheduled_at.replace("T", " ").slice(0, 16)) : "immediate"}</td>
        <td><span class="pill ${l.status}">${esc(l.status)}</span></td>
      </tr>`
        )
        .join("")
    : "";

  const html = `<div class="wrap ws">
    ${wsHead("listings", "Listings", "Draft and scheduled listings across marketplaces. eBay first; the same records format to other channels next.", rows.length ? `<a class="btn" href="/app/export/ebay.csv?all=1" target="_blank">Export all as eBay CSV</a>` : "")}
    ${flash(msg)}
    ${
      rows.length
        ? `<div class="tablewrap"><table class="inv-table"><thead><tr><th>#</th><th></th><th>Title</th><th>Market</th><th>Format</th><th>Price</th><th>Schedule</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>
           <div class="seam-note" style="margin-top:16px"><span class="i">◆</span><div><b>Scheduled listings &amp; spacing</b> (spec §12: "list one card every 5 minutes") and live publish run through the eBay Sell API job runner — the next integration. Drafts and their schedule times are captured here now and export to File Exchange CSV.</div></div>`
        : `<div class="ws-empty"><h3>No listings yet</h3><p>Open a card in your <a href="/app">inventory</a> and build a listing.</p></div>`
    }
    ${APP_JS}
  </div>`;

  return { html, title: "Listings — Seller workspace | CardIndex", description: "Your marketplace listing drafts." };
}

// ---- Settings -------------------------------------------------------------

export async function renderSettings(msg?: string): Promise<{ html: string; title: string; description: string }> {
  const s = await getSeller();
  const structure = parseStructure(s.title_structure) ?? DEFAULT_STRUCTURE;
  const initialJson = serializeStructure(structure);
  const initialPreview = renderStructuredTitle(await sampleTitleFields(), structure);
  const pro = isPro(s.plan_tier);
  const planPanel = `<div class="ws-panel plan-panel">
    <div>
      <div class="eyebrow">Your plan</div>
      <div class="plan-line">
        <b>${pro ? "Pro" : "Free"}</b>${pro ? ` · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}` : ""}
        <span class="plan-dot${pro ? "" : " free"}">${pro ? "Active" : "Free"}</span>
      </div>
      <p class="hint">${
        pro
          ? "Thanks for subscribing. Online billing management is coming soon."
          : "Upgrade to Pro to unlock the seller workspace."
      } <a href="/pricing">View plans</a></p>
    </div>
  </div>`;

  const html = `<div class="wrap ws">
    ${wsHead("settings", "Settings", "Set once, reuse on every scan and listing — SKU scheme, default pricing, and eBay listing preferences.")}
    ${flash(msg)}
    ${planPanel}
    <form class="ws-panel settings-form" method="post" action="/app/settings">
      <div class="set-section">
        <h2>Shop &amp; SKUs</h2>
        <div class="fld-row">
          <label class="fld"><span>Shop name</span><input name="display_name" value="${esc(s.display_name)}"></label>
          <label class="fld"><span>SKU prefix</span><input name="sku_prefix" value="${esc(s.sku_prefix)}" maxlength="12"></label>
          <label class="fld"><span>SKU digits</span><input type="number" name="sku_pad" min="3" max="9" value="${s.sku_pad}" class="mono"></label>
          <label class="fld"><span>Next SKU number</span><input type="number" name="sku_next" min="1" value="${s.sku_next}" class="mono"></label>
        </div>
        <p class="hint">Next SKU: <b class="mono">${esc(s.sku_prefix)}-${String(s.sku_next).padStart(s.sku_pad, "0")}</b></p>
      </div>

      <div class="set-section">
        <h2>Default pricing &amp; condition</h2>
        <div class="fld-row">
          <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(s.price_mode, s.price_pct))}</select></label>
          <label class="fld"><span>Fixed price ($, if rule = Fixed)</span><input name="price_fixed" value="${dollars(s.price_fixed_cents)}" class="mono"></label>
          <label class="fld"><span>Default condition</span><select name="default_condition">${conditionOptions(s.default_condition)}</select></label>
          <label class="fld"><span>Default language</span><select name="default_language">${languageOptions(s.default_language)}</select></label>
        </div>
      </div>

      <div class="set-section title-editor" id="te-root" data-max="${TITLE_MAX}">
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

      <div class="set-section">
        <h2>eBay listing preferences</h2>
        <p class="hint">Saved so you don't re-enter them each time. Connecting your eBay account (OAuth) to pull these automatically is the next integration.</p>
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

      <button class="btn primary" type="submit">Save settings</button>
    </form>
    ${APP_JS}${TITLE_EDITOR_JS}
  </div>`;

  return { html, title: "Settings — Seller workspace | CardIndex", description: "Seller workspace settings." };
}

// ---- Title Structure Editor (settings) ------------------------------------
// Progressive enhancement: builds the interactive block editor from window.__TITLE__,
// keeps a hidden JSON field in sync, and live-previews via /api/title-preview
// (the real server-side builder). Without JS the saved structure still persists.
const TITLE_EDITOR_JS = `<script>(function(){
  var root=document.getElementById('te-root'); if(!root||!window.__TITLE__)return;
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
const APP_JS = `<script>(function(){
  if(window.__wsInit)return; window.__wsInit=1;

  // load sample lines on the scan page
  var ls=document.getElementById('loadsample');
  if(ls)ls.addEventListener('click',function(){var t=document.getElementById('lines');if(t&&window.__SAMPLE__){t.value=window.__SAMPLE__;t.focus();}});

  // photo-upload dropzone: preview thumbnails, drag & drop, enable submit
  var dz=document.getElementById('dropzone'), inp=document.getElementById('imgInput');
  if(dz&&inp){
    var prev=document.getElementById('dzPreview'), cnt=document.getElementById('dzCount'), btn=document.getElementById('uploadBtn');
    function render(){
      var files=inp.files||[]; var n=files.length;
      if(cnt)cnt.textContent = n? (n+' photo'+(n>1?'s':'')+' ready') : 'No photos selected yet';
      if(btn)btn.disabled = n===0;
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
    dz.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length){inp.files=e.dataTransfer.files;render();}});
    var upForm=dz.closest('form');
    if(upForm)upForm.addEventListener('submit',function(){if(btn){btn.disabled=true;btn.textContent='Uploading…';}});
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
