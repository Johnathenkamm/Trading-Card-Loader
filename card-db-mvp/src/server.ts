import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, sep } from "node:path";
import { getGameBySlug, getSetBySlug, getCard, getVariants, latestMarket, pool } from "./pg.ts";
import { ebayConfigured, searchListed } from "./ebay.ts";
import { tcgConfigured, conditionPrices } from "./tcgplayer.ts";
import { page } from "./render/layout.ts";
import {
  renderHome,
  renderBrowse,
  renderSet,
  renderCard,
  renderSearch,
  sitemapUrls,
} from "./render/pages.ts";
import { search, suggest, type SearchParams } from "./search.ts";
import { searchSales, type SalesParams } from "./sales.ts";
import { renderSales } from "./render/sales.ts";
import { money } from "./util.ts";

// ---- seller-workspace wiring ----------------------------------------------
import { identify, type IdentifyOptions } from "./app/identify.ts";
import { resolvePrice, parseRuleKey, parseAutoPricePref, applyFloor } from "./app/pricing.ts";
import {
  getSeller, updateSeller, createBatch, addItemFromIdentify, detectDuplicates, finalizeBatch,
  getItems, getItem, updateItem, replaceMatch, commitBatch,
  getInventoryItem, listInventory, updateInventory, createListing, previousPrice, marketCents,
  ensureWorkspaceSchema,
  type Seller,
} from "./app/store.ts";
import {
  toEbayCsv, parseDescriptionTemplates, serializeDescriptionTemplates, fillDescriptionTemplate, DESCRIPTION_TEMPLATE_MAX,
} from "./app/listing.ts";
import { parseStructure, serializeStructure, renderStructuredTitle, DEFAULT_STRUCTURE } from "./app/title.ts";
import { exportRowsFor, inventoryListingPreview, scanItemTitle, sampleTitleFields, sellerTitle } from "./app/compose.ts";
import { prefsFromForm, serializeMatchingPrefs, isEmptyPrefs, type MatchingPrefs } from "./app/matching.ts";
import { getAllSets } from "./pg.ts";
import {
  renderWorkspaceHome, renderInventory, renderBatches, renderScan, renderReview, renderListingBuilder, renderListings, renderSettings,
} from "./render/app.ts";
import {
  renderGraded, renderListingCreator, renderBlankListing, renderPricingTool, renderPricingResults, renderCardSearch,
  renderOrders, renderPicklist, renderAutomaticInventory, renderInbox,
} from "./render/workspace2.ts";
import {
  addItemFromCatalog, shareBatch, unshareBatch, getBatchByToken, getItemsPublic, setBatchKind, getBatch,
  getListings, listBlankListings, markListingsExported, setListingStatus, marketCentsAt,
} from "./app/store.ts";
import { parseCerts, lookupCert, gradeLabel, graderOf, GRADE_VALUES } from "./app/graded.ts";
import {
  ensureOrdersSchema, createOrder, listOrders, setItemPicked, shipOrder, deleteOrder, importPullSheet, picklist, getOrderWithItems, existingRefs,
} from "./app/orders.ts";
import {
  ensureEbaySchema, ebaySellConfigured, beginConnect, completeConnect, disconnect as ebayDisconnect, syncPolicies, setPolicyIds, ensureLocation,
  getConnection, publishListing, endListing, syncQuantityForInventory, fetchOpenOrders, markShippedOnEbay, touchOrderSync, EbayError,
} from "./app/ebay-sell.ts";
import { ensureFeedbackSchema, submitFeedback, listFeedback } from "./app/feedback.ts";
import {
  itemsFromRows, itemFromBlankListing, ebayCsv, tcgplayerCsv, whatnotCsv, shopifyCsv, parseChannelPrefs, channelPrefsFromForm,
} from "./app/exporters.ts";
import { formatSku } from "./app/sku.ts";
import { parseInput, type IdentifyResult } from "./app/identify.ts";
import { readBodyBuffer, parseMultipart, boundaryOf, isImage, hintFromFilename, MAX_UPLOAD_FILES, type UploadedFile } from "./upload.ts";
import { storage, keyFor, localUploadsDir, contentTypeForExt } from "./storage.ts";
import { visionIdentify } from "./app/vision.ts";

// ---- auth & accounts ------------------------------------------------------
import {
  ensureAuthSchema, authenticate, createAccount, createSession, destroySession,
  sellerForSession, getAccount, parseCookies, sessionCookie, clearSessionCookie,
  SESSION_COOKIE, AuthError,
} from "./app/auth.ts";
import { runWithSeller, runWithRequest, currentAccount, type HeaderAccount } from "./app/session-context.ts";
import { renderLogin, renderSignup, safeNext } from "./render/auth.ts";
import { ensureBillingSchema, planTier, isPro } from "./app/billing.ts";
import { renderPricing } from "./render/pricing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);

// Fail fast with a helpful message if Postgres isn't reachable.
try {
  await pool.query("SELECT 1");
} catch {
  console.error(
    `\n  Cannot connect to Postgres via DATABASE_URL.\n  Start it:   npm run db:up\n  Load data:  npm run seed && npm run pg:migrate\n`
  );
  process.exit(1);
}

// Bring the account/session schema up to date (idempotent) so login works
// against a database provisioned before this feature existed.
try {
  await ensureAuthSchema();
} catch (err) {
  console.error("\n  Failed to prepare the auth schema (sellers.password_hash / sessions).\n", err);
  process.exit(1);
}

// Prepare the billing/plan bits (idempotent): ensure sellers.plan_tier exists and
// grandfather any pre-existing accounts to Pro once, so shipping the paywall never
// locks a current user out. See app/billing.ts.
try {
  await ensureBillingSchema();
} catch (err) {
  console.error("\n  Failed to prepare the billing schema (sellers.plan_tier / meta).\n", err);
  process.exit(1);
}

// Workspace preference columns (matching defaults, automatic pricing, description
// templates) — idempotent, same pattern as the auth/billing bootstraps.
try {
  await ensureWorkspaceSchema();
  await ensureOrdersSchema();
  await ensureFeedbackSchema();
  await ensureEbaySchema();
} catch (err) {
  console.error("\n  Failed to prepare the workspace schema (seller prefs, graded columns, orders, feedback).\n", err);
  process.exit(1);
}

const STYLES = readFileSync(join(here, "..", "public", "styles.css"), "utf8");

function send(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": type.startsWith("text/htm") || type.startsWith("application/json") ? "no-cache" : type.startsWith("text/") ? "no-cache" : "public, max-age=300",
  });
  res.end(body);
}

function sendPage(res: ServerResponse, rendered: { html: string; title: string; description: string }, canonical: string) {
  send(res, 200, page({ ...rendered, canonical }));
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { location });
  res.end();
}

/** Redirect while setting (or clearing) the session cookie. */
function redirectWithCookie(res: ServerResponse, location: string, cookie: string) {
  res.writeHead(303, { location, "set-cookie": cookie });
  res.end();
}

/**
 * Resolve the logged-in account from the session cookie. Returns null instantly
 * (no DB hit) when there is no cookie — so logged-out visitors and crawlers on
 * the public catalog pay nothing.
 */
async function resolveAccount(req: IncomingMessage): Promise<HeaderAccount> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const sellerId = await sellerForSession(token);
  if (!sellerId) return null;
  const acct = await getAccount(sellerId);
  return acct ? { id: acct.id, display_name: acct.display_name } : null;
}

