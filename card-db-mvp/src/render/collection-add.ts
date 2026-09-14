// The pages that take cards IN: the Add cards page (photos or a pasted list,
// two outcomes — price check or collection), the review queue, graded slabs
// from cert numbers, "add from a set" checklists, and the priced list that a
// price check produces (also the public /p/{token} share page). Shared chrome
// and helpers come from render/collection.ts.

import { esc, money } from "../util.ts";
import { query, getGames, getSetsForGame, getAllSets, getVariants } from "../pg.ts";
import type { CardSet } from "../db.ts";
import { finishChip } from "./components.ts";
import {
  wsHead, flash, APP_JS, opt, conditionOptions, languageOptions, setDatalist, matchingPanel, dollars, batchHref, batchLabel, TITLE_SUFFIX,
  NAV_ICONS, currentPlanIsPro, type Page,
} from "./collection.ts";
import {
  getMember, listBatches, listBatchesOfKind, getBatch, getItems, getVariantFull, marketCents, marketCentsAt,
  type ScanBatch, type ScanItem, type VariantFull,
} from "../app/collection.ts";
import { parseMatchingPrefs, prefsToForm, isEmptyPrefs } from "../app/matching.ts";
import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL } from "../app/billing.ts";
import { maxUploadFiles, MAX_UPLOAD_FILES_PRO, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_FILES, UPLOAD_MAX_EDGE } from "../upload.ts";
import { GRADERS, GRADE_VALUES, certUrl, splitGrade, certProviderName } from "../app/graded.ts";

// ---- Add cards (one page, two outcomes) --------------------------------------
//   price      → identified, valued at market, shown as a shareable table; the
//                photos are kept only as thumbnails on that list.       (Free)
//   collection → identified, confirmed in review, added to your collection;
//                the photos are stored with each card.                   (Pro)

export type AddMode = "price" | "collection";

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

function flow(steps: Array<[string, string]>): string {
  return `<div class="mode-flow" aria-hidden="true">${steps
    .map(([ic, label], i) => `${i ? `<span class="mf-arr">→</span>` : ""}<span class="mf-step"><svg class="nav-ic" viewBox="0 0 20 20">${NAV_ICONS[ic]}</svg><small>${label}</small></span>`)
    .join("")}</div>`;
}

