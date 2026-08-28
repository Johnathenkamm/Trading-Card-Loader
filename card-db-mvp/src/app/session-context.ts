// Request-scoped seller context.
//
// The workspace data layer (store.ts) used to hardcode `seller_id = 1` — a
// single implicit seller. With real accounts, every /app request runs inside
// `runWithSeller(sellerId, …)`, and the data layer reads the current seller via
// `currentSellerId()`. AsyncLocalStorage carries that id across every `await` in
// the request (including inside pg transactions), so no query can read or write
// another customer's inventory, scans, listings, or settings.

import { AsyncLocalStorage } from "node:async_hooks";

type SellerContext = { sellerId: number };

const storage = new AsyncLocalStorage<SellerContext>();

// ---- header account context ----------------------------------------------
// Set for EVERY request (public pages included) so the shared page shell can
// render "Sign in" vs. the logged-in account without threading a param through
// every render call. Distinct from the seller data scope above: this is display
// state; that one gates data access and is only set inside the /app auth gate.

export type HeaderAccount = { id: number; display_name: string } | null;

const requestStore = new AsyncLocalStorage<{ account: HeaderAccount }>();

export function runWithRequest<T>(account: HeaderAccount, fn: () => Promise<T>): Promise<T> {
  return requestStore.run({ account }, fn);
}

/** The logged-in account for the current request, or null (logged out / no scope). */
export function currentAccount(): HeaderAccount {
  return requestStore.getStore()?.account ?? null;
}

/** Run `fn` with the given seller as the ambient tenant for all store queries. */
export function runWithSeller<T>(sellerId: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ sellerId }, fn);
}

/**
 * The logged-in seller for the current request. Throws if called outside a
 * `runWithSeller` scope — that means an /app data call escaped the auth gate,
 * which should fail loudly rather than silently read seller 1.
 */
export function currentSellerId(): number {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error("currentSellerId() called outside a seller context — auth gate missing");
  }
  return ctx.sellerId;
}

/** Best-effort read of the current seller id, or null outside a request scope. */
export function maybeSellerId(): number | null {
  return storage.getStore()?.sellerId ?? null;
}
