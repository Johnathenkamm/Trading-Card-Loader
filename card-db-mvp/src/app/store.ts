// Data-access layer for the seller workspace: sellers, scan batches/items,
// inventory, price history, and listings. All mutations live here so the render
// and server layers stay thin.
//
// Postgres-backed (async). Multi-statement writes that must be atomic use tx();
// single statements use the pool helpers. Every query is scoped to the logged-in
// seller via currentSellerId() (request-scoped, see session-context.ts), so one
// customer can never read or write another's data. Read-then-write (e.g. SKU
// allocation) is serialized inside a transaction and safe without extra locking.

import { randomBytes } from "node:crypto";
import { query, one, tx, toPg, latestMarket } from "../pg.ts";
import { resolvePrice, autoPrice, parseAutoPricePref, type PriceRule, type PriceMode } from "./pricing.ts";
import { formatSku } from "./sku.ts";
import { currentSellerId } from "./session-context.ts";
import { gradedMarketCents } from "./graded.ts";
import type { Variant } from "../db.ts";
import type { Candidate, IdentifyResult } from "./identify.ts";

const nowIso = (): string => new Date().toISOString();
const toBool = (v: unknown): boolean => v === true || v === 1 || v === "1";

// ---- types ----------------------------------------------------------------

export type Seller = {
  id: number;
  email: string | null;
  display_name: string;
  plan_tier: string;
  training_opt_in: number;
  sku_prefix: string;
  sku_pad: number;
  sku_next: number;
  price_mode: PriceMode;
  price_pct: number;
  price_fixed_cents: number | null;
  default_condition: string;
  default_language: string;
  ebay_connected: number;
  ebay_store_category: string | null;
  ebay_shipping_policy: string | null;
  ebay_return_policy: string | null;
  ebay_payment_policy: string | null;
  item_location: string | null;
  title_template: string | null;
  title_structure: string | null; // JSON: visual Title Structure Editor (see app/title.ts)
  matching_prefs: string | null; // JSON: Advanced Matching Options defaults (see app/matching.ts)
  auto_price_pref: string; // rule | previous_first | previous_only (see app/pricing.ts)
  price_floor_cents: number | null; // "never price below" floor for automatic prices
  description_templates: string | null; // JSON: {active, items:[{name, body}]} (see app/listing.ts)
  channel_prefs: string | null; // JSON: Shopify / Whatnot / TCGplayer / Mana Pool export preferences (see app/exporters.ts)
  created_at: string;
};

/**
 * Workspace settings and page tables added after the first schema (idempotent,
 * runs at server start like ensureAuthSchema): matching defaults, automatic
 * pricing, description templates, channel prefs; graded-card columns; batch
 * kinds + share tokens; catalog-less ("blank") listings.
 */
