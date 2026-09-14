// Data-access layer for the member area: accounts' preferences, identify
// batches (photos / pasted lists / certs / set picks), the review queue, the
// personal collection and the wishlist.
//
// Postgres-backed (async). Multi-statement writes that must be atomic use tx();
// single statements use the pool helpers. Every query is scoped to the
// signed-in member via currentSellerId() (request-scoped, see
// session-context.ts), so one member can never read or write another's cards.
//
// Naming note: the accounts table is still called `sellers` and its foreign
// keys `seller_id` — the product used to be a seller tool and renaming the
// live production schema buys nothing a visitor can see. Everything else here
// speaks the collector's language: collection, wishlist, paid, value.

import { randomBytes } from "node:crypto";
import { query, one, tx, toPg, latestMarket, getMeta } from "../pg.ts";
import { currentSellerId } from "./session-context.ts";
import { gradedMarketCents } from "./graded.ts";
import { conditionLabel } from "./conditions.ts";
import { sendMail } from "./mailer.ts";
import { money } from "../util.ts";
import type { Variant } from "../db.ts";
import type { Candidate, IdentifyResult } from "./identify.ts";

const nowIso = (): string => new Date().toISOString();
const toBool = (v: unknown): boolean => v === true || v === 1 || v === "1";

/** Wishlist cards a Free account may keep; Pro is unlimited. */
export const WISHLIST_FREE_MAX = 25;

// ---- types ----------------------------------------------------------------

/** A member account's preferences (one row of `sellers`). */
export type Member = {
  id: number;
  email: string | null;
  display_name: string;
  plan_tier: string;
  training_opt_in: number;
  default_condition: string;
  default_language: string;
  matching_prefs: string | null; // JSON: Advanced Matching Options defaults (see app/matching.ts)
  created_at: string;
};

export type ScanBatch = {
  id: number;
  seller_id: number;
  source: string; // paste | upload | certs | catalog
  label: string | null;
  status: string;
  total: number;
  processed: number;
  created_at: string;
  finished_at: string | null;
  kind: string; // scan (→ collection) | graded | creator | pricing (price check)
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
  status: string; // matched | needs_review | failed | approved | skipped
  condition: string;
  language: string;
  quantity: number;
  price_cents: number | null; // market value when identified (at the grade if any)
  paid_cents: number | null; // what the member paid, optional
  dup_of_item_id: number | null;
  grade: string | null; // "PSA 10" — graded cards
  grader: string | null;
  cert: string | null;
  created_at: string;
};

export type CollectionItem = {
  id: number;
  seller_id: number;
  card_id: number;
  variant_id: number;
  condition: string;
  language: string;
  quantity: number;
  grader: string | null;
  grade: string | null;
  cert: string | null;
  paid_cents: number | null;
  notes: string | null;
  source_item_id: number | null;
  created_at: string;
  updated_at: string;
};

export type WishlistItem = {
  id: number;
  seller_id: number;
  card_id: number;
  variant_id: number;
  target_cents: number | null;
  note: string | null;
  created_at: string;
  notified_at: string | null;
};

/** A variant joined to its card/set/game, for display. */
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

// ---- schema ---------------------------------------------------------------

/**
 * Member-area tables and columns, idempotent, run at server start like
 * ensureAuthSchema: the collection and wishlist tables, the graded/paid
 * columns on review items, batch kinds + share tokens, and matching defaults.
 * Also copies rows out of the old seller `inventory` table into the collection
 * once (guarded by a meta flag) so nobody's cards vanish on the first deploy.
 */