function modeChooser(mode: AddMode, pro: boolean, prefill: string): string {
  const keep = prefill ? `&add=${encodeURIComponent(prefill)}` : "";
  const card = (m: AddMode, name: string, plan: string, steps: Array<[string, string]>, body: string) =>
    `<a class="mode-card${mode === m ? " on" : ""}" href="/collection/add?mode=${m}${keep}"${mode === m ? ' aria-current="page"' : ""}>
      <div class="mode-head"><span class="mode-name">${name}</span><span class="pill ${plan === "Pro" ? (pro ? "sold" : "") : "listed"}">${plan}</span></div>
      ${flow(steps)}
      <p>${body}</p>
    </a>`;
  return `<div class="mode-pick" role="group" aria-label="What should happen with these cards?">
    ${card(
      "price",
      "Just price them",
      "Free",
      [["add", "photos or list"], ["search", "identified"], ["price", "market price"], ["share", "share by link"]],
      `Each card is read, matched to the catalog and valued at market, then shown as a table you can share by link. <b>Nothing is added to your collection</b>; photos are kept only as thumbnails on that list.`
    )}
    ${card(
      "collection",
      "Add to my collection",
      "Pro",
      [["add", "photos or list"], ["search", "identified"], ["review", "you confirm"], ["cards", "in your collection"]],
      `Each card is read and matched, you confirm anything uncertain in review (and can note what you paid), and it lands in your collection valued at today's market. <b>Photos are kept with the card.</b>`
    )}
  </div>`;
}

export async function renderAdd(msg?: string, prefill?: string, opts: { mode?: AddMode; pro?: boolean } = {}): Promise<Page> {
  const pro = opts.pro ?? true;
  const mode: AddMode = opts.mode ?? (pro ? "collection" : "price");
  const priceMode = mode === "price";
  const [member, batches, sets] = await Promise.all([getMember(), priceMode ? listBatchesOfKind("pricing", 8) : listBatches(8), getAllSets()]);
  const pref = (prefill ?? "").replace(/\s+/g, " ").trim();
  const prefs = parseMatchingPrefs(member.matching_prefs);
  const matchVals = prefsToForm(prefs, sets);
  const savedMatching = !isEmptyPrefs(prefs);
  const modeField = `<input type="hidden" name="mode" value="${mode}">`;

  const sub = priceMode
    ? "Price a binder page, a stack from a show, or a list you've been offered. Nothing is added to your collection, and the priced list can be shared by link."
    : "Upload photos or paste a list. Every card is identified against the catalog and scored for confidence; anything uncertain waits in review before it reaches your collection.";

  const uploadForm = `<form class="ws-panel upload-form" method="post" action="/collection/add/upload" enctype="multipart/form-data">
          ${modeField}
          <div class="ws-panel-head"><h2>Upload photos</h2><span class="eyebrow">${priceMode ? "single cards · binder pages · loose cards" : "phone or scanner"}</span></div>
          <label class="dropzone" id="dropzone" data-max-files="${maxUploadFiles(pro)}" data-max-bytes="${MAX_UPLOAD_BYTES}" data-chunk="${UPLOAD_CHUNK_FILES}" data-max-edge="${UPLOAD_MAX_EDGE}">
            <input type="file" name="images" id="imgInput" accept="image/*" capture="environment" multiple hidden>
            <div class="dz-inner">
              <div class="dz-ic">📷</div>
              <div class="dz-main"><b>Tap to choose</b> or drag &amp; drop card photos</div>
              <div class="dz-hint">JPG / PNG / WebP / HEIC · one card per image · front side · up to ${maxUploadFiles(pro)} photos per upload${pro ? "" : ` (${MAX_UPLOAD_FILES_PRO} on Pro)`} · resized to ${UPLOAD_MAX_EDGE} px on your device and sent in groups of ${UPLOAD_CHUNK_FILES}</div>
              <div class="dz-what">${
                priceMode
                  ? `These photos are used to <b>identify and price</b> the cards. They stay only as thumbnails on the priced list.`
                  : `These photos are <b>kept with each card</b> in your collection.`
              }</div>
            </div>
            <div class="dz-preview" id="dzPreview" hidden></div>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Label</span><input type="text" name="label" placeholder="${priceMode ? "e.g. Binder page 4" : "e.g. Binder A"}"></label>
            <label class="fld"><span>${priceMode ? "Condition" : "Default condition"}</span><select name="condition">${conditionOptions(member.default_condition)}</select></label>
            ${priceMode ? "" : `<label class="fld"><span>Default language</span><select name="language">${languageOptions(member.default_language)}</select></label>`}
          </div>
          ${matchingPanel(matchVals, savedMatching, "u")}
          <div class="scan-submit">
            <button class="btn primary" type="submit" id="uploadBtn">${priceMode ? "Price photos →" : "Upload &amp; identify →"}</button>
            <span class="hint" id="dzCount">No photos selected yet</span>
          </div>
        </form>`;

  const pasteForm = `<form class="scan-form ws-panel" method="post" action="/collection/add" id="paste">
          ${modeField}
          <div class="ws-panel-head"><h2>Or paste a list</h2><button type="button" class="btn sm" id="loadsample">Load sample</button></div>
          <label class="fld">
            <span>Cards <small>one per line — name, number (4/102 or #119), set, finish, condition, language, qty (e.g. 3x)</small></span>
            <textarea name="lines" id="lines" rows="7" placeholder="Charizard 4/102 Base Set holo NM&#10;3x Pikachu 58/102 Base&#10;The Wandering Emperor Neon Dynasty foil">${esc(pref)}</textarea>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Label</span><input type="text" name="label" placeholder="${priceMode ? "e.g. Trade offer" : "e.g. Show pickups 8/25"}"></label>
            <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(member.default_condition)}</select></label>
            ${priceMode ? "" : `<label class="fld"><span>Language</span><select name="language">${languageOptions(member.default_language)}</select></label>
            <label class="fld ckbox"><input type="checkbox" name="save_defaults" value="1"> <span>Save as my defaults</span></label>`}
          </div>
          ${matchingPanel(matchVals, savedMatching, "p")}
          <div class="scan-submit">
            <button class="btn primary" type="submit">${priceMode ? "Price list →" : "Identify cards →"}</button>
            <span class="hint">${priceMode ? "Market prices from the catalog; nothing is added to your collection." : "You'll confirm every match in review before anything is added to your collection."}</span>
          </div>
        </form>`;

  // A Free account that picks "Add to my collection" sees what it unlocks, not a
  // form that would bounce on submit.
  const locked = `<div class="ws-panel mode-lock">
          <div class="ws-panel-head"><h2>Your collection is part of Pro</h2><span class="pill">Pro · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}</span></div>
          <p>With Pro, the same photos and lists go through review into your collection: every card keeps its photo, its condition and what you paid, and you see the whole collection's value against the market.</p>
          <div class="scan-submit"><a class="btn primary" href="/pricing?upgrade=1">Upgrade to Pro</a><a class="btn" href="/collection/add?mode=price${pref ? "&add=" + encodeURIComponent(pref) : ""}">Just price these cards instead</a></div>
        </div>`;

  const forms = mode === "collection" && !pro ? locked : `${uploadForm}\n${pasteForm}`;

  const aside = priceMode
    ? `<aside class="ws-panel scan-side">
        <h2>Recent price checks</h2>
        ${
          batches.length
            ? `<div class="batch-list">${batches
                .map((b) => `<a class="batch-row" href="/collection/priced/${b.id}"><span class="bid">#${b.id}</span><span class="blabel">${esc(b.label || "Price check")}</span><span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"}${b.share_token ? " · shared" : ""}</span></a>`)
                .join("")}</div>`
            : `<p class="hint">No price checks yet.</p>`
        }
        <h3 style="margin-top:18px">What happens to the photos</h3>
        <p>Each photo is read by the recognizer and matched to a catalog printing. The priced list keeps a thumbnail so you and whoever you share it with can see which card is which. Nothing is added to your collection, and any price check can be turned into a collection batch later from its results page.</p>
        <div class="seam-note"><span class="i">◆</span><div><b>Binder-page detection</b> (several cards in one photo, auto-cropped) plugs into the same upload — today each photo is treated as one card.</div></div>
      </aside>`
    : `<aside class="ws-panel scan-side">
        <h2>What happens next</h2>
        <p><b>Photos</b> go straight into the review queue, one card per image. The recognizer reads each card (or takes a first guess from the filename, e.g. <span class="mono">charizard-4-102.jpg</span>); anything it can't place waits in the queue where you <b>search and confirm</b> it. Confirmed cards keep their photo.</p>
        <p><b>Pasted lines</b> are parsed for name, number, set, finish, condition, language and quantity, then matched against the catalog — <b>90%+</b> auto-matches, the rest route to review.</p>
        <p><b>Know what's in the binder?</b> Open <b>Advanced matching options</b> and prioritize its sets — same-name cards from other sets stop stealing matches.</p>
        <p><b>Values</b> are today's TCGplayer market price per printing, or the catalog's value at the grade for slabs. Type what you <b>paid</b> in review to track gains.</p>
        ${
          batches.length
            ? `<h3 style="margin-top:18px">Recent uploads</h3><div class="batch-list">${batches
                .map((b) => `<a class="batch-row" href="${batchHref(b)}"><span class="bid">#${b.id}</span><span class="blabel">${esc(batchLabel(b))}</span><span class="bmeta">${b.total} · ${b.status}</span></a>`)
                .join("")}</div>`
            : ""
        }
      </aside>`;

  const html = `<div class="wrap ws">
    ${wsHead(priceMode ? "price" : "add", "Add cards", sub)}
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
    title: `${priceMode ? "Price check" : "Add cards"} ${TITLE_SUFFIX}`,
    description: priceMode ? "Free card price check by photo or list." : "Identify cards and add them to your collection.",
  };
}

// ---- Review queue ---------------------------------------------------------

function confBadge(item: ScanItem): string {
  const pctN = Math.round(item.ai_confidence * 100);
  if (item.status === "failed") return `<span class="conf bad">No match</span>`;
  if (item.status === "approved") return `<span class="conf ok">✓ Confirmed</span>`;
  if (item.status === "skipped") return `<span class="conf muted">Skipped</span>`;
  const cls = item.ai_confidence >= 0.9 ? "ok" : "warn";
  return `<span class="conf ${cls}">${pctN}% match</span>`;
}

/** Per-item front/back photo upload + thumbnails. */
function imageControl(item: ScanItem, batch: ScanBatch): string {
  const action = `/collection/review/${batch.id}/item/${item.id}/image`;
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

async function reviewItem(item: ScanItem, batch: ScanBatch, priceMode: boolean): Promise<string> {
  const alts: Array<{ variant_id: number; card_id: number; label: string; set: string; finish: string; image: string | null; score: number }> = JSON.parse(item.alternatives || "[]");
  const variants = item.matched_card_id ? await getVariants(item.matched_card_id) : [];
  const market = item.matched_variant_id ? await marketCentsAt(item.matched_variant_id, item.grade) : null;
  const g = splitGrade(item.grade);
  const vf = await vfOf(item);
  const cardImg = vf ? vf.image_small || vf.image_large : null;
  const scanImg = item.image_url || cardImg;
  const vMarket = new Map<number, number | null>(await Promise.all(variants.map(async (v) => [v.id, await marketCents(v.id)] as const)));

  const action = `/collection/review/${batch.id}/item/${item.id}`;
  const dup = item.dup_of_item_id
    ? `<div class="dup-note">⚠ Same card as item #${item.dup_of_item_id} in this batch — <b>merge</b> folds its quantity in when you add them.</div>`
    : "";
  const certLink = certUrl(item.grader ?? g?.grader, item.cert);
  const certLine = item.cert
    ? `<div class="cert-line">🏅 ${esc(item.grader ?? g?.grader ?? "")} cert <span class="mono">${esc(item.cert)}</span>${item.grade ? ` · <b>${esc(item.grade)}</b>` : " · grade not set"}${certLink ? ` · <a href="${esc(certLink)}" target="_blank" rel="noopener">verify ↗</a>` : ""}</div>`
    : "";

  const compareThumb = item.image_url && cardImg
    ? `<img class="ri-catalog" src="${esc(cardImg)}" alt="catalog match" title="Catalog image — compare with your photo" loading="lazy">`
    : "";
  const matchBlock = vf
    ? `<div class="ri-match">
        ${compareThumb}
        <div class="ri-match-txt">
          <a href="/c/${esc(vf.card_slug)}-${vf.card_id}" class="ri-name" target="_blank" rel="noopener">${esc(vf.card_name)}</a>
          <div class="ri-sub">${esc(vf.set_name)}${vf.number ? " · #" + esc(vf.number) : ""}</div>
        </div>
      </div>`
    : `<div class="ri-match ri-nomatch">No catalog match — search below to identify this card.</div>`;

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

  const valueLine = market != null ? `Market value <b class="mono">${money(market)}</b>${item.grade ? ` at ${esc(item.grade)}` : ""}` : "No market price for this printing yet";

  return `<div class="review-item status-${item.status}" data-item="${item.id}" tabindex="0">
    <div class="ri-left">
      <div class="ri-thumb${item.image_url ? " is-scan" : ""}">${scanImg ? `<img src="${esc(scanImg)}" alt="" loading="lazy">` : `<span class="noimg">?</span>`}${item.image_url ? `<span class="scan-tag">your photo</span>` : ""}</div>
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
        ${priceMode ? "" : `<label>Paid<div class="price-in"><span>$</span><input type="text" name="paid" value="${dollars(item.paid_cents)}" class="mono" inputmode="decimal" placeholder="—"></div></label>`}
      </div>
      <div class="price-hint">${valueLine}</div>
      <div class="ri-buttons">
        <button class="btn sm" name="do" value="save" type="submit">Save</button>
        <button class="btn sm ok" name="do" value="approve" type="submit" ${item.matched_variant_id ? "" : "disabled"}>✓ Confirm</button>
        <button class="btn sm ghost" name="do" value="skip" type="submit">Skip</button>
      </div>
    </form>
  </div>`;
}