export async function ensureWorkspaceSchema(): Promise<void> {
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS matching_prefs jsonb`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS auto_price_pref text NOT NULL DEFAULT 'rule'`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS price_floor_cents integer`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS description_templates jsonb`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS channel_prefs jsonb`);
  // graded cards: grade label ("PSA 10"), grader, cert number travel scan → inventory
  await query(`ALTER TABLE scan_items ADD COLUMN IF NOT EXISTS grade text`);
  await query(`ALTER TABLE scan_items ADD COLUMN IF NOT EXISTS grader text`);
  await query(`ALTER TABLE scan_items ADD COLUMN IF NOT EXISTS cert text`);
  await query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS grade text`);
  await query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS cert text`);
  // batch kind (scan | graded | creator | pricing) + public share token for pricing batches
  await query(`ALTER TABLE scan_batches ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'scan'`);
  await query(`ALTER TABLE scan_batches ADD COLUMN IF NOT EXISTS share_token text`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_share ON scan_batches(share_token) WHERE share_token IS NOT NULL`);
  // blank listings have no inventory row
  await query(`ALTER TABLE listings ALTER COLUMN inventory_id DROP NOT NULL`);
  await query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS image_url text`);
}

/** Opaque token for a public share link (pricing tool). */
export async function shareBatch(batchId: number): Promise<string> {
  const b = await getBatch(batchId);
  if (!b) throw new Error("batch not found");
  if (b.share_token) return b.share_token;
  const token = randomBytes(9).toString("base64url");
  await query("UPDATE scan_batches SET share_token=$1 WHERE id=$2 AND seller_id=$3", [token, batchId, currentSellerId()]);
  return token;
}

export async function unshareBatch(batchId: number): Promise<void> {
  await query("UPDATE scan_batches SET share_token=NULL WHERE id=$1 AND seller_id=$2", [batchId, currentSellerId()]);
}

/** Public lookup by share token (no seller scope — the token is the capability). */
export function getBatchByToken(token: string): Promise<ScanBatch | undefined> {
  return one<ScanBatch>("SELECT * FROM scan_batches WHERE share_token=$1", [token]);
}

/** Items of a shared batch, for the public page (no seller scope). */
export function getItemsPublic(batchId: number): Promise<ScanItem[]> {
  return query<ScanItem>("SELECT * FROM scan_items WHERE batch_id=$1 ORDER BY id", [batchId]);
}

export async function setBatchKind(batchId: number, kind: string): Promise<void> {
  await query("UPDATE scan_batches SET kind=$1 WHERE id=$2 AND seller_id=$3", [kind, batchId, currentSellerId()]);
}

export type ScanBatch = {
  id: number;
  seller_id: number;
  source: string;
  label: string | null;
  status: string;
  total: number;
  processed: number;
  created_at: string;
  finished_at: string | null;
  kind: string; // scan | graded | creator | pricing
  share_token: string | null;
};

export type ScanItem = {
  id: number;
  batch_id: number;
  seller_id: number;
  raw_input: string;
  image_url: string | null;
  back_image_url: string | null;
  matched_card_id: number | null;
  matched_variant_id: number | null;
  ai_confidence: number;
  alternatives: string;
  status: string;
  condition: string;
  language: string;
  quantity: number;
  price_mode: PriceMode;
  price_pct: number;
  price_cents: number | null;
  price_overridden: number;
  prev_price_cents: number | null;
  sku: string | null;
  title: string | null;
  dup_of_item_id: number | null;
  grade: string | null; // "PSA 10" — graded cards
  grader: string | null;
  cert: string | null;
  created_at: string;
};

export type InventoryRow = {
  id: number;
  seller_id: number;
  card_id: number;
  variant_id: number;
  sku: string;
  condition: string;
  language: string;
  quantity: number;
  price_mode: PriceMode;
  price_pct: number;
  price_cents: number | null;
  acquired_cents: number | null;
  status: string;
  source_item_id: number | null;
  grade: string | null;
  cert: string | null;
  created_at: string;
  updated_at: string;
};

export type Listing = {
  id: number;
  seller_id: number;
  inventory_id: number | null; // null = blank (catalog-less) listing
  image_url: string | null;
  marketplace: string;
  format: string;
  title: string;
  description: string;
  category_id: string | null;
  price_cents: number | null;
  start_cents: number | null;
  duration_days: number | null;
  quantity: number;
  sku: string | null;
  item_specifics: string;
  scheduled_at: string | null;
  status: string; // draft | scheduled | exported | published | ended
  external_ref: string | null; // eBay listing (item) id once published
  ebay_offer_id?: string | null; // eBay Inventory API offer id (app/ebay-sell.ts)
  last_error?: string | null; // last publish/revise failure, for the listings page
  published_at?: string | null;
  created_at: string;
};

/** A variant joined to its card/set/game, for display in review & listings. */
export type VariantFull = Variant & {
  card_name: string;
  card_slug: string;
  number: string | null;
  rarity: string | null;
  image_small: string | null;
  image_large: string | null;
  set_name: string;
  set_slug: string;
  set_code: string | null;
  release_date: string | null;
  game_name: string;
  game_slug: string;
};

// ---- seller ---------------------------------------------------------------

export async function getSeller(): Promise<Seller> {
  const id = currentSellerId();
  const s = await one<Seller>("SELECT * FROM sellers WHERE id=$1", [id]);
  if (!s) throw new Error(`Seller ${id} not found`);
  return s;
}

export function sellerRule(s: Seller): PriceRule {
  return { mode: s.price_mode, pct: s.price_pct, fixed_cents: s.price_fixed_cents };
}

const SELLER_FIELDS = new Set([
  "email", "display_name", "plan_tier", "training_opt_in",
  "sku_prefix", "sku_pad", "sku_next",
  "price_mode", "price_pct", "price_fixed_cents",
  "default_condition", "default_language",
  "ebay_connected", "ebay_store_category", "ebay_shipping_policy",
  "ebay_return_policy", "ebay_payment_policy", "item_location", "title_template",
  "title_structure", "matching_prefs", "auto_price_pref", "price_floor_cents", "description_templates", "channel_prefs",
]);
const SELLER_BOOL = new Set(["training_opt_in", "ebay_connected"]);
const SELLER_JSON = new Set(["title_structure", "matching_prefs", "description_templates", "channel_prefs"]);

export async function updateSeller(patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch).filter((k) => SELLER_FIELDS.has(k));
  if (!keys.length) return;
  const set = keys
    .map((k, i) => (SELLER_JSON.has(k) ? `${k}=$${i + 1}::jsonb` : `${k}=$${i + 1}`))
    .join(", ");
  const params = keys.map((k) => (SELLER_BOOL.has(k) ? toBool(patch[k]) : patch[k] ?? null));
  await query(`UPDATE sellers SET ${set} WHERE id=$${keys.length + 1}`, [...params, currentSellerId()]);
}

// ---- variant lookup -------------------------------------------------------

export function getVariantFull(variantId: number): Promise<VariantFull | undefined> {
  return one<VariantFull>(
    `SELECT v.*, c.name AS card_name, c.slug AS card_slug, c.number, c.rarity,
            c.image_small, c.image_large,
            s.name AS set_name, s.slug AS set_slug, s.code AS set_code, s.release_date,
            g.name AS game_name, g.slug AS game_slug
     FROM card_variants v
     JOIN cards c ON c.id=v.card_id
     JOIN sets s ON s.id=c.set_id
     JOIN games g ON g.id=s.game_id
     WHERE v.id=$1`,
    [variantId]
  );
}

export async function marketCents(variantId: number): Promise<number | null> {
  return (await latestMarket(variantId))?.price_cents ?? null;
}

/** Market for a printing at an optional grade: the graded value when one is known, else raw market. */
export async function marketCentsAt(variantId: number, grade: string | null | undefined): Promise<number | null> {
  if (grade) {
    const g = await gradedMarketCents(variantId, grade);
    if (g != null) return g;
  }
  return marketCents(variantId);
}

/**
 * A representative variant id for the Title Structure Editor's live preview —
 * prefer a numbered chase card (a Charizard, if the catalog has one), else any
 * numbered default variant. Returns null on an empty catalog (preview falls back
 * to hardcoded fields).
 */
export async function sampleVariantId(): Promise<number | null> {
  const r = await one<{ id: number }>(
    `SELECT v.id FROM card_variants v JOIN cards c ON c.id=v.card_id
     WHERE c.number IS NOT NULL
     ORDER BY (c.name LIKE 'Charizard%') DESC, v.is_default DESC, v.id
     LIMIT 1`
  );
  return r?.id ?? null;
}

/** Latest price the seller previously listed this printing at (spec §7). */
export async function previousPrice(variantId: number, condition: string): Promise<number | null> {
  const r = await one<{ price_cents: number }>(
    `SELECT price_cents FROM inventory_price_history
     WHERE seller_id=$1 AND variant_id=$2 AND condition=$3
     ORDER BY recorded_at DESC LIMIT 1`,
    [currentSellerId(), variantId, condition]
  );
  return r?.price_cents ?? null;
}

// ---- scan batches & items -------------------------------------------------

export async function createBatch(source: string, label: string | null, kind = "scan"): Promise<number> {
  const r = await one<{ id: number }>(
    `INSERT INTO scan_batches(seller_id, source, label, status, total, processed, created_at, kind)
     VALUES ($1, $2, $3, 'processing', 0, 0, $4, $5) RETURNING id`,
    [currentSellerId(), source, label, nowIso(), kind]
  );
  return r!.id;
}

/**
 * Add a catalog card directly (Listing Creator / Card Search "Add"): no
 * identification step — the seller chose the printing, so it's a confirmed
 * match at full confidence, priced by the usual rule (at the grade if any).
 */
export async function addItemFromCatalog(
  batchId: number,
  variantId: number,
  seller: Seller,
  opts: { quantity?: number; condition?: string; language?: string; grade?: string | null; grader?: string | null; cert?: string | null; raw?: string } = {}
): Promise<number | null> {
  const vf = await getVariantFull(variantId);
  if (!vf) return null;
  const condition = opts.condition || seller.default_condition;
  const language = opts.language || vf.language || seller.default_language;
  const rule = sellerRule(seller);
  const prev = await previousPrice(variantId, opts.grade || condition);
  const ruled = resolvePrice(await marketCentsAt(variantId, opts.grade), rule);
  const price = autoPrice(ruled, prev, parseAutoPricePref(seller.auto_price_pref), seller.price_floor_cents).price;
  const r = await one<{ id: number }>(
    `INSERT INTO scan_items(
      batch_id, seller_id, raw_input, matched_card_id, matched_variant_id, ai_confidence, alternatives, status,
      condition, language, quantity, price_mode, price_pct, price_cents, prev_price_cents, grade, grader, cert, created_at)
     VALUES ($1,$2,$3,$4,$5,1,'[]'::jsonb,'matched',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [
      batchId, currentSellerId(), opts.raw ?? `${vf.card_name}${vf.number ? " " + vf.number : ""} ${vf.set_name}`,
      vf.card_id, variantId, condition, language, Math.max(1, opts.quantity ?? 1), rule.mode, rule.pct ?? 0, price, prev,
      opts.grade ?? null, opts.grader ?? null, opts.cert ?? null, nowIso(),
    ]
  );
  return r!.id;
}

