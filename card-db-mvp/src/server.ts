import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, sep } from "node:path";
import { getGameBySlug, getSetBySlug, getCard, getVariants, latestMarket, pool, getAllSets } from "./pg.ts";
import { ebayConfigured, searchListed } from "./ebay.ts";
import { tcgConfigured, conditionPrices } from "./tcgplayer.ts";
import { page } from "./render/layout.ts";
import { renderHome, renderBrowse, renderSet, renderCard, renderSearch, sitemapUrls } from "./render/pages.ts";
import { search, suggest, type SearchParams } from "./search.ts";
import { searchSales, ensureSalesSchema, type SalesParams } from "./sales.ts";
import { renderSales } from "./render/sales.ts";
import { money } from "./util.ts";

// ---- member area wiring ---------------------------------------------------
import { identify, parseInput, type IdentifyOptions, type IdentifyResult } from "./app/identify.ts";
import {
  ensureCollectionSchema, getMember, updateMember, createBatch, addItemFromIdentify, addItemFromCatalog, detectDuplicates, finalizeBatch,
  getBatch, getItems, getItem, updateItem, replaceMatch, revalueItem, bumpBatchProgress, commitToCollection,
  shareBatch, unshareBatch, getBatchByToken, getItemsPublic, setBatchKind,
  listCollection, getCollectionItem, updateCollectionItems, removeCollectionItems, collectionCsv,
  addWishlist, removeWishlist, setWishlistTarget, cardMemberState, WISHLIST_FREE_MAX,
  type Member,
} from "./app/collection.ts";
import { prefsFromForm, serializeMatchingPrefs, isEmptyPrefs, type MatchingPrefs } from "./app/matching.ts";
import { renderCollectionHome, renderCards, renderUploads, renderSettings, renderWishlist, renderInbox } from "./render/collection.ts";
import { renderAdd, renderReview, renderGraded, renderFromSet, renderPriced } from "./render/collection-add.ts";
import { parseCerts, lookupCert, gradeLabel, graderOf, GRADE_VALUES } from "./app/graded.ts";
import { ensureFeedbackSchema, submitFeedback, listFeedback, replyFeedback, closeFeedback } from "./app/feedback.ts";
import { startHashIndexOnBoot } from "./app/hashindex.ts";
import { startSoldSampleOnBoot } from "./app/soldimport.ts";
import {
  readBodyBuffer, parseMultipart, boundaryOf, isImage, tooLargeMessage, maxUploadFiles, MAX_UPLOAD_FILES_PRO, UPLOAD_CHUNK_FILES,
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

// ---- owner console (/admin) -----------------------------------------------
import {
  ensureAdminSchema, logActivity, describeActivity, listUsers, getUser, userUsage, overview, listActivity, dailyActive,
  listAllFeedback, userBatches, actAsCookie, clearActAsCookie, ACT_AS_COOKIE,
  ADMIN_COOKIE, adminConfigured, adminAuthenticate, adminLockedFor, adminSessionValid, createAdminSession, destroyAdminSession,
  adminCookie, clearAdminCookie, ensureOwnerSeller, ownerSellerId,
} from "./app/admin.ts";
import {
  renderAdminHome, renderAdminUsers, renderAdminUser, renderAdminActivity, renderAdminFeedback, renderAdminUpload, renderAdminLogin,
} from "./render/admin.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);

// Fail fast with a helpful message if Postgres isn't reachable.
try {
  await pool.query("SELECT 1");
} catch {
  console.error(`\n  Cannot connect to Postgres via DATABASE_URL.\n  Start it:   npm run db:up\n  Load data:  npm run seed && npm run pg:migrate\n`);
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

// Plan bits (idempotent): sellers.plan_tier + the meta flag table.
try {
  await ensureBillingSchema();
} catch (err) {
  console.error("\n  Failed to prepare the billing schema (sellers.plan_tier / meta).\n", err);
  process.exit(1);
}

// Member-area tables: collection, wishlist, review-item columns, feedback, the
// sold-sales archive — idempotent, same pattern as the auth/billing bootstraps.
try {
  await ensureCollectionSchema();
  await ensureFeedbackSchema();
  await ensureSalesSchema();
} catch (err) {
  console.error("\n  Failed to prepare the member-area schema (collection, wishlist, feedback, sold sales).\n", err);
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
// The owner's own member row (their personal collection / uploader). Idempotent.
try {
  const oid = await ensureOwnerSeller();
  if (oid) console.log(`  Owner account: member #${oid} (${process.env.ADMIN_EMAIL}) — /admin/upload adds cards there.`);
} catch (err) {
  console.error("\n  Failed to prepare the owner's own account.\n", err);
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

/** Permanent redirect (old /app bookmarks → /collection). */
function redirectPermanent(res: ServerResponse, location: string) {
  res.writeHead(301, { location });
  res.end();
}

/** Redirect while setting (or clearing) the session cookie. */
function redirectWithCookie(res: ServerResponse, location: string, cookie: string) {
  res.writeHead(303, { location, "set-cookie": cookie });
  res.end();
}

/**
 * Resolve the signed-in account from the session cookie. Returns null instantly
 * (no DB hit) when there is no cookie — so logged-out visitors and crawlers on
 * the public catalog pay nothing.
 */
async function resolveAccount(req: IncomingMessage): Promise<HeaderAccount> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  const adminToken = cookies[ADMIN_COOKIE];
  if (!token && !adminToken) return null;

  // Member account (normal login).
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
  // No member login and no member's collection opened: an owner session's
  // /collection is the owner's OWN collection (their personal row).
  if (admin && !acct && !acting && ownerId) {
    const own = await getAccount(ownerId);
    if (own) acting = { id: own.id, display_name: own.display_name, email: own.email, plan_tier: own.plan_tier, owner: true };
  }
  return { id: acct?.id ?? null, display_name: acct?.display_name ?? "Owner", plan_tier: acct?.plan_tier ?? null, admin, acting };
}

/** The member id whose collection/wishlist a request should read (public pages). */
function viewerMemberId(acct: HeaderAccount): number | null {
  if (!acct) return null;
  if (acct.acting) return acct.acting.id;
  return acct.id;
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

/** Redirect back to the referring page when it's a review page, else fallback. */
function redirectBack(req: IncomingMessage, res: ServerResponse, fallback: string) {
  const ref = req.headers.referer;
  if (ref && /\/collection\/review\/\d+/.test(ref)) return redirect(res, ref);
  redirect(res, fallback);
}

// ---- member area: mutations -----------------------------------------------

/**
 * Read the Advanced Matching Options fields off an add form (set names resolve
 * against the catalog), persisting them as the member's defaults on request.
 */
async function matchingFromForm(f: Record<string, string>): Promise<MatchingPrefs> {
  const prefs = prefsFromForm(f, await getAllSets());
  if (f.save_matching === "1") await updateMember({ matching_prefs: serializeMatchingPrefs(prefs) });
  return prefs;
}
const identifyOpts = (p: MatchingPrefs): IdentifyOptions => (isEmptyPrefs(p) ? {} : p);

/** Where a finished batch goes: price checks to their priced list, the rest to review. */
const batchLanding = (kind: string, batchId: number): string => (kind === "pricing" ? `/collection/priced/${batchId}` : `/collection/review/${batchId}`);
/** Both outcomes live on one page; the mode query selects which forms show. */
const addPageFor = (kind: string): string => (kind === "pricing" ? "/collection/add?mode=price" : "/collection/add?mode=collection");
/** Form field `mode` → batch kind. */
const kindForMode = (mode: string | undefined): string => (mode === "price" ? "pricing" : "scan");
/** Is the current member on Pro? Owner mode never hits the paywall. */
async function memberPro(): Promise<boolean> {
  if (currentAccount()?.acting) return true;
  return isPro(await planTier(currentSellerId()));
}

/** Pasted list → identified items → review (or the priced list). */
async function handlePaste(f: Record<string, string>, kind = "scan"): Promise<string> {
  const base = await getMember();
  const condition = f.condition || base.default_condition;
  const language = f.language || base.default_language;
  if (f.save_defaults === "1") await updateMember({ default_condition: condition, default_language: language });
  const matching = identifyOpts(await matchingFromForm(f));
  const member: Member = { ...(await getMember()), default_condition: condition, default_language: language };

  const lines = (f.lines || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500);
  if (!lines.length) return addPageFor(kind) + "&msg=" + encodeURIComponent("Paste at least one card line.");

  const batchId = await createBatch("paste", f.label?.trim() || null, kind);
  for (const line of lines) {
    const result = await identify(line, matching);
    await addItemFromIdentify(batchId, line, result, member);
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  return batchLanding(kind, batchId);
}

/**
 * Graded slabs: one item per cert. With a lookup provider the cert resolves to a
 * card hint + grade; otherwise the item waits in review carrying the cert, and
 * the member picks the card and grade (link-out to the grader for verification).
 */
async function handleGraded(f: Record<string, string>): Promise<string> {
  const member = await getMember();
  const grader = graderOf(f.grader)?.key ?? "PSA";
  const { certs } = parseCerts(f.certs ?? "");
  if (!certs.length) return "/collection/graded?msg=" + encodeURIComponent("Paste at least one cert number.");
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
    await addItemFromIdentify(batchId, raw, result, member, { grade, grader, cert });
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  return `/collection/review/${batchId}`;
}

/**
 * Add from a set: chosen catalog cards → confirmed items. Picks arrive as
 * `picks` lines ("cardId,qty") and/or checkbox fields card_<id> with qty_<id>.
 */
async function handleFromSet(f: Record<string, string>): Promise<string> {
  const base = await getMember();
  const condition = f.condition || base.default_condition;
  const member: Member = { ...base, default_condition: condition };
  const picks = new Map<number, number>();
  for (const line of (f.picks ?? "").split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s*,\s*(\d+)?/);
    if (m) picks.set(Number(m[1]), Math.max(1, Number(m[2] || 1)) + (picks.get(Number(m[1])) ?? 0));
  }
  for (const k of Object.keys(f)) {
    const m = k.match(/^card_(\d+)$/);
    if (m && f[k]) picks.set(Number(m[1]), Math.max(1, intOr(f[`qty_${m[1]}`], 1)) + (picks.get(Number(m[1])) ?? 0));
  }
  if (!picks.size) return "/collection/from-set?msg=" + encodeURIComponent("Pick at least one card.");
  const batchId = await createBatch("catalog", f.label?.trim() || null, "creator");
  let added = 0;
  for (const [cardId, qty] of picks) {
    const vs = await getVariants(cardId);
    const v = vs.find((x) => x.is_default) ?? vs[0];
    if (!v) continue;
    if (await addItemFromCatalog(batchId, v.id, member, { quantity: qty, condition })) added++;
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  return `/collection/review/${batchId}?msg=` + encodeURIComponent(`${added} card${added === 1 ? "" : "s"} picked from the set — confirm and add to your collection.`);
}

/**
 * Batch-level settings read off the upload form: condition, language and
 * matching options, folded into a Member view. Every chunk of a batch carries
 * the same form fields, so only the first call (`persist`) may write the
 * "save as default" choices back.
 */
async function uploadSettings(fields: Record<string, string>, persist: boolean): Promise<{ member: Member; matching: IdentifyOptions }> {
  const base = await getMember();
  const condition = fields.condition || base.default_condition;
  const language = fields.language || base.default_language;
  if (persist && fields.save_defaults === "1") await updateMember({ default_condition: condition, default_language: language });
  const f = persist ? fields : { ...fields, save_matching: "" };
  const matching = identifyOpts(await matchingFromForm(f));
  const member: Member = { ...(await getMember()), default_condition: condition, default_language: language };
  return { member, matching };
}

const uploadImages = (files: UploadedFile[]): UploadedFile[] => files.filter((f) => f.field === "images" && isImage(f));

/** Open a photo batch (chunked upload step 1). Persists any "save as default" choices. */
async function startUpload(fields: Record<string, string>, kind: string): Promise<number> {
  await uploadSettings(fields, true);
  return createBatch("upload", fields.label?.trim() || null, kind);
}

/**
 * Store + identify photos into an open batch (chunked upload step 2, repeated).
 * `room` is how many more photos the batch may take; extras are dropped.
 */
async function ingestPhotos(batchId: number, fields: Record<string, string>, files: UploadedFile[], room: number): Promise<number> {
  const imgs = uploadImages(files).slice(0, Math.max(0, room));
  if (!imgs.length) return 0;
  const { member, matching } = await uploadSettings(fields, false);
  const store = storage();
  for (const file of imgs) {
    const put = await store.put(keyFor(member.id, file.filename), file.data, file.contentType);
    // Vision provider reads the card (pixels → labels → catalog match); falls back
    // to the filename hint when no provider is configured (see app/vision.ts).
    const { result: r0, hintText } = await visionIdentify({ data: file.data, filename: file.filename, contentType: file.contentType }, matching);
    // A photo we couldn't auto-match isn't a failure — it's a review task with
    // the image in hand, so route "failed" → "needs_review".
    const result = r0.status === "failed" ? { ...r0, status: "needs_review" as const } : r0;
    await addItemFromIdentify(batchId, hintText || file.filename, result, member, { imageUrl: put.url });
  }
  await bumpBatchProgress(batchId, imgs.length);
  return imgs.length;
}

/** Close a photo batch (chunked upload step 3): duplicates, totals. Returns the landing URL. */
async function finishUpload(batchId: number, kind: string): Promise<string> {
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  return batchLanding(kind, batchId);
}

/** An open upload batch the current member may still add to, or null. */
async function openUploadBatch(batchId: number) {
  const b = await getBatch(batchId);
  return b && b.source === "upload" && b.status === "processing" ? b : null;
}

/**
 * Single-request photo upload (the no-script fallback and the owner's one-shot
 * path). With script the same three steps run as start → chunk… → finish.
 */
async function handlePhotoUpload(fields: Record<string, string>, files: UploadedFile[], kind = "scan", cap = MAX_UPLOAD_FILES_PRO): Promise<string> {
  if (!uploadImages(files).length) return addPageFor(kind) + "&msg=" + encodeURIComponent("Choose at least one image (JPG/PNG/WebP/HEIC).");
  const batchId = await startUpload(fields, kind);
  await ingestPhotos(batchId, fields, files, cap);
  return finishUpload(batchId, kind);
}

/**
 * The chunked photo upload, shared by the member area and the owner's uploader:
 * `start` opens a batch, `chunk` adds up to a chunk of photos, `finish` closes
 * it. Each step answers JSON for the dropzone script. `cap` is the plan's
 * per-upload photo limit; `kind` is only consulted by `start`.
 */
async function handleChunkedUpload(
  step: { op: "start"; kind: string } | { op: "chunk" | "finish"; batchId: number },
  fields: Record<string, string>,
  files: UploadedFile[],
  cap: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (step.op === "start") {
    const batchId = await startUpload(fields, step.kind);
    return { status: 200, body: { batchId, max: cap, chunk: UPLOAD_CHUNK_FILES } };
  }
  const b = await openUploadBatch(step.batchId);
  if (!b) return { status: 404, body: { error: "That upload is closed or isn't yours. Start the upload again." } };
  if (step.op === "chunk") {
    const room = cap - b.total;
    if (room <= 0) return { status: 409, body: { error: `This upload is full — max ${cap} photos per upload.`, total: b.total } };
    const added = await ingestPhotos(b.id, fields, files, Math.min(room, UPLOAD_CHUNK_FILES));
    return { status: 200, body: { added, total: b.total + added, max: cap } };
  }
  if (!b.total) return { status: 400, body: { error: "No photos were uploaded." } };
  const landing = await finishUpload(b.id, b.kind);
  return { status: 200, body: { landing, total: b.total } };
}

/** Attach or replace a review item's front/back image (per-item upload in review). */
async function handleItemImage(batchId: number, itemId: number, fields: Record<string, string>, files: UploadedFile[]): Promise<void> {
  const item = await getItem(itemId);
  if (!item || item.batch_id !== batchId) return;
  const file = files.find((f) => f.field === "image" && isImage(f));
  if (!file) return;
  const member = await getMember();
  const put = await storage().put(keyFor(member.id, file.filename), file.data, file.contentType);
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

  // save: printing switch first (finish or alternative via the select)
  const vid = intOr(f.variant_id, item.matched_variant_id ?? 0);
  if (vid && vid !== item.matched_variant_id) {
    await replaceMatch(itemId, vid);
    item = (await getItem(itemId))!;
  }
  // Grade: grader + value selects ("PSA" + "10" → "PSA 10"); "Raw" clears it.
  const graderKey = f.grader != null ? graderOf(f.grader)?.key ?? null : item.grader;
  const gradeValue = f.grade_value != null ? (GRADE_VALUES.includes(f.grade_value) ? f.grade_value : null) : null;
  const grade = graderKey && gradeValue ? gradeLabel(graderKey, gradeValue) : f.grader != null ? null : item.grade;

  await updateItem(itemId, {
    condition: f.condition || item.condition,
    language: f.language || item.language,
    quantity: Math.max(1, intOr(f.quantity, item.quantity)),
    grade,
    grader: grade ? graderKey : null,
    paid_cents: f.paid != null ? toCents(f.paid) : item.paid_cents,
  });
  if (grade !== item.grade) await revalueItem(itemId);
}

/** Collection bulk bar: apply a condition to, or remove, the selected rows. */
async function handleCardsBulk(f: Record<string, string>): Promise<string> {
  const ids = (f.ids || "").split(",").map((s) => intOr(s, 0)).filter(Boolean);
  if (!ids.length) return "/collection/cards?msg=" + encodeURIComponent("No cards selected.");
  if (f.do === "remove") {
    const n = await removeCollectionItems(ids);
    return "/collection/cards?msg=" + encodeURIComponent(`Removed ${n} card${n === 1 ? "" : "s"} from your collection.`);
  }
  if (f.condition) {
    const n = await updateCollectionItems(ids, { condition: f.condition });
    return "/collection/cards?msg=" + encodeURIComponent(`Updated ${n} card${n === 1 ? "" : "s"}.`);
  }
  return "/collection/cards?msg=" + encodeURIComponent("Choose a condition to apply.");
}

/** One collection row's inline edit: quantity, paid, condition. */
async function handleCardEdit(id: number, f: Record<string, string>): Promise<string> {
  const row = await getCollectionItem(id);
  if (!row) return "/collection/cards";
  const patch: Record<string, unknown> = {};
  if (f.quantity != null) patch.quantity = Math.max(1, intOr(f.quantity, row.quantity));
  if (f.paid != null) patch.paid_cents = toCents(f.paid);
  if (f.condition) patch.condition = f.condition;
  await updateCollectionItems([id], patch);
  return "/collection/cards?msg=" + encodeURIComponent(`Saved ${row.card_name}.`);
}

async function handleSettings(f: Record<string, string>): Promise<void> {
  const matching = prefsFromForm(f, await getAllSets());
  await updateMember({
    display_name: f.display_name?.trim().slice(0, 80) || "Collector",
    default_condition: f.default_condition || "NM",
    default_language: f.default_language || "EN",
    training_opt_in: f.training_opt_in === "1" ? 1 : 0,
    matching_prefs: serializeMatchingPrefs(matching),
  });
}

/**
 * Wishlist add from a card page (or the wishlist page): a printing id, or a card
 * id (its default printing), plus an optional target price. Free accounts are
 * capped; Pro is unlimited.
 */
async function handleWishlistAdd(f: Record<string, string>, pro: boolean): Promise<string> {
  let variantId = intOr(f.variant_id, 0);
  if (!variantId && f.card_id) {
    const vs = await getVariants(intOr(f.card_id, 0));
    variantId = (vs.find((v) => v.is_default) ?? vs[0])?.id ?? 0;
  }
  const back = safeNext(f.next);
  const withMsg = (msg: string) => back + (back.includes("?") ? "&" : "?") + "msg=" + encodeURIComponent(msg);
  if (!variantId) return withMsg("Couldn't tell which card to add.");
  const target = (f.target ?? "").trim() ? toCents(f.target) : null;
  const r = await addWishlist(variantId, target, pro ? null : WISHLIST_FREE_MAX);
  if (!r.ok) {
    if (r.reason === "cap") return `/pricing?upgrade=1&msg=` + encodeURIComponent(`Your wishlist is full (${WISHLIST_FREE_MAX} cards on Free). Pro lifts the cap.`);
    return withMsg("That printing isn't in the catalog.");
  }
  return withMsg(r.existed ? (target != null ? "Target price updated." : "Already on your wishlist.") : target != null ? `Added to your wishlist — we'll flag it at ${money(target)} or less.` : "Added to your wishlist.");
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

/** Collection CSV download (Pro). */
async function exportCollectionCsv(res: ServerResponse, url: URL): Promise<void> {
  const rows = await listCollection({ game: url.searchParams.get("game") ?? undefined, sort: "set" });
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="my-collection-${new Date().toISOString().slice(0, 10)}.csv"`,
    "cache-control": "no-cache",
  });
  res.end(collectionCsv(rows));
}

// ---- router ---------------------------------------------------------------

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = decodeURIComponent(url.pathname);
  const method = req.method ?? "GET";
  const msg = url.searchParams.get("msg") ?? undefined;
  let m: RegExpMatchArray | null;

  // Resolve the signed-in account once per request; the shared page shell reads
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
      return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /collection\nDisallow: /admin\nSitemap: ${url.origin}/sitemap.xml\n`, "text/plain");
    if (path === "/sitemap.xml") {
      const urls = (await sitemapUrls()).map((u) => `  <url><loc>${url.origin}${u}</loc></url>`).join("\n");
      return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`, "application/xml");
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
        sendPage(res, await renderPriced(b, items, { isPublic: true, shareUrl: null, memberName: acct?.display_name ?? "a CardIndex member" }), `/p/${token}`)
      );
    }

    // ---- owner console (owner-role-gated) ----
    if (path === "/admin" || path.startsWith("/admin/")) {
      return await handleAdmin(req, res, url, path, method, msg);
    }

    // ---- legacy: the member area used to live under /app ----
    if (path === "/app" || path.startsWith("/app/")) {
      const rest = path === "/app" ? "" : path.slice("/app".length);
      let mapped = LEGACY_APP_PATHS[rest];
      if (!mapped && /^\/review\/\d+$/.test(rest)) mapped = "/collection" + rest;
      if (!mapped && (m = rest.match(/^\/pricing\/(\d+)$/))) mapped = `/collection/priced/${m[1]}`;
      if (!mapped) mapped = "/collection";
      return redirectPermanent(res, mapped + (url.search && !mapped.includes("?") ? url.search : ""));
    }

    // ---- member area (login-gated) ----
    if (path === "/collection" || path.startsWith("/collection/") || path === "/api/identify") {
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
      const query = [card.name, card.number ?? "", card.set_name ?? "", sel && sel.finish !== "normal" ? sel.finish_label : ""].filter(Boolean).join(" ").trim();
      try {
        const items = await searchListed(query, 10);
        return j(200, { configured: true, query, items });
      } catch (err) {
        console.error("ebay listed:", err);
        return j(200, { configured: true, query, error: "eBay request failed — try again shortly" });
      }
    }

    // API: per-condition TCGplayer prices (SKU-level; needs a grandfathered/
    // partner key or TCGPLAYER_MOCK — see src/tcgplayer.ts).
    if (path === "/api/tcgplayer/conditions") {
      const j = (code: number, body: unknown) => send(res, code, JSON.stringify(body), "application/json");
      if (!tcgConfigured()) return j(200, { configured: false, groups: [] });
      const card = await getCard(Number(url.searchParams.get("card")));
      if (!card) return j(404, { configured: true, error: "unknown card" });
      if (!card.tcgplayer_product_id) return j(200, { configured: true, groups: [], error: "No TCGplayer product linked for this card yet (run sync:tcgcsv)." });
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
      return sendPage(res, renderPricing({ account, tier, upgrade, msg }), "/pricing");
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
      // Signed-in members see what they already own / want on the card page.
      const viewer = viewerMemberId(account);
      const member = viewer ? await cardMemberState(viewer, card.id) : null;
      const p = await renderCard(card, {
        variantFinish: url.searchParams.get("v") ?? undefined,
        range: num(url.searchParams.get("r")),
        gradeTab: url.searchParams.get("tab") ?? undefined,
        member,
        msg,
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

/** Old /app paths → their /collection equivalents (301). Anything unlisted lands on the collection home. */
const LEGACY_APP_PATHS: Record<string, string> = {
  "": "/collection",
  "/scan": "/collection/add",
  "/pricing-tool": "/collection/add?mode=price",
  "/graded": "/collection/graded",
  "/listing-creator": "/collection/from-set",
  "/card-search": "/search",
  "/sales-lookup": "/sales",
  "/inventory": "/collection/cards",
  "/batches": "/collection/uploads",
  "/inbox": "/collection/inbox",
  "/settings": "/collection/settings",
};

// ---- auth sub-router ------------------------------------------------------

async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string) {
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
    if (acct?.id != null) return redirect(res, "/collection"); // already signed in
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
        // Land signed in, on the collection home, with a welcome — never back on a login screen.
        const acct = await getAccount(sellerId);
        const landing =
          next === "/collection"
            ? "/collection?msg=" + encodeURIComponent(`Welcome, ${acct?.display_name ?? (displayName || "there")}! Your collection is ready.`)
            : next;
        return redirectWithCookie(res, landing, sessionCookie(token));
      } catch (err) {
        const message = err instanceof AuthError ? err.message : "Could not create your account. Please try again.";
        if (!(err instanceof AuthError)) console.error("signup error:", err);
        return sendPage(res, renderSignup({ error: message, email, displayName: String(f.display_name ?? ""), next: f.next }), "/signup");
      }
    }

    let sellerId: number | null = null;
    try {
      sellerId = await authenticate(email, password);
    } catch (err) {
      console.error("login error:", err);
    }
    if (!sellerId) {
      return sendPage(res, renderLogin({ error: "Wrong email or password.", email, next: f.next, showForgot: true }), "/login");
    }
    const token = await createSession(sellerId);
    await logActivity({ sellerId, kind: "login", method, path, detail: "Signed in" });
    return redirectWithCookie(res, next, sessionCookie(token));
  }

  return redirect(res, "/login");
}

// ---- password reset ---------------------------------------------------------

async function handleReset(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string) {
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
        const landing = to === "/collection" ? "/collection?msg=" + encodeURIComponent("Password updated — you're signed in.") : to;
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
      return sendPage(res, renderResetRequest({ email, next: f.next, error: "We couldn't send the email just now. Please try again in a minute." }), "/reset-password");
    }
    return sendPage(res, renderResetRequest({ email, next: f.next, sent: true, mode: mailMode() }), "/reset-password");
  }
  return redirect(res, "/reset-password");
}

// ---- owner console sub-router ---------------------------------------------

/**
 * The owner's back office. Gate: a live OWNER session (its own login at
 * /admin/login, its own cookie). Member accounts never get in. Data access here
 * is deliberately cross-tenant (app/admin.ts). The uploader (/admin/upload) is
 * the owner's PERSONAL one: it runs inside the owner's own member scope through
 * the very same handlers the member add page uses, so cards land in the owner's
 * own collection — never in a member's.
 */
async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string, msg: string | undefined) {
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
    const ownerChunked = path.match(/^\/admin\/upload\/photos\/(?:(start)|(\d+)\/(chunk|finish))$/);
    const queueMsg = (n: number) => `${n} photo${n === 1 ? "" : "s"} uploaded to your own review queue. Confirm to add them to your collection.`;
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
      const landing = await runWithSeller(ownerId, () => handlePhotoUpload(mp.fields, mp.files));
      if (!landing.startsWith("/collection/review/")) return redirect(res, uploadBack(decodeURIComponent(landing.split("msg=")[1] ?? "Nothing uploaded.")));
      const n = mp.files.length;
      return redirectWithCookie(res, landing + "?msg=" + encodeURIComponent(queueMsg(n)), actAsCookie(ownerId));
    }

    const f = parseForm(await readBody(req));

    // ---- the owner's own uploader: pasted list ----
    if (path === "/admin/upload") {
      const ownerId = await ownerSellerId();
      if (!ownerId) return redirect(res, uploadBack("The owner account isn't set up — check ADMIN_EMAIL and restart."));
      const landing = await runWithSeller(ownerId, () => handlePaste(f));
      if (!landing.startsWith("/collection/review/")) return redirect(res, uploadBack("Paste at least one card line."));
      const n = (f.lines ?? "").split(/\r?\n/).filter((l) => l.trim()).length;
      return redirectWithCookie(res, landing + "?msg=" + encodeURIComponent(`${n} card${n === 1 ? "" : "s"} queued in your own review queue. Confirm to add them to your collection.`), actAsCookie(ownerId));
    }

    if ((m = path.match(/^\/admin\/users\/(\d+)\/(act-as|plan)$/))) {
      const id = Number(m[1]);
      const target = await getUser(id);
      if (!target) return notFound(res);

      if (m[2] === "act-as") {
        await logActivity({ sellerId: id, byOwner: true, kind: "owner", method, path, detail: "Owner opened this collection" });
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
    const [usage, batches, activity, feedback] = await Promise.all([userUsage(id), userBatches(id, 8), listActivity({ sellerId: id }, 40), listAllFeedback({ sellerId: id }, 20)]);
    return sendPage(res, renderAdminUser(u, usage, batches, activity, feedback, msg), path);
  }
  if (path === "/admin/upload") {
    // The owner's personal uploader: everything here is the owner's own account.
    const ownerId = await ownerSellerId();
    const owner = ownerId ? await getUser(ownerId) : undefined;
    if (!ownerId || !owner) return sendPage(res, renderAdminUpload(null, null, null, [], msg ?? "The owner account isn't set up — check ADMIN_EMAIL and restart."), "/admin/upload");
    const [member, usage, batches] = await Promise.all([runWithSeller(ownerId, () => getMember()), userUsage(ownerId), userBatches(ownerId, 8)]);
    return sendPage(res, renderAdminUpload(owner, member, usage, batches, msg), "/admin/upload");
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

// ---- member sub-router ----------------------------------------------------

/**
 * Auth gate for the whole member area. No valid session -> bounce to login
 * (preserving where the user was headed). Otherwise run the request inside the
 * member's data scope so every query is tenant-isolated.
 */
async function handleApp(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string, msg: string | undefined) {
  const acct = currentAccount();
  // Owner session: the request runs as the owner's OWN row (their personal
  // collection — no member login needed) or, when the owner has explicitly
  // opened a member's collection (owner mode), as that member. Neither hits
  // the paywall. Only owner-mode actions are logged.
  if (acct?.acting) {
    const sellerId = acct.acting.id;
    if (!acct.acting.owner && !path.startsWith("/api/")) {
      await logActivity({ sellerId, byOwner: true, kind: method === "POST" ? "action" : "page", method, path, detail: describeActivity(method, path) });
    }
    return runWithSeller(sellerId, () => handleAppAuthed(req, res, url, path, method, msg));
  }
  if (!acct || acct.id == null) {
    // Owner session without an owner row (console not configured): back to the console.
    if (acct?.admin) return redirect(res, "/admin?msg=" + encodeURIComponent("Your owner account isn't set up — check ADMIN_EMAIL and restart."));
    if (method === "GET") return redirect(res, "/login?next=" + encodeURIComponent(path + (url.search || "")));
    return redirect(res, "/login");
  }
  // Pro paywall. Free accounts get the collection home, price checks (+ share
  // links), the wishlist (capped), uploads history, inbox and settings; the
  // collection itself — adding to it, browsing it, exporting it — is Pro and
  // bounces to /pricing.
  if (proRequired(path) && !isPro(await planTier(acct.id))) {
    return redirect(res, "/pricing?upgrade=1");
  }
  // Activity tracking (feeds the owner console). API calls are skipped.
  if (!path.startsWith("/api/")) {
    await logActivity({ sellerId: acct.id, kind: method === "POST" ? "action" : "page", method, path, detail: describeActivity(method, path) });
  }
  return runWithSeller(acct.id, () => handleAppAuthed(req, res, url, path, method, msg));
}

/** Member paths a Free account may use; everything else under /collection is Pro. */
const FREE_PATHS = new Set([
  "/collection",
  // Add cards: the page itself is open (its price-check outcome is free);
  // the collection outcome is gated where the form is handled (see kindForMode).
  "/collection/add",
  "/collection/add/upload",
  "/collection/uploads",
  "/collection/wishlist",
  "/collection/inbox",
  "/collection/settings",
  "/api/identify",
]);
function proRequired(path: string): boolean {
  if (FREE_PATHS.has(path)) return false;
  // Chunked photo upload steps: the price-check outcome is free; the collection
  // outcome is gated in the `start` step itself (see handleAppAuthed).
  if (/^\/collection\/add\/upload\/(start|\d+\/(chunk|finish))$/.test(path)) return false;
  // Priced lists (results + share links) belong to the free price check;
  // converting one into a collection upload does not.
  if (/^\/collection\/priced\/\d+(\/(share|unshare))?$/.test(path)) return false;
  // Review is where a price check's matches get fixed; the commit is gated separately.
  if (/^\/collection\/review\/\d+(\/item\/\d+(\/image)?)?$/.test(path)) return false;
  // Wishlist rows: remove / retarget.
  if (/^\/collection\/wishlist\/\d+\/(remove|target)$/.test(path)) return false;
  return true;
}

async function handleAppAuthed(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string, msg: string | undefined) {
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

  let m: RegExpMatchArray | null;
  if (path === "/collection/export.csv" && method === "GET") return await exportCollectionCsv(res, url);

  if (method === "POST") {
    // Image uploads arrive as multipart/form-data (binary); everything else is
    // urlencoded. Branch before reading the body since the readers differ.
    const ctype = String(req.headers["content-type"] ?? "");
    if (ctype.startsWith("multipart/form-data")) {
      const boundary = boundaryOf(ctype);
      // Chunked photo upload (fetch from the dropzone script): answers JSON.
      const chunked = path.match(/^\/collection\/add\/upload\/(?:(start)|(\d+)\/(chunk|finish))$/);
      let mp = { fields: {} as Record<string, string>, files: [] as UploadedFile[] };
      try {
        const buf = await readBodyBuffer(req);
        if (boundary) mp = parseMultipart(buf, boundary);
      } catch (err) {
        if (chunked) return sendJson(res, 413, { error: tooLargeMessage(err) });
        const mi = path.match(/^\/collection\/review\/(\d+)\/item\/\d+\/image$/);
        const back = mi ? `/collection/review/${mi[1]}` : "/collection/add";
        return redirect(res, back + (back.includes("?") ? "&" : "?") + "msg=" + encodeURIComponent(tooLargeMessage(err)));
      }
      if (chunked) {
        const pro = await memberPro();
        let step: Parameters<typeof handleChunkedUpload>[0];
        if (chunked[1]) {
          const kind = kindForMode(mp.fields.mode);
          // Same paywall as the one-shot form: collection uploads are Pro.
          if (kind === "scan" && !pro) return sendJson(res, 402, { error: "Adding cards to your collection is a Pro feature.", redirect: "/pricing?upgrade=1" });
          step = { op: "start", kind };
        } else {
          step = { op: chunked[3] as "chunk" | "finish", batchId: Number(chunked[2]) };
        }
        const r = await handleChunkedUpload(step, mp.fields, mp.files, maxUploadFiles(pro));
        return sendJson(res, r.status, r.body);
      }
      if (path === "/collection/add/upload") {
        const kind = kindForMode(mp.fields.mode);
        const pro = await memberPro();
        if (kind === "scan" && !pro) return redirect(res, "/pricing?upgrade=1");
        return redirect(res, await handlePhotoUpload(mp.fields, mp.files, kind, maxUploadFiles(pro)));
      }
      let mi: RegExpMatchArray | null;
      if ((mi = path.match(/^\/collection\/review\/(\d+)\/item\/(\d+)\/image$/))) {
        await handleItemImage(Number(mi[1]), Number(mi[2]), mp.fields, mp.files);
        return redirectBack(req, res, `/collection/review/${mi[1]}`);
      }
      return redirect(res, "/collection");
    }

    const f = parseForm(await readBody(req));

    if (path === "/collection/add") {
      const kind = kindForMode(f.mode);
      if (kind === "scan" && !(await memberPro())) return redirect(res, "/pricing?upgrade=1");
      return redirect(res, await handlePaste(f, kind));
    }
    if (path === "/collection/graded") return redirect(res, await handleGraded(f));
    if (path === "/collection/from-set") return redirect(res, await handleFromSet(f));
    if (path === "/collection/inbox") {
      if (!(f.title ?? "").trim()) return redirect(res, "/collection/inbox?msg=" + encodeURIComponent("Give your note a title."));
      await submitFeedback(f.kind ?? "feedback", f.title, f.body ?? "");
      return redirect(res, "/collection/inbox?msg=" + encodeURIComponent("Sent — replies will show up here."));
    }
    if ((m = path.match(/^\/collection\/priced\/(\d+)\/(share|unshare|convert)$/))) {
      const id = Number(m[1]);
      if (m[2] === "share") {
        await shareBatch(id);
        return redirect(res, `/collection/priced/${id}?msg=` + encodeURIComponent("Share link created — anyone with it can view the priced list."));
      }
      if (m[2] === "unshare") {
        await unshareBatch(id);
        return redirect(res, `/collection/priced/${id}?msg=` + encodeURIComponent("Sharing stopped."));
      }
      if (!(await memberPro())) return redirect(res, "/pricing?upgrade=1");
      await setBatchKind(id, "scan");
      return redirect(res, `/collection/review/${id}?msg=` + encodeURIComponent("Now a collection upload — confirm the cards, then add them to your collection."));
    }
    if (path === "/collection/wishlist") return redirect(res, await handleWishlistAdd(f, await memberPro()));
    if ((m = path.match(/^\/collection\/wishlist\/(\d+)\/(remove|target)$/))) {
      const id = Number(m[1]);
      if (m[2] === "remove") {
        await removeWishlist(id);
        return redirect(res, "/collection/wishlist?msg=" + encodeURIComponent("Removed from your wishlist."));
      }
      const target = (f.target ?? "").trim() ? toCents(f.target) : null;
      await setWishlistTarget(id, target);
      return redirect(res, "/collection/wishlist?msg=" + encodeURIComponent(target != null ? `Target set to ${money(target)}.` : "Target cleared — just watching."));
    }
    if (path === "/collection/settings") {
      await handleSettings(f);
      return redirect(res, "/collection/settings?msg=" + encodeURIComponent("Settings saved."));
    }
    if (path === "/collection/cards/bulk") return redirect(res, await handleCardsBulk(f));
    if ((m = path.match(/^\/collection\/cards\/(\d+)$/))) return redirect(res, await handleCardEdit(Number(m[1]), f));

    if ((m = path.match(/^\/collection\/review\/(\d+)\/item\/(\d+)$/))) {
      await handleItemAction(Number(m[1]), Number(m[2]), f);
      return redirectBack(req, res, `/collection/review/${m[1]}`);
    }
    if ((m = path.match(/^\/collection\/review\/(\d+)\/commit$/))) {
      if (!(await memberPro())) return redirect(res, "/pricing?upgrade=1");
      const r = await commitToCollection(Number(m[1]), { mergeDuplicates: f.merge === "1" });
      const extra = r.merged ? ` (${r.merged} merged)` : "";
      return redirect(res, "/collection/cards?msg=" + encodeURIComponent(`Added ${r.created.length} card(s) to your collection${extra}.`));
    }

    return redirect(res, "/collection");
  }

  // GET pages
  if (path === "/collection") return sendPage(res, await renderCollectionHome(msg), "/collection");
  if (path === "/collection/cards") {
    const filter = { q: url.searchParams.get("q") ?? undefined, sort: url.searchParams.get("sort") ?? undefined, game: url.searchParams.get("game") ?? undefined };
    return sendPage(res, await renderCards(filter, msg), "/collection/cards");
  }
  if (path === "/collection/uploads") return sendPage(res, await renderUploads(msg), path);
  if (path === "/collection/wishlist") return sendPage(res, await renderWishlist(msg), path);
  if (path === "/collection/graded") return sendPage(res, await renderGraded(msg), path);
  if (path === "/collection/from-set") return sendPage(res, await renderFromSet({ game: url.searchParams.get("game") ?? undefined, set: url.searchParams.get("set") ?? undefined }, msg), path);
  if ((m = path.match(/^\/collection\/priced\/(\d+)$/))) {
    const b = await getBatch(Number(m[1]));
    if (!b) return notFound(res);
    const member = await getMember();
    const shareUrl = b.share_token ? `${url.origin}/p/${b.share_token}` : null;
    return sendPage(res, await renderPriced(b, await getItems(b.id), { isPublic: false, shareUrl, memberName: member.display_name, pro: await memberPro(), msg }), path);
  }
  if (path === "/collection/inbox") return sendPage(res, renderInbox(await listFeedback(), msg), path);
  if (path === "/collection/add") {
    const pro = await memberPro();
    const mq = url.searchParams.get("mode");
    const mode = mq === "price" || mq === "collection" ? mq : pro ? "collection" : "price";
    return sendPage(res, await renderAdd(msg, url.searchParams.get("add") ?? undefined, { mode, pro }), "/collection/add");
  }
  if (path === "/collection/settings") return sendPage(res, await renderSettings(msg), path);
  if ((m = path.match(/^\/collection\/review\/(\d+)$/))) {
    const r = await renderReview(Number(m[1]), url.searchParams.get("tab") ?? undefined, msg);
    if (!r) return notFound(res);
    return sendPage(res, r, path);
  }

  return notFound(res);
}

server.listen(PORT, () => {
  console.log(`\n  CardIndex running -> http://localhost:${PORT}\n`);
  // Photo-ID index (VISION_PROVIDER=hash): hosted deploys can't run
  // `npm run hash:catalog` by hand, so fill any gap in the background here.
  startHashIndexOnBoot();
  // Sold archive housekeeping: remove bundled sample rows so /sales shows real
  // sales only (SOLD_SAMPLE_ON_BOOT=1 loads the sample on a demo deploy instead).
  startSoldSampleOnBoot();
});