export async function ensureCollectionSchema(): Promise<void> {
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS matching_prefs jsonb`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS default_condition text NOT NULL DEFAULT 'NM'`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS default_language text NOT NULL DEFAULT 'EN'`);
  await query(`ALTER TABLE sellers ADD COLUMN IF NOT EXISTS training_opt_in boolean NOT NULL DEFAULT false`);
  await query(`ALTER TABLE sellers ALTER COLUMN display_name SET DEFAULT 'Collector'`);

  await query(`ALTER TABLE scan_items ADD COLUMN IF NOT EXISTS grade text`);
  await query(`ALTER TABLE scan_items ADD COLUMN IF NOT EXISTS grader text`);
  await query(`ALTER TABLE scan_items ADD COLUMN IF NOT EXISTS cert text`);
  await query(`ALTER TABLE scan_items ADD COLUMN IF NOT EXISTS paid_cents integer`);
  await query(`ALTER TABLE scan_batches ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'scan'`);
  await query(`ALTER TABLE scan_batches ADD COLUMN IF NOT EXISTS share_token text`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_batches_share ON scan_batches(share_token) WHERE share_token IS NOT NULL`);

  await query(`
    CREATE TABLE IF NOT EXISTS collection_items (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      seller_id      bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      card_id        bigint  NOT NULL REFERENCES cards(id),
      variant_id     bigint  NOT NULL REFERENCES card_variants(id),
      condition      text    NOT NULL DEFAULT 'NM',
      language       text    NOT NULL DEFAULT 'EN',
      quantity       integer NOT NULL DEFAULT 1,
      grader         text,
      grade          text,
      cert           text,
      paid_cents     integer,
      notes          text,
      source_item_id bigint  REFERENCES scan_items(id) ON DELETE SET NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_coll_member ON collection_items(seller_id, id DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_coll_variant ON collection_items(seller_id, variant_id, condition, language, grade)`);

  await query(`
    CREATE TABLE IF NOT EXISTS wishlist_items (
      id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      seller_id    bigint  NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      card_id      bigint  NOT NULL REFERENCES cards(id),
      variant_id   bigint  NOT NULL REFERENCES card_variants(id),
      target_cents integer,
      note         text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      notified_at  timestamptz,
      UNIQUE (seller_id, variant_id)
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_wish_member ON wishlist_items(seller_id, id DESC)`);

  // One-time: carry the old seller inventory over as collection rows.
  if (!(await getMeta("collection_migrated_at"))) {
    const legacy = await one<{ t: string | null }>(`SELECT to_regclass('inventory')::text AS t`);
    if (legacy?.t) {
      await query(
        `INSERT INTO collection_items(seller_id, card_id, variant_id, condition, language, quantity, grade, grader, cert, paid_cents, source_item_id, created_at, updated_at)
         SELECT i.seller_id, i.card_id, i.variant_id, i.condition, i.language, i.quantity, i.grade,
                CASE WHEN i.grade IS NOT NULL THEN split_part(i.grade, ' ', 1) END,
                i.cert, i.acquired_cents, i.source_item_id, i.created_at, i.updated_at
         FROM inventory i
         WHERE i.status <> 'sold'
           AND NOT EXISTS (SELECT 1 FROM collection_items c WHERE c.seller_id=i.seller_id AND c.source_item_id IS NOT DISTINCT FROM i.source_item_id AND c.variant_id=i.variant_id AND c.created_at=i.created_at)`
      );
    }
    await query(`INSERT INTO meta (key, value) VALUES ('collection_migrated_at', now()::text) ON CONFLICT (key) DO NOTHING`);
  }
}

// ---- member ---------------------------------------------------------------

export async function getMember(): Promise<Member> {
  const id = currentSellerId();
  const s = await one<Member>("SELECT * FROM sellers WHERE id=$1", [id]);
  if (!s) throw new Error(`Member ${id} not found`);
  return s;
}

const MEMBER_FIELDS = new Set(["display_name", "training_opt_in", "default_condition", "default_language", "matching_prefs"]);
const MEMBER_BOOL = new Set(["training_opt_in"]);
const MEMBER_JSON = new Set(["matching_prefs"]);

export async function updateMember(patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch).filter((k) => MEMBER_FIELDS.has(k));
  if (!keys.length) return;
  const set = keys.map((k, i) => (MEMBER_JSON.has(k) ? `${k}=$${i + 1}::jsonb` : `${k}=$${i + 1}`)).join(", ");
  const params = keys.map((k) => (MEMBER_BOOL.has(k) ? toBool(patch[k]) : patch[k] ?? null));
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

// ---- batches & review items -----------------------------------------------

export async function createBatch(source: string, label: string | null, kind = "scan"): Promise<number> {
  const r = await one<{ id: number }>(
    `INSERT INTO scan_batches(seller_id, source, label, status, total, processed, created_at, kind)
     VALUES ($1, $2, $3, 'processing', 0, 0, $4, $5) RETURNING id`,
    [currentSellerId(), source, label, nowIso(), kind]
  );
  return r!.id;
}