export function getBatch(id: number): Promise<ScanBatch | undefined> {
  return one<ScanBatch>("SELECT * FROM scan_batches WHERE id=$1 AND seller_id=$2", [id, currentSellerId()]);
}

export function listBatches(limit = 20): Promise<ScanBatch[]> {
  return query<ScanBatch>(
    "SELECT * FROM scan_batches WHERE seller_id=$1 ORDER BY id DESC LIMIT $2",
    [currentSellerId(), limit]
  );
}

/** Batches of one kind (e.g. 'pricing' for the pricing tool's history). */
export function listBatchesOfKind(kind: string, limit = 20): Promise<ScanBatch[]> {
  return query<ScanBatch>(
    "SELECT * FROM scan_batches WHERE seller_id=$1 AND kind=$2 ORDER BY id DESC LIMIT $3",
    [currentSellerId(), kind, limit]
  );
}

export type BatchStats = ScanBatch & {
  matched: number; // matched + approved
  review: number; // needs_review
  failed: number;
  approved: number; // committed to inventory
  value_cents: number; // priced value of matched/approved items
};

/** Batches with per-status counts and value — the "Previous Batches" page. */
export function listBatchesWithStats(limit = 100): Promise<BatchStats[]> {
  return query<BatchStats>(
    `SELECT b.*,
            COALESCE(SUM(CASE WHEN i.status IN ('matched','approved') THEN 1 ELSE 0 END),0)::int AS matched,
            COALESCE(SUM(CASE WHEN i.status='needs_review' THEN 1 ELSE 0 END),0)::int AS review,
            COALESCE(SUM(CASE WHEN i.status='failed' THEN 1 ELSE 0 END),0)::int AS failed,
            COALESCE(SUM(CASE WHEN i.status='approved' THEN 1 ELSE 0 END),0)::int AS approved,
            COALESCE(SUM(CASE WHEN i.status IN ('matched','approved') THEN i.quantity * COALESCE(i.price_cents,0) ELSE 0 END),0)::bigint AS value_cents
     FROM scan_batches b
     LEFT JOIN scan_items i ON i.batch_id=b.id
     WHERE b.seller_id=$1
     GROUP BY b.id
     ORDER BY b.id DESC
     LIMIT $2`,
    [currentSellerId(), limit]
  );
}

