// The rest of the logged-in page set, modelled on CardUploader's sidebar
// (teardown Sept 3, 2026): Graded Cards, Listing Creator, Blank Listing
// Creator, Ungraded Pricing Tool (+ public share page), Card Search, Orders +
// Picklist, Automatic Inventory, Inbox. Server-rendered forms like app.ts;
// the shared chrome/helpers are imported from there.

import { esc, money } from "../util.ts";
import { query, getGames, getSetsForGame, getAllSets } from "../pg.ts";
import type { CardSet } from "../db.ts";
import { finishChip } from "./components.ts";
import {
  wsHead, flash, APP_JS, opt, conditionOptions, ruleOptions, setDatalist, matchingPanel,
} from "./app.ts";
import {
  getSeller, listBatchesOfKind, getVariantFull, marketCentsAt, listLiveListings, listBlankListings,
  type ScanBatch, type ScanItem,
} from "../app/store.ts";
import { ruleKey } from "../app/pricing.ts";
import { parseMatchingPrefs, prefsToForm, isEmptyPrefs } from "../app/matching.ts";
import { GRADERS, GRADE_VALUES, certUrl, certProviderName } from "../app/graded.ts";
import { ORDER_PLATFORMS, CARRIERS, platformLabel, type OrderWithItems } from "../app/orders.ts";
import { FEEDBACK_KINDS, FEEDBACK_TITLE_MAX, FEEDBACK_BODY_MAX, type Feedback } from "../app/feedback.ts";
import type { SearchParams, SearchResult } from "../search.ts";
import type { SalesParams, SalesResult } from "../sales.ts";
import { renderSales } from "./sales.ts";
import { EXPORT_FORMATS } from "../app/exporters.ts";
import { MAX_UPLOAD_FILES, MAX_UPLOAD_BYTES } from "../upload.ts";

type Page = { html: string; title: string; description: string };

// ---- Sales lookup (inside the workspace) ------------------------------------
// The public /sales page rendered inside the workspace chrome, so a seller
// checking comps doesn't lose the sidebar and the "Add cards" action.

export function renderSalesLookup(p: SalesParams, r: SalesResult, msg?: string): Page {
  const inner = renderSales(p, r, { base: "/app/sales-lookup", embedded: true });
  const html = `<div class="wrap ws">
    ${wsHead("sales", "Sales lookup", "Real sold prices from the archive — eBay, Goldin and Fanatics — with accepted Best Offer prices revealed. Same data as the public page, inside your workspace.")}
    ${flash(msg)}
    <div class="sales-embed">${inner.html}</div>
    ${APP_JS}
  </div>`;
  return {
    html,
    title: p.q ? `“${p.q}” sold prices — Seller workspace | CardIndex` : "Sales lookup — Seller workspace | CardIndex",
    description: "Sold-price lookup inside your seller workspace.",
  };
}
const dollars = (c: number | null | undefined): string => (c == null ? "" : (c / 100).toFixed(2));

// ---- Graded cards ---------------------------------------------------------