// Joined variant lookup for display, memoized per render pass.
const _vfCache = new Map<number, VariantFull | undefined>();
async function vfOf(item: ScanItem): Promise<VariantFull | undefined> {
  if (!item.matched_variant_id) return undefined;
  if (_vfCache.has(item.matched_variant_id)) return _vfCache.get(item.matched_variant_id);
  const vf = await getVariantFull(item.matched_variant_id);
  _vfCache.set(item.matched_variant_id, vf);
  return vf;
}

export async function renderReview(batchId: number, filterTab: string | undefined, msg?: string): Promise<Page | null> {
  const batch = await getBatch(batchId);
  if (!batch) return null;
  _vfCache.clear();
  const priceMode = batch.kind === "pricing";
  const pro = currentPlanIsPro();
  const all = await getItems(batchId);
  const auto = all.filter((i) => i.status === "matched" || i.status === "approved").length;
  const review = all.filter((i) => i.status === "needs_review").length;
  const failed = all.filter((i) => i.status === "failed").length;
  const pctDone = batch.total ? Math.round((batch.processed / batch.total) * 100) : 100;

  const tab = filterTab ?? "all";
  const tabs: Array<[string, string, number]> = [
    ["all", "All", all.length],
    ["needs_review", "Needs review", review],
    ["failed", "No match", failed],
    ["matched", "Matched", auto],
  ];
  const filtered = all.filter((i) => {
    if (tab === "all") return true;
    if (tab === "matched") return i.status === "matched" || i.status === "approved";
    return i.status === tab;
  });

  const items = (await Promise.all(filtered.map((i) => reviewItem(i, batch, priceMode)))).join("") || `<div class="ws-empty"><p>No cards in this view.</p></div>`;
  const commitReady = all.filter((i) => i.matched_variant_id && (i.status === "matched" || i.status === "approved")).length;

  const commit = priceMode
    ? `<a class="btn primary" href="/collection/priced/${batch.id}">See the priced list →</a>`
    : pro
    ? `<form method="post" action="/collection/review/${batch.id}/commit" class="commit-form" onsubmit="return confirm('Add ${commitReady} matched card(s) to your collection?')">
        <label class="ckbox sm"><input type="checkbox" name="merge" value="1" checked> merge duplicates</label>
        <button class="btn primary" type="submit" ${commitReady ? "" : "disabled"}>Add ${commitReady} to my collection →</button>
      </form>`
    : `<a class="btn primary" href="/pricing?upgrade=1" title="Adding cards to your collection is part of Pro">Add to my collection <span class="nav-pro">Pro</span></a>`;

  const html = `<div class="wrap ws">
    ${wsHead(priceMode ? "price" : "add", `Review ${priceMode ? "price check" : "upload"} #${batch.id}`, esc(batch.label || (priceMode ? "Check the matches, then see the priced list." : "Confirm each match, note what you paid, then add them to your collection.")), `<a class="btn" href="/collection/add?mode=${priceMode ? "price" : "collection"}">New upload</a>`, { navMode: "collapsed" })}
    ${flash(msg)}
    <div class="batch-progress">
      <div class="bp-bar"><div class="bp-fill" style="width:${pctDone}%"></div></div>
      <div class="bp-stats">
        <span><b>${batch.total}</b> cards</span>
        <span class="ok">✅ ${auto} matched</span>
        <span class="warn">⚠ ${review} need review</span>
        <span class="bad">✖ ${failed} no match</span>
      </div>
    </div>

    <div class="review-toolbar">
      <div class="tabs">${tabs.map(([k, label, n]) => `<a href="/collection/review/${batch.id}?tab=${k}" class="${k === tab ? "active" : ""}">${label} <span class="c">${n}</span></a>`).join("")}</div>
      ${commit}
    </div>

    <div class="review-list">${items}</div>
    ${APP_JS}
  </div>`;

  return { html, title: `Review #${batch.id} ${TITLE_SUFFIX}`, description: "Confirm identified cards." };
}