export type WorkspaceCounts = { batches: number; review_items: number; listings: number; sold: number };

/** Small counters for the dashboard home and its getting-started checklist. */
export async function workspaceCounts(): Promise<WorkspaceCounts> {
  const sid = currentSellerId();
  return (await one<WorkspaceCounts>(
    `SELECT (SELECT COUNT(*) FROM scan_batches WHERE seller_id=$1)::int AS batches,
            (SELECT COUNT(*) FROM scan_items WHERE seller_id=$1 AND status='needs_review')::int AS review_items,
            (SELECT COUNT(*) FROM listings WHERE seller_id=$1)::int AS listings,
            (SELECT COUNT(*) FROM inventory WHERE seller_id=$1 AND status='sold')::int AS sold`,
    [sid]
  ))!;
}

/**
 * Insert a scan item from an identification result, resolving its initial price
 * from the seller's default rule and recalling any previous price.
 */
export async function addItemFromIdentify(
  batchId: number,
  raw: string,
  result: IdentifyResult,
  seller: Seller,
  opts: { imageUrl?: string | null; backImageUrl?: string | null; grade?: string | null; grader?: string | null; cert?: string | null } = {}
): Promise<number> {
  const best = result.best;
  const condition = seller.default_condition;
  const language = best?.language || seller.default_language;
  const rule = sellerRule(seller);
  // A parsed grade ("psa 10 charizard") counts unless the caller pinned one.
  const grade = opts.grade ?? result.parsed.grade ?? null;
  const grader = opts.grader ?? (grade ? grade.split(" ")[0] : null);

  let price: number | null = null;
  let prev: number | null = null;
  if (best) {
    prev = await previousPrice(best.variant_id, grade || condition);
    // Automatic pricing preference (previous price vs. rule) + floor — see pricing.ts.
    const ruled = resolvePrice(await marketCentsAt(best.variant_id, grade), rule);
    price = autoPrice(ruled, prev, parseAutoPricePref(seller.auto_price_pref), seller.price_floor_cents).price;
  }

  const r = await one<{ id: number }>(
    `INSERT INTO scan_items(
      batch_id, seller_id, raw_input, image_url, back_image_url, matched_card_id, matched_variant_id,
      ai_confidence, alternatives, status, condition, language, quantity,
      price_mode, price_pct, price_cents, prev_price_cents, created_at, grade, grader, cert)
     VALUES ($1,$18,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$19,$20,$21) RETURNING id`,
    [
      batchId,
      raw,
      opts.imageUrl ?? null,
      opts.backImageUrl ?? null,
      best?.card_id ?? null,
      best?.variant_id ?? null,
      result.confidence,
      JSON.stringify(result.alternatives.map((a) => altRow(a))),
      result.status,
      condition,
      language,
      result.parsed.quantity,
      rule.mode,
      rule.pct ?? 0,
      price,
      prev,
      nowIso(),
      currentSellerId(),
      grade,
      grader,
      opts.cert ?? null,
    ]
  );
  return r!.id;
}

