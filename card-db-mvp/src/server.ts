import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, sep } from "node:path";
import { getGameBySlug, getSetBySlug, getCard, pool } from "./pg.ts";
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
import { money } from "./util.ts";

// ---- seller-workspace wiring ----------------------------------------------
import { identify } from "./app/identify.ts";
import { resolvePrice, parseRuleKey } from "./app/pricing.ts";
import {
  getSeller, updateSeller, createBatch, addItemFromIdentify, detectDuplicates, finalizeBatch,
  getItems, getItem, updateItem, replaceMatch, commitBatch,
  getInventoryItem, listInventory, updateInventory, createListing, previousPrice, marketCents,
  type Seller,
} from "./app/store.ts";
import { toEbayCsv } from "./app/listing.ts";
import { parseStructure, serializeStructure, renderStructuredTitle, DEFAULT_STRUCTURE } from "./app/title.ts";
import { exportRowsFor, inventoryListingPreview, scanItemTitle, sampleTitleFields } from "./app/compose.ts";
import {
  renderDashboard, renderScan, renderReview, renderListingBuilder, renderListings, renderSettings,
} from "./render/app.ts";
import { readBodyBuffer, parseMultipart, boundaryOf, isImage, hintFromFilename, type UploadedFile } from "./upload.ts";
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

async function handleScan(f: Record<string, string>): Promise<string> {
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

  const seller: Seller = { ...(await getSeller()), default_condition: condition, default_language: language, price_mode: rr.mode, price_pct: rr.pct };

  const lines = (f.lines || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 500);

  if (!lines.length) return "/app/scan?msg=" + encodeURIComponent("Paste at least one card line.");

  const batchId = await createBatch("paste", f.label?.trim() || null);
  for (const line of lines) {
    const result = await identify(line);
    await addItemFromIdentify(batchId, line, result, seller);
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  // pre-generate titles for matched items
  for (const it of await getItems(batchId))
    if (it.matched_variant_id) await updateItem(it.id, { title: await scanItemTitle(it, seller) });

  return `/app/review/${batchId}`;
}

/**
 * Image-upload scan path (spec §2): store each uploaded photo in the object
 * store, best-effort identify it from its filename, and create a review-queue
 * item carrying the image. Photos with no filename signal land in the queue as
 * "needs review" for manual search — the same path a vision model will feed once
 * it reads the pixels (see identify.ts / the seam note on the scan page).
 */
async function handleScanUpload(fields: Record<string, string>, files: UploadedFile[]): Promise<string> {
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
  const seller: Seller = { ...(await getSeller()), default_condition: condition, default_language: language, price_mode: rr.mode, price_pct: rr.pct };

  const imgs = files.filter((f) => f.field === "images" && isImage(f)).slice(0, 40);
  if (!imgs.length) return "/app/scan?msg=" + encodeURIComponent("Choose at least one image (JPG/PNG/WebP/HEIC).");

  const store = storage();
  const batchId = await createBatch("upload", fields.label?.trim() || null);
  for (const file of imgs) {
    const put = await store.put(keyFor(seller.id, file.filename), file.data, file.contentType);
    // Vision provider reads the card (pixels → labels → catalog match); falls back
    // to the filename hint when no provider is configured (see app/vision.ts).
    const { result: r0, hintText } = await visionIdentify({ data: file.data, filename: file.filename, contentType: file.contentType });
    // An uploaded photo we couldn't auto-match isn't a failure — it's a review
    // task with the image in hand, so route "failed" → "needs_review".
    const result = r0.status === "failed" ? { ...r0, status: "needs_review" as const } : r0;
    // Show the recognizer's reading (or the filename) as the item's raw label.
    await addItemFromIdentify(batchId, hintText || file.filename, result, seller, { imageUrl: put.url });
  }
  await detectDuplicates(batchId);
  await finalizeBatch(batchId);
  for (const it of await getItems(batchId))
    if (it.matched_variant_id) await updateItem(it.id, { title: await scanItemTitle(it, seller) });

  return `/app/review/${batchId}`;
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

  // Price resolution. `shown_price` is the value the form was rendered with, so
  // we can tell "user changed the rule (recompute)" from "user edited the price
  // box (override)": if the typed price still equals what was shown, it wasn't
  // hand-edited and we recompute from the rule; otherwise it's a manual override.
  const market = item.matched_variant_id ? await marketCents(item.matched_variant_id) : null;
  const ruled = resolvePrice(market, { mode: rr.mode, pct: rr.pct, fixed_cents: null });
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
    prev_price_cents: item.matched_variant_id ? await previousPrice(item.matched_variant_id, condition) : null,
  };

  // title: regenerate on request or when cleared, else keep the user's text
  const merged = { ...item, condition, language, sku: patch.sku as string | null } as typeof item;
  if (doAction === "regen" || !f.title || !f.title.trim()) {
    patch.title = (await scanItemTitle(merged)) ?? "";
  } else {
    patch.title = f.title.trim().slice(0, 80);
  }

  await updateItem(itemId, patch);
}