function notFound(res: ServerResponse) {
  const html = page({
    title: "Not found — CardIndex",
    description: "Page not found.",
    canonical: "/",
    body: `<div class="wrap"><div class="empty"><h1>404</h1><p>That page doesn’t exist. <a href="/">Go home</a> or <a href="/search">search</a>.</p></div></div>`,
  });
  send(res, 404, html);
}

function num(v: string | null): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ---- POST helpers ---------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 4_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      data += c;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseForm(body: string): Record<string, string> {
  const p = new URLSearchParams(body);
  const o: Record<string, string> = {};
  for (const [k, v] of p) o[k] = v;
  return o;
}

const intOr = (v: unknown, def: number): number => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : def;
};
const toCents = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/** Redirect back to the referring page when it's a review page, else fallback. */
function redirectBack(req: IncomingMessage, res: ServerResponse, fallback: string) {
  const ref = req.headers.referer;
  if (ref && /\/app\/review\/\d+/.test(ref)) return redirect(res, ref);
  redirect(res, fallback);
}

// ---- app: mutations -------------------------------------------------------

/**
 * Read the Advanced Matching Options fields off a scan form (set names resolve
 * against the catalog), persisting them as the seller's defaults on request.
 */
async function matchingFromForm(f: Record<string, string>): Promise<MatchingPrefs> {
  const prefs = prefsFromForm(f, await getAllSets());
  if (f.save_matching === "1") await updateSeller({ matching_prefs: serializeMatchingPrefs(prefs) });
  return prefs;
}
const identifyOpts = (p: MatchingPrefs): IdentifyOptions => (isEmptyPrefs(p) ? {} : p);

/** Where a finished batch goes: pricing batches to their results page, the rest to review. */
const batchLanding = (kind: string, batchId: number): string => (kind === "pricing" ? `/app/pricing/${batchId}` : `/app/review/${batchId}`);
const scanPageFor = (kind: string): string => (kind === "pricing" ? "/app/pricing-tool" : "/app/scan");

/** Generate titles for every matched item (after any batch build). */
async function titleBatch(batchId: number, seller: Seller): Promise<void> {
  for (const it of await getItems(batchId))
    if (it.matched_variant_id) await updateItem(it.id, { title: await scanItemTitle(it, seller) });
}