function altRow(a: Candidate) {
  return {
    variant_id: a.variant_id,
    card_id: a.card_id,
    label: `${a.name}${a.number ? " #" + a.number : ""}`,
    set: a.set_name,
    finish: a.finish_label,
    image: a.image,
    score: Math.round(a.score * 100),
  };
}

export async function finalizeBatch(batchId: number): Promise<void> {
  const total = (await one<{ n: number }>(
    "SELECT COUNT(*) n FROM scan_items WHERE batch_id=$1",
    [batchId]
  ))!.n;
  await query(
    "UPDATE scan_batches SET total=$1, processed=$2, status='done', finished_at=$3 WHERE id=$4",
    [total, total, nowIso(), batchId]
  );
}

export function getItems(batchId: number): Promise<ScanItem[]> {
  return query<ScanItem>("SELECT * FROM scan_items WHERE batch_id=$1 ORDER BY id", [batchId]);
}

export function getItem(id: number): Promise<ScanItem | undefined> {
  return one<ScanItem>("SELECT * FROM scan_items WHERE id=$1 AND seller_id=$2", [id, currentSellerId()]);
}

const ITEM_FIELDS = new Set([
  "matched_card_id", "matched_variant_id", "status", "condition", "language",
  "quantity", "price_mode", "price_pct", "price_cents", "price_overridden",
  "sku", "title", "dup_of_item_id", "ai_confidence", "prev_price_cents", "alternatives",
  "image_url", "back_image_url", "grade", "grader", "cert",
]);
const ITEM_BOOL = new Set(["price_overridden"]);
const ITEM_JSON = new Set(["alternatives"]);

export async function updateItem(id: number, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch).filter((k) => ITEM_FIELDS.has(k));
  if (!keys.length) return;
  const set = keys
    .map((k, i) => (ITEM_JSON.has(k) ? `${k}=$${i + 1}::jsonb` : `${k}=$${i + 1}`))
    .join(", ");
  const params = keys.map((k) => (ITEM_BOOL.has(k) ? toBool(patch[k]) : patch[k] ?? null));
  await query(
    `UPDATE scan_items SET ${set} WHERE id=$${keys.length + 1} AND seller_id=$${keys.length + 2}`,
    [...params, id, currentSellerId()]
  );
}

/** Unused by the current UI; kept for completeness. Non-atomic (per-row). */
export async function bulkUpdateItems(ids: number[], patch: Record<string, unknown>): Promise<void> {
  for (const id of ids) await updateItem(id, patch);
}

/**
 * Re-point an item at a chosen variant (manual replace / alternative pick), and
 * re-resolve its price from the item's current rule unless the user overrode it.
 */