export async function renderGraded(msg?: string): Promise<Page> {
  const seller = await getSeller();
  const provider = certProviderName();
  const html = `<div class="wrap ws">
    ${wsHead("graded", "Graded cards", "Paste cert numbers — one per line, or a range like <span class=\"mono\">12345678-12345690</span> — and each slab is looked up, matched, priced at its grade, and queued for review.")}
    ${flash(msg)}
    <div class="scan-grid">
      <div class="scan-main">
        <form class="ws-panel" method="post" action="/app/graded">
          <div class="ws-panel-head"><h2>Certification numbers</h2><span class="eyebrow">PSA · CGC · BGS · SGC · TAG · ACE</span></div>
          <div class="grader-pick">${GRADERS.map(
            (g, i) => `<label class="grader-opt"><input type="radio" name="grader" value="${g.key}"${i === 0 ? " checked" : ""}><span><b>${g.key}</b><small>${esc(g.name)}</small></span></label>`
          ).join("")}</div>
          <label class="fld"><span>Cert numbers <small>up to 200 · ranges expand</small></span>
            <textarea name="certs" id="certs" rows="7" placeholder="12345678&#10;12345679-12345690&#10;98765432"></textarea>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. PSA submission #12"></label>
            <label class="fld"><span>Grade if lookup is unavailable</span><select name="grade_default">${opt("", "Choose in review", "")}${GRADE_VALUES.map((v) => opt(v, v, "")).join("")}</select></label>
          </div>
          <div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(seller.price_mode, seller.price_pct))}</select></label>
            <label class="fld"><span>SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit">Look up &amp; price →</button>
            <span class="hint" id="certCount">0 certs</span>
          </div>
        </form>
      </div>
      <aside class="ws-panel scan-side">
        <h2>How graded cards work</h2>
        <p>Each cert becomes one item. ${
          provider === "none"
            ? `<b>Cert lookup isn't connected yet</b> (set <span class="mono">CERT_PROVIDER</span>), so items land in review with the cert attached: pick the card, set the grade, done. The cert link opens the grader's own page for a quick check.`
            : `Certs resolve through the <b>${esc(provider)}</b> lookup provider; anything it can't read waits in review with the cert attached.`
        }</p>
        <p><b>Pricing at the grade.</b> When the catalog has a value for that printing at that grade (PSA 10 / 9 / 8, BGS 9.5, CGC 9.5 today) the rule applies to it; otherwise to raw market. Your previous price for the same card and grade is remembered.</p>
        <p><b>Listings</b> carry the grade in the title and item specifics (Graded: Yes, Professional Grader, Grade, Certification Number); eBay condition switches to graded automatically.</p>
        <h3 style="margin-top:14px">Cert lookups</h3>
        <ul class="linklist">${GRADERS.map((g) => `<li><b>${g.key}</b> — ${esc(g.name)}</li>`).join("")}</ul>
        <div class="seam-note"><span class="i">◆</span><div>Slab <b>QR / barcode scanning</b> from the camera is the next step here — it fills the same cert box.</div></div>
      </aside>
    </div>
    <script>(function(){var t=document.getElementById('certs'),c=document.getElementById('certCount');if(!t||!c)return;function n(){var v=t.value.split(/[\\s,;]+/).filter(Boolean);var extra=0;v.forEach(function(x){var m=x.match(/^(\\d{4,12})-(\\d{4,12})$/);if(m){var d=Number(m[2])-Number(m[1]);if(d>0&&d<=200)extra+=d;}});c.textContent=(v.length+extra)+' cert'+((v.length+extra)===1?'':'s');}t.addEventListener('input',n);n();})();</script>
    ${APP_JS}
  </div>`;
  return { html, title: "Graded cards — Seller workspace | CardIndex", description: "List graded cards from cert numbers." };
}

// ---- Listing creator (from the catalog, no photos) ------------------------

type CreatorCard = { id: number; name: string; number: string | null; rarity: string | null; image_small: string | null; price_cents: number | null };

async function cardsForSet(setId: number): Promise<CreatorCard[]> {
  return query<CreatorCard>(
    `SELECT c.id, c.name, c.number, c.rarity, c.image_small,
            (SELECT MAX(pp.price_cents) FROM card_variants v JOIN price_points pp ON pp.variant_id=v.id AND pp.kind='market' AND pp.grade IS NULL WHERE v.card_id=c.id) AS price_cents
     FROM cards c WHERE c.set_id=$1 ORDER BY c.number_sort, c.name`,
    [setId]
  );
}

export async function renderListingCreator(sel: { game?: string; set?: string }, msg?: string): Promise<Page> {
  const [seller, games] = await Promise.all([getSeller(), getGames()]);
  const game = games.find((g) => g.slug === sel.game) ?? games[0];
  const sets: CardSet[] = game ? await getSetsForGame(game.id) : [];
  const set = sets.find((s) => s.slug === sel.set);
  const cards = set ? await cardsForSet(set.id) : [];

  const table = set
    ? `<div class="tablewrap creator-table"><table class="inv-table"><thead><tr><th class="chk"><input type="checkbox" id="pickall" aria-label="Select all"></th><th></th><th>Card</th><th>Rarity</th><th>Market</th><th>Qty</th></tr></thead><tbody>${cards
        .map(
          (c) => `<tr>
          <td class="chk"><input type="checkbox" class="pick" name="card_${c.id}" value="1" aria-label="Add ${esc(c.name)}"></td>
          <td class="thumb">${c.image_small ? `<img src="${esc(c.image_small)}" alt="" loading="lazy">` : ""}</td>
          <td class="card"><b>${esc(c.name)}</b><div class="sub">#${esc(c.number ?? "—")}</div></td>
          <td>${esc(c.rarity ?? "")}</td>
          <td class="mono">${money(c.price_cents)}</td>
          <td><input type="number" name="qty_${c.id}" value="1" min="1" max="999" class="mono qty"></td>
        </tr>`
        )
        .join("")}</tbody></table></div>`
    : `<div class="ws-empty"><p>Pick a set to browse its cards, or search on the right.</p></div>`;

  const html = `<div class="wrap ws">
    ${wsHead("creator", "Listing creator", "Build listings from catalog stock images — no photos needed. Browse a set or search, tick the cards, set quantities, and they go straight to review priced.")}
    ${flash(msg)}
    <div class="creator-grid">
      <form class="ws-panel" method="post" action="/app/listing-creator" id="creatorForm">
        <div class="ws-panel-head"><h2>Browse sets</h2>
          <div class="creator-sel">
            <select name="game" id="gameSel" aria-label="Game">${games.map((g) => opt(g.slug, g.name, game?.slug ?? "")).join("")}</select>
            <select name="set" id="setSel" aria-label="Set">${opt("", "Choose a set…", set?.slug ?? "")}${sets.map((s) => opt(s.slug, `${s.name}${s.card_count ? " · " + s.card_count : ""}`, set?.slug ?? "")).join("")}</select>
          </div>
        </div>
        ${table}
        <div class="fld-row" style="margin-top:14px">
          <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. Base Set restock"></label>
          <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
          <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(seller.price_mode, seller.price_pct))}</select></label>
        </div>
        <textarea name="picks" id="picks" hidden></textarea>
        <div class="scan-submit">
          <button class="btn primary" type="submit" id="creatorSubmit">Add <span id="pickCount">0</span> cards → review</button>
          <span class="hint">Selected cards are priced with your rule and land in review as confirmed matches.</span>
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
      function nav(){var p=new URLSearchParams();p.set('game',gameSel.value);if(setSel.value)p.set('set',setSel.value);location.href='/app/listing-creator?'+p;}
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
  return { html, title: "Listing creator — Seller workspace | CardIndex", description: "Create listings from catalog cards." };
}