async function handleScan(f: Record<string, string>, kind = "scan"): Promise<string> {
  const base = await getSeller();
  const rr = parseRuleKey(f.rule || "market");
  const condition = f.condition || base.default_condition;
  const language = f.language || base.default_language;

  // SKU prefix is a global counter setting — persist whenever changed.
  if (f.sku_prefix && f.sku_prefix.trim() && f.sku_prefix.trim() !== base.sku_prefix) {
    await updateSeller({ sku_prefix: f.sku_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "CARD" });
  }
  if (f.save_defaults === "1") {
    await updateSeller({ default_condition: condition, default_language: language, price_mode: rr.mode, price_pct: rr.pct });
  }
  const matching = identifyOpts(await matchingFromForm(f));

  const seller: Seller = { ...(await getSeller()), default_condition: condition, default_language: language, price_mode: rr.mode, price_pct: rr.pct };

  const lines = (f.lines || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 500);

  if (!lines.length) return scanPageFor(kind) + "?msg=" + encodeURIComponent("Paste at least one card line.");

  const batchId = await createBatch("paste", f.label?.trim() || null, kind);
  for (const line of lines) {
    const result = await identify(line, matching);
    await addItemFromIdentify(batchId, line, result, seller);
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  await titleBatch(batchId, seller);
  return batchLanding(kind, batchId);
}

/**
 * Graded Cards: one item per cert. With a lookup provider the cert resolves to a
 * card hint + grade; otherwise the item waits in review carrying the cert, and
 * the seller picks the card and grade (link-out to the grader for verification).
 */
async function handleGraded(f: Record<string, string>): Promise<string> {
  const base = await getSeller();
  const grader = graderOf(f.grader)?.key ?? "PSA";
  const { certs } = parseCerts(f.certs ?? "");
  if (!certs.length) return "/app/graded?msg=" + encodeURIComponent("Paste at least one cert number.");
  const rr = parseRuleKey(f.rule || "market");
  if (f.sku_prefix && f.sku_prefix.trim() && f.sku_prefix.trim() !== base.sku_prefix) {
    await updateSeller({ sku_prefix: f.sku_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "CARD" });
  }
  const seller: Seller = { ...(await getSeller()), price_mode: rr.mode, price_pct: rr.pct };
  const defaultGrade = GRADE_VALUES.includes(f.grade_default ?? "") ? gradeLabel(grader, f.grade_default) : null;

  const batchId = await createBatch("certs", f.label?.trim() || null, "graded");
  for (const cert of certs) {
    const lk = await lookupCert(grader, cert);
    const grade = lk.grade ?? defaultGrade;
    let result: IdentifyResult;
    if (lk.hint) result = await identify(lk.hint);
    else result = { parsed: parseInput(""), best: null, alternatives: [], confidence: 0, status: "needs_review" };
    if (result.status === "failed") result = { ...result, status: "needs_review" };
    const raw = `${grader} ${cert}${lk.hint ? " · " + lk.hint : ""}`;
    await addItemFromIdentify(batchId, raw, result, seller, { grade, grader, cert });
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  await titleBatch(batchId, seller);
  return `/app/review/${batchId}`;
}

/**
 * Listing Creator / Card Search "Add": chosen catalog cards → confirmed items.
 * Picks arrive as `picks` lines ("cardId,qty") and/or checkbox fields
 * card_<id> with qty_<id>.
 */
async function handleCreator(f: Record<string, string>): Promise<string> {
  const base = await getSeller();
  const rr = parseRuleKey(f.rule || ruleKeyOf(base));
  const condition = f.condition || base.default_condition;
  const seller: Seller = { ...base, default_condition: condition, price_mode: rr.mode, price_pct: rr.pct };
  const picks = new Map<number, number>();
  for (const line of (f.picks ?? "").split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s*,\s*(\d+)?/);
    if (m) picks.set(Number(m[1]), Math.max(1, Number(m[2] || 1)) + (picks.get(Number(m[1])) ?? 0));
  }
  for (const k of Object.keys(f)) {
    const m = k.match(/^card_(\d+)$/);
    if (m && f[k]) picks.set(Number(m[1]), Math.max(1, intOr(f[`qty_${m[1]}`], 1)) + (picks.get(Number(m[1])) ?? 0));
  }
  if (!picks.size) return "/app/listing-creator?msg=" + encodeURIComponent("Pick at least one card.");
  const batchId = await createBatch("catalog", f.label?.trim() || (f.quick === "1" ? "Card search pick" : null), "creator");
  let added = 0;
  for (const [cardId, qty] of picks) {
    const vs = await getVariants(cardId);
    const v = vs.find((x) => x.is_default) ?? vs[0];
    if (!v) continue;
    if (await addItemFromCatalog(batchId, v.id, seller, { quantity: qty, condition })) added++;
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  await titleBatch(batchId, seller);
  return `/app/review/${batchId}?msg=` + encodeURIComponent(`${added} card${added === 1 ? "" : "s"} added from the catalog — confirm and add to inventory.`);
}
const ruleKeyOf = (s: Seller): string => (s.price_mode === "fixed" ? "fixed" : s.price_mode === "pct" ? `pct:${s.price_pct}` : "market");

/** Blank Listing Creator: a listing draft with no catalog row behind it. */
async function handleBlank(f: Record<string, string>): Promise<string> {
  const seller = await getSeller();
  const title = (f.title ?? "").trim().slice(0, 80);
  if (!title) return "/app/blank-listing?msg=" + encodeURIComponent("A title is required.");
  const price = toCents(f.price);
  const format = f.format === "auction" ? "auction" : "fixed";
  const graded = f.listing_type === "graded" && f.grader && f.grade_value;
  const specifics: Record<string, string> = {};
  const put = (k: string, v: string | undefined) => {
    if (v && v.trim()) specifics[k] = v.trim();
  };
  put("Game", f.game);
  put("Set", f.set);
  put("Card Name", f.card_name);
  put("Card Number", f.number);
  put("Rarity", f.rarity);
  put("Language", f.language);
  if (graded) {
    specifics["Graded"] = "Yes";
    specifics["Professional Grader"] = String(f.grader).toUpperCase();
    specifics["Grade"] = String(f.grade_value);
    put("Certification Number", f.cert);
  } else {
    specifics["Graded"] = "No";
    const cond = f.condition || seller.default_condition;
    specifics["Card Condition"] = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged" }[cond] ?? cond;
  }
  let sku = (f.sku ?? "").trim();
  if (!sku) {
    sku = formatSku(seller.sku_prefix, seller.sku_next, seller.sku_pad);
    await updateSeller({ sku_next: seller.sku_next + 1 });
  }
  const description = (f.description ?? "").trim() || [title, "", ...Object.entries(specifics).filter(([k]) => k !== "Graded").map(([k, v]) => `${k}: ${v}`)].join("\n");
  const scheduled = f.scheduled_at?.trim() || null;
  await createListing({
    inventory_id: null,
    marketplace: "ebay",
    format,
    title,
    description,
    category_id: (f.category ?? "").trim() || "183454",
    price_cents: format === "fixed" ? price : null,
    start_cents: format === "auction" ? price : null,
    duration_days: format === "auction" ? 7 : null,
    quantity: Math.max(1, intOr(f.quantity, 1)),
    sku,
    item_specifics: JSON.stringify(specifics),
    scheduled_at: scheduled,
    status: scheduled ? "scheduled" : "draft",
    image_url: (f.image_url ?? "").trim() || null,
  });
  return "/app/blank-listing?msg=" + encodeURIComponent(`Listing draft created: ${title} (${sku}).`);
}

/** Manual order: "SKU, qty, price" lines. */
async function handleOrderCreate(f: Record<string, string>): Promise<string> {
  const items = (f.items ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [sku, qty, price] = l.split(/\s*,\s*/);
      return { sku: sku?.trim() || null, quantity: Math.max(1, intOr(qty, 1)), price_cents: toCents(price) };
    });
  if (!items.length) return "/app/orders?msg=" + encodeURIComponent("Add at least one item line (SKU, qty, price).");
  const id = await createOrder({
    platform: f.platform || "manual",
    external_ref: f.external_ref?.trim() || null,
    buyer: f.buyer?.trim() || null,
    ship_to: f.ship_to?.trim() || null,
    items,
  });
  return "/app/orders?msg=" + encodeURIComponent(`Order #${id} created with ${items.length} item${items.length === 1 ? "" : "s"}.`);
}

/**
 * Image-upload scan path (spec §2): store each uploaded photo in the object
 * store, best-effort identify it from its filename, and create a review-queue
 * item carrying the image. Photos with no filename signal land in the queue as
 * "needs review" for manual search — the same path a vision model will feed once
 * it reads the pixels (see identify.ts / the seam note on the scan page).
 */
async function handleScanUpload(fields: Record<string, string>, files: UploadedFile[], kind = "scan"): Promise<string> {
  const base = await getSeller();
  const rr = parseRuleKey(fields.rule || "market");
  const condition = fields.condition || base.default_condition;
  const language = fields.language || base.default_language;

  if (fields.sku_prefix && fields.sku_prefix.trim() && fields.sku_prefix.trim() !== base.sku_prefix) {
    await updateSeller({ sku_prefix: fields.sku_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "CARD" });
  }
  if (fields.save_defaults === "1") {
    await updateSeller({ default_condition: condition, default_language: language, price_mode: rr.mode, price_pct: rr.pct });
  }
  const matching = identifyOpts(await matchingFromForm(fields));
  const seller: Seller = { ...(await getSeller()), default_condition: condition, default_language: language, price_mode: rr.mode, price_pct: rr.pct };

  const imgs = files.filter((f) => f.field === "images" && isImage(f)).slice(0, MAX_UPLOAD_FILES);
  if (!imgs.length) return scanPageFor(kind) + "?msg=" + encodeURIComponent("Choose at least one image (JPG/PNG/WebP/HEIC).");

  const store = storage();
  const batchId = await createBatch("upload", fields.label?.trim() || null, kind);
  for (const file of imgs) {
    const put = await store.put(keyFor(seller.id, file.filename), file.data, file.contentType);
    // Vision provider reads the card (pixels → labels → catalog match); falls back
    // to the filename hint when no provider is configured (see app/vision.ts).
    const { result: r0, hintText } = await visionIdentify({ data: file.data, filename: file.filename, contentType: file.contentType }, matching);
    // An uploaded photo we couldn't auto-match isn't a failure — it's a review
    // task with the image in hand, so route "failed" → "needs_review".
    const result = r0.status === "failed" ? { ...r0, status: "needs_review" as const } : r0;
    // Show the recognizer's reading (or the filename) as the item's raw label.
    await addItemFromIdentify(batchId, hintText || file.filename, result, seller, { imageUrl: put.url });
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  await titleBatch(batchId, seller);
  return batchLanding(kind, batchId);
}

/** Attach or replace a scan item's front/back image (per-item upload in review). */
async function handleItemImage(batchId: number, itemId: number, fields: Record<string, string>, files: UploadedFile[]): Promise<void> {
  const item = await getItem(itemId);
  if (!item || item.batch_id !== batchId) return;
  const file = files.find((f) => f.field === "image" && isImage(f));
  if (!file) return;
  const seller = await getSeller();
  const put = await storage().put(keyFor(seller.id, file.filename), file.data, file.contentType);
  await updateItem(itemId, fields.slot === "back" ? { back_image_url: put.url } : { image_url: put.url });
}

async function handleItemAction(batchId: number, itemId: number, f: Record<string, string>): Promise<void> {
  const doAction = f.do || "save";
  let item = await getItem(itemId);
  if (!item || item.batch_id !== batchId) return;

  if (doAction === "replace") {
    const vid = intOr(f.variant_id, 0);
    if (vid) await replaceMatch(itemId, vid);
    return;
  }
  if (doAction === "skip") {
    await updateItem(itemId, { status: "skipped" });
    return;
  }
  if (doAction === "approve") {
    if (item.matched_variant_id) await updateItem(itemId, { status: "approved" });
    return;
  }

  // save / regen
  // 1) variant switch (finish or alternative via the select)
  const vid = intOr(f.variant_id, item.matched_variant_id ?? 0);
  if (vid && vid !== item.matched_variant_id) {
    await replaceMatch(itemId, vid);
    item = (await getItem(itemId))!;
  }

  const condition = f.condition || item.condition;
  const language = f.language || item.language;
  const quantity = Math.max(1, intOr(f.quantity, item.quantity));
  const rr = parseRuleKey(f.rule || "market");
  // Grade: grader + value selects ("PSA" + "10" → "PSA 10"); "Raw" clears it.
  const graderKey = f.grader != null ? graderOf(f.grader)?.key ?? null : item.grader;
  const gradeValue = f.grade_value != null ? (GRADE_VALUES.includes(f.grade_value) ? f.grade_value : null) : null;
  const grade = graderKey && gradeValue ? gradeLabel(graderKey, gradeValue) : f.grader != null ? null : item.grade;

  // Price resolution. `shown_price` is the value the form was rendered with, so
  // we can tell "user changed the rule (recompute)" from "user edited the price
  // box (override)": if the typed price still equals what was shown, it wasn't
  // hand-edited and we recompute from the rule; otherwise it's a manual override.
  const market = item.matched_variant_id ? await marketCentsAt(item.matched_variant_id, grade) : null;
  // Rule-derived prices respect the seller's floor; a typed price never does.
  const ruled = applyFloor(resolvePrice(market, { mode: rr.mode, pct: rr.pct, fixed_cents: null }), (await getSeller()).price_floor_cents).price;
  const typed = toCents(f.price);
  const shown = toCents(f.shown_price);
  let price_cents = ruled;
  let price_overridden = 0;
  if (rr.mode === "fixed") {
    price_cents = typed;
  } else if (typed != null && typed !== shown) {
    price_cents = typed; // user hand-edited the box
    price_overridden = 1;
  }

  const patch: Record<string, unknown> = {
    condition,
    language,
    quantity,
    price_mode: rr.mode,
    price_pct: rr.pct,
    price_cents,
    price_overridden,
    sku: f.sku?.trim() || null,
    grade,
    grader: grade ? graderKey : null,
    prev_price_cents: item.matched_variant_id ? await previousPrice(item.matched_variant_id, grade || condition) : null,
  };

  // title: regenerate on request or when cleared, else keep the user's text
  const merged = { ...item, condition, language, grade, sku: patch.sku as string | null } as typeof item;
  if (doAction === "regen" || !f.title || !f.title.trim()) {
    patch.title = (await scanItemTitle(merged)) ?? "";
  } else {
    patch.title = f.title.trim().slice(0, 80);
  }

  await updateItem(itemId, patch);
}

async function handleInventoryBulk(f: Record<string, string>): Promise<string> {
  const ids = (f.ids || "").split(",").map((s) => intOr(s, 0)).filter(Boolean);
  if (!ids.length) return "/app/inventory?msg=" + encodeURIComponent("No cards selected.");
  const doAction = f.do;

  if (doAction === "list") {
    let n = 0;
    for (const id of ids) {
      const inv = await getInventoryItem(id);
      if (!inv) continue;
      const pv = await inventoryListingPreview(inv);
      if (!pv) continue;
      await createListing({
        inventory_id: inv.id,
        marketplace: "ebay",
        format: "fixed",
        title: pv.title,
        description: pv.description,
        category_id: pv.category,
        price_cents: inv.price_cents,
        start_cents: null,
        duration_days: null,
        quantity: inv.quantity,
        sku: inv.sku,
        item_specifics: JSON.stringify(pv.specifics),
        scheduled_at: null,
      });
      n++;
    }
    return "/app/listings?msg=" + encodeURIComponent(`Created ${n} listing draft(s).`);
  }

  // apply condition and/or pricing rule
  const rr = f.rule ? parseRuleKey(f.rule) : null;
  for (const id of ids) {
    const inv = await getInventoryItem(id);
    if (!inv) continue;
    const patch: Record<string, unknown> = {};
    if (f.condition) patch.condition = f.condition;
    if (rr) {
      patch.price_mode = rr.mode;
      patch.price_pct = rr.pct;
      const p = resolvePrice(await marketCents(inv.variant_id), { mode: rr.mode, pct: rr.pct, fixed_cents: inv.price_cents });
      if (p != null) patch.price_cents = p;
    }
    await updateInventory(id, patch);
  }
  return "/app/inventory?msg=" + encodeURIComponent(`Updated ${ids.length} card(s).`);
}

async function handleCreateListing(invId: number, f: Record<string, string>): Promise<string> {
  const inv = await getInventoryItem(invId);
  if (!inv) return "/app/inventory";
  const format = f.format === "auction" ? "auction" : "fixed";
  const price = toCents(f.price);
  const grade = f.grade?.trim() || null;
  const pv = await inventoryListingPreview(inv, { grade, titleOverride: f.title });
  const specifics = pv ? pv.specifics : {};
  const scheduled = f.scheduled_at?.trim() || null;

  const id = await createListing({
    inventory_id: inv.id,
    marketplace: "ebay",
    format,
    title: (f.title || pv?.title || inv.card_name).slice(0, 80),
    description: f.description ?? pv?.description ?? "",
    category_id: f.category?.trim() || pv?.category || null,
    price_cents: format === "fixed" ? price : null,
    start_cents: format === "auction" ? price : null,
    duration_days: format === "auction" ? intOr(f.duration, 7) : null,
    quantity: Math.max(1, intOr(f.quantity, inv.quantity)),
    sku: inv.sku,
    item_specifics: JSON.stringify(specifics),
    scheduled_at: scheduled,
    status: scheduled ? "scheduled" : "draft",
  });
  if (f.do === "publish") return await publishAndRedirect(id, `${inv.card_name}`);
  return "/app/listings?msg=" + encodeURIComponent(`Listing draft created for ${inv.card_name}.`);
}

/** Publish (or revise) a listing on eBay and land on the listings page with the outcome. */
async function publishAndRedirect(listingId: number, label: string): Promise<string> {
  try {
    const r = await publishListing(listingId);
    return "/app/listings?msg=" + encodeURIComponent(`${r.revised ? "Revised" : "Published"} on eBay: ${label} → item ${r.listingId}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof EbayError)) console.error("ebay publish:", err);
    return "/app/listings?msg=" + encodeURIComponent(`eBay rejected "${label}": ${msg}`);
  }
}

/** Pull open eBay orders into the orders table (skipping ones already imported). */
async function fetchEbayOrders(): Promise<string> {
  try {
    const open = await fetchOpenOrders();
    const seen = await existingRefs("ebay");
    let added = 0;
    for (const o of open) {
      if (seen.has(o.orderId)) continue;
      await createOrder({ platform: "ebay", external_ref: o.orderId, buyer: o.buyer, ship_to: o.shipTo, items: o.items });
      added++;
    }
    await touchOrderSync();
    return "/app/orders?platform=ebay&msg=" + encodeURIComponent(`Fetched ${open.length} open eBay order${open.length === 1 ? "" : "s"} — ${added} new.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof EbayError)) console.error("ebay orders:", err);
    return "/app/orders?msg=" + encodeURIComponent(`Couldn't fetch eBay orders: ${msg}`);
  }
}

/**
 * After an order ships: tell eBay (for eBay orders) or push the new quantity to
 * live eBay listings (for orders from anywhere else). Best-effort; local
 * inventory is already updated and is the source of truth.
 */
async function afterShip(orderId: number): Promise<string> {
  const o = await getOrderWithItems(orderId);
  if (!o || !(await getConnection())) return "";
  try {
    if (o.platform === "ebay" && o.external_ref) {
      await markShippedOnEbay(o.external_ref);
      return " Marked shipped on eBay.";
    }
    let n = 0;
    for (const it of o.items) if (it.inventory_id != null) n += await syncQuantityForInventory(it.inventory_id);
    return n ? ` Quantity synced to ${n} live eBay listing${n === 1 ? "" : "s"}.` : "";
  } catch (err) {
    return ` (eBay sync failed: ${err instanceof Error ? err.message : String(err)})`;
  }
}

async function handleSettings(f: Record<string, string>): Promise<string> {
  const rr = parseRuleKey(f.rule || "market");
  // Description templates: up to N (name, body) pairs + which one is active.
  const items = Array.from({ length: DESCRIPTION_TEMPLATE_MAX }, (_, i) => ({
    name: (f[`desc_name_${i}`] ?? "").trim().slice(0, 40) || `Description ${i + 1}`,
    body: (f[`desc_body_${i}`] ?? "").replace(/\r\n/g, "\n").slice(0, 8000),
  }));
  const activeRaw = intOr(f.desc_active, 0);
  // `active` indexes the kept (non-empty) list; map from the form slot.
  const kept = items.map((it, i) => ({ ...it, i })).filter((it) => it.body.trim());
  const active = Math.max(0, kept.findIndex((it) => it.i === activeRaw));
  const matching = prefsFromForm(f, await getAllSets());
  await updateSeller({
    display_name: f.display_name?.trim() || "My card shop",
    sku_prefix: (f.sku_prefix || "CARD").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "CARD",
    sku_pad: Math.max(3, Math.min(9, intOr(f.sku_pad, 6))),
    sku_next: Math.max(1, intOr(f.sku_next, 1)),
    price_mode: rr.mode,
    price_pct: rr.pct,
    price_fixed_cents: toCents(f.price_fixed),
    default_condition: f.default_condition || "NM",
    default_language: f.default_language || "EN",
    // Visual Title Structure Editor. Legacy title_template is left untouched (the
    // structure takes precedence when set); an empty/invalid structure clears it.
    title_structure: (() => {
      const st = parseStructure(f.title_structure);
      return st && st.blocks.length ? serializeStructure(st) : null;
    })(),
    ebay_store_category: f.ebay_store_category?.trim() || null,
    item_location: f.item_location?.trim() || null,
    ebay_shipping_policy: f.ebay_shipping_policy?.trim() || null,
    ebay_return_policy: f.ebay_return_policy?.trim() || null,
    ebay_payment_policy: f.ebay_payment_policy?.trim() || null,
    training_opt_in: f.training_opt_in === "1" ? 1 : 0,
    auto_price_pref: parseAutoPricePref(f.auto_price_pref),
    price_floor_cents: (() => {
      const c = toCents(f.price_floor);
      return c != null && c > 0 ? c : null;
    })(),
    matching_prefs: serializeMatchingPrefs(matching),
    description_templates: serializeDescriptionTemplates({ active, items: kept.map(({ name, body }) => ({ name, body })) }),
    channel_prefs: JSON.stringify(channelPrefsFromForm(f)),
  });
  // eBay: chosen policy ids + ship-from location (only when connected).
  let note = "";
  if (await getConnection()) {
    if (f.policy_fulfillment != null || f.policy_payment != null || f.policy_return != null) {
      await setPolicyIds({ fulfillment: (f.policy_fulfillment ?? "").trim(), payment: (f.policy_payment ?? "").trim(), return: (f.policy_return ?? "").trim() });
    }
    if ((f.loc_postal ?? "").trim()) {
      try {
        await ensureLocation({ postalCode: f.loc_postal.trim(), country: (f.loc_country ?? "US").trim(), city: (f.loc_city ?? "").trim(), stateOrProvince: (f.loc_state ?? "").trim() });
      } catch (err) {
        note = ` eBay location wasn't saved: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }
  return note;
}

/** Serve a locally-stored uploaded image (local storage driver only). */
function serveUpload(res: ServerResponse, path: string): void {
  const dir = localUploadsDir();
  if (!dir) return notFound(res); // S3 driver: images are served by the bucket
  const key = path.slice("/uploads/".length);
  const rootAbs = resolve(dir);
  const target = resolve(rootAbs, key);
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) return notFound(res); // traversal guard
  try {
    const data = readFileSync(target);
    res.writeHead(200, { "content-type": contentTypeForExt(extname(target)), "cache-control": "public, max-age=3600" });
    res.end(data);
  } catch {
    notFound(res);
  }
}

/**
 * File export for any channel. `ids` = inventory rows, `listings` = blank
 * listing ids, `all=1` = every inventory row plus every blank listing draft.
 */
async function exportCsv(res: ServerResponse, url: URL, fmt: string): Promise<void> {
  const seller = await getSeller();
  const all = url.searchParams.get("all") === "1";
  const invIds = all ? (await listInventory({})).map((r) => r.id) : (url.searchParams.get("ids") || "").split(",").map((s) => intOr(s, 0)).filter(Boolean);
  const listingIds = (url.searchParams.get("listings") || "").split(",").map((s) => intOr(s, 0)).filter(Boolean);
  const invs = (await Promise.all(invIds.map((id) => getInventoryItem(id)))).filter((x): x is NonNullable<typeof x> => !!x);
  const blanks = all ? await listBlankListings() : await getListings(listingIds);
  const items = [...itemsFromRows(await exportRowsFor(invs, { format: "fixed" })), ...blanks.filter((l) => l.inventory_id == null).map(itemFromBlankListing)];
  const prefs = parseChannelPrefs(seller.channel_prefs);
  let csv: string;
  switch (fmt) {
    case "tcgplayer":
      csv = tcgplayerCsv(items, prefs).csv;
      break;
    case "whatnot":
      csv = whatnotCsv(items, prefs);
      break;
    case "shopify":
      csv = shopifyCsv(items, prefs);
      break;
    default:
      csv = ebayCsv(items, seller);
  }
  if (blanks.length) await markListingsExported(blanks.map((l) => l.id));
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${fmt}-listings.csv"`,
    "cache-control": "no-cache",
  });
  res.end(csv);
}

// ---- router ---------------------------------------------------------------

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = decodeURIComponent(url.pathname);
  const method = req.method ?? "GET";
  const msg = url.searchParams.get("msg") ?? undefined;
  let m: RegExpMatchArray | null;

  // Resolve the logged-in account once per request; the shared page shell reads
  // it (via AsyncLocalStorage) to render the header without threading a param.
  let account: HeaderAccount = null;
  try {
    account = await resolveAccount(req);
  } catch (err) {
    console.error("account resolve error:", err);
  }

  await runWithRequest(account, async () => {
  try {
    // static
    if (path === "/styles.css") return send(res, 200, STYLES, "text/css; charset=utf-8");
    if (path.startsWith("/uploads/")) return serveUpload(res, path);
    if (path === "/robots.txt")
      return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /app\nSitemap: ${url.origin}/sitemap.xml\n`, "text/plain");
    if (path === "/sitemap.xml") {
      const urls = (await sitemapUrls())
        .map((u) => `  <url><loc>${url.origin}${u}</loc></url>`)
        .join("\n");
      return send(
        res,
        200,
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
        "application/xml"
      );
    }

    // ---- auth (login / signup / logout) ----
    if (path === "/login" || path === "/signup" || path === "/logout") {
      return await handleAuth(req, res, url, path, method);
    }

    // ---- public share page for a priced list (token is the capability) ----
    if ((m = path.match(/^\/p\/([A-Za-z0-9_-]{8,40})$/))) {
      const b = await getBatchByToken(m[1]);
      if (!b) return notFound(res);
      const acct = await getAccount(b.seller_id);
      const items = await getItemsPublic(b.id);
      const token = m[1];
      return runWithSeller(b.seller_id, async () =>
        sendPage(res, await renderPricingResults(b, items, { isPublic: true, shareUrl: null, shopName: acct?.display_name ?? "a CardIndex seller" }), `/p/${token}`)
      );
    }

    // ---- seller workspace (login-gated) ----
    if (path === "/app" || path.startsWith("/app/") || path === "/api/identify" || path === "/api/title-preview" || path === "/api/description-preview") {
      return await handleApp(req, res, url, path, method, msg);
    }

    // API: type-ahead
    if (path === "/api/suggest") {
      const q = (url.searchParams.get("q") ?? "").trim();
      const rows = q.length >= 2 ? await suggest(q) : [];
      const out = rows.map((r) => ({
        name: r.name,
        url: `/c/${r.slug}-${r.id}`,
        image: r.image,
        meta: `${r.set_name}${r.number ? " · #" + r.number : ""}${r.price != null ? " · " + money(r.price) : ""}`,
      }));
      return send(res, 200, JSON.stringify(out), "application/json");
    }

    // API: live eBay listings for a card (Browse API; see src/ebay.ts).
    // Lazy-loaded by a button on the card page so pageviews/crawlers never
    // spend Browse-API quota; results are cached 10 min in-process.
    if (path === "/api/ebay/listed") {
      const j = (code: number, body: unknown) => send(res, code, JSON.stringify(body), "application/json");
      if (!ebayConfigured()) return j(200, { configured: false, items: [] });
      const card = await getCard(Number(url.searchParams.get("card")));
      if (!card) return j(404, { configured: true, error: "unknown card" });
      const variants = await getVariants(card.id);
      const vf = url.searchParams.get("v");
      const sel = variants.find((v) => v.finish === vf) ?? variants.find((v) => v.is_default) ?? variants[0];
      const query = [card.name, card.number ?? "", card.set_name ?? "", sel && sel.finish !== "normal" ? sel.finish_label : ""]
        .filter(Boolean)
        .join(" ")
        .trim();
      try {
        const items = await searchListed(query, 10);
        return j(200, { configured: true, query, items });
      } catch (err) {
        console.error("ebay listed:", err);
        return j(200, { configured: true, query, error: "eBay request failed — try again shortly" });
      }
    }

    // API: per-condition TCGplayer prices (SKU-level; needs a grandfathered/
    // partner key or TCGPLAYER_MOCK — see src/tcgplayer.ts). Lazy like the
    // eBay endpoint; results cached 30 min in-process.
    if (path === "/api/tcgplayer/conditions") {
      const j = (code: number, body: unknown) => send(res, code, JSON.stringify(body), "application/json");
      if (!tcgConfigured()) return j(200, { configured: false, groups: [] });
      const card = await getCard(Number(url.searchParams.get("card")));
      if (!card) return j(404, { configured: true, error: "unknown card" });
      if (!card.tcgplayer_product_id)
        return j(200, { configured: true, groups: [], error: "No TCGplayer product linked for this card yet (run sync:tcgcsv)." });
      const variants = await getVariants(card.id);
      const vf = url.searchParams.get("v");
      const sel = variants.find((v) => v.finish === vf) ?? variants.find((v) => v.is_default) ?? variants[0];
      const base = sel ? await latestMarket(sel.id) : undefined;
      try {
        const groups = await conditionPrices({
          productId: Number(card.tcgplayer_product_id),
          gameSlug: card.game_slug ?? "",
          mockBaseCents: base?.price_cents ?? null,
          mockPrinting: sel?.finish_label ?? "Standard",
        });
        return j(200, { configured: true, product_id: card.tcgplayer_product_id, groups });
      } catch (err) {
        console.error("tcgplayer conditions:", err);
        return j(200, { configured: true, error: "TCGplayer request failed — try again shortly" });
      }
    }

    // pages
    if (path === "/") return sendPage(res, { ...(await renderHome()) }, "/");
    if (path === "/browse") return sendPage(res, { ...(await renderBrowse()) }, "/browse");
    if (path === "/sales") {
      const sp: SalesParams = {
        q: url.searchParams.get("q") ?? undefined,
        market: url.searchParams.get("market") ?? undefined,
        type: url.searchParams.get("type") ?? undefined,
        grade: url.searchParams.get("grade") ?? undefined,
        sort: url.searchParams.get("sort") ?? undefined,
      };
      return sendPage(res, { ...renderSales(sp, await searchSales(sp)) }, "/sales");
    }
    if (path === "/pricing") {
      const tier = account ? await planTier(account.id) : "free";
      const upgrade = url.searchParams.get("upgrade") === "1";
      return sendPage(res, renderPricing({ account, tier, upgrade }), "/pricing");
    }

    if ((m = path.match(/^\/g\/([a-z0-9-]+)$/i))) {
      const game = await getGameBySlug(m[1]);
      if (!game) return notFound(res);
      return sendPage(res, { ...(await renderBrowse(game)) }, `/g/${game.slug}`);
    }

    if ((m = path.match(/^\/s\/([a-z0-9-]+)$/i))) {
      const set = await getSetBySlug(m[1]);
      if (!set) return notFound(res);
      return sendPage(res, { ...(await renderSet(set)) }, `/s/${set.slug}`);
    }

    if ((m = path.match(/^\/c\/(.+)-(\d+)$/))) {
      const card = await getCard(Number(m[2]));
      if (!card) return notFound(res);
      const p = await renderCard(card, {
        variantFinish: url.searchParams.get("v") ?? undefined,
        range: num(url.searchParams.get("r")),
        gradeTab: url.searchParams.get("tab") ?? undefined,
      });
      if (!p) return notFound(res);
      return send(res, 200, page({ ...p, canonical: `/c/${card.slug}-${card.id}` }));
    }

    if (path === "/search") {
      const sp: SearchParams = {
        q: url.searchParams.get("q") ?? undefined,
        game: url.searchParams.get("game") ?? undefined,
        set: url.searchParams.get("set") ?? undefined,
        rarity: url.searchParams.get("rarity") ?? undefined,
        finish: url.searchParams.get("finish") ?? undefined,
        min: num(url.searchParams.get("min")),
        max: num(url.searchParams.get("max")),
        sort: url.searchParams.get("sort") ?? undefined,
        page: num(url.searchParams.get("page")),
      };
      const result = await search(sp);
      const p = renderSearch(sp, result);
      const canonical = "/search" + (url.search || "");
      return send(res, 200, page({ ...p, canonical, searchValue: sp.q ?? "" }));
    }

    return notFound(res);
  } catch (err) {
    console.error("Request error:", err);
    send(
      res,
      500,
      page({
        title: "Error — CardIndex",
        description: "Something went wrong.",
        canonical: "/",
        body: `<div class="wrap"><div class="empty"><h1>500</h1><p>Something went wrong rendering this page.</p></div></div>`,
      })
    );
  }
  }); // runWithRequest
});

// ---- auth sub-router ------------------------------------------------------

async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  method: string
) {
  const acct = currentAccount();

  if (path === "/logout") {
    if (method === "POST") {
      await destroySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      return redirectWithCookie(res, "/", clearSessionCookie());
    }
    return redirect(res, "/");
  }

  const isSignup = path === "/signup";

  if (method === "GET") {
    if (acct) return redirect(res, "/app"); // already signed in
    const next = url.searchParams.get("next") ?? undefined;
    return sendPage(res, isSignup ? renderSignup({ next }) : renderLogin({ next }), path);
  }

  if (method === "POST") {
    const f = parseForm(await readBody(req));
    const email = String(f.email ?? "");
    const password = String(f.password ?? "");
    const next = safeNext(f.next);

    if (isSignup) {
      try {
        const sellerId = await createAccount(email, password, String(f.display_name ?? ""));
        const token = await createSession(sellerId);
        return redirectWithCookie(res, next, sessionCookie(token));
      } catch (err) {
        const message = err instanceof AuthError ? err.message : "Could not create your account. Please try again.";
        if (!(err instanceof AuthError)) console.error("signup error:", err);
        return sendPage(
          res,
          renderSignup({ error: message, email, displayName: String(f.display_name ?? ""), next: f.next }),
          "/signup"
        );
      }
    }

    let sellerId: number | null = null;
    try {
      sellerId = await authenticate(email, password);
    } catch (err) {
      console.error("login error:", err);
    }
    if (!sellerId) {
      return sendPage(res, renderLogin({ error: "Wrong email or password.", email, next: f.next }), "/login");
    }
    const token = await createSession(sellerId);
    return redirectWithCookie(res, next, sessionCookie(token));
  }

  return redirect(res, "/login");
}

// ---- app sub-router -------------------------------------------------------

/**
 * Auth gate for the whole seller workspace. No valid session -> bounce to login
 * (preserving where the user was headed). Otherwise run the request inside the
 * seller's data scope so every store query is tenant-isolated.
 */
async function handleApp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  method: string,
  msg: string | undefined
) {
  const acct = currentAccount();
  if (!acct) {
    if (method === "GET") {
      return redirect(res, "/login?next=" + encodeURIComponent(path + (url.search || "")));
    }
    return redirect(res, "/login");
  }
  // Pro paywall: the whole seller workspace requires an active Pro subscription.
  // Free accounts are bounced to /pricing (the public catalog stays open to them).
  if (!isPro(await planTier(acct.id))) {
    return redirect(res, "/pricing?upgrade=1");
  }
  return runWithSeller(acct.id, () => handleAppAuthed(req, res, url, path, method, msg));
}

async function handleAppAuthed(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  method: string,
  msg: string | undefined
) {
  // identify API (manual search in the review queue)
  if (path === "/api/identify") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return send(res, 200, "[]", "application/json");
    const r = await identify(q);
    const cands = [r.best, ...r.alternatives].filter((c): c is NonNullable<typeof c> => !!c);
    const out = cands.map((c) => ({
      variant_id: c.variant_id,
      label: `${c.name}${c.number ? " #" + c.number : ""}`,
      set: c.set_name,
      finish: c.finish_label,
      image: c.image,
    }));
    return send(res, 200, JSON.stringify(out), "application/json");
  }

  // Title Structure Editor live preview: render the (draft) structure against a
  // representative catalog card through the real title builder.
  if (path === "/api/title-preview") {
    const st = parseStructure(url.searchParams.get("s")) ?? DEFAULT_STRUCTURE;
    const r = renderStructuredTitle(await sampleTitleFields(), st);
    return send(res, 200, JSON.stringify(r), "application/json");
  }

  // Description template live preview (POST t=<template>): fill the draft
  // against the same sample card the title editor uses, through the real filler.
  if (path === "/api/description-preview" && method === "POST") {
    const f = parseForm(await readBody(req));
    const [fields, seller] = await Promise.all([sampleTitleFields(), getSeller()]);
    const text = fillDescriptionTemplate(String(f.t ?? "").slice(0, 8000), fields, 1250, sellerTitle(fields, seller));
    return send(res, 200, JSON.stringify({ text }), "application/json");
  }

  // CSV exports (GET): /app/export/{ebay|tcgplayer|whatnot|shopify}.csv
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/app\/export\/(ebay|tcgplayer|whatnot|shopify)\.csv$/)) && method === "GET") return await exportCsv(res, url, m[1]);

  if (method === "POST") {
    // Image uploads arrive as multipart/form-data (binary); everything else is
    // urlencoded. Branch before reading the body since the readers differ.
    const ctype = String(req.headers["content-type"] ?? "");
    if (ctype.startsWith("multipart/form-data")) {
      const boundary = boundaryOf(ctype);
      let mp = { fields: {} as Record<string, string>, files: [] as UploadedFile[] };
      try {
        const buf = await readBodyBuffer(req);
        if (boundary) mp = parseMultipart(buf, boundary);
      } catch {
        return redirect(res, "/app/scan?msg=" + encodeURIComponent("Upload too large — try fewer or smaller images."));
      }
      if (path === "/app/scan/upload") return redirect(res, await handleScanUpload(mp.fields, mp.files));
      if (path === "/app/pricing-tool/upload") return redirect(res, await handleScanUpload(mp.fields, mp.files, "pricing"));
      if (path === "/app/orders/import") {
        const file = mp.files.find((x) => x.field === "csv");
        if (!file) return redirect(res, "/app/orders?msg=" + encodeURIComponent("Choose a CSV file."));
        const r = await importPullSheet(file.data.toString("utf8"));
        return redirect(res, "/app/orders?msg=" + encodeURIComponent(`Imported ${r.orders.length} order${r.orders.length === 1 ? "" : "s"}: ${r.matched} line${r.matched === 1 ? "" : "s"} matched inventory, ${r.unmatched} not matched.`));
      }
      let mi: RegExpMatchArray | null;
      if ((mi = path.match(/^\/app\/review\/(\d+)\/item\/(\d+)\/image$/))) {
        await handleItemImage(Number(mi[1]), Number(mi[2]), mp.fields, mp.files);
        return redirectBack(req, res, `/app/review/${mi[1]}`);
      }
      return redirect(res, "/app");
    }

    const body = await readBody(req);
    const f = parseForm(body);

    if (path === "/app/scan") return redirect(res, await handleScan(f));
    if (path === "/app/pricing-tool") return redirect(res, await handleScan(f, "pricing"));
    if (path === "/app/graded") return redirect(res, await handleGraded(f));
    if (path === "/app/listing-creator") return redirect(res, await handleCreator(f));
    if (path === "/app/blank-listing") return redirect(res, await handleBlank(f));
    if (path === "/app/orders") return redirect(res, await handleOrderCreate(f));
    if (path === "/app/inbox") {
      if (!(f.title ?? "").trim()) return redirect(res, "/app/inbox?msg=" + encodeURIComponent("Give your note a title."));
      await submitFeedback(f.kind ?? "feedback", f.title, f.body ?? "");
      return redirect(res, "/app/inbox?msg=" + encodeURIComponent("Sent — replies will show up here."));
    }
    if ((m = path.match(/^\/app\/pricing\/(\d+)\/(share|unshare|convert)$/))) {
      const id = Number(m[1]);
      if (m[2] === "share") {
        await shareBatch(id);
        return redirect(res, `/app/pricing/${id}?msg=` + encodeURIComponent("Share link created — anyone with it can view the priced list."));
      }
      if (m[2] === "unshare") {
        await unshareBatch(id);
        return redirect(res, `/app/pricing/${id}?msg=` + encodeURIComponent("Sharing stopped."));
      }
      await setBatchKind(id, "scan");
      return redirect(res, `/app/review/${id}?msg=` + encodeURIComponent("Now an inventory batch — review, then add to inventory."));
    }
    if ((m = path.match(/^\/app\/orders\/(\d+)\/(pick|ship|delete)$/))) {
      const id = Number(m[1]);
      if (m[2] === "pick") await setItemPicked(id, intOr(f.item, 0), f.picked === "1");
      else if (m[2] === "ship") {
        const r = await shipOrder(id);
        const extra = await afterShip(id);
        return redirect(res, "/app/orders?msg=" + encodeURIComponent(`Order #${id} shipped — ${r.adjusted} inventory row${r.adjusted === 1 ? "" : "s"} adjusted.${extra}`));
      } else await deleteOrder(id);
      return redirect(res, "/app/orders");
    }
    if (path === "/app/orders/fetch-ebay") return redirect(res, await fetchEbayOrders());
    if (path === "/app/ebay/disconnect") {
      await ebayDisconnect();
      return redirect(res, "/app/settings?msg=" + encodeURIComponent("eBay disconnected."));
    }
    if (path === "/app/ebay/sync-policies") {
      try {
        const p = await syncPolicies();
        return redirect(res, "/app/settings?msg=" + encodeURIComponent(`Synced ${p.fulfillment.length} shipping, ${p.payment.length} payment and ${p.return.length} return polic${p.return.length === 1 ? "y" : "ies"} from eBay — pick one of each and save.`) + "#s-ebay");
      } catch (err) {
        return redirect(res, "/app/settings?msg=" + encodeURIComponent(`Policy sync failed: ${err instanceof Error ? err.message : String(err)}`) + "#s-ebay");
      }
    }
    if ((m = path.match(/^\/app\/listings\/(\d+)\/(publish|end)$/))) {
      const id = Number(m[1]);
      if (m[2] === "publish") return redirect(res, await publishAndRedirect(id, `#${id}`));
      try {
        await endListing(id);
        return redirect(res, "/app/listings?msg=" + encodeURIComponent(`Listing #${id} ended on eBay.`));
      } catch (err) {
        return redirect(res, "/app/listings?msg=" + encodeURIComponent(`Couldn't end listing #${id}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    if ((m = path.match(/^\/app\/inventory\/automatic\/(\d+)$/))) {
      const st = f.status === "published" ? "published" : "ended";
      await setListingStatus(Number(m[1]), st);
      return redirect(res, "/app/inventory/automatic?msg=" + encodeURIComponent(st === "published" ? "Marked live." : "Listing ended."));
    }
    if (path === "/app/settings") {
      const note = await handleSettings(f);
      return redirect(res, "/app/settings?msg=" + encodeURIComponent("Settings saved." + note));
    }
    if (path === "/app/inventory/bulk") return redirect(res, await handleInventoryBulk(f));

    if ((m = path.match(/^\/app\/review\/(\d+)\/item\/(\d+)$/))) {
      await handleItemAction(Number(m[1]), Number(m[2]), f);
      return redirectBack(req, res, `/app/review/${m[1]}`);
    }
    if ((m = path.match(/^\/app\/review\/(\d+)\/commit$/))) {
      const r = await commitBatch(Number(m[1]), { mergeDuplicates: f.merge === "1" });
      const extra = r.merged ? ` (${r.merged} merged)` : "";
      return redirect(res, "/app/inventory?msg=" + encodeURIComponent(`Added ${r.created.length} card(s) to inventory${extra}.`));
    }
    if ((m = path.match(/^\/app\/list\/(\d+)$/))) return redirect(res, await handleCreateListing(Number(m[1]), f));

    return redirect(res, "/app");
  }

  // GET pages
  if (path === "/app") {
    // Old inventory links carried filters on /app itself — send them to the inventory page.
    if (["status", "q", "sort", "game"].some((k) => url.searchParams.has(k))) return redirect(res, "/app/inventory" + url.search);
    return sendPage(res, await renderWorkspaceHome(msg), "/app");
  }
  if (path === "/app/inventory") {
    const filter = {
      status: url.searchParams.get("status") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      game: url.searchParams.get("game") ?? undefined,
    };
    return sendPage(res, await renderInventory(filter, msg), "/app/inventory");
  }
  if (path === "/app/batches") return sendPage(res, await renderBatches(msg), "/app/batches");
  if (path === "/app/inventory/automatic") return sendPage(res, await renderAutomaticInventory(msg), path);
  if (path === "/app/graded") return sendPage(res, await renderGraded(msg), path);
  if (path === "/app/listing-creator")
    return sendPage(res, await renderListingCreator({ game: url.searchParams.get("game") ?? undefined, set: url.searchParams.get("set") ?? undefined }, msg), path);
  if (path === "/app/blank-listing") return sendPage(res, await renderBlankListing(msg), path);
  if (path === "/app/pricing-tool") return sendPage(res, await renderPricingTool(msg), path);
  if ((m = path.match(/^\/app\/pricing\/(\d+)$/))) {
    const b = await getBatch(Number(m[1]));
    if (!b) return notFound(res);
    const seller = await getSeller();
    const shareUrl = b.share_token ? `${url.origin}/p/${b.share_token}` : null;
    return sendPage(res, await renderPricingResults(b, await getItems(b.id), { isPublic: false, shareUrl, shopName: seller.display_name, msg }), path);
  }
  if (path === "/app/card-search") {
    const sp: SearchParams = {
      q: url.searchParams.get("q") ?? undefined,
      game: url.searchParams.get("game") ?? undefined,
      set: url.searchParams.get("set") ?? undefined,
      rarity: url.searchParams.get("rarity") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      page: num(url.searchParams.get("page")),
    };
    return sendPage(res, renderCardSearch(sp, await search(sp), msg), path);
  }
  if (path === "/app/orders") {
    const f = { platform: url.searchParams.get("platform") ?? "all", status: url.searchParams.get("status") ?? "pending" };
    const conn = await getConnection();
    return sendPage(res, renderOrders(await listOrders(f), f, { connected: !!conn, lastSync: conn?.last_order_sync ?? null }, msg), path);
  }
  // eBay OAuth: start on eBay's consent page, come back with a code.
  if (path === "/app/ebay/connect") {
    if (!ebaySellConfigured()) return redirect(res, "/app/settings?msg=" + encodeURIComponent("eBay isn't configured on this server yet (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_RU_NAME).") + "#s-ebay");
    return redirect(res, await beginConnect());
  }
  if (path === "/app/ebay/callback") {
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!code || !state) return redirect(res, "/app/settings?msg=" + encodeURIComponent("eBay sign-in was cancelled or returned no code.") + "#s-ebay");
    try {
      const c = await completeConnect(code, state);
      let extra = "";
      try {
        const p = await syncPolicies();
        extra = ` Synced ${p.fulfillment.length + p.payment.length + p.return.length} business policies — pick one of each and add your postal code.`;
      } catch {
        extra = " Now sync your business policies and add a postal code.";
      }
      return redirect(res, "/app/settings?msg=" + encodeURIComponent(`Connected eBay account ${c.ebay_user ?? ""}.${extra}`) + "#s-ebay");
    } catch (err) {
      return redirect(res, "/app/settings?msg=" + encodeURIComponent(`eBay connection failed: ${err instanceof Error ? err.message : String(err)}`) + "#s-ebay");
    }
  }
  if (path === "/app/orders/picklist") return sendPage(res, renderPicklist(await picklist()), path);
  if (path === "/app/inbox") return sendPage(res, renderInbox(await listFeedback(), msg), path);
  if (path === "/app/scan") return sendPage(res, await renderScan(msg, url.searchParams.get("add") ?? undefined), "/app/scan");
  if (path === "/app/listings") return sendPage(res, await renderListings(msg), "/app/listings");
  if (path === "/app/settings") return sendPage(res, await renderSettings(msg), "/app/settings");

  if ((m = path.match(/^\/app\/review\/(\d+)$/))) {
    const r = await renderReview(Number(m[1]), url.searchParams.get("tab") ?? undefined, msg);
    if (!r) return notFound(res);
    return sendPage(res, r, path);
  }
  if ((m = path.match(/^\/app\/list\/(\d+)$/))) {
    const r = await renderListingBuilder(Number(m[1]), msg);
    if (!r) return notFound(res);
    return sendPage(res, r, path);
  }

  return notFound(res);
}

server.listen(PORT, () => {
  console.log(`\n  CardIndex MVP running -> http://localhost:${PORT}\n`);
});