export async function replaceMatch(itemId: number, variantId: number): Promise<void> {
  const item = await getItem(itemId);
  const vf = await getVariantFull(variantId);
  if (!item || !vf) return;
  const patch: Record<string, unknown> = {
    matched_variant_id: variantId,
    matched_card_id: vf.card_id,
    status: item.status === "failed" || item.status === "needs_review" ? "matched" : item.status,
    ai_confidence: 1, // a human confirmed it
    alternatives: "[]",
    prev_price_cents: await previousPrice(variantId, item.grade || item.condition),
  };
  if (!item.price_overridden) {
    patch.price_cents = resolvePrice(await marketCentsAt(variantId, item.grade), {
      mode: item.price_mode,
      pct: item.price_pct,
    });
  }
  await updateItem(itemId, patch);
}

/** Recompute an item's price from its rule (after a rule/condition change). */
export async function repriceItem(itemId: number): Promise<void> {
  const item = await getItem(itemId);
  if (!item || !item.matched_variant_id || item.price_overridden) return;
  const price = resolvePrice(await marketCentsAt(item.matched_variant_id, item.grade), {
    mode: item.price_mode,
    pct: item.price_pct,
    fixed_cents: null,
  });
  await updateItem(itemId, { price_cents: price });
}

/**
 * Duplicate detection within a batch (spec §15): items pointing at the same
 * (variant, condition, language) are linked to the first occurrence.
 */
export async function detectDuplicates(batchId: number): Promise<void> {
  const items = await getItems(batchId);
  const seen = new Map<string, number>();
  for (const it of items) {
    if (!it.matched_variant_id) continue;
    // Slabs are unique objects: a cert never merges with another cert.
    const key = it.cert ? `cert:${it.cert}` : `${it.matched_variant_id}|${it.condition}|${it.language}|${it.grade ?? ""}`;
    if (seen.has(key)) {
      await updateItem(it.id, { dup_of_item_id: seen.get(key)! });
    } else {
      seen.set(key, it.id);
      if (it.dup_of_item_id != null) await updateItem(it.id, { dup_of_item_id: null });
    }
  }
}

// ---- commit to inventory --------------------------------------------------

export type CommitResult = { created: number[]; merged: number; skipped: number };

/**
 * Move matched/approved items into confirmed inventory (spec §14–15). Each gets
 * a unique SKU from the seller's counter; in-batch duplicates flagged for
 * merging fold their quantity into the kept row instead of creating a new one.
 * The whole commit runs in one transaction.
 */
export async function commitBatch(
  batchId: number,
  opts: { mergeDuplicates: boolean }
): Promise<CommitResult> {
  const seller = await getSeller();
  const sid = currentSellerId();
  const items = (await getItems(batchId)).filter(
    (i) => i.matched_variant_id && (i.status === "matched" || i.status === "approved")
  );

  const result: CommitResult = { created: [], merged: 0, skipped: 0 };

  await tx(async (c) => {
    let skuNext = seller.sku_next;
    const invByItem = new Map<number, number>(); // scan_item.id -> inventory.id

    for (const it of items) {
      // merge into the kept duplicate's inventory row if requested
      if (opts.mergeDuplicates && it.dup_of_item_id && invByItem.has(it.dup_of_item_id)) {
        const invId = invByItem.get(it.dup_of_item_id)!;
        await c.query("UPDATE inventory SET quantity=quantity+$1, updated_at=$2 WHERE id=$3", [
          it.quantity,
          nowIso(),
          invId,
        ]);
        await c.query("UPDATE scan_items SET status='approved' WHERE id=$1 AND seller_id=$2", [it.id, sid]);
        result.merged++;
        continue;
      }

      const sku =
        it.sku && it.sku.trim() ? it.sku.trim() : formatSku(seller.sku_prefix, skuNext++, seller.sku_pad);
      const inv = await c.query(
        `INSERT INTO inventory(
          seller_id, card_id, variant_id, sku, condition, language, quantity,
          price_mode, price_pct, price_cents, source_item_id, status, created_at, updated_at, grade, cert)
         VALUES ($13,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'in_stock',$11,$12,$14,$15) RETURNING id`,
        [
          it.matched_card_id,
          it.matched_variant_id,
          sku,
          it.condition,
          it.language,
          it.quantity,
          it.price_mode,
          it.price_pct,
          it.price_cents,
          it.id,
          nowIso(),
          nowIso(),
          sid,
          it.grade ?? null,
          it.cert ?? null,
        ]
      );
      const invId = Number(inv.rows[0].id);
      invByItem.set(it.id, invId);
      result.created.push(invId);

      // remember the price for next time (spec §7) — keyed by grade for slabs
      if (it.price_cents != null) {
        await c.query(
          "INSERT INTO inventory_price_history(seller_id, variant_id, condition, price_cents, recorded_at) VALUES ($5,$1,$2,$3,$4)",
          [it.matched_variant_id, it.grade || it.condition, it.price_cents, nowIso(), sid]
        );
      }
      await c.query("UPDATE scan_items SET status='approved', sku=$1 WHERE id=$2 AND seller_id=$3", [
        sku,
        it.id,
        sid,
      ]);
    }

    await c.query("UPDATE sellers SET sku_next=$1 WHERE id=$2", [skuNext, sid]);
  });

  return result;
}