async function handleInventoryBulk(f: Record<string, string>): Promise<string> {
  const ids = (f.ids || "").split(",").map((s) => intOr(s, 0)).filter(Boolean);
  if (!ids.length) return "/app?msg=" + encodeURIComponent("No cards selected.");
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
  return "/app?msg=" + encodeURIComponent(`Updated ${ids.length} card(s).`);
}

async function handleCreateListing(invId: number, f: Record<string, string>): Promise<string> {
  const inv = await getInventoryItem(invId);
  if (!inv) return "/app";
  const format = f.format === "auction" ? "auction" : "fixed";
  const price = toCents(f.price);
  const grade = f.grade?.trim() || null;
  const pv = await inventoryListingPreview(inv, { grade, titleOverride: f.title });
  const specifics = pv ? pv.specifics : {};
  const scheduled = f.scheduled_at?.trim() || null;

  await createListing({
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
  return "/app/listings?msg=" + encodeURIComponent(`Listing draft created for ${inv.card_name}.`);
}

async function handleSettings(f: Record<string, string>): Promise<void> {
  const rr = parseRuleKey(f.rule || "market");
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
  });
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

async function exportCsv(res: ServerResponse, url: URL): Promise<void> {
  const seller = await getSeller();
  let invIds: number[];
  if (url.searchParams.get("all") === "1") {
    invIds = (await listInventory({})).map((r) => r.id);
  } else {
    invIds = (url.searchParams.get("ids") || "").split(",").map((s) => intOr(s, 0)).filter(Boolean);
  }
  const invs = (await Promise.all(invIds.map((id) => getInventoryItem(id)))).filter(
    (x): x is NonNullable<typeof x> => !!x
  );
  const rows = await exportRowsFor(invs, { format: "fixed" });
  const csv = toEbayCsv(rows, seller);
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="ebay-listings.csv"`,
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

    // ---- seller workspace (login-gated) ----
    if (path === "/app" || path.startsWith("/app/") || path === "/api/identify" || path === "/api/title-preview") {
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
        meta: `${r.set_name}${r.price != null ? " · " + money(r.price) : ""}`,
      }));
      return send(res, 200, JSON.stringify(out), "application/json");
    }

    // pages
    if (path === "/") return sendPage(res, { ...(await renderHome()) }, "/");
    if (path === "/browse") return sendPage(res, { ...(await renderBrowse()) }, "/browse");

    let m: RegExpMatchArray | null;

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

  // CSV export (GET)
  if (path === "/app/export/ebay.csv" && method === "GET") return await exportCsv(res, url);

  let m: RegExpMatchArray | null;

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
    if (path === "/app/settings") {
      await handleSettings(f);
      return redirect(res, "/app/settings?msg=" + encodeURIComponent("Settings saved."));
    }
    if (path === "/app/inventory/bulk") return redirect(res, await handleInventoryBulk(f));

    if ((m = path.match(/^\/app\/review\/(\d+)\/item\/(\d+)$/))) {
      await handleItemAction(Number(m[1]), Number(m[2]), f);
      return redirectBack(req, res, `/app/review/${m[1]}`);
    }
    if ((m = path.match(/^\/app\/review\/(\d+)\/commit$/))) {
      const r = await commitBatch(Number(m[1]), { mergeDuplicates: f.merge === "1" });
      const extra = r.merged ? ` (${r.merged} merged)` : "";
      return redirect(res, "/app?msg=" + encodeURIComponent(`Added ${r.created.length} card(s) to inventory${extra}.`));
    }
    if ((m = path.match(/^\/app\/list\/(\d+)$/))) return redirect(res, await handleCreateListing(Number(m[1]), f));

    return redirect(res, "/app");
  }

  // GET pages
  if (path === "/app") {
    const filter = {
      status: url.searchParams.get("status") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      game: url.searchParams.get("game") ?? undefined,
    };
    return sendPage(res, await renderDashboard(filter, msg), "/app");
  }
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
