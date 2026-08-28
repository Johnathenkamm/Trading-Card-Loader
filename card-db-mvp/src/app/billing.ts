// Subscription plans & the Pro paywall.
//
// The product has two tiers:
//   * Free — the public price catalog (browse, search, live prices). No account.
//   * Pro  — $15/month. The full seller workspace: scan → identify → price →
//            inventory → eBay listings + CSV export.
//
// `sellers.plan_tier` ('free' | 'pro') is the source of truth (it already existed
// as a documented seam). Real payment processing — Stripe Checkout + a webhook
// that flips plan_tier when a subscription goes active/canceled — is the next
// seam. Until then Pro is granted operationally (see `npm run grant-pro`), so the
// paywall is enforced while billing is wired up.

import { query, one, getMeta } from "../pg.ts";

/** Price of the Pro plan, in cents. Money is always integer cents (never floats). */
export const PRO_PRICE_CENTS = 1500; // $15.00 / month
export const PRO_PRICE_LABEL = "$15";
export const PRO_PERIOD_LABEL = "month";

export type PlanTier = "free" | "pro";

export function isPro(tier: string | null | undefined): boolean {
  return tier === "pro";
}

/** The plan tier for a seller (anything but 'pro' is treated as 'free'). */
export async function planTier(sellerId: number): Promise<PlanTier> {
  const r = await one<{ plan_tier: string }>("SELECT plan_tier FROM sellers WHERE id=$1", [sellerId]);
  return r?.plan_tier === "pro" ? "pro" : "free";
}

/**
 * Set a seller's plan tier. The manual-billing lever today (`grant-pro`); the
 * Stripe webhook will call this with 'pro'/'free' once checkout is live.
 */
export async function setPlanTier(sellerId: number, tier: PlanTier): Promise<void> {
  await query("UPDATE sellers SET plan_tier=$1 WHERE id=$2", [tier, sellerId]);
}

/**
 * One-time grandfather. The moment the paywall ships, every account that ALREADY
 * existed keeps workspace access (they had been using it for free), so deploying
 * the gate never locks a current user out of a live site. Runs once ever — guarded
 * by a `meta` flag — so accounts created AFTER the paywall start on Free and must
 * upgrade to Pro. Reversible per-account with `npm run grant-pro -- <email> free`.
 */
export async function grandfatherExistingToPro(): Promise<void> {
  if (await getMeta("paywall_grandfathered_at")) return;
  await query("UPDATE sellers SET plan_tier='pro' WHERE plan_tier <> 'pro'");
  await query(
    `INSERT INTO meta (key, value) VALUES ('paywall_grandfathered_at', now()::text)
     ON CONFLICT (key) DO NOTHING`
  );
}

/**
 * Bring the billing bits up to date at startup (idempotent), mirroring
 * ensureAuthSchema: guarantee the plan_tier column and the meta flag table exist
 * on databases provisioned before this feature, then run the one-time grandfather.
 */
export async function ensureBillingSchema(): Promise<void> {
  await query("ALTER TABLE sellers ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free'");
  await query("CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL)");
  await grandfatherExistingToPro();
}