// ---- inventory ------------------------------------------------------------

export type InventoryFilter = { status?: string; game?: string; q?: string; sort?: string };

const INV_SELECT = `SELECT inv.*, v.finish, v.finish_label, v.language AS v_language, v.printing_note, v.tcgplayer_id, v.is_default,
        c.name AS card_name, c.slug AS card_slug, c.number, c.rarity, c.image_small, c.image_large,
        s.name AS set_name, s.slug AS set_slug, s.code AS set_code, s.release_date,
        g.name AS game_name, g.slug AS game_slug
   FROM inventory inv
   JOIN card_variants v ON v.id=inv.variant_id
   JOIN cards c ON c.id=inv.card_id
   JOIN sets s ON s.id=c.set_id
   JOIN games g ON g.id=s.game_id`;

export function listInventory(f: InventoryFilter = {}): Promise<Array<InventoryRow & VariantFull>> {
  const cond: string[] = ["inv.seller_id=?"];
  const params: unknown[] = [currentSellerId()];
  if (f.status && f.status !== "all") {
    cond.push("inv.status=?");
    params.push(f.status);
  }
  if (f.game) {
    cond.push("g.slug=?");
    params.push(f.game);
  }
  if (f.q) {
    cond.push("(c.search_text LIKE ? OR inv.sku LIKE ?)");
    params.push(`%${f.q.toLowerCase()}%`, `%${f.q.toUpperCase()}%`);
  }
  const order =
    f.sort === "value"
      ? "inv.price_cents DESC"
      : f.sort === "name"
      ? "c.name"
      : f.sort === "sku"
      ? "inv.sku"
      : "inv.id DESC";

  return query<InventoryRow & VariantFull>(
    toPg(`${INV_SELECT} WHERE ${cond.join(" AND ")} ORDER BY ${order}`),
    params
  );
}

export function getInventoryItem(id: number): Promise<(InventoryRow & VariantFull) | undefined> {
  return one<InventoryRow & VariantFull>(`${INV_SELECT} WHERE inv.id=$1 AND inv.seller_id=$2`, [id, currentSellerId()]);
}

const INV_FIELDS = new Set(["condition", "language", "quantity", "price_cents", "price_mode", "price_pct", "status", "sku", "grade", "cert"]);
export async function updateInventory(id: number, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch).filter((k) => INV_FIELDS.has(k));
  if (!keys.length) return;
  const set = keys.map((k) => `${k}=?`).join(", ");
  await query(
    toPg(`UPDATE inventory SET ${set}, updated_at=? WHERE id=? AND seller_id=?`),
    [...keys.map((k) => patch[k]), nowIso(), id, currentSellerId()]
  );
}

export type InventoryStats = { count: number; units: number; value_cents: number; market_cents: number; listed: number };

/**
 * Inventory totals. `value_cents` = your prices × qty; `market_cents` = latest
 * catalog market price × qty (CardUploader's "Price $ · Market $" header pair).
 * Sold copies are excluded from both totals.
 */