// ---- Graded slabs ---------------------------------------------------------

export async function renderGraded(msg?: string): Promise<Page> {
  const provider = certProviderName();
  const html = `<div class="wrap ws">
    ${wsHead("graded", "Add graded slabs", "Paste cert numbers — one per line, or a range like <span class=\"mono\">12345678-12345690</span> — and each slab is looked up, matched, valued at its grade, and queued for review.")}
    ${flash(msg)}
    <div class="scan-grid">
      <div class="scan-main">
        <form class="ws-panel" method="post" action="/collection/graded">
          <div class="ws-panel-head"><h2>Certification numbers</h2><span class="eyebrow">PSA · CGC · BGS · SGC · TAG · ACE</span></div>
          <div class="grader-pick">${GRADERS.map(
            (g, i) => `<label class="grader-opt"><input type="radio" name="grader" value="${g.key}"${i === 0 ? " checked" : ""}><span><b>${g.key}</b><small>${esc(g.name)}</small></span></label>`
          ).join("")}</div>
          <label class="fld"><span>Cert numbers <small>up to 200 · ranges expand</small></span>
            <textarea name="certs" id="certs" rows="7" placeholder="12345678&#10;12345679-12345690&#10;98765432"></textarea>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Label</span><input type="text" name="label" placeholder="e.g. PSA return #12"></label>
            <label class="fld"><span>Grade if lookup is unavailable</span><select name="grade_default">${opt("", "Choose in review", "")}${GRADE_VALUES.map((v) => opt(v, v, "")).join("")}</select></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit">Look up &amp; value →</button>
            <span class="hint" id="certCount">0 certs</span>
          </div>
        </form>
      </div>
      <aside class="ws-panel scan-side">
        <h2>How graded slabs work</h2>
        <p>Each cert becomes one card in review. ${
          provider === "none"
            ? `<b>Cert lookup isn't connected yet</b> (set <span class="mono">CERT_PROVIDER</span>), so slabs land in review with the cert attached: pick the card, set the grade, done. The cert link opens the grader's own page for a quick check.`
            : `Certs resolve through the <b>${esc(provider)}</b> lookup provider; anything it can't read waits in review with the cert attached.`
        }</p>
        <p><b>Valued at the grade.</b> When the catalog has a value for that printing at that grade (PSA 10 / 9 / 8, BGS 9.5, CGC 9.5 today) that's the value; otherwise raw market is shown.</p>
        <h3 style="margin-top:14px">Cert lookups</h3>
        <ul class="linklist">${GRADERS.map((g) => `<li><b>${g.key}</b> — ${esc(g.name)}</li>`).join("")}</ul>
        <div class="seam-note"><span class="i">◆</span><div>Slab <b>QR / barcode scanning</b> from the camera is the next step here — it fills the same cert box.</div></div>
      </aside>
    </div>
    <script>(function(){var t=document.getElementById('certs'),c=document.getElementById('certCount');if(!t||!c)return;function n(){var v=t.value.split(/[\\s,;]+/).filter(Boolean);var extra=0;v.forEach(function(x){var m=x.match(/^(\\d{4,12})-(\\d{4,12})$/);if(m){var d=Number(m[2])-Number(m[1]);if(d>0&&d<=200)extra+=d;}});c.textContent=(v.length+extra)+' cert'+((v.length+extra)===1?'':'s');}t.addEventListener('input',n);n();})();</script>
    ${APP_JS}
  </div>`;
  return { html, title: `Graded slabs ${TITLE_SUFFIX}`, description: "Add graded cards from cert numbers." };
}

// ---- Add from a set (checklist) -------------------------------------------

type SetCard = { id: number; name: string; number: string | null; rarity: string | null; image_small: string | null; price_cents: number | null; owned: number };

async function cardsForSet(setId: number, sellerId: number): Promise<SetCard[]> {
  return query<SetCard>(
    `SELECT c.id, c.name, c.number, c.rarity, c.image_small,
            (SELECT MAX(pp.price_cents) FROM card_variants v JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL WHERE v.card_id=c.id) AS price_cents,
            (SELECT COALESCE(SUM(ci.quantity),0) FROM collection_items ci WHERE ci.card_id=c.id AND ci.seller_id=$2)::int AS owned
     FROM cards c WHERE c.set_id=$1 ORDER BY c.number_sort, c.name`,
    [setId, sellerId]
  );
}

export async function renderFromSet(sel: { game?: string; set?: string }, msg?: string): Promise<Page> {
  const [member, games] = await Promise.all([getMember(), getGames()]);
  const game = games.find((g) => g.slug === sel.game) ?? games[0];
  const sets: CardSet[] = game ? await getSetsForGame(game.id) : [];
  const set = sets.find((s) => s.slug === sel.set);
  const cards = set ? await cardsForSet(set.id, member.id) : [];
  const ownedCount = cards.filter((c) => c.owned > 0).length;

  const table = set
    ? `<p class="hint">You own <b>${ownedCount}</b> of ${cards.length} cards in ${esc(set.name)}${cards.length ? ` (${Math.round((ownedCount / cards.length) * 100)}%)` : ""}. Tick the ones to add.</p>
      <div class="tablewrap creator-table"><table class="inv-table"><thead><tr><th class="chk"><input type="checkbox" id="pickall" aria-label="Select all"></th><th></th><th>Card</th><th>Rarity</th><th>Market</th><th>Owned</th><th>Qty</th></tr></thead><tbody>${cards
        .map(
          (c) => `<tr class="${c.owned ? "owned" : ""}">
          <td class="chk"><input type="checkbox" class="pick" name="card_${c.id}" value="1" aria-label="Add ${esc(c.name)}"></td>
          <td class="thumb">${c.image_small ? `<img src="${esc(c.image_small)}" alt="" loading="lazy">` : ""}</td>
          <td class="card"><b>${esc(c.name)}</b><div class="sub">#${esc(c.number ?? "—")}</div></td>
          <td>${esc(c.rarity ?? "")}</td>
          <td class="mono">${money(c.price_cents)}</td>
          <td class="mono">${c.owned ? `<span class="ok">✓ ${c.owned}</span>` : "—"}</td>
          <td><input type="number" name="qty_${c.id}" value="1" min="1" max="999" class="mono qty"></td>
        </tr>`
        )
        .join("")}</tbody></table></div>`
    : `<div class="ws-empty"><p>Pick a set to see its checklist, or search on the right.</p></div>`;

  const html = `<div class="wrap ws">
    ${wsHead("from-set", "Add from a set", "Work through a set checklist — tick the cards you have, set quantities, and they go to review already matched. Cards you already own are marked.")}
    ${flash(msg)}
    <div class="creator-grid">
      <form class="ws-panel" method="post" action="/collection/from-set" id="creatorForm">
        <div class="ws-panel-head"><h2>Set checklist</h2>
          <div class="creator-sel">
            <select name="game" id="gameSel" aria-label="Game">${games.map((g) => opt(g.slug, g.name, game?.slug ?? "")).join("")}</select>
            <select name="set" id="setSel" aria-label="Set">${opt("", "Choose a set…", set?.slug ?? "")}${sets.map((s) => opt(s.slug, `${s.name}${s.card_count ? " · " + s.card_count : ""}`, set?.slug ?? "")).join("")}</select>
          </div>
        </div>
        ${table}
        <div class="fld-row" style="margin-top:14px">
          <label class="fld"><span>Label</span><input type="text" name="label" placeholder="e.g. Base Set binder"></label>
          <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(member.default_condition)}</select></label>
        </div>
        <textarea name="picks" id="picks" hidden></textarea>
        <div class="scan-submit">
          <button class="btn primary" type="submit" id="creatorSubmit">Add <span id="pickCount">0</span> cards → review</button>
          <span class="hint">Picked cards land in review as confirmed matches, valued at market.</span>
        </div>
      </form>
      <aside class="ws-panel">
        <h2>Search the catalog</h2>
        <input type="search" id="creatorSearch" placeholder="Card name or number…" aria-label="Search catalog" class="creator-search">
        <div class="creator-results" id="creatorResults"></div>
        <h3 style="margin-top:14px">Picked from search</h3>
        <div class="picked-list" id="pickedList"><p class="hint">Nothing yet — search and click <b>+ Add</b>.</p></div>
      </aside>
    </div>
    <script>(function(){
      var gameSel=document.getElementById('gameSel'),setSel=document.getElementById('setSel'),form=document.getElementById('creatorForm');
      function nav(){var p=new URLSearchParams();p.set('game',gameSel.value);if(setSel.value)p.set('set',setSel.value);location.href='/collection/from-set?'+p;}
      gameSel.addEventListener('change',function(){setSel.value='';nav();}); setSel.addEventListener('change',nav);
      var picks={}, picksTa=document.getElementById('picks'), list=document.getElementById('pickedList'), count=document.getElementById('pickCount'), all=document.getElementById('pickall');
      function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
      function sync(){
        var n=document.querySelectorAll('.pick:checked').length;
        var lines=[];Object.keys(picks).forEach(function(id){lines.push(id+','+picks[id].qty);n+=1;});
        picksTa.value=lines.join('\\n'); count.textContent=n;
        list.innerHTML=lines.length?Object.keys(picks).map(function(id){var p=picks[id];return '<div class="picked"><span>'+esc(p.label)+'</span><input type="number" min="1" value="'+p.qty+'" data-id="'+id+'" class="mono qty"><button type="button" data-rm="'+id+'" class="te-rm" title="Remove">\\u00d7</button></div>';}).join(''):'<p class="hint">Nothing yet — search and click <b>+ Add</b>.</p>';
      }
      form.addEventListener('change',function(e){if(e.target.classList.contains('pick'))sync();});
      if(all)all.addEventListener('change',function(){document.querySelectorAll('.pick').forEach(function(c){c.checked=all.checked;});sync();});
      list.addEventListener('click',function(e){var b=e.target.closest('[data-rm]');if(b){delete picks[b.getAttribute('data-rm')];sync();}});
      list.addEventListener('input',function(e){var i=e.target;if(i.dataset.id&&picks[i.dataset.id]){picks[i.dataset.id].qty=Math.max(1,parseInt(i.value,10)||1);picksTa.value=Object.keys(picks).map(function(id){return id+','+picks[id].qty;}).join('\\n');}});
      var q=document.getElementById('creatorSearch'), out=document.getElementById('creatorResults'), t;
      q.addEventListener('input',function(){clearTimeout(t);var v=q.value.trim();if(v.length<2){out.innerHTML='';return;}
        t=setTimeout(function(){fetch('/api/suggest?q='+encodeURIComponent(v)).then(function(r){return r.json();}).then(function(rows){
          out.innerHTML=rows.map(function(r){var id=(r.url.match(/-(\\d+)$/)||[])[1];return '<div class="mres"><button type="button" data-add="'+id+'" data-label="'+esc(r.name+' · '+r.meta)+'">'+(r.image?'<img src="'+esc(r.image)+'" alt="">':'')+'<span>'+esc(r.name)+'</span><span class="mset">'+esc(r.meta)+'</span><b class="addlbl">+ Add</b></button></div>';}).join('')||'<div class="mnone">No matches</div>';
        }).catch(function(){});},160);});
      out.addEventListener('click',function(e){var b=e.target.closest('[data-add]');if(!b)return;var id=b.getAttribute('data-add');if(!picks[id])picks[id]={qty:1,label:b.getAttribute('data-label')};else picks[id].qty++;sync();});
      form.addEventListener('submit',function(e){if(!document.querySelectorAll('.pick:checked').length&&!Object.keys(picks).length){e.preventDefault();alert('Pick at least one card.');}});
      sync();
    })();</script>
    ${APP_JS}
  </div>`;
  return { html, title: `Add from a set ${TITLE_SUFFIX}`, description: "Add cards from a set checklist." };
}

// ---- Priced list (price check results + public share page) -------------------

type PricedLine = { item: ScanItem; name: string; set: string; number: string | null; finish: string; finishLabel: string; image: string | null; market: number | null; slug: string; card_id: number };

async function priceLines(items: ScanItem[]): Promise<PricedLine[]> {
  const out: PricedLine[] = [];
  for (const it of items) {
    const vf = it.matched_variant_id ? await getVariantFull(it.matched_variant_id) : undefined;
    out.push({
      item: it,
      name: vf?.card_name ?? "Unmatched",
      set: vf?.set_name ?? "",
      number: vf?.number ?? null,
      finish: vf?.finish ?? "",
      finishLabel: vf?.finish_label ?? "",
      image: it.image_url || vf?.image_small || null,
      market: vf ? await marketCentsAt(vf.id, it.grade) : null,
      slug: vf?.card_slug ?? "",
      card_id: vf?.card_id ?? 0,
    });
  }
  return out;
}

export async function renderPriced(batch: ScanBatch, items: ScanItem[], o: { isPublic: boolean; shareUrl: string | null; memberName: string; pro?: boolean; msg?: string }): Promise<Page> {
  const lines = await priceLines(items);
  const units = lines.reduce((n, l) => n + l.item.quantity, 0);
  const marketTotal = lines.reduce((n, l) => n + (l.market ?? 0) * l.item.quantity, 0);
  const matched = lines.filter((l) => l.item.matched_variant_id).length;

  const rows = lines
    .map(
      (l) => `<tr class="${l.item.matched_variant_id ? "" : "unmatched"}">
      <td class="thumb">${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : ""}</td>
      <td class="card">${l.card_id ? `<a href="/c/${esc(l.slug)}-${l.card_id}" target="_blank" rel="noopener">${esc(l.name)}</a>` : `<b>${esc(l.name)}</b>`}<div class="sub">${esc(l.set)}${l.number ? " · #" + esc(l.number) : ""}${l.finish ? " · " + finishChip({ finish: l.finish, finish_label: l.finishLabel }) : ""}${!l.item.matched_variant_id ? ` · <span class="mono">${esc(l.item.raw_input)}</span>` : ""}</div></td>
      <td>${esc(l.item.grade ?? l.item.condition)}</td>
      <td class="mono">${l.item.quantity}</td>
      <td class="mono">${money(l.market)}</td>
      <td class="mono">${l.market != null ? money(l.market * l.item.quantity) : "—"}</td>
    </tr>`
    )
    .join("");

  const table = `<div class="tablewrap"><table class="inv-table pricing-table"><thead><tr><th></th><th>Card</th><th>Cond.</th><th>Qty</th><th>Market</th><th>Line total</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="5"><b>${lines.length} card${lines.length === 1 ? "" : "s"}</b> · ${units} cop${units === 1 ? "y" : "ies"} · ${matched} matched</td><td class="mono"><b>${money(marketTotal)}</b></td></tr></tfoot></table></div>`;

  if (o.isPublic) {
    const html = `<div class="wrap ws public-pricing">
      <div class="ws-head"><div class="ws-title-row"><div><div class="eyebrow">Priced list · shared by ${esc(o.memberName)}</div><h1>${esc(batch.label || "Card prices")}</h1><p class="ws-sub">TCGplayer market prices from the CardIndex catalog, as of ${esc(batch.created_at.slice(0, 10))}. Prices are references, not offers.</p></div></div></div>
      ${table}
      <p class="hint" style="margin-top:14px">Priced with <a href="/">CardIndex</a> — the trading-card price guide for buyers and collectors. <a href="/collection/add?mode=price">Price your own cards free →</a></p>
    </div>`;
    return { html, title: `${batch.label || "Card prices"} — CardIndex`, description: "A shared, priced card list." };
  }

  const share = o.shareUrl
    ? `<div class="share-box"><span class="te-lbl">Share link</span><input type="text" readonly value="${esc(o.shareUrl)}" class="mono share-url" onclick="this.select()"><form method="post" action="/collection/priced/${batch.id}/unshare"><button class="btn sm ghost" type="submit">Stop sharing</button></form></div>`
    : `<form method="post" action="/collection/priced/${batch.id}/share"><button class="btn" type="submit">Create share link</button></form>`;

  const convert = o.pro
    ? `<form method="post" action="/collection/priced/${batch.id}/convert" onsubmit="return confirm('Turn this price check into a collection upload? You confirm the cards in review, then add them to your collection.')"><button class="btn primary" type="submit">Add these to my collection →</button></form>`
    : `<a class="btn primary" href="/pricing?upgrade=1" title="Your collection is part of Pro">Add these to my collection <span class="nav-pro">Pro</span></a>`;

  const html = `<div class="wrap ws">
    ${wsHead("price", batch.label || `Price check #${batch.id}`, `Valued at catalog market. ${matched < lines.length ? `${lines.length - matched} card${lines.length - matched === 1 ? "" : "s"} didn't match — fix them in review.` : "Every card matched."}`, `<a class="btn" href="/collection/review/${batch.id}">Review matches</a>${convert}`)}
    ${flash(o.msg)}
    <div class="pricing-actions">${share}<a class="btn" href="/collection/add?mode=price">← Price more cards</a></div>
    ${table}
    ${APP_JS}
  </div>`;
  return { html, title: `Price check #${batch.id} ${TITLE_SUFFIX}`, description: "Priced card list." };
}
