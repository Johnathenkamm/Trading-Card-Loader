// Orders (CardUploader's Orders page): pending orders per channel, a picklist,
// and quantity coming off inventory when an order ships. eBay / Mana Pool order
// *fetching* needs those APIs (OAuth) — labeled seams on the page; what works
// today: manual orders, TCGplayer pull-sheet CSV import, pick/ship flow.

import { query, one, tx } from "../pg.ts";
import { currentSellerId } from "./session-context.ts";

export async function ensureOrdersSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      seller_id     bigint NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      platform      text   NOT NULL DEFAULT 'manual',   -- ebay | tcgplayer | manapool | storefront | manual
      external_ref  text,
      buyer         text,
      ship_to       text,
      note          text,
      status        text   NOT NULL DEFAULT 'pending',  -- pending | picked | shipped
      total_cents   integer,
      created_at    timestamptz NOT NULL DEFAULT now(),
      shipped_at    timestamptz
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id      bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      inventory_id  bigint REFERENCES inventory(id) ON DELETE SET NULL,
      sku           text,
      title         text   NOT NULL DEFAULT '',
      quantity      integer NOT NULL DEFAULT 1,
      price_cents   integer,
      picked        boolean NOT NULL DEFAULT false
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id, status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`);
}

export const ORDER_PLATFORMS: Array<{ key: string; label: string; live: boolean }> = [
  { key: "ebay", label: "eBay", live: false },
  { key: "tcgplayer", label: "TCGplayer", live: true },
  { key: "manapool", label: "Mana Pool", live: false },
  { key: "storefront", label: "Storefront", live: false },
  { key: "manual", label: "Manual", live: true },
];
export const platformLabel = (k: string): string => ORDER_PLATFORMS.find((p) => p.key === k)?.label ?? k;

export type Order = {
  id: number;
  seller_id: number;
  platform: string;
  external_ref: string | null;
  buyer: string | null;
  ship_to: string | null;
  note: string | null;
  status: string;
  total_cents: number | null;
  created_at: string;
  shipped_at: string | null;
};
export type OrderItem = {
  id: number;
  order_id: number;
  inventory_id: number | null;
  sku: string | null;
  title: string;
  quantity: number;
  price_cents: number | null;
  picked: boolean;
  // joined from inventory for the picklist
  in_stock?: number | null;
  card_name?: string | null;
  set_name?: string | null;
  number?: string | null;
  image_small?: string | null;
};
export type OrderWithItems = Order & { items: OrderItem[] };

export type NewOrderItem = { sku?: string | null; title?: string; quantity: number; price_cents?: number | null };

/** Create an order; items with a SKU attach to the matching inventory row. */
export async function createOrder(o: {
  platform: string;
  external_ref?: string | null;
  buyer?: string | null;
  ship_to?: string | null;
  note?: string | null;
  items: NewOrderItem[];
}): Promise<number> {
  const sid = currentSellerId();
  return tx(async (c) => {
    let total = 0;
    const resolved: Array<NewOrderItem & { inventory_id: number | null; title: string }> = [];
    for (const it of o.items) {
      const sku = it.sku?.trim() || null;
      let invId: number | null = null;
      let title = it.title?.trim() || "";
      if (sku) {
        const r = await c.query(
          `SELECT inv.id, c.name, c.number, s.name AS set_name FROM inventory inv JOIN cards c ON c.id=inv.card_id JOIN sets s ON s.id=c.set_id
           WHERE inv.seller_id=$1 AND upper(inv.sku)=upper($2) LIMIT 1`,
          [sid, sku]
        );
        if (r.rows[0]) {
          invId = Number(r.rows[0].id);
          if (!title) title = `${r.rows[0].name}${r.rows[0].number ? " #" + r.rows[0].number : ""} — ${r.rows[0].set_name}`;
        }
      }
      if (!title) title = sku ?? "Item";
      total += (it.price_cents ?? 0) * it.quantity;
      resolved.push({ ...it, sku, inventory_id: invId, title });
    }
    const r = await c.query(
      `INSERT INTO orders(seller_id, platform, external_ref, buyer, ship_to, note, status, total_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING id`,
      [sid, o.platform, o.external_ref ?? null, o.buyer ?? null, o.ship_to ?? null, o.note ?? null, total || null]
    );
    const orderId = Number(r.rows[0].id);
    for (const it of resolved) {
      await c.query(
        `INSERT INTO order_items(order_id, inventory_id, sku, title, quantity, price_cents) VALUES ($1,$2,$3,$4,$5,$6)`,
        [orderId, it.inventory_id, it.sku, it.title, Math.max(1, it.quantity), it.price_cents ?? null]
      );
    }
    return orderId;
  });
}

export async function listOrders(f: { platform?: string; status?: string } = {}): Promise<OrderWithItems[]> {
  const sid = currentSellerId();
  const cond = ["o.seller_id=$1"];
  const params: unknown[] = [sid];
  if (f.platform && f.platform !== "all") {
    params.push(f.platform);
    cond.push(`o.platform=$${params.length}`);
  }
  if (f.status && f.status !== "all") {
    params.push(f.status);
    cond.push(`o.status=$${params.length}`);
  }
  const orders = await query<Order>(`SELECT o.* FROM orders o WHERE ${cond.join(" AND ")} ORDER BY o.id DESC LIMIT 200`, params);
  if (!orders.length) return [];
  const items = await query<OrderItem>(
    `SELECT oi.*, inv.quantity AS in_stock, c.name AS card_name, c.number, c.image_small, s.name AS set_name
     FROM order_items oi
     LEFT JOIN inventory inv ON inv.id=oi.inventory_id
     LEFT JOIN cards c ON c.id=inv.card_id
     LEFT JOIN sets s ON s.id=c.set_id
     WHERE oi.order_id = ANY($1::bigint[]) ORDER BY oi.id`,
    [orders.map((o) => o.id)]
  );
  const byOrder = new Map<number, OrderItem[]>();
  for (const it of items) byOrder.set(it.order_id, [...(byOrder.get(it.order_id) ?? []), it]);
  return orders.map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] }));
}

export function getOrder(id: number): Promise<Order | undefined> {
  return one<Order>("SELECT * FROM orders WHERE id=$1 AND seller_id=$2", [id, currentSellerId()]);
}

export async function getOrderWithItems(id: number): Promise<OrderWithItems | undefined> {
  const o = await getOrder(id);
  if (!o) return undefined;
  const items = await query<OrderItem>("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id", [id]);
  return { ...o, items };
}

/** External refs already imported for a platform (dedupe on fetch). */
export async function existingRefs(platform: string): Promise<Set<string>> {
  const rows = await query<{ external_ref: string }>(
    "SELECT external_ref FROM orders WHERE seller_id=$1 AND platform=$2 AND external_ref IS NOT NULL",
    [currentSellerId(), platform]
  );
  return new Set(rows.map((r) => r.external_ref));
}

/** Toggle an item picked; the order flips to 'picked' when every item is. */
export async function setItemPicked(orderId: number, itemId: number, picked: boolean): Promise<void> {
  const o = await getOrder(orderId);
  if (!o || o.status === "shipped") return;
  await query("UPDATE order_items SET picked=$1 WHERE id=$2 AND order_id=$3", [picked, itemId, orderId]);
  const left = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=$1 AND NOT picked", [orderId]);
  await query("UPDATE orders SET status=$1 WHERE id=$2", [left && left.n === 0 ? "picked" : "pending", orderId]);
}

/**
 * Ship an order: quantities come off the linked inventory rows (a row that hits
 * zero is marked sold), the order is stamped shipped. Mirrors CardUploader's
 * "marking Sold records the sale and takes the cards off the platform".
 */
export async function shipOrder(orderId: number): Promise<{ adjusted: number }> {
  const o = await getOrder(orderId);
  if (!o || o.status === "shipped") return { adjusted: 0 };
  const sid = currentSellerId();
  return tx(async (c) => {
    const items = (await c.query("SELECT inventory_id, quantity FROM order_items WHERE order_id=$1", [orderId])).rows;
    let adjusted = 0;
    for (const it of items) {
      if (it.inventory_id == null) continue;
      const r = await c.query(
        `UPDATE inventory SET quantity=GREATEST(0, quantity-$1),
                status=CASE WHEN quantity-$1 <= 0 THEN 'sold' ELSE status END,
                updated_at=now()
         WHERE id=$2 AND seller_id=$3`,
        [it.quantity, it.inventory_id, sid]
      );
      adjusted += r.rowCount ?? 0;
    }
    await c.query("UPDATE order_items SET picked=true WHERE order_id=$1", [orderId]);
    await c.query("UPDATE orders SET status='shipped', shipped_at=now() WHERE id=$1 AND seller_id=$2", [orderId, sid]);
    return { adjusted };
  });
}

export async function deleteOrder(orderId: number): Promise<void> {
  await query("DELETE FROM orders WHERE id=$1 AND seller_id=$2 AND status<>'shipped'", [orderId, currentSellerId()]);
}

// ---- TCGplayer pull sheet import ------------------------------------------

/** Minimal RFC-4180 CSV parser (quotes, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export type PullSheetLine = { name: string; set: string; number: string; condition: string; quantity: number; sku: string; price_cents: number | null; order_ref: string };

/**
 * Read a TCGplayer pull sheet / shipping export. Header names vary between
 * exports, so columns are found by loose name (Product Name / Name, Set / Set
 * Name, Quantity / Qty, SKU / Custom Label, Order Number / Order #, …).
 */
export function parsePullSheet(csv: string): PullSheetLine[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = head.findIndex((h) => h === n || h.replace(/[^a-z0-9]/g, "") === n.replace(/[^a-z0-9]/g, ""));
      if (i >= 0) return i;
    }
    return -1;
  };
  const cName = col("product name", "name", "title", "card name");
  const cSet = col("set", "set name", "group", "expansion");
  const cNum = col("number", "card number", "no", "#");
  const cCond = col("condition");
  const cQty = col("quantity", "qty", "count");
  const cSku = col("sku", "custom label", "custom sku", "my sku");
  const cPrice = col("price", "unit price", "item price", "tcg marketplace price");
  const cOrder = col("order number", "order #", "order id", "order");
  const out: PullSheetLine[] = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const name = get(cName);
    if (!name && !get(cSku)) continue;
    const qty = parseInt(get(cQty) || "1", 10);
    const priceNum = parseFloat(get(cPrice).replace(/[^0-9.]/g, ""));
    out.push({
      name,
      set: get(cSet),
      number: get(cNum),
      condition: get(cCond),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      sku: get(cSku),
      price_cents: Number.isFinite(priceNum) ? Math.round(priceNum * 100) : null,
      order_ref: get(cOrder),
    });
  }
  return out;
}

/**
 * Turn a pull sheet into orders (one per order number, or one for the file).
 * Lines match inventory by SKU first, then by card name + number.
 */
export async function importPullSheet(csv: string, platform = "tcgplayer"): Promise<{ orders: number[]; matched: number; unmatched: number }> {
  const lines = parsePullSheet(csv);
  const sid = currentSellerId();
  const groups = new Map<string, PullSheetLine[]>();
  for (const l of lines) groups.set(l.order_ref || "", [...(groups.get(l.order_ref || "") ?? []), l]);
  const result = { orders: [] as number[], matched: 0, unmatched: 0 };
  for (const [ref, ls] of groups) {
    const items: NewOrderItem[] = [];
    for (const l of ls) {
      let sku = l.sku || null;
      if (!sku && l.name) {
        // fall back to name (+ number) against this seller's inventory
        const num = l.number.replace(/^0+/, "");
        const r = await one<{ sku: string }>(
          `SELECT inv.sku FROM inventory inv JOIN cards c ON c.id=inv.card_id
           WHERE inv.seller_id=$1 AND inv.status<>'sold' AND lower(c.name)=lower($2)
             AND ($3='' OR c.number ILIKE $3 || '%' OR c.number ILIKE '%' || $3)
           ORDER BY inv.id LIMIT 1`,
          [sid, l.name, num]
        );
        sku = r?.sku ?? null;
      }
      if (sku) result.matched++;
      else result.unmatched++;
      items.push({ sku, title: [l.name, l.set, l.number ? "#" + l.number : "", l.condition].filter(Boolean).join(" · "), quantity: l.quantity, price_cents: l.price_cents });
    }
    if (!items.length) continue;
    result.orders.push(await createOrder({ platform, external_ref: ref || null, note: "Imported from pull sheet", items }));
  }
  return result;
}

/** Everything still to pick across pending orders, grouped by SKU for a chaos-sort run. */
export async function picklist(): Promise<Array<{ sku: string | null; title: string; quantity: number; orders: string; in_stock: number | null; image_small: string | null }>> {
  return query(
    `SELECT oi.sku, MIN(oi.title) AS title, SUM(oi.quantity)::int AS quantity,
            string_agg(DISTINCT '#' || o.id::text || COALESCE(' ' || o.external_ref, ''), ', ') AS orders,
            MAX(inv.quantity) AS in_stock, MAX(c.image_small) AS image_small
     FROM order_items oi JOIN orders o ON o.id=oi.order_id
     LEFT JOIN inventory inv ON inv.id=oi.inventory_id
     LEFT JOIN cards c ON c.id=inv.card_id
     WHERE o.seller_id=$1 AND o.status<>'shipped' AND NOT oi.picked
     GROUP BY oi.sku ORDER BY oi.sku NULLS LAST`,
    [currentSellerId()]
  );
}
