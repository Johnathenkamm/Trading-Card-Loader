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
import { searchSales, ensureSalesSchema, type SalesParams } from "./sales.ts";
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
  renderGraded, renderListingCreator, renderBlankListing, renderPricingResults, renderCardSearch,
  renderOrders, renderPicklist, renderAutomaticInventory, renderInbox, renderSalesLookup,
} from "./render/workspace2.ts";
import {
  addItemFromCatalog, shareBatch, unshareBatch, getBatchByToken, getItemsPublic, setBatchKind, getBatch, bumpBatchProgress,
  getListings, listBlankListings, markListingsExported, setListingStatus, marketCentsAt,
} from "./app/store.ts";
import { parseCerts, lookupCert, gradeLabel, graderOf, GRADE_VALUES } from "./app/graded.ts";
import {
  ensureOrdersSchema, createOrder, listOrders, setItemPicked, shipOrder, deleteOrder, importPullSheet, picklist, getOrderWithItems, existingRefs,
} from "./app/orders.ts";
import {
  ensureEbaySchema, ebaySellConfigured, beginConnect, completeConnect, disconnect as ebayDisconnect, syncPolicies, setPolicyIds, ensureLocation,
  getConnection, publishListing, endListing, syncQuantityForInventory, fetchOpenOrders, markShippedOnEbay, touchOrderSync, EbayError,
  startScheduler, runScheduledPublishes,
} from "./app/ebay-sell.ts";
import { scheduleListing } from "./app/store.ts";
import { ensureFeedbackSchema, submitFeedback, listFeedback } from "./app/feedback.ts";
import {
  itemsFromRows, itemFromBlankListing, ebayCsv, tcgplayerCsv, whatnotCsv, shopifyCsv, parseChannelPrefs, channelPrefsFromForm,
} from "./app/exporters.ts";
import { formatSku } from "./app/sku.ts";
import { parseInput, type IdentifyResult } from "./app/identify.ts";
import {
  readBodyBuffer, parseMultipart, boundaryOf, isImage, hintFromFilename, tooLargeMessage, maxUploadFiles, MAX_UPLOAD_FILES_PRO, UPLOAD_CHUNK_FILES,
  type UploadedFile,
} from "./upload.ts";
import { storage, keyFor, localUploadsDir, contentTypeForExt } from "./storage.ts";
import { visionIdentify } from "./app/vision.ts";

// ---- auth & accounts ------------------------------------------------------
import {
  ensureAuthSchema, authenticate, createAccount, createSession, destroySession,
  sellerForSession, getAccount, parseCookies, sessionCookie, clearSessionCookie,
  SESSION_COOKIE, AuthError, isValidEmail,
  createPasswordReset, resetTokenValid, consumePasswordReset,
} from "./app/auth.ts";
import { sendMail, mailMode, appBaseUrl } from "./app/mailer.ts";
import { runWithSeller, runWithRequest, currentAccount, currentSellerId, type HeaderAccount } from "./app/session-context.ts";
import { renderLogin, renderSignup, renderResetRequest, renderResetForm, safeNext } from "./render/auth.ts";
import { ensureBillingSchema, planTier, isPro, setPlanTier } from "./app/billing.ts";
import { renderPricing } from "./render/pricing.ts";

// ---- owner CRM (/admin) ---------------------------------------------------
import {
  ensureAdminSchema, logActivity, describeActivity, listUsers, getUser, userUsage, overview, listActivity, dailyActive,
  listAllFeedback, userBatches, actAsCookie, clearActAsCookie, ACT_AS_COOKIE,
  ADMIN_COOKIE, adminConfigured, adminAuthenticate, adminLockedFor, adminSessionValid, createAdminSession, destroyAdminSession,
  adminCookie, clearAdminCookie, ensureOwnerSeller, ownerSellerId,
} from "./app/admin.ts";
import { replyFeedback, closeFeedback } from "./app/feedback.ts";
import {
  renderAdminHome, renderAdminUsers, renderAdminUser, renderAdminActivity, renderAdminFeedback, renderAdminUpload, renderAdminLogin,
} from "./render/admin.ts";

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
  await ensureSalesSchema();
} catch (err) {
  console.error("\n  Failed to prepare the workspace schema (seller prefs, graded columns, orders, feedback).\n", err);
  process.exit(1);
}