// ---- Blank listing creator ------------------------------------------------

export async function renderBlankListing(msg?: string): Promise<Page> {
  const [seller, recent] = await Promise.all([getSeller(), listBlankListings()]);
  const rows = recent
    .map(
      (l) => `<tr><td class="mono">${l.id}</td><td>${esc(l.title)}<div class="sub mono">${esc(l.sku ?? "")}</div></td><td>${esc(l.format)}</td><td class="mono">${money(l.price_cents)}</td><td class="mono">${l.quantity}</td><td><span class="pill ${esc(l.status)}">${esc(l.status)}</span></td><td class="act"><a class="btn sm" href="/app/export/ebay.csv?listings=${l.id}" target="_blank">CSV</a></td></tr>`
    )
    .join("");
  const html = `<div class="wrap ws">
    ${wsHead("blank", "Blank listing creator", "Free · add items by hand with no catalog lookup — sealed product, lots, accessories, or a card the catalog doesn't have yet.")}
    ${flash(msg)}
    <div class="scan-grid">
      <form class="ws-panel scan-main" method="post" action="/app/blank-listing">
        <div class="ws-panel-head"><h2>Item</h2><span class="eyebrow">no credits · no lookup</span></div>
        <label class="fld title-fld"><span>Title <small>80 max</small></span><input type="text" name="title" maxlength="80" required placeholder="e.g. Pokemon Base Set Booster Pack (Unlimited) Sealed"></label>
        <div class="fld-row">
          <label class="fld"><span>Listing type</span><select name="listing_type" id="ltype">${opt("single", "Singles (ungraded)", "single")}${opt("graded", "Graded", "single")}${opt("sealed", "Sealed / other", "single")}</select></label>
          <label class="fld"><span>Format</span><select name="format">${opt("fixed", "Fixed price", "fixed")}${opt("auction", "Auction", "fixed")}</select></label>
          <label class="fld"><span>Price ($)</span><input name="price" class="mono" inputmode="decimal" required placeholder="0.00"></label>
          <label class="fld"><span>Quantity</span><input type="number" name="quantity" value="1" min="1" class="mono"></label>
        </div>
        <div class="fld-row" data-single>
          <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
          <label class="fld"><span>eBay category</span><input name="category" value="183454" class="mono"> </label>
          <label class="fld"><span>SKU <small>blank = auto</small></span><input name="sku" class="mono" placeholder="${esc(seller.sku_prefix)}-…"></label>
        </div>
        <div class="fld-row" data-graded hidden>
          <label class="fld"><span>Grader</span><select name="grader">${opt("", "—", "")}${GRADERS.map((g) => opt(g.key, g.key, "")).join("")}</select></label>
          <label class="fld"><span>Grade</span><select name="grade_value">${opt("", "—", "")}${GRADE_VALUES.map((v) => opt(v, v, "")).join("")}</select></label>
          <label class="fld"><span>Cert number</span><input name="cert" class="mono"></label>
        </div>
        <h3 class="set-sub">Item specifics <small class="hint">optional — become eBay item specifics and Shopify tags</small></h3>
        <div class="fld-row">
          <label class="fld"><span>Game</span><input name="game" placeholder="Pokémon"></label>
          <label class="fld"><span>Set</span><input name="set" placeholder="Base Set"></label>
          <label class="fld"><span>Card name</span><input name="card_name"></label>
          <label class="fld"><span>Card number</span><input name="number" class="mono"></label>
          <label class="fld"><span>Rarity</span><input name="rarity"></label>
          <label class="fld"><span>Language</span><input name="language" value="English"></label>
        </div>
        <label class="fld"><span>Image URL <small>optional</small></span><input name="image_url" placeholder="https://…"></label>
        <label class="fld"><span>Description</span><textarea name="description" rows="6" placeholder="Leave blank to generate from the fields above."></textarea></label>
        <label class="fld"><span>Schedule (optional)</span><input type="datetime-local" name="scheduled_at"><input type="hidden" name="tz_offset" class="tz-offset"></label>
        <div class="list-actions"><button class="btn primary" type="submit">Create listing draft</button></div>
      </form>
      <aside class="ws-panel scan-side">
        <h2>What this is for</h2>
        <p>Anything you sell that isn't a single identified card: <b>sealed product, bundles, lots, supplies</b>, or a card the catalog hasn't added yet. Drafts sit alongside your other listings and export to eBay, TCGplayer, Whatnot and Shopify files with the same policies and templates.</p>
        <p>Blank listings don't touch inventory or SKU counters unless you give them a SKU, and they never train the identifier.</p>
        <div class="seam-note"><span class="i">◆</span><div>Default <b>item specifics</b> per job (CardUploader's "apply to all items") are the next addition here.</div></div>
      </aside>
    </div>
    ${recent.length ? `<div class="ws-panel"><div class="ws-panel-head"><h2>Blank listing drafts</h2><a href="/app/listings">All listings →</a></div><div class="tablewrap"><table class="inv-table"><thead><tr><th>#</th><th>Title</th><th>Format</th><th>Price</th><th>Qty</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>` : ""}
    <script>(function(){var t=document.getElementById('ltype');if(!t)return;function u(){var g=t.value==='graded';document.querySelector('[data-graded]').hidden=!g;}t.addEventListener('change',u);u();})();</script>
    ${APP_JS}
  </div>`;
  return { html, title: "Blank listing creator — Seller workspace | CardIndex", description: "Create listings without a catalog lookup." };
}

// ---- Ungraded pricing tool ------------------------------------------------
// The upload/paste forms now live on the Add cards page (render/app.ts,
// `mode=price`); this file keeps the priced results + public share page.

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

export async function renderPricingResults(
  batch: ScanBatch,
  items: ScanItem[],
  o: { isPublic: boolean; shareUrl: string | null; shopName: string; msg?: string }
): Promise<Page> {
  const lines = await priceLines(items);
  const units = lines.reduce((n, l) => n + l.item.quantity, 0);
  const marketTotal = lines.reduce((n, l) => n + (l.market ?? 0) * l.item.quantity, 0);
  const yourTotal = lines.reduce((n, l) => n + (l.item.price_cents ?? 0) * l.item.quantity, 0);
  const matched = lines.filter((l) => l.item.matched_variant_id).length;

  const rows = lines
    .map(
      (l) => `<tr class="${l.item.matched_variant_id ? "" : "unmatched"}">
      <td class="thumb">${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy">` : ""}</td>
      <td class="card">${l.card_id ? `<a href="/c/${esc(l.slug)}-${l.card_id}" target="_blank" rel="noopener">${esc(l.name)}</a>` : `<b>${esc(l.name)}</b>`}<div class="sub">${esc(l.set)}${l.number ? " · #" + esc(l.number) : ""}${l.finish ? " · " + finishChip({ finish: l.finish, finish_label: l.finishLabel }) : ""}${!l.item.matched_variant_id ? ` · <span class="mono">${esc(l.item.raw_input)}</span>` : ""}</div></td>
      <td>${esc(l.item.grade ?? l.item.condition)}</td>
      <td class="mono">${l.item.quantity}</td>
      <td class="mono">${money(l.market)}</td>
      ${o.isPublic ? "" : `<td class="mono">${money(l.item.price_cents)}</td>`}
      <td class="mono">${l.market != null ? money(l.market * l.item.quantity) : "—"}</td>
    </tr>`
    )
    .join("");

  const table = `<div class="tablewrap"><table class="inv-table pricing-table"><thead><tr><th></th><th>Card</th><th>Cond.</th><th>Qty</th><th>Market</th>${o.isPublic ? "" : "<th>Your price</th>"}<th>Line total</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="${o.isPublic ? 4 : 5}"><b>${lines.length} card${lines.length === 1 ? "" : "s"}</b> · ${units} unit${units === 1 ? "" : "s"} · ${matched} matched</td>${o.isPublic ? "" : `<td class="mono"><b>${money(yourTotal)}</b></td>`}<td class="mono"><b>${money(marketTotal)}</b></td></tr></tfoot></table></div>`;

  if (o.isPublic) {
    const html = `<div class="wrap ws public-pricing">
      <div class="ws-head"><div class="ws-title-row"><div><div class="eyebrow">Priced list · shared by ${esc(o.shopName)}</div><h1>${esc(batch.label || "Card pricing")}</h1><p class="ws-sub">TCGplayer-market prices from the CardIndex catalog, as of ${esc(batch.created_at.slice(0, 10))}. Prices are references, not offers.</p></div></div></div>
      ${table}
      <p class="hint" style="margin-top:14px">Priced with <a href="/">CardIndex</a> — the card price database you can upload to.</p>
    </div>`;
    return { html, title: `${batch.label || "Card pricing"} — CardIndex`, description: "A shared, priced card list." };
  }

  const share = o.shareUrl
    ? `<div class="share-box"><span class="te-lbl">Share link</span><input type="text" readonly value="${esc(o.shareUrl)}" class="mono share-url" onclick="this.select()"><form method="post" action="/app/pricing/${batch.id}/unshare"><button class="btn sm ghost" type="submit">Stop sharing</button></form></div>`
    : `<form method="post" action="/app/pricing/${batch.id}/share"><button class="btn" type="submit">Create share link</button></form>`;

  const html = `<div class="wrap ws">
    ${wsHead("pricing-tool", batch.label || `Pricing #${batch.id}`, `Priced against catalog market. ${matched < lines.length ? `${lines.length - matched} card${lines.length - matched === 1 ? "" : "s"} didn't match — fix them in review.` : "Every card matched."}`, `<a class="btn" href="/app/review/${batch.id}">Review matches</a><form method="post" action="/app/pricing/${batch.id}/convert" onsubmit="return confirm('Turn this pricing into an inventory batch? Cards will go through review and get SKUs when you add them.')"><button class="btn primary" type="submit">Turn into inventory batch →</button></form>`)}
    ${flash(o.msg)}
    <div class="pricing-actions">${share}<a class="btn" href="/app/scan?mode=price">← Price more cards</a></div>
    ${table}
    ${APP_JS}
  </div>`;
  return { html, title: `Pricing #${batch.id} — Seller workspace | CardIndex`, description: "Priced card list." };
}

// ---- Card search (in-app) -------------------------------------------------

export function renderCardSearch(p: SearchParams, r: SearchResult, msg?: string): Page {
  const sel = (opts: Array<{ key: string; label: string; count: number; active: boolean }>, name: string, all: string) =>
    `<select name="${name}" onchange="this.form.submit()">${opt("", all, "")}${opts.map((o) => opt(o.key, `${o.label} (${o.count})`, o.active ? o.key : "")).join("")}</select>`;
  const rows = r.rows
    .map(
      (c) => `<tr>
      <td class="thumb">${c.image_small ? `<img src="${esc(c.image_small)}" alt="" loading="lazy">` : ""}</td>
      <td class="card"><a href="/c/${esc(c.slug)}-${c.id}" target="_blank" rel="noopener">${esc(c.name)}</a><div class="sub">${esc(c.set_name)}${c.number ? " · #" + esc(c.number) : ""} · ${esc(c.game_name)}</div></td>
      <td>${esc(c.rarity ?? "")}</td>
      <td>${esc(c.artist ?? "")}</td>
      <td class="mono">${money(c.price_cents)}${r.gradeApplied ? `<div class="mkt">${esc(r.gradeApplied)}</div>` : ""}</td>
      <td class="act"><form method="post" action="/app/listing-creator" class="inline"><input type="hidden" name="picks" value="${c.id},1"><input type="hidden" name="quick" value="1"><button class="btn sm" type="submit" title="Add one to a new review batch">+ Add</button></form></td>
    </tr>`
    )
    .join("");
  const html = `<div class="wrap ws">
    ${wsHead("card-search", "Card search", "Search the catalog with market prices — filter by game, set and rarity, then add cards straight to a review batch. Grades in the query (\"charizard psa 10\") reprice the results.")}
    ${flash(msg)}
    <form class="ws-panel cs-form" method="get" action="/app/card-search">
      <div class="cs-row">
        <input type="search" name="q" value="${esc(p.q ?? "")}" placeholder="Name, number, set, grade… e.g. charizard 4/102 base set" aria-label="Search" class="cs-q">
        <button class="btn primary" type="submit">Search</button>
      </div>
      <div class="cs-row">
        ${sel(r.facets.game, "game", "All games")}${sel(r.facets.set, "set", "All sets")}${sel(r.facets.rarity, "rarity", "Any rarity")}
        <select name="sort" onchange="this.form.submit()">${opt("", "Relevance", p.sort ?? "")}${opt("price_desc", "Price: high → low", p.sort ?? "")}${opt("price_asc", "Price: low → high", p.sort ?? "")}${opt("name", "Name", p.sort ?? "")}</select>
      </div>
      ${r.parsedChips.length ? `<div class="cs-chips">${r.parsedChips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
    </form>
    <p class="hint">${r.total} result${r.total === 1 ? "" : "s"}${r.fuzzyFor ? ` · showing close matches for “${esc(r.fuzzyFor)}”` : ""} · prices are TCGplayer NM market${r.gradeApplied ? ` at ${esc(r.gradeApplied)}` : ""}.</p>
    ${r.rows.length ? `<div class="tablewrap"><table class="inv-table"><thead><tr><th></th><th>Card</th><th>Rarity</th><th>Artist</th><th>Market</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="ws-empty"><p>No cards match. Try fewer words, or a number like <span class="mono">4/102</span>.</p></div>`}
    ${r.totalPages > 1 ? `<div class="cs-pager">${r.page > 1 ? `<a class="btn sm" href="/app/card-search?${new URLSearchParams({ ...(p.q ? { q: p.q } : {}), ...(p.game ? { game: p.game } : {}), ...(p.set ? { set: p.set } : {}), ...(p.rarity ? { rarity: p.rarity } : {}), ...(p.sort ? { sort: p.sort } : {}), page: String(r.page - 1) })}">← Prev</a>` : ""}<span class="hint">Page ${r.page} of ${r.totalPages}</span>${r.page < r.totalPages ? `<a class="btn sm" href="/app/card-search?${new URLSearchParams({ ...(p.q ? { q: p.q } : {}), ...(p.game ? { game: p.game } : {}), ...(p.set ? { set: p.set } : {}), ...(p.rarity ? { rarity: p.rarity } : {}), ...(p.sort ? { sort: p.sort } : {}), page: String(r.page + 1) })}">Next →</a>` : ""}</div>` : ""}
    ${APP_JS}
  </div>`;
  return { html, title: "Card search — Seller workspace | CardIndex", description: "Search the catalog with prices." };
}

// ---- Orders ---------------------------------------------------------------

export function renderOrders(orders: OrderWithItems[], f: { platform: string; status: string }, ebay: { connected: boolean; lastSync: string | null }, msg?: string): Page {
  const counts = new Map<string, number>();
  for (const o of orders) counts.set(o.platform, (counts.get(o.platform) ?? 0) + 1);
  const tab = (key: string, label: string, cur: boolean, param: string, other: string) =>
    `<a href="/app/orders?${new URLSearchParams({ [param]: key, ...(param === "platform" ? { status: other } : { platform: other }) })}" class="${cur ? "active" : ""}">${label}</a>`;
  const platformTabs = `<div class="tabs">${tab("all", "All", f.platform === "all", "platform", f.status)}${ORDER_PLATFORMS.map((p) => tab(p.key, p.label + (p.live ? "" : " (soon)"), f.platform === p.key, "platform", f.status)).join("")}</div>`;
  const statusTabs = `<div class="tabs">${[["pending", "Pending"], ["picked", "Picked"], ["shipped", "Shipped"], ["all", "All"]].map(([k, l]) => tab(k, l, f.status === k, "status", f.platform)).join("")}</div>`;

  const cards = orders.length
    ? orders
        .map((o) => {
          const items = o.items
            .map(
              (it) => `<tr class="${it.picked ? "picked" : ""}">
            <td class="chk">${o.status === "shipped" ? "✓" : `<form method="post" action="/app/orders/${o.id}/pick" class="inline"><input type="hidden" name="item" value="${it.id}"><input type="hidden" name="picked" value="${it.picked ? "0" : "1"}"><button type="submit" class="pickbtn${it.picked ? " on" : ""}" title="${it.picked ? "Un-pick" : "Mark picked"}">${it.picked ? "✓" : ""}</button></form>`}</td>
            <td class="thumb">${it.image_small ? `<img src="${esc(it.image_small)}" alt="" loading="lazy">` : ""}</td>
            <td class="card"><b>${esc(it.card_name ? `${it.card_name}${it.number ? " #" + it.number : ""}` : it.title)}</b><div class="sub">${esc(it.card_name ? `${it.set_name ?? ""}` : "")}${it.inventory_id == null ? `<span class="warn">not in inventory</span>` : `in stock ${it.in_stock ?? 0}`}</div></td>
            <td class="mono sku">${esc(it.sku ?? "—")}</td>
            <td class="mono">${it.quantity}</td>
            <td class="mono">${money(it.price_cents)}</td>
          </tr>`
            )
            .join("");
          return `<div class="order ws-panel status-${esc(o.status)}">
          <div class="order-head">
            <div><span class="mono bid">#${o.id}</span> <span class="pill ${esc(o.platform)}">${esc(platformLabel(o.platform))}</span> <span class="pill ${esc(o.status)}">${esc(o.status)}</span>${o.external_ref ? ` <span class="mono hint">${esc(o.external_ref)}</span>` : ""}</div>
            <div class="order-meta">${o.buyer ? `<b>${esc(o.buyer)}</b> · ` : ""}${esc(o.created_at.slice(0, 10))}${o.total_cents != null ? ` · <span class="mono">${money(o.total_cents)}</span>` : ""}</div>
          </div>
          ${o.ship_to ? `<div class="hint">Ship to: ${esc(o.ship_to)}</div>` : ""}
          <div class="tablewrap"><table class="inv-table order-items"><tbody>${items}</tbody></table></div>
          <div class="order-actions">
            ${
              o.status !== "shipped"
                ? `<form method="post" action="/app/orders/${o.id}/ship" class="ship-form" onsubmit="return confirm('Mark shipped? Quantities come off inventory.')">
                    <select name="carrier" aria-label="Carrier">${CARRIERS.map((c) => opt(c, c, "USPS")).join("")}</select>
                    <input name="tracking" placeholder="Tracking # (optional)" class="mono" aria-label="Tracking number">
                    <button class="btn sm primary" type="submit">Mark shipped</button>
                  </form><form method="post" action="/app/orders/${o.id}/delete" onsubmit="return confirm('Delete this order?')"><button class="btn sm ghost" type="submit">Delete</button></form>`
                : `<span class="hint">Shipped ${esc((o.shipped_at ?? "").slice(0, 10))}${o.tracking_number ? ` · ${esc(o.tracking_carrier ?? "")} <span class="mono">${esc(o.tracking_number)}</span>` : ""}</span>`
            }
            ${o.note ? `<span class="hint">${esc(o.note)}</span>` : ""}
          </div>
        </div>`;
        })
        .join("")
    : `<div class="ws-empty"><h3>No ${f.status === "all" ? "" : f.status + " "}orders</h3><p>Add one by hand, upload a TCGplayer pull sheet, or connect a marketplace.</p></div>`;

  const html = `<div class="wrap ws">
    ${wsHead("orders", "Orders", "Pending orders across channels, a picklist for chaos-sorted stock, and quantities that come off inventory when you ship.", `<a class="btn" href="/app/orders/picklist" target="_blank">Picklist</a>`)}
    ${flash(msg)}
    <div class="order-tools">
      ${
        ebay.connected
          ? `<form method="post" action="/app/orders/fetch-ebay" class="inline"><button class="btn primary" type="submit" title="Pull open orders from eBay (Fulfillment API)${ebay.lastSync ? " · last " + esc(ebay.lastSync.slice(0, 16).replace("T", " ")) : ""}">Fetch eBay orders</button></form>`
          : `<a class="btn" href="/app/settings#s-ebay" title="Connect your eBay account to pull orders">Fetch eBay orders</a>`
      }
      <button class="btn" type="button" disabled title="Needs a Mana Pool API connection — next integration">Fetch Mana Pool</button>
      <details class="tool-dd"><summary class="btn">Upload TCGplayer pull sheet</summary>
        <form method="post" action="/app/orders/import" enctype="multipart/form-data" class="tool-form">
          <p class="hint">The CSV from TCGplayer's Seller Portal (pull sheet or shipping export). Lines match your inventory by SKU, then by card name + number; one order per order number.</p>
          <input type="file" name="csv" accept=".csv,text/csv" required>
          <button class="btn sm primary" type="submit">Import</button>
        </form>
      </details>
      <details class="tool-dd"><summary class="btn">+ Add order</summary>
        <form method="post" action="/app/orders" class="tool-form">
          <div class="fld-row">
            <label class="fld"><span>Channel</span><select name="platform">${ORDER_PLATFORMS.map((p) => opt(p.key, p.label, "manual")).join("")}</select></label>
            <label class="fld"><span>Order ref</span><input name="external_ref" placeholder="e.g. 12-34567-89012"></label>
            <label class="fld"><span>Buyer</span><input name="buyer"></label>
          </div>
          <label class="fld"><span>Ship to</span><input name="ship_to" placeholder="City, ST"></label>
          <label class="fld"><span>Items <small>one per line: SKU, qty, price — e.g. <span class="mono">CARD-000012, 2, 4.50</span></small></span><textarea name="items" rows="4" required></textarea></label>
          <button class="btn sm primary" type="submit">Create order</button>
        </form>
      </details>
    </div>
    <div class="inv-toolbar">${platformTabs}${statusTabs}</div>
    ${cards}
    ${
      ebay.connected
        ? `<p class="hint">eBay orders arrive here with <b>Fetch eBay orders</b> (open orders only; already-imported ones are skipped). Marking an eBay order shipped also tells eBay. Shipping a non-eBay order pushes the new quantity to your live eBay listings.</p>`
        : `<div class="seam-note"><span class="i">◆</span><div><b>Live order sync</b> — connect eBay (Settings → eBay) for Fulfillment-API orders; Mana Pool and Shopify plug into this same table next. Pick/ship and the inventory decrement already work for imported and manual orders.</div></div>`
    }
    ${APP_JS}
  </div>`;
  return { html, title: "Orders — Seller workspace | CardIndex", description: "Orders and picklists." };
}

export function renderPicklist(rows: Array<{ sku: string | null; title: string; quantity: number; orders: string; in_stock: number | null; image_small: string | null }>): Page {
  const body = rows
    .map(
      (r) => `<tr><td class="mono"><b>${esc(r.sku ?? "—")}</b></td><td>${r.image_small ? `<img src="${esc(r.image_small)}" alt="">` : ""} ${esc(r.title)}</td><td class="mono big">${r.quantity}</td><td class="mono">${r.in_stock ?? "—"}</td><td class="mono">${esc(r.orders)}</td><td class="box">☐</td></tr>`
    )
    .join("");
  const html = `<div class="wrap ws picklist">
    <div class="ws-head"><div class="ws-title-row"><div><div class="eyebrow">Picklist · ${new Date().toISOString().slice(0, 10)}</div><h1>Cards to pull</h1><p class="ws-sub">${rows.length} SKU${rows.length === 1 ? "" : "s"} across pending orders, sorted by SKU so a chaos-sorted box is one pass.</p></div><div class="ws-actions noprint"><button class="btn" type="button" onclick="window.print()">Print</button><a class="btn" href="/app/orders">← Orders</a></div></div></div>
    ${rows.length ? `<table class="pick-table"><thead><tr><th>SKU</th><th>Card</th><th>Pull</th><th>In stock</th><th>Orders</th><th></th></tr></thead><tbody>${body}</tbody></table>` : `<div class="ws-empty"><p>Nothing to pick — every pending item is already picked.</p></div>`}
  </div>`;
  return { html, title: "Picklist — Seller workspace | CardIndex", description: "Cards to pull for pending orders." };
}

// ---- Automatic inventory --------------------------------------------------

export async function renderAutomaticInventory(msg?: string): Promise<Page> {
  const rows = await listLiveListings();
  const body = rows
    .map(
      (l) => `<tr>
      <td class="thumb">${l.image_small ? `<img src="${esc(l.image_small)}" alt="" loading="lazy">` : ""}</td>
      <td class="card"><b>${esc(l.title)}</b><div class="sub mono">${esc(l.sku ?? "")}</div></td>
      <td><span class="pill ${esc(l.marketplace)}">${esc(l.marketplace)}</span></td>
      <td class="mono">${money(l.price_cents)}</td>
      <td class="mono">${l.quantity}${l.in_stock != null && l.in_stock !== l.quantity ? `<div class="mkt warn">stock ${l.in_stock}</div>` : ""}</td>
      <td><span class="pill ${esc(l.status)}">${esc(l.status)}</span></td>
      <td class="act"><form method="post" action="/app/inventory/automatic/${l.id}" class="inline">${l.status === "exported" ? `<button class="btn sm" name="status" value="published" type="submit">Mark live</button>` : ""}<button class="btn sm ghost" name="status" value="ended" type="submit">End</button></form></td>
    </tr>`
    )
    .join("");
  const html = `<div class="wrap ws">
    ${wsHead("automatic", "Automatic inventory", "Listings that are live (or exported to go live) per channel. When a marketplace is connected, this page keeps quantities in sync both ways; today it tracks what you've exported and what sold.", `<span class="pill listed">BETA</span>`)}
    ${flash(msg)}
    ${rows.length ? `<div class="tablewrap"><table class="inv-table"><thead><tr><th></th><th>Listing</th><th>Channel</th><th>Price</th><th>Qty</th><th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="ws-empty"><h3>Nothing live yet</h3><p>Export listings from <a href="/app/listings">Listings</a> — exported rows show up here; mark them live once the marketplace import finishes.</p></div>`}
    <div class="seam-note"><span class="i">◆</span><div><b>Engine sync</b> (eBay Feed/Inventory API, Mana Pool, Shopify) is the integration this page is built for: marking a copy Listed / Not listed / Sold in Inventory would push quantity to each connected channel. Until then, ship orders here and the quantities follow.</div></div>
    ${APP_JS}
  </div>`;
  return { html, title: "Automatic inventory — Seller workspace | CardIndex", description: "Live listings per channel." };
}

// ---- Inbox / feedback -----------------------------------------------------

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
    ${wsHead("inbox", "Inbox", "Send feedback, report a problem, or tell us a card is missing from the catalog — replies land here.")}
    ${flash(msg)}
    <div class="home-grid">
      <div>${list}</div>
      <form class="ws-panel" method="post" action="/app/inbox">
        <div class="ws-panel-head"><h2>Send a note</h2></div>
        <label class="fld"><span>Type</span><select name="kind">${FEEDBACK_KINDS.map((k) => opt(k.key, k.label, "feedback")).join("")}</select></label>
        <label class="fld"><span>Title</span><input name="title" maxlength="${FEEDBACK_TITLE_MAX}" required placeholder="Short summary"></label>
        <label class="fld"><span>Details</span><textarea name="body" rows="6" maxlength="${FEEDBACK_BODY_MAX}" placeholder="What happened, which card or batch, what you expected…"></textarea></label>
        <button class="btn primary" type="submit">Send</button>
        <p class="hint" style="margin-top:10px">Missing card? Include the game, set and card number and it's added on the next catalog sync.</p>
      </form>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: "Inbox — Seller workspace | CardIndex", description: "Feedback and replies." };
}

export { EXPORT_FORMATS };