/**
 * Add a catalog card directly (Add from a set): no identification step — the
 * member chose the printing, so it's a confirmed match at full confidence,
 * valued at market (at the grade if any).
 */
export async function addItemFromCatalog(
  batchId: number,
  variantId: number,
  member: Member,
  opts: { quantity?: number; condition?: string; language?: string; grade?: string | null; grader?: string | null; cert?: string | null; raw?: string; paid?: number | null } = {}
): Promise<number | null> {
  const vf = await getVariantFull(variantId);
  if (!vf) return null;
  const condition = opts.condition || member.default_condition;
  const language = opts.language || vf.language || member.default_language;
  const value = await marketCentsAt(variantId, opts.grade);
  const r = await one<{ id: number }>(
    `INSERT INTO scan_items(
      batch_id, seller_id, raw_input, matched_card_id, matched_variant_id, ai_confidence, alternatives, status,
      condition, language, quantity, price_cents, paid_cents, grade, grader, cert, created_at)
     VALUES ($1,$2,$3,$4,$5,1,'[]'::jsonb,'matched',$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      batchId, currentSellerId(), opts.raw ?? `${vf.card_name}${vf.number ? " " + vf.number : ""} ${vf.set_name}`,
      vf.card_id, variantId, condition, language, Math.max(1, opts.quantity ?? 1), value, opts.paid ?? null,
      opts.grade ?? null, opts.grader ?? null, opts.cert ?? null, nowIso(),
    ]
  );
  return r!.id;
}

export function getBatch(id: number): Promise<ScanBatch | undefined> {
  return one<ScanBatch>("SELECT * FROM scan_batches WHERE id=$1 AND seller_id=$2", [id, currentSellerId()]);
}

export function listBatches(limit = 20): Promise<ScanBatch[]> {
  return query<ScanBatch>("SELECT * FROM scan_batches WHERE seller_id=$1 ORDER BY id DESC LIMIT $2", [currentSellerId(), limit]);
}

/** Batches of one kind (e.g. 'pricing' for price-check history). */
export function listBatchesOfKind(kind: string, limit = 20): Promise<ScanBatch[]> {
  return query<ScanBatch>("SELECT * FROM scan_batches WHERE seller_id=$1 AND kind=$2 ORDER BY id DESC LIMIT $3", [currentSellerId(), kind, limit]);
}

export type BatchStats = ScanBatch & {
  matched: number; // matched + approved
  review: number; // needs_review
  failed: number;
  approved: number; // added to the collection
  value_cents: number; // market value of matched/approved items
};

/** Batches with per-status counts and value — the Uploads page. */
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

export type MemberCounts = { batches: number; review_items: number };

/** Small counters for the collection home and its getting-started checklist. */
export async function memberCounts(): Promise<MemberCounts> {
  const sid = currentSellerId();
  return (await one<MemberCounts>(
    `SELECT (SELECT COUNT(*) FROM scan_batches WHERE seller_id=$1)::int AS batches,
            (SELECT COUNT(*) FROM scan_items WHERE seller_id=$1 AND status='needs_review')::int AS review_items`,
    [sid]
  ))!;
}

/** Insert a review item from an identification result, valued at market. */
export async function addItemFromIdentify(
  batchId: number,
  raw: string,
  result: IdentifyResult,
  member: Member,
  opts: { imageUrl?: string | null; backImageUrl?: string | null; grade?: string | null; grader?: string | null; cert?: string | null } = {}
): Promise<number> {
  const best = result.best;
  const condition = member.default_condition;
  const language = best?.language || member.default_language;
  // A parsed grade ("psa 10 charizard") counts unless the caller pinned one.
  const grade = opts.grade ?? result.parsed.grade ?? null;
  const grader = opts.grader ?? (grade ? grade.split(" ")[0] : null);
  const value = best ? await marketCentsAt(best.variant_id, grade) : null;

  const r = await one<{ id: number }>(
    `INSERT INTO scan_items(
      batch_id, seller_id, raw_input, image_url, back_image_url, matched_card_id, matched_variant_id,
      ai_confidence, alternatives, status, condition, language, quantity, price_cents, created_at, grade, grader, cert)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [
      batchId,
      currentSellerId(),
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
      value,
      nowIso(),
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

/** Count photos into an open batch as each upload chunk lands. */
export async function bumpBatchProgress(batchId: number, n: number): Promise<void> {
  await query("UPDATE scan_batches SET total=total+$1, processed=processed+$1 WHERE id=$2 AND seller_id=$3", [n, batchId, currentSellerId()]);
}

export async function finalizeBatch(batchId: number): Promise<void> {
  const total = (await one<{ n: number }>("SELECT COUNT(*) n FROM scan_items WHERE batch_id=$1", [batchId]))!.n;
  await query("UPDATE scan_batches SET total=$1, processed=$2, status='done', finished_at=$3 WHERE id=$4", [total, total, nowIso(), batchId]);
}

export function getItems(batchId: number): Promise<ScanItem[]> {
  return query<ScanItem>("SELECT * FROM scan_items WHERE batch_id=$1 ORDER BY id", [batchId]);
}

export function getItem(id: number): Promise<ScanItem | undefined> {
  return one<ScanItem>("SELECT * FROM scan_items WHERE id=$1 AND seller_id=$2", [id, currentSellerId()]);
}

const ITEM_FIELDS = new Set([
  "matched_card_id", "matched_variant_id", "status", "condition", "language", "quantity",
  "price_cents", "paid_cents", "dup_of_item_id", "ai_confidence", "alternatives",
  "image_url", "back_image_url", "grade", "grader", "cert",
]);
const ITEM_JSON = new Set(["alternatives"]);

export async function updateItem(id: number, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch).filter((k) => ITEM_FIELDS.has(k));
  if (!keys.length) return;
  const set = keys.map((k, i) => (ITEM_JSON.has(k) ? `${k}=$${i + 1}::jsonb` : `${k}=$${i + 1}`)).join(", ");
  const params = keys.map((k) => patch[k] ?? null);
  await query(`UPDATE scan_items SET ${set} WHERE id=$${keys.length + 1} AND seller_id=$${keys.length + 2}`, [...params, id, currentSellerId()]);
}

/** Re-point an item at a chosen printing (manual replace / alternative pick) and re-value it. */
export async function replaceMatch(itemId: number, variantId: number): Promise<void> {
  const item = await getItem(itemId);
  const vf = await getVariantFull(variantId);
  if (!item || !vf) return;
  await updateItem(itemId, {
    matched_variant_id: variantId,
    matched_card_id: vf.card_id,
    status: item.status === "failed" || item.status === "needs_review" ? "matched" : item.status,
    ai_confidence: 1, // a human confirmed it
    alternatives: "[]",
    price_cents: await marketCentsAt(variantId, item.grade),
  });
}

/** Re-value an item after its grade changed. */
export async function revalueItem(itemId: number): Promise<void> {
  const item = await getItem(itemId);
  if (!item || !item.matched_variant_id) return;
  await updateItem(itemId, { price_cents: await marketCentsAt(item.matched_variant_id, item.grade) });
}

/**
 * Duplicate detection within a batch: items pointing at the same (printing,
 * condition, language, grade) are linked to the first occurrence. Slabs are
 * unique objects — a cert never merges with another cert.
 */
export async function detectDuplicates(batchId: number): Promise<void> {
  const items = await getItems(batchId);
  const seen = new Map<string, number>();
  for (const it of items) {
    if (!it.matched_variant_id) continue;
    const key = it.cert ? `cert:${it.cert}` : `${it.matched_variant_id}|${it.condition}|${it.language}|${it.grade ?? ""}`;
    if (seen.has(key)) {
      await updateItem(it.id, { dup_of_item_id: seen.get(key)! });
    } else {
      seen.set(key, it.id);
      if (it.dup_of_item_id != null) await updateItem(it.id, { dup_of_item_id: null });
    }
  }
}

// ---- price-check share links ------------------------------------------------

/** Opaque token for a public share link (price check). */
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

/** Public lookup by share token (no member scope — the token is the capability). */
export function getBatchByToken(token: string): Promise<ScanBatch | undefined> {
  return one<ScanBatch>("SELECT * FROM scan_batches WHERE share_token=$1", [token]);
}

/** Items of a shared batch, for the public page (no member scope). */
export function getItemsPublic(batchId: number): Promise<ScanItem[]> {
  return query<ScanItem>("SELECT * FROM scan_items WHERE batch_id=$1 ORDER BY id", [batchId]);
}

export async function setBatchKind(batchId: number, kind: string): Promise<void> {
  await query("UPDATE scan_batches SET kind=$1 WHERE id=$2 AND seller_id=$3", [kind, batchId, currentSellerId()]);
}

// ---- add to the collection ---------------------------------------------------

export type CommitResult = { created: number[]; merged: number; skipped: number };

/**
 * Move matched/approved items into the member's collection. In-batch duplicates
 * flagged for merging fold their quantity into the kept row instead of creating
 * a new one. The whole commit runs in one transaction.
 */
export async function commitToCollection(batchId: number, opts: { mergeDuplicates: boolean }): Promise<CommitResult> {
  const sid = currentSellerId();
  const items = (await getItems(batchId)).filter((i) => i.matched_variant_id && (i.status === "matched" || i.status === "approved"));
  const result: CommitResult = { created: [], merged: 0, skipped: 0 };

  await tx(async (c) => {
    const rowByItem = new Map<number, number>(); // scan_item.id -> collection_items.id
    for (const it of items) {
      if (opts.mergeDuplicates && it.dup_of_item_id && rowByItem.has(it.dup_of_item_id)) {
        const rowId = rowByItem.get(it.dup_of_item_id)!;
        await c.query("UPDATE collection_items SET quantity=quantity+$1, updated_at=now() WHERE id=$2", [it.quantity, rowId]);
        await c.query("UPDATE scan_items SET status='approved' WHERE id=$1 AND seller_id=$2", [it.id, sid]);
        result.merged++;
        continue;
      }
      const ins = await c.query(
        `INSERT INTO collection_items(seller_id, card_id, variant_id, condition, language, quantity, grader, grade, cert, paid_cents, source_item_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [sid, it.matched_card_id, it.matched_variant_id, it.condition, it.language, it.quantity, it.grader ?? null, it.grade ?? null, it.cert ?? null, it.paid_cents ?? null, it.id]
      );
      const rowId = Number(ins.rows[0].id);
      rowByItem.set(it.id, rowId);
      result.created.push(rowId);
      await c.query("UPDATE scan_items SET status='approved' WHERE id=$1 AND seller_id=$2", [it.id, sid]);
    }
  });
  return result;
}

// ---- the collection ----------------------------------------------------------

export type CollectionFilter = { game?: string; q?: string; sort?: string };

export type CollectionRow = CollectionItem & VariantFull & { market_cents: number | null };

const COLL_SELECT = `SELECT ci.*, v.finish, v.finish_label, v.language AS v_language, v.printing_note, v.tcgplayer_id, v.is_default,
        c.name AS card_name, c.slug AS card_slug, c.number, c.rarity, c.image_small, c.image_large,
        s.name AS set_name, s.slug AS set_slug, s.code AS set_code, s.release_date,
        g.name AS game_name, g.slug AS game_slug,
        COALESCE(gm.price_cents, m.price_cents) AS market_cents
   FROM collection_items ci
   JOIN card_variants v ON v.id=ci.variant_id
   JOIN cards c ON c.id=ci.card_id
   JOIN sets s ON s.id=c.set_id
   JOIN games g ON g.id=s.game_id
   LEFT JOIN LATERAL (
     SELECT price_cents FROM price_points WHERE variant_id=ci.variant_id AND kind='market' AND grade IS NULL
     ORDER BY observed_on DESC LIMIT 1
   ) m ON true
   LEFT JOIN LATERAL (
     SELECT price_cents FROM price_points WHERE ci.grade IS NOT NULL AND variant_id=ci.variant_id AND kind='market' AND upper(grade)=upper(ci.grade)
     ORDER BY observed_on DESC LIMIT 1
   ) gm ON true`;

export function listCollection(f: CollectionFilter = {}): Promise<CollectionRow[]> {
  const cond: string[] = ["ci.seller_id=?"];
  const params: unknown[] = [currentSellerId()];
  if (f.game) {
    cond.push("g.slug=?");
    params.push(f.game);
  }
  if (f.q) {
    cond.push("(c.search_text LIKE ? OR lower(coalesce(ci.cert,'')) LIKE ?)");
    params.push(`%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`);
  }
  const order =
    f.sort === "value" ? "market_cents DESC NULLS LAST, ci.id DESC"
    : f.sort === "name" ? "c.name, ci.id"
    : f.sort === "set" ? "s.release_date DESC NULLS LAST, s.name, c.number_sort"
    : f.sort === "paid" ? "ci.paid_cents DESC NULLS LAST, ci.id DESC"
    : "ci.id DESC";
  return query<CollectionRow>(toPg(`${COLL_SELECT} WHERE ${cond.join(" AND ")} ORDER BY ${order}`), params);
}

export function getCollectionItem(id: number): Promise<CollectionRow | undefined> {
  return one<CollectionRow>(`${COLL_SELECT} WHERE ci.id=$1 AND ci.seller_id=$2`, [id, currentSellerId()]);
}

const COLL_FIELDS = new Set(["condition", "language", "quantity", "grade", "grader", "cert", "paid_cents", "notes"]);

/** Bulk patch (condition today) across the member's own rows. */
export async function updateCollectionItems(ids: number[], patch: Record<string, unknown>): Promise<number> {
  const keys = Object.keys(patch).filter((k) => COLL_FIELDS.has(k));
  if (!keys.length || !ids.length) return 0;
  const set = keys.map((k, i) => `${k}=$${i + 1}`).join(", ");
  const rows = await query<{ id: number }>(
    `UPDATE collection_items SET ${set}, updated_at=now() WHERE seller_id=$${keys.length + 1} AND id = ANY($${keys.length + 2}::bigint[]) RETURNING id`,
    [...keys.map((k) => patch[k] ?? null), currentSellerId(), ids]
  );
  return rows.length;
}

export async function removeCollectionItems(ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await query<{ id: number }>("DELETE FROM collection_items WHERE seller_id=$1 AND id = ANY($2::bigint[]) RETURNING id", [currentSellerId(), ids]);
  return rows.length;
}

export type CollectionStats = { count: number; units: number; market_cents: number; paid_cents: number; paid_units: number; graded: number };

/**
 * Collection totals: rows, copies, current market value (at grade when known),
 * what was paid (only rows with a paid price count toward paid_units), slabs.
 */
export async function collectionStats(): Promise<CollectionStats> {
  return (await one<CollectionStats>(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(ci.quantity),0)::int AS units,
            COALESCE(SUM(ci.quantity * COALESCE(gm.price_cents, m.price_cents, 0)),0)::bigint AS market_cents,
            COALESCE(SUM(CASE WHEN ci.paid_cents IS NOT NULL THEN ci.quantity * ci.paid_cents ELSE 0 END),0)::bigint AS paid_cents,
            COALESCE(SUM(CASE WHEN ci.paid_cents IS NOT NULL THEN ci.quantity ELSE 0 END),0)::int AS paid_units,
            COALESCE(SUM(CASE WHEN ci.grade IS NOT NULL THEN ci.quantity ELSE 0 END),0)::int AS graded
     FROM collection_items ci
     LEFT JOIN LATERAL (
       SELECT price_cents FROM price_points WHERE variant_id=ci.variant_id AND kind='market' AND grade IS NULL
       ORDER BY observed_on DESC LIMIT 1
     ) m ON true
     LEFT JOIN LATERAL (
       SELECT price_cents FROM price_points WHERE ci.grade IS NOT NULL AND variant_id=ci.variant_id AND kind='market' AND upper(grade)=upper(ci.grade)
       ORDER BY observed_on DESC LIMIT 1
     ) gm ON true
     WHERE ci.seller_id=$1`,
    [currentSellerId()]
  ))!;
}

/** CSV of the member's collection (Pro export). */
export function collectionCsv(rows: CollectionRow[]): string {
  const cell = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dollars = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
  const head = ["Game", "Set", "Card", "Number", "Printing", "Language", "Condition", "Grade", "Cert", "Quantity", "Paid (USD)", "Market (USD)", "Added"];
  const lines = rows.map((r) =>
    [
      r.game_name, r.set_name, r.card_name, r.number ?? "", r.finish_label, r.language,
      r.grade ? "" : conditionLabel(r.condition), r.grade ?? "", r.cert ?? "", r.quantity,
      dollars(r.paid_cents), dollars(r.market_cents), r.created_at.slice(0, 10),
    ].map(cell).join(",")
  );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}

// ---- wishlist -------------------------------------------------------------------

export type WishlistRow = WishlistItem & VariantFull & { market_cents: number | null; hit: boolean };

const WISH_SELECT = `SELECT w.*, v.finish, v.finish_label, v.language AS v_language, v.printing_note, v.tcgplayer_id, v.is_default,
        c.name AS card_name, c.slug AS card_slug, c.number, c.rarity, c.image_small, c.image_large, c.tcgplayer_url,
        s.name AS set_name, s.slug AS set_slug, s.code AS set_code, s.release_date,
        g.name AS game_name, g.slug AS game_slug,
        m.price_cents AS market_cents,
        (w.target_cents IS NOT NULL AND m.price_cents IS NOT NULL AND m.price_cents <= w.target_cents) AS hit
   FROM wishlist_items w
   JOIN card_variants v ON v.id=w.variant_id
   JOIN cards c ON c.id=w.card_id
   JOIN sets s ON s.id=c.set_id
   JOIN games g ON g.id=s.game_id
   LEFT JOIN LATERAL (
     SELECT price_cents FROM price_points WHERE variant_id=w.variant_id AND kind='market' AND grade IS NULL
     ORDER BY observed_on DESC LIMIT 1
   ) m ON true`;

export function listWishlist(): Promise<Array<WishlistRow & { tcgplayer_url: string | null }>> {
  return query(`${WISH_SELECT} WHERE w.seller_id=$1 ORDER BY hit DESC, w.id DESC`, [currentSellerId()]);
}

export type WishlistStats = { count: number; hit: number };

export async function wishlistStats(): Promise<WishlistStats> {
  return (await one<WishlistStats>(
    `SELECT COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE w.target_cents IS NOT NULL AND m.price_cents IS NOT NULL AND m.price_cents <= w.target_cents)::int AS hit
     FROM wishlist_items w
     LEFT JOIN LATERAL (
       SELECT price_cents FROM price_points WHERE variant_id=w.variant_id AND kind='market' AND grade IS NULL
       ORDER BY observed_on DESC LIMIT 1
     ) m ON true
     WHERE w.seller_id=$1`,
    [currentSellerId()]
  ))!;
}

export type WishlistAddResult = { ok: true; id: number; existed: boolean } | { ok: false; reason: "cap" | "unknown" };

/**
 * Add a printing to the wishlist (or update its target if it's already there).
 * `cap` is the plan's limit (null = unlimited).
 */
export async function addWishlist(variantId: number, targetCents: number | null, cap: number | null): Promise<WishlistAddResult> {
  const vf = await getVariantFull(variantId);
  if (!vf) return { ok: false, reason: "unknown" };
  const sid = currentSellerId();
  const existing = await one<{ id: number }>("SELECT id FROM wishlist_items WHERE seller_id=$1 AND variant_id=$2", [sid, variantId]);
  if (existing) {
    if (targetCents != null) await query("UPDATE wishlist_items SET target_cents=$1, notified_at=NULL WHERE id=$2", [targetCents, existing.id]);
    return { ok: true, id: existing.id, existed: true };
  }
  if (cap != null) {
    const n = (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM wishlist_items WHERE seller_id=$1", [sid]))!.n;
    if (n >= cap) return { ok: false, reason: "cap" };
  }
  const r = await one<{ id: number }>(
    "INSERT INTO wishlist_items(seller_id, card_id, variant_id, target_cents) VALUES ($1,$2,$3,$4) RETURNING id",
    [sid, vf.card_id, variantId, targetCents]
  );
  return { ok: true, id: r!.id, existed: false };
}

export async function removeWishlist(id: number): Promise<void> {
  await query("DELETE FROM wishlist_items WHERE id=$1 AND seller_id=$2", [id, currentSellerId()]);
}

export async function setWishlistTarget(id: number, targetCents: number | null): Promise<void> {
  await query("UPDATE wishlist_items SET target_cents=$1, notified_at=NULL WHERE id=$2 AND seller_id=$3", [targetCents, id, currentSellerId()]);
}

export type CardMemberState = { owned: number; wishlist: { id: number; variant_id: number; target_cents: number | null } | null };

/**
 * What a signed-in member already has for a card — copies owned across every
 * printing, and the wishlist row if any printing is wanted. Takes the member
 * id explicitly because the card page renders outside the member scope.
 */
export async function cardMemberState(sellerId: number, cardId: number): Promise<CardMemberState> {
  const [own, wish] = await Promise.all([
    one<{ n: number }>("SELECT COALESCE(SUM(quantity),0)::int AS n FROM collection_items WHERE seller_id=$1 AND card_id=$2", [sellerId, cardId]),
    one<{ id: number; variant_id: number; target_cents: number | null }>(
      "SELECT id, variant_id, target_cents FROM wishlist_items WHERE seller_id=$1 AND card_id=$2 ORDER BY id LIMIT 1",
      [sellerId, cardId]
    ),
  ]);
  return { owned: own?.n ?? 0, wishlist: wish ?? null };
}

// ---- target-price alerts ---------------------------------------------------------

/**
 * Email Pro members whose wishlist targets have been met by the latest market
 * price. Meant to run right after a price sync (scripts/sync-tcgcsv.ts). Each
 * row is notified at most once a week; setting a new target re-arms it.
 * Returns the number of members emailed.
 */
export async function notifyWishlistAlerts(baseUrl: string): Promise<number> {
  const rows = await query<{
    id: number; seller_id: number; email: string; display_name: string; target_cents: number; market_cents: number;
    card_name: string; number: string | null; set_name: string; finish_label: string; card_slug: string; card_id: number;
  }>(
    `SELECT w.id, w.seller_id, s.email, s.display_name, w.target_cents, m.price_cents AS market_cents,
            c.name AS card_name, c.number, st.name AS set_name, v.finish_label, c.slug AS card_slug, c.id AS card_id
     FROM wishlist_items w
     JOIN sellers s ON s.id=w.seller_id
     JOIN card_variants v ON v.id=w.variant_id
     JOIN cards c ON c.id=w.card_id
     JOIN sets st ON st.id=c.set_id
     JOIN LATERAL (
       SELECT price_cents FROM price_points WHERE variant_id=w.variant_id AND kind='market' AND grade IS NULL
       ORDER BY observed_on DESC LIMIT 1
     ) m ON true
     WHERE s.plan_tier='pro' AND s.email IS NOT NULL AND w.target_cents IS NOT NULL
       AND m.price_cents <= w.target_cents
       AND (w.notified_at IS NULL OR w.notified_at < now() - interval '7 days')
     ORDER BY w.seller_id, w.id`
  );
  const byMember = new Map<number, typeof rows>();
  for (const r of rows) byMember.set(r.seller_id, [...(byMember.get(r.seller_id) ?? []), r]);
  let sent = 0;
  for (const [, list] of byMember) {
    const first = list[0];
    const lines = list.map((r) => `${r.card_name}${r.number ? " #" + r.number : ""} (${r.set_name}, ${r.finish_label}) — market ${money(r.market_cents)}, your target ${money(r.target_cents)}\n${baseUrl}/c/${r.card_slug}-${r.card_id}`);
    try {
      await sendMail({
        to: first.email,
        subject: list.length === 1 ? `${first.card_name} hit your target price` : `${list.length} wishlist cards hit your target price`,
        text: `Hi ${first.display_name},\n\nGood news — these cards on your CardIndex wishlist are at or below the price you set:\n\n${lines.join("\n\n")}\n\nManage your wishlist: ${baseUrl}/collection/wishlist\n`,
      });
      await query("UPDATE wishlist_items SET notified_at=now() WHERE id = ANY($1::bigint[])", [list.map((r) => r.id)]);
      sent++;
    } catch (err) {
      console.error("wishlist alert:", err);
    }
  }
  return sent;
}