export async function inventoryStats(): Promise<InventoryStats> {
  return (await one<InventoryStats>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(inv.quantity),0)::int AS units,
            COALESCE(SUM(CASE WHEN inv.status<>'sold' THEN inv.quantity * COALESCE(inv.price_cents,0) ELSE 0 END),0)::bigint AS value_cents,
            COALESCE(SUM(CASE WHEN inv.status<>'sold' THEN inv.quantity * COALESCE(m.price_cents,0) ELSE 0 END),0)::bigint AS market_cents,
            COALESCE(SUM(CASE WHEN inv.status='listed' THEN 1 ELSE 0 END),0)::int AS listed
     FROM inventory inv
     LEFT JOIN LATERAL (
       SELECT price_cents FROM price_points
       WHERE variant_id=inv.variant_id AND kind='market' AND grade IS NULL
       ORDER BY observed_on DESC LIMIT 1
     ) m ON true
     WHERE inv.seller_id=$1`,
    [currentSellerId()]
  ))!;
}

// ---- listings -------------------------------------------------------------

export async function createListing(
  l: Omit<Listing, "id" | "seller_id" | "created_at" | "status" | "external_ref" | "image_url"> & { status?: string; image_url?: string | null }
): Promise<number> {
  const r = await one<{ id: number }>(
    `INSERT INTO listings(
      seller_id, inventory_id, marketplace, format, title, description, category_id,
      price_cents, start_cents, duration_days, quantity, sku, item_specifics, scheduled_at, status, created_at, image_url)
     VALUES ($16,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$17) RETURNING id`,
    [
      l.inventory_id,
      l.marketplace,
      l.format,
      l.title,
      l.description,
      l.category_id,
      l.price_cents ?? null,
      l.start_cents ?? null,
      l.duration_days ?? null,
      l.quantity,
      l.sku,
      l.item_specifics,
      l.scheduled_at ?? null,
      l.status ?? "draft",
      nowIso(),
      currentSellerId(),
      l.image_url ?? null,
    ]
  );
  const id = r!.id;
  if (l.inventory_id != null) {
    await query("UPDATE inventory SET status='listed', updated_at=$1 WHERE id=$2 AND seller_id=$3", [
      nowIso(),
      l.inventory_id,
      currentSellerId(),
    ]);
  }
  return id;
}

/** Listings by id (seller-scoped), for exports of blank listings. */
export function getListings(ids: number[]): Promise<Listing[]> {
  if (!ids.length) return Promise.resolve([]);
  return query<Listing>("SELECT * FROM listings WHERE seller_id=$1 AND id = ANY($2::bigint[]) ORDER BY id", [currentSellerId(), ids]);
}

/** Blank (catalog-less) listing drafts. */
export function listBlankListings(): Promise<Listing[]> {
  return query<Listing>("SELECT * FROM listings WHERE seller_id=$1 AND inventory_id IS NULL ORDER BY id DESC LIMIT 200", [currentSellerId()]);
}

/** Listings that are (or are scheduled to be) live — the Automatic Inventory view. */
export function listLiveListings(): Promise<Array<Listing & { card_name: string | null; image_small: string | null; in_stock: number | null }>> {
  return query(
    `SELECT l.*, c.name AS card_name, COALESCE(l.image_url, c.image_small) AS image_small, inv.quantity AS in_stock
     FROM listings l
     LEFT JOIN inventory inv ON inv.id=l.inventory_id
     LEFT JOIN cards c ON c.id=inv.card_id
     WHERE l.seller_id=$1 AND l.status IN ('scheduled','exported','published')
     ORDER BY l.id DESC LIMIT 300`,
    [currentSellerId()]
  );
}

export async function setListingStatus(id: number, status: string): Promise<void> {
  await query("UPDATE listings SET status=$1 WHERE id=$2 AND seller_id=$3", [status, id, currentSellerId()]);
}

export async function markListingsExported(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await query("UPDATE listings SET status='exported' WHERE seller_id=$1 AND status IN ('draft','scheduled') AND id = ANY($2::bigint[])", [currentSellerId(), ids]);
}

export function getListing(id: number): Promise<Listing | undefined> {
  return one<Listing>("SELECT * FROM listings WHERE id=$1 AND seller_id=$2", [id, currentSellerId()]);
}

export function listingsFor(inventoryId: number): Promise<Listing[]> {
  return query<Listing>(
    "SELECT * FROM listings WHERE inventory_id=$1 AND seller_id=$2 ORDER BY id DESC",
    [inventoryId, currentSellerId()]
  );
}

export function listListings(limit = 200): Promise<Array<Listing & Partial<VariantFull> & { card_name: string | null }>> {
  // LEFT JOINs: blank listings have no inventory/catalog row (image comes from l.image_url).
  return query<Listing & Partial<VariantFull> & { card_name: string | null }>(
    `SELECT l.*, c.name AS card_name, c.number, COALESCE(l.image_url, c.image_small) AS image_small, c.image_large,
            s.name AS set_name, g.name AS game_name, g.slug AS game_slug,
            v.finish_label
     FROM listings l
     LEFT JOIN inventory inv ON inv.id=l.inventory_id
     LEFT JOIN card_variants v ON v.id=inv.variant_id
     LEFT JOIN cards c ON c.id=inv.card_id
     LEFT JOIN sets s ON s.id=c.set_id
     LEFT JOIN games g ON g.id=s.game_id
     WHERE l.seller_id=$1 ORDER BY l.id DESC LIMIT $2`,
    [currentSellerId(), limit]
  );
}