// Owner console: sellers.last_seen_at, the activity_log and admin_sessions
// tables. See app/admin.ts. The console itself needs ADMIN_EMAIL + ADMIN_PASSWORD.
try {
  await ensureAdminSchema();
} catch (err) {
  console.error("\n  Failed to prepare the owner-console schema (activity_log, admin_sessions).\n", err);
  process.exit(1);
}
if (!adminConfigured()) console.warn("  Owner console disabled: set ADMIN_EMAIL and ADMIN_PASSWORD to enable /admin.");
// The owner's own seller row (their personal uploader / workspace). Idempotent.
try {
  const oid = await ensureOwnerSeller();
  if (oid) console.log(`  Owner account: seller #${oid} (${process.env.ADMIN_EMAIL}) — /admin/upload adds cards there.`);
} catch (err) {
  console.error("\n  Failed to prepare the owner's own seller account.\n", err);
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

/** JSON reply for the fetch-driven endpoints (chunked uploads); `cookie` sets a Set-Cookie header. */
function sendJson(res: ServerResponse, status: number, body: unknown, cookie?: string) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache",
    ...(cookie ? { "set-cookie": cookie } : {}),
  });
  res.end(JSON.stringify(body));
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
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  const adminToken = cookies[ADMIN_COOKIE];
  if (!token && !adminToken) return null;

  // Customer account (normal login).
  let acct: Awaited<ReturnType<typeof getAccount>> | undefined;
  if (token) {
    const sellerId = await sellerForSession(token);
    if (sellerId) acct = await getAccount(sellerId);
  }
  // Owner-console session (separate login, separate cookie).
  const admin = adminConfigured() && (await adminSessionValid(adminToken));
  if (!acct && !admin) return null;

  // Owner mode: the act-as cookie is only honored alongside a live owner
  // session, and only while the target still exists — anyone else's cookie is
  // ignored outright.
  let acting: NonNullable<HeaderAccount>["acting"] = null;
  const actAs = Number(cookies[ACT_AS_COOKIE]);
  const ownerId = admin ? await ownerSellerId() : null;
  if (admin && Number.isInteger(actAs) && actAs > 0) {
    const target = await getAccount(actAs);
    if (target) acting = { id: target.id, display_name: target.display_name, email: target.email, plan_tier: target.plan_tier, owner: target.id === ownerId };
  }
  // No customer login and no customer workspace opened: an owner session's /app
  // is the owner's OWN workspace (their personal seller row), so what they scan
  // or upload lands in their own inventory.
  if (admin && !acct && !acting && ownerId) {
    const own = await getAccount(ownerId);
    if (own) acting = { id: own.id, display_name: own.display_name, email: own.email, plan_tier: own.plan_tier, owner: true };
  }
  return { id: acct?.id ?? null, display_name: acct?.display_name ?? "Owner", plan_tier: acct?.plan_tier ?? null, admin, acting };
}

/** Client IP for the owner-login throttle (first X-Forwarded-For hop behind Railway's proxy). */
function clientIp(req: IncomingMessage): string {
  const xf = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xf) ? xf[0] : xf ?? "").split(",")[0].trim();
  return first || req.socket.remoteAddress || "unknown";
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

/**
 * A <input type="datetime-local"> value ("2026-09-05T14:30") is the USER's wall
 * time with no zone. Forms send the browser's offset (tz_offset, minutes, as
 * Date#getTimezoneOffset) so we can turn it into a real instant; without it we
 * fall back to the server's zone. Returns ISO or null when unparseable.
 */
