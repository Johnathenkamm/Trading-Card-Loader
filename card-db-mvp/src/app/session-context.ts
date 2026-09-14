// Request-scoped member context.
//
// Every /collection request runs inside `runWithSeller(memberId, …)`, and the
// data layer (app/collection.ts) reads the current member via
// `currentSellerId()`. AsyncLocalStorage carries that id across every `await` in
// the request (including inside pg transactions), so no query can read or write
// another member's collection, wishlist, uploads or settings. (The accounts
// table is still named `sellers` from the product's seller-tool days, hence the
// function names; see app/collection.ts.)

import { AsyncLocalStorage } from "node:async_hooks";

type SellerContext = { sellerId: number };

const storage = new AsyncLocalStorage<SellerContext>();

// ---- header account context ----------------------------------------------
// Set for EVERY request (public pages included) so the shared page shell can
// render "Sign in" vs. the logged-in account without threading a param through
// every render call. Distinct from the seller data scope above: this is display
// state; that one gates data access and is only set inside the /app auth gate.

/**
 * Who is behind this request. `id` is the logged-in MEMBER account (null when
 * only the owner-console session exists). `admin` is true for a live owner
 * session (see app/admin.ts) — a separate login with its own cookie. `acting`
 * is the member the owner's /collection requests run as: the OWNER'S OWN row by
 * default (`owner: true` — their personal collection and uploader), or a
 * member's collection they explicitly opened (`owner: false`, banner shown).
 */
export type HeaderAccount = {
  id: number | null;
  display_name: string;
  /** 'free' | 'pro' for the member account; null for an owner-only session. */
  plan_tier: string | null;
  admin: boolean;
  acting: { id: number; display_name: string; email: string | null; plan_tier: string; owner: boolean } | null;
} | null;

const requestStore = new AsyncLocalStorage<{ account: HeaderAccount }>();

export function runWithRequest<T>(account: HeaderAccount, fn: () => Promise<T>): Promise<T> {
  return requestStore.run({ account }, fn);
}

/** The logged-in account for the current request, or null (logged out / no scope). */
export function currentAccount(): HeaderAccount {
  return requestStore.getStore()?.account ?? null;
}

/** Run `fn` with the given member as the ambient tenant for all data queries. */
export function runWithSeller<T>(sellerId: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ sellerId }, fn);
}

/**
 * The signed-in member for the current request. Throws if called outside a
 * `runWithSeller` scope — that means a member-area data call escaped the auth
 * gate, which should fail loudly rather than silently read someone's data.
 */
export function currentSellerId(): number {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error("currentSellerId() called outside a member context — auth gate missing");
  }
  return ctx.sellerId;
}