function localToIso(v: string | undefined, tzOffsetMin: string | undefined): string | null {
  const m = (v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const off = Number(tzOffsetMin);
  if (Number.isFinite(off) && tzOffsetMin !== undefined && tzOffsetMin !== "") {
    return new Date(Date.UTC(y, mo - 1, d, h, mi) + off * 60_000).toISOString();
  }
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

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
// Both outcomes live on one page now; the mode query selects which forms show.
const scanPageFor = (kind: string): string => (kind === "pricing" ? "/app/scan?mode=price" : "/app/scan?mode=inventory");
/** Form field `mode` → batch kind. */
const kindForMode = (mode: string | undefined): string => (mode === "price" ? "pricing" : "scan");
/** Is the current workspace on Pro? Owner mode never hits the paywall. */
async function workspacePro(): Promise<boolean> {
  if (currentAccount()?.acting) return true;
  return isPro(await planTier(currentSellerId()));
}

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

  if (!lines.length) return scanPageFor(kind) + "&msg=" + encodeURIComponent("Paste at least one card line.");

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
  const scheduled = localToIso(f.scheduled_at, f.tz_offset);
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
/**
 * Batch-level settings read off the upload form: condition, language, pricing
 * rule and matching options, folded into a Seller view for pricing/titles.
 * Every chunk of a batch carries the same form fields, so only the first call
 * (`persist`) is allowed to write the "save as default" choices back.
 */
async function uploadSettings(fields: Record<string, string>, persist: boolean): Promise<{ seller: Seller; matching: IdentifyOptions }> {
  const base = await getSeller();
  const rr = parseRuleKey(fields.rule || "market");
  const condition = fields.condition || base.default_condition;
  const language = fields.language || base.default_language;

  if (persist) {
    if (fields.sku_prefix && fields.sku_prefix.trim() && fields.sku_prefix.trim() !== base.sku_prefix) {
      await updateSeller({ sku_prefix: fields.sku_prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "CARD" });
    }
    if (fields.save_defaults === "1") {
      await updateSeller({ default_condition: condition, default_language: language, price_mode: rr.mode, price_pct: rr.pct });
    }
  }
  const f = persist ? fields : { ...fields, save_matching: "" };
  const matching = identifyOpts(await matchingFromForm(f));
  const seller: Seller = { ...(await getSeller()), default_condition: condition, default_language: language, price_mode: rr.mode, price_pct: rr.pct };
  return { seller, matching };
}

const uploadImages = (files: UploadedFile[]): UploadedFile[] => files.filter((f) => f.field === "images" && isImage(f));

/** Open a photo batch (chunked upload step 1). Persists any "save as default" choices. */
async function startScanUpload(fields: Record<string, string>, kind: string): Promise<number> {
  await uploadSettings(fields, true);
  return createBatch("upload", fields.label?.trim() || null, kind);
}

/**
 * Store + identify photos into an open batch (chunked upload step 2, repeated).
 * `room` is how many more photos the batch may take; extras are dropped.
 * Returns the number added.
 */
async function ingestScanPhotos(batchId: number, fields: Record<string, string>, files: UploadedFile[], room: number): Promise<number> {
  const imgs = uploadImages(files).slice(0, Math.max(0, room));
  if (!imgs.length) return 0;
  const { seller, matching } = await uploadSettings(fields, false);
  const store = storage();
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
  await bumpBatchProgress(batchId, imgs.length);
  return imgs.length;
}

/** Close a photo batch (chunked upload step 3): duplicates, totals, titles. Returns the landing URL. */
async function finishScanUpload(batchId: number, fields: Record<string, string>, kind: string): Promise<string> {
  const { seller } = await uploadSettings(fields, false);
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  await titleBatch(batchId, seller);
  return batchLanding(kind, batchId);
}

/**
 * An open upload batch the current seller may still add to, or null. Chunks
 * and the finish call both go through this so a stray or replayed request
 * can't append to someone else's batch or to one that's already closed.
 */
async function openUploadBatch(batchId: number) {
  const b = await getBatch(batchId);
  return b && b.source === "upload" && b.status === "processing" ? b : null;
}

/**
 * Image-upload scan path (spec §2), single-request form: store each uploaded
 * photo in the object store, identify it, and create a review-queue item
 * carrying the image. This is the no-script fallback and the admin's one-shot
 * path; with script the same three steps run as start → chunk… → finish (see
 * the /app/scan/upload/* routes) so big batches never sit in one request.
 */
async function handleScanUpload(fields: Record<string, string>, files: UploadedFile[], kind = "scan", cap = MAX_UPLOAD_FILES_PRO): Promise<string> {
  if (!uploadImages(files).length) return scanPageFor(kind) + "&msg=" + encodeURIComponent("Choose at least one image (JPG/PNG/WebP/HEIC).");
  const batchId = await startScanUpload(fields, kind);
  await ingestScanPhotos(batchId, fields, files, cap);
  return finishScanUpload(batchId, fields, kind);
}

/**
 * The chunked photo upload, shared by the seller workspace and the owner's
 * uploader: `start` opens a batch, `chunk` adds up to a chunk of photos to it,
 * `finish` closes it. Each step answers JSON for the dropzone script. `cap` is
 * the plan's per-batch photo limit; `kind` is only consulted by `start` (later
 * steps read it off the batch).
 */
async function handleChunkedUpload(
  step: { op: "start"; kind: string } | { op: "chunk" | "finish"; batchId: number },
  fields: Record<string, string>,
  files: UploadedFile[],
  cap: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (step.op === "start") {
    const batchId = await startScanUpload(fields, step.kind);
    return { status: 200, body: { batchId, max: cap, chunk: UPLOAD_CHUNK_FILES } };
  }
  const b = await openUploadBatch(step.batchId);
  if (!b) return { status: 404, body: { error: "That upload batch is closed or isn't yours. Start the upload again." } };
  if (step.op === "chunk") {
    const room = cap - b.total;
    if (room <= 0) return { status: 409, body: { error: `This batch is full — max ${cap} photos per batch.`, total: b.total } };
    const added = await ingestScanPhotos(b.id, fields, files, Math.min(room, UPLOAD_CHUNK_FILES));
    return { status: 200, body: { added, total: b.total + added, max: cap } };
  }
  if (!b.total) return { status: 400, body: { error: "No photos were uploaded to this batch." } };
  const landing = await finishScanUpload(b.id, fields, b.kind);
  return { status: 200, body: { landing, total: b.total } };
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
  const scheduled = localToIso(f.scheduled_at, f.tz_offset);

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

/**
 * Listings bulk bar: publish now, schedule with spacing ("Space Out": one
 * listing every N minutes from a start time), back to draft, end, or run
 * whatever is due right now.
 */
async function handleListingsBulk(f: Record<string, string>, sellerId: number): Promise<string> {
  const ids = (f.ids || "").split(",").map((s) => intOr(s, 0)).filter(Boolean);
  const back = (msg: string) => "/app/listings?msg=" + encodeURIComponent(msg);
  if (f.do === "run-due") {
    const r = await runScheduledPublishes((sid, fn) => runWithSeller(sid, fn), sellerId);
    return back(`Ran the scheduler: ${r.published} published, ${r.failed} failed${r.parked ? `, ${r.parked} parked as drafts` : ""}.`);
  }
  if (!ids.length) return back("Select at least one listing.");
  if (f.do === "schedule") {
    const startIso = localToIso(f.start, f.tz_offset);
    const start = startIso ? new Date(startIso) : new Date(Date.now() + 60_000);
    const gapMin = Math.max(0, Math.min(1440, intOr(f.gap, 5)));
    let n = 0;
    for (const id of ids) {
      await scheduleListing(id, new Date(start.getTime() + n * gapMin * 60_000).toISOString());
      n++;
    }
    const last = new Date(start.getTime() + (n - 1) * gapMin * 60_000);
    // Echo times in the user's own zone (tz_offset), not the server's.
    const off = Number.isFinite(Number(f.tz_offset)) && f.tz_offset !== "" ? Number(f.tz_offset) : new Date().getTimezoneOffset();
    const wall = (d: Date) => new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16).replace("T", " ");
    return back(`Scheduled ${n} listing${n === 1 ? "" : "s"} from ${wall(start)}${n > 1 ? ` to ${wall(last)}, ${gapMin} min apart` : ""} (your local time).`);
  }
  if (f.do === "unschedule") {
    for (const id of ids) await scheduleListing(id, null);
    return back(`${ids.length} listing${ids.length === 1 ? "" : "s"} back to draft.`);
  }
  if (f.do === "end") {
    let n = 0;
    for (const id of ids) {
      try {
        await endListing(id);
        n++;
      } catch (err) {
        console.error("bulk end:", err);
      }
    }
    return back(`Ended ${n} of ${ids.length} listing${ids.length === 1 ? "" : "s"}.`);
  }
  // publish now
  let ok = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      await publishListing(id);
      ok++;
    } catch (err) {
      errors.push(`#${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return back(`Published ${ok} of ${ids.length}.${errors.length ? " " + errors.slice(0, 3).join(" · ") + (errors.length > 3 ? ` (+${errors.length - 3} more — see the rows)` : "") : ""}`);
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
      await markShippedOnEbay(o.external_ref, o.tracking_number ? { carrier: o.tracking_carrier ?? "Other", number: o.tracking_number } : undefined);
      return o.tracking_number ? ` Marked shipped on eBay with ${o.tracking_carrier ?? ""} tracking ${o.tracking_number}.` : " Marked shipped on eBay.";
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

    // ---- auth (login / signup / logout / password reset) ----
    if (path === "/login" || path === "/signup" || path === "/logout") {
      return await handleAuth(req, res, url, path, method);
    }
    if (path === "/reset-password" || path.startsWith("/reset-password/")) {
      return await handleReset(req, res, url, path, method);
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

    // ---- owner console (owner-role-gated) ----
    if (path === "/admin" || path.startsWith("/admin/")) {
      return await handleAdmin(req, res, url, path, method, msg);
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
      const tier = account?.id != null ? await planTier(account.id) : "free";
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
      if (acct?.id != null) await logActivity({ sellerId: acct.id, kind: "logout", method, path, detail: "Logged out" });
      await destroySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      return redirectWithCookie(res, "/", clearSessionCookie());
    }
    return redirect(res, "/");
  }

  const isSignup = path === "/signup";

  if (method === "GET") {
    if (acct?.id != null) return redirect(res, "/app"); // already signed in
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
        const displayName = String(f.display_name ?? "").trim();
        const sellerId = await createAccount(email, password, displayName);
        const token = await createSession(sellerId);
        await logActivity({ sellerId, kind: "signup", method, path, detail: "Created account" });
        // Land signed in, on the dashboard, with a welcome — never back on a login screen.
        const acct = await getAccount(sellerId);
        const landing =
          next === "/app"
            ? "/app?msg=" + encodeURIComponent(`Welcome, ${acct?.display_name ?? (displayName || "there")}! Your workspace is ready.`)
            : next;
        return redirectWithCookie(res, landing, sessionCookie(token));
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
      // Keep the email filled in and offer the reset path right in the error,
      // so a forgotten password never dead-ends.
      return sendPage(res, renderLogin({ error: "Wrong email or password.", email, next: f.next, showForgot: true }), "/login");
    }
    const token = await createSession(sellerId);
    await logActivity({ sellerId, kind: "login", method, path, detail: "Signed in" });
    return redirectWithCookie(res, next, sessionCookie(token));
  }

  return redirect(res, "/login");
}

// ---- password reset ---------------------------------------------------------
// /reset-password           GET form · POST email → emailed link (same copy
//                           whether or not the address is registered)
// /reset-password/<token>   GET new-password form · POST sets it, signs the
//                           user in, and signs out every other session

async function handleReset(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  method: string
) {
  const next = url.searchParams.get("next") ?? undefined;
  const m = path.match(/^\/reset-password\/([A-Za-z0-9_-]{20,})$/);

  if (m) {
    const token = m[1];
    if (method === "GET") {
      return sendPage(res, renderResetForm({ token, valid: await resetTokenValid(token), next }), "/reset-password");
    }
    if (method === "POST") {
      const f = parseForm(await readBody(req));
      try {
        const sellerId = await consumePasswordReset(token, String(f.password ?? ""));
        if (!sellerId) return sendPage(res, renderResetForm({ token, valid: false, next: f.next }), "/reset-password");
        const session = await createSession(sellerId);
        await logActivity({ sellerId, kind: "login", method, path: "/reset-password", detail: "Set a new password and signed in" });
        const to = safeNext(f.next);
        const landing = to === "/app" ? "/app?msg=" + encodeURIComponent("Password updated — you're signed in.") : to;
        return redirectWithCookie(res, landing, sessionCookie(session));
      } catch (err) {
        const message = err instanceof AuthError ? err.message : "Could not set that password. Please try again.";
        if (!(err instanceof AuthError)) console.error("reset error:", err);
        return sendPage(res, renderResetForm({ token, valid: true, error: message, next: f.next }), "/reset-password");
      }
    }
    return redirect(res, "/reset-password");
  }

  if (path !== "/reset-password") return notFound(res);

  if (method === "GET") {
    return sendPage(res, renderResetRequest({ email: url.searchParams.get("email") ?? "", next }), "/reset-password");
  }
  if (method === "POST") {
    const f = parseForm(await readBody(req));
    const email = String(f.email ?? "").trim();
    if (!isValidEmail(email)) {
      return sendPage(res, renderResetRequest({ email, next: f.next, error: "Enter a valid email address." }), "/reset-password");
    }
    try {
      const r = await createPasswordReset(email);
      if (r) {
        const link = `${appBaseUrl(url.origin)}/reset-password/${r.token}${f.next ? "?next=" + encodeURIComponent(f.next) : ""}`;
        await sendMail({
          to: email,
          subject: "Reset your CardIndex password",
          text:
            `Someone (hopefully you) asked to reset the password for this CardIndex account.\n\n` +
            `Set a new password here — the link works once and expires in 60 minutes:\n${link}\n\n` +
            `If you didn't ask for this, ignore this email; your password hasn't changed.`,
          html:
            `<p>Someone (hopefully you) asked to reset the password for this CardIndex account.</p>` +
            `<p><a href="${link}">Set a new password</a> — the link works once and expires in 60 minutes.</p>` +
            `<p>If you didn't ask for this, ignore this email; your password hasn't changed.</p>`,
        });
        await logActivity({ sellerId: r.sellerId, kind: "action", method, path, detail: "Requested a password reset link" });
      }
    } catch (err) {
      console.error("reset email error:", err);
      return sendPage(
        res,
        renderResetRequest({ email, next: f.next, error: "We couldn't send the email just now. Please try again in a minute." }),
        "/reset-password"
      );
    }
    return sendPage(res, renderResetRequest({ email, next: f.next, sent: true, mode: mailMode() }), "/reset-password");
  }
  return redirect(res, "/reset-password");
}

// ---- owner console sub-router ---------------------------------------------

/**
 * The owner's CRM. Gate: a live OWNER session (its own login at /admin/login,
 * its own cookie). Customer accounts — Free, Pro, any of them — never get in;
 * without an owner session every /admin URL just shows the owner sign-in.
 * Data access here is deliberately cross-tenant (app/admin.ts). The uploader
 * (/admin/upload) is the owner's PERSONAL one: it runs inside the owner's own
 * seller scope (app/admin.ts ensureOwnerSeller) through the very same handlers
 * the customer scan page uses, so cards land in the owner's inventory — never
 * in a customer's account.
 */
async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  method: string,
  msg: string | undefined
) {
  const acct = currentAccount();
  const admin = !!acct?.admin;

  // ---- owner sign-in / sign-out (no session needed) ----
  if (path === "/admin/login") {
    if (method === "POST") {
      const f = parseForm(await readBody(req));
      const ip = clientIp(req);
      const email = String(f.email ?? "");
      const next = f.next && f.next.startsWith("/admin") && !f.next.startsWith("//") ? f.next : "/admin";
      if (!adminConfigured()) return sendPage(res, renderAdminLogin({ configured: false }), "/admin/login");
      if (adminAuthenticate(email, String(f.password ?? ""), ip)) {
        const token = await createAdminSession(ip);
        return redirectWithCookie(res, next, adminCookie(token));
      }
      const locked = adminLockedFor(ip);
      return sendPage(res, renderAdminLogin({ configured: true, email, error: "Wrong owner email or password.", lockedMinutes: locked || undefined, next: f.next }), "/admin/login");
    }
    if (admin) return redirect(res, "/admin");
    return sendPage(res, renderAdminLogin({ configured: adminConfigured(), lockedMinutes: adminLockedFor(clientIp(req)) || undefined, next: url.searchParams.get("next") ?? undefined }), "/admin/login");
  }
  if (path === "/admin/logout") {
    if (method === "POST") {
      await destroyAdminSession(parseCookies(req.headers.cookie)[ADMIN_COOKIE]);
      // Ending the owner session also ends owner mode.
      res.writeHead(303, { location: "/admin/login", "set-cookie": [clearAdminCookie(), clearActAsCookie()] });
      return res.end();
    }
    return redirect(res, "/admin");
  }

  // ---- everything else needs the owner session ----
  if (!admin || !acct) {
    if (method === "GET") return redirect(res, "/admin/login?next=" + encodeURIComponent(path + (url.search || "")));
    return redirect(res, "/admin/login");
  }

  let m: RegExpMatchArray | null;
  const back = (id: number, note: string) => `/admin/users/${id}?msg=` + encodeURIComponent(note);

  if (method === "POST") {
    if (path === "/admin/stop-acting") {
      const to = acct.acting && !acct.acting.owner ? `/admin/users/${acct.acting.id}` : "/admin";
      return redirectWithCookie(res, to, clearActAsCookie());
    }

    const ctype = String(req.headers["content-type"] ?? "");
    const uploadBack = (note: string) => "/admin/upload?msg=" + encodeURIComponent(note);

    // ---- the owner's own uploader: photos (multipart) ----
    // Same pipeline as /app/scan/upload, inside the OWNER's seller scope. The
    // batch lands in the owner's own review queue; the act-as cookie is pinned
    // to the owner's row so the review page opens in their own workspace even
    // if a customer's workspace was open before.
    const ownerChunked = path.match(/^\/admin\/upload\/photos\/(?:(start)|(\d+)\/(chunk|finish))$/);
    const queueMsg = (n: number) => `${n} photo${n === 1 ? "" : "s"} uploaded to your own review queue. Confirm to add them to your inventory.`;
    if ((path === "/admin/upload/photos" || ownerChunked) && ctype.startsWith("multipart/form-data")) {
      const ownerId = await ownerSellerId();
      if (!ownerId) {
        const note = "The owner account isn't set up — check ADMIN_EMAIL and restart.";
        return ownerChunked ? sendJson(res, 500, { error: note }) : redirect(res, uploadBack(note));
      }
      const boundary = boundaryOf(ctype);
      let mp = { fields: {} as Record<string, string>, files: [] as UploadedFile[] };
      try {
        const buf = await readBodyBuffer(req);
        if (boundary) mp = parseMultipart(buf, boundary);
      } catch (err) {
        return ownerChunked ? sendJson(res, 413, { error: tooLargeMessage(err) }) : redirect(res, uploadBack(tooLargeMessage(err)));
      }
      // Chunked (fetch) steps, in the owner's seller scope. The finish reply
      // pins the act-as cookie so the landing page opens in the owner's workspace.
      if (ownerChunked) {
        const step: Parameters<typeof handleChunkedUpload>[0] = ownerChunked[1]
          ? { op: "start", kind: "scan" }
          : { op: ownerChunked[3] as "chunk" | "finish", batchId: Number(ownerChunked[2]) };
        const r = await runWithSeller(ownerId, () => handleChunkedUpload(step, mp.fields, mp.files, MAX_UPLOAD_FILES_PRO));
        if (step.op === "finish" && r.status === 200) {
          const landing = String(r.body.landing) + "?msg=" + encodeURIComponent(queueMsg(Number(r.body.total)));
          return sendJson(res, 200, { ...r.body, landing }, actAsCookie(ownerId));
        }
        return sendJson(res, r.status, r.body);
      }
      const landing = await runWithSeller(ownerId, () => handleScanUpload(mp.fields, mp.files));
      if (!landing.startsWith("/app/review/")) return redirect(res, uploadBack(decodeURIComponent(landing.split("msg=")[1] ?? "Nothing uploaded.")));
      const n = mp.files.length;
      return redirectWithCookie(res, landing + "?msg=" + encodeURIComponent(queueMsg(n)), actAsCookie(ownerId));
    }

    const f = parseForm(await readBody(req));

    // ---- the owner's own uploader: pasted list ----
    if (path === "/admin/upload") {
      const ownerId = await ownerSellerId();
      if (!ownerId) return redirect(res, uploadBack("The owner account isn't set up — check ADMIN_EMAIL and restart."));
      const landing = await runWithSeller(ownerId, () => handleScan(f));
      if (!landing.startsWith("/app/review/")) return redirect(res, uploadBack("Paste at least one card line."));
      const n = (f.lines ?? "").split(/\r?\n/).filter((l) => l.trim()).length;
      return redirectWithCookie(res, landing + "?msg=" + encodeURIComponent(`${n} card${n === 1 ? "" : "s"} queued in your own review queue. Confirm to add them to your inventory.`), actAsCookie(ownerId));
    }

    if ((m = path.match(/^\/admin\/users\/(\d+)\/(act-as|plan)$/))) {
      const id = Number(m[1]);
      const target = await getUser(id);
      if (!target) return notFound(res);

      if (m[2] === "act-as") {
        await logActivity({ sellerId: id, byOwner: true, kind: "owner", method, path, detail: "Owner opened this workspace" });
        return redirectWithCookie(res, safeNext(f.next), actAsCookie(id));
      }

      // plan
      const tier = f.tier === "pro" ? "pro" : "free";
      if (tier !== target.plan_tier) {
        await setPlanTier(id, tier);
        await logActivity({ sellerId: id, byOwner: true, kind: "plan_change", method, path, detail: `Plan changed ${target.plan_tier === "pro" ? "Pro" : "Free"} → ${tier === "pro" ? "Pro" : "Free"} by owner` });
      }
      return redirect(res, back(id, `${target.display_name} is now on the ${tier === "pro" ? "Pro" : "Free"} tier.`));
    }

    if ((m = path.match(/^\/admin\/feedback\/(\d+)\/reply$/))) {
      const id = Number(m[1]);
      const reply = (f.reply ?? "").trim();
      if (f.close === "1") {
        await closeFeedback(id, reply);
      } else if (reply) {
        await replyFeedback(id, reply);
      }
      const ret = (req.headers.referer ?? "").includes("/admin/users/") ? req.headers.referer! : "/admin/feedback";
      return redirect(res, ret.split("?")[0] + "?msg=" + encodeURIComponent(f.close === "1" ? "Closed." : reply ? "Reply sent — it's in their inbox." : "Nothing to send.") + `#fb-${id}`);
    }

    return redirect(res, "/admin");
  }

  // ---- GET pages ----
  if (path === "/admin") {
    const [ov, daily, recent, newest] = await Promise.all([overview(), dailyActive(14), listActivity({}, 25), listUsers({ sort: "newest" }, 6)]);
    return sendPage(res, renderAdminHome(ov, daily, recent, newest, msg), "/admin");
  }
  if (path === "/admin/users") {
    const f = { q: url.searchParams.get("q") ?? undefined, tier: url.searchParams.get("tier") ?? undefined, sort: url.searchParams.get("sort") ?? undefined };
    return sendPage(res, renderAdminUsers(await listUsers(f), f, msg), "/admin/users");
  }
  if ((m = path.match(/^\/admin\/users\/(\d+)$/))) {
    const id = Number(m[1]);
    const u = await getUser(id);
    if (!u) return notFound(res);
    const [usage, seller, batches, activity, feedback] = await Promise.all([
      userUsage(id),
      runWithSeller(id, () => getSeller()),
      userBatches(id, 8),
      listActivity({ sellerId: id }, 40),
      listAllFeedback({ sellerId: id }, 20),
    ]);
    return sendPage(res, renderAdminUser(u, usage, seller, batches, activity, feedback, msg), path);
  }
  if (path === "/admin/upload") {
    // The owner's personal uploader: everything here is the owner's own account.
    const ownerId = await ownerSellerId();
    const owner = ownerId ? await getUser(ownerId) : undefined;
    if (!ownerId || !owner) return sendPage(res, renderAdminUpload(null, null, null, [], msg ?? "The owner account isn't set up — check ADMIN_EMAIL and restart."), "/admin/upload");
    const [seller, usage, batches] = await Promise.all([runWithSeller(ownerId, () => getSeller()), userUsage(ownerId), userBatches(ownerId, 8)]);
    return sendPage(res, renderAdminUpload(owner, seller, usage, batches, msg), "/admin/upload");
  }
  if (path === "/admin/activity") {
    const f = { sellerId: num(url.searchParams.get("user")), kind: url.searchParams.get("kind") ?? undefined };
    const [rows, users] = await Promise.all([listActivity(f, 200), listUsers({ sort: "name" })]);
    return sendPage(res, renderAdminActivity(rows, f, users, msg), "/admin/activity");
  }
  if (path === "/admin/feedback") {
    const status = url.searchParams.get("status") ?? "all";
    return sendPage(res, renderAdminFeedback(await listAllFeedback({ status }), status, msg), "/admin/feedback");
  }
  return notFound(res);
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
  // Owner session: the request runs as the owner's OWN seller row (their
  // personal workspace — no customer login needed) or, when the owner has
  // explicitly opened a customer's workspace (owner mode), as that customer.
  // Neither hits the paywall. Only owner-mode actions are logged: the customer
  // activity feed shouldn't fill up with the owner's own uploads.
  if (acct?.acting) {
    const sellerId = acct.acting.id;
    if (!acct.acting.owner && !path.startsWith("/api/")) {
      await logActivity({ sellerId, byOwner: true, kind: method === "POST" ? "action" : "page", method, path, detail: describeActivity(method, path) });
    }
    return runWithSeller(sellerId, () => handleAppAuthed(req, res, url, path, method, msg));
  }
  if (!acct || acct.id == null) {
    // Owner session without an owner seller row (console not configured): back to the console.
    if (acct?.admin) return redirect(res, "/admin?msg=" + encodeURIComponent("Your owner account isn't set up — check ADMIN_EMAIL and restart."));
    if (method === "GET") {
      return redirect(res, "/login?next=" + encodeURIComponent(path + (url.search || "")));
    }
    return redirect(res, "/login");
  }
  // Pro paywall. Free accounts get the dashboard, the pricing tool, card search,
  // sales lookup, inbox and settings (CardUploader's free surface); anything
  // that adds cards to inventory, manages stock, or publishes is Pro and bounces
  // to /pricing.
  if (proRequired(path) && !isPro(await planTier(acct.id))) {
    return redirect(res, "/pricing?upgrade=1");
  }
  // Activity tracking (feeds the owner console). API calls are skipped — they're
  // type-ahead noise; every page view and form action is one row.
  if (!path.startsWith("/api/")) {
    await logActivity({ sellerId: acct.id, kind: method === "POST" ? "action" : "page", method, path, detail: describeActivity(method, path) });
  }
  return runWithSeller(acct.id, () => handleAppAuthed(req, res, url, path, method, msg));
}

/** Workspace paths a Free account may use; everything else under /app is Pro. */
const FREE_APP_PATHS = new Set([
  "/app",
  // Add cards: the page itself is open (its "price only" outcome is free);
  // the inventory outcome is gated where the form is handled (see kindForMode).
  "/app/scan",
  "/app/scan/upload",
  "/app/pricing-tool",
  "/app/pricing-tool/upload",
  "/app/card-search",
  "/app/sales-lookup",
  "/app/inbox",
  "/app/settings",
  "/api/identify",
  "/api/title-preview",
  "/api/description-preview",
]);
function proRequired(path: string): boolean {
  if (FREE_APP_PATHS.has(path)) return false;
  // Chunked photo upload steps: the price-only outcome is free; the inventory
  // outcome is gated in the `start` step itself (see handleAppAuthed).
  if (/^\/app\/scan\/upload\/(start|\d+\/(chunk|finish))$/.test(path)) return false;
  // Priced lists (results + share links) belong to the free pricing tool;
  // converting one into an inventory batch does not.
  if (/^\/app\/pricing\/\d+(\/(share|unshare))?$/.test(path)) return false;
  return true;
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
      // Chunked photo upload (fetch from the dropzone script): answers JSON.
      const chunked = path.match(/^\/app\/scan\/upload\/(?:(start)|(\d+)\/(chunk|finish))$/);
      let mp = { fields: {} as Record<string, string>, files: [] as UploadedFile[] };
      try {
        const buf = await readBodyBuffer(req);
        if (boundary) mp = parseMultipart(buf, boundary);
      } catch (err) {
        if (chunked) return sendJson(res, 413, { error: tooLargeMessage(err) });
        // Send the user back to the page they uploaded from, not always /app/scan.
        const mi = path.match(/^\/app\/review\/(\d+)\/item\/\d+\/image$/);
        // (The multipart body couldn't be parsed, so the mode field is unknown; the
        // page picks its default by plan.)
        const back = mi ? `/app/review/${mi[1]}` : path === "/app/orders/import" ? "/app/orders" : path === "/app/pricing-tool/upload" ? "/app/scan?mode=price" : "/app/scan";
        return redirect(res, back + (back.includes("?") ? "&" : "?") + "msg=" + encodeURIComponent(tooLargeMessage(err)));
      }
      if (chunked) {
        const pro = await workspacePro();
        let step: Parameters<typeof handleChunkedUpload>[0];
        if (chunked[1]) {
          const kind = kindForMode(mp.fields.mode);
          // Same paywall as the one-shot form: inventory batches are Pro.
          if (kind === "scan" && !pro) return sendJson(res, 402, { error: "Adding cards to inventory is a Pro feature.", redirect: "/pricing?upgrade=1" });
          step = { op: "start", kind };
        } else {
          step = { op: chunked[3] as "chunk" | "finish", batchId: Number(chunked[2]) };
        }
        const r = await handleChunkedUpload(step, mp.fields, mp.files, maxUploadFiles(pro));
        return sendJson(res, r.status, r.body);
      }
      if (path === "/app/scan/upload" || path === "/app/pricing-tool/upload") {
        const kind = path === "/app/pricing-tool/upload" ? "pricing" : kindForMode(mp.fields.mode);
        const pro = await workspacePro();
        if (kind === "scan" && !pro) return redirect(res, "/pricing?upgrade=1");
        return redirect(res, await handleScanUpload(mp.fields, mp.files, kind, maxUploadFiles(pro)));
      }
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

    if (path === "/app/scan" || path === "/app/pricing-tool") {
      const kind = path === "/app/pricing-tool" ? "pricing" : kindForMode(f.mode);
      if (kind === "scan" && !(await workspacePro())) return redirect(res, "/pricing?upgrade=1");
      return redirect(res, await handleScan(f, kind));
    }
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
        const r = await shipOrder(id, (f.tracking ?? "").trim() ? { carrier: f.carrier ?? "Other", number: f.tracking } : null);
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
    if (path === "/app/listings/bulk") return redirect(res, await handleListingsBulk(f, currentSellerId()));
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
  // The pricing tool is the "price only" outcome of the Add cards page.
  if (path === "/app/pricing-tool") return redirect(res, "/app/scan?mode=price" + (msg ? "&msg=" + encodeURIComponent(msg) : ""));
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
  if (path === "/app/sales-lookup") {
    const sp: SalesParams = {
      q: url.searchParams.get("q") ?? undefined,
      market: url.searchParams.get("market") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      grade: url.searchParams.get("grade") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    };
    return sendPage(res, renderSalesLookup(sp, await searchSales(sp), msg), path);
  }
  if (path === "/app/orders/picklist") return sendPage(res, renderPicklist(await picklist()), path);
  if (path === "/app/inbox") return sendPage(res, renderInbox(await listFeedback(), msg), path);
  if (path === "/app/scan") {
    const pro = await workspacePro();
    const m = url.searchParams.get("mode");
    const mode = m === "price" || m === "inventory" ? m : pro ? "inventory" : "price";
    return sendPage(res, await renderScan(msg, url.searchParams.get("add") ?? undefined, { mode, pro }), "/app/scan");
  }
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
  // Scheduled / spaced-out eBay publishing (app/ebay-sell.ts). Set SCHEDULER_DISABLED=1
  // when running several instances so only one publishes.
  if (process.env.SCHEDULER_DISABLED !== "1") startScheduler((sid, fn) => runWithSeller(sid, fn));
});
