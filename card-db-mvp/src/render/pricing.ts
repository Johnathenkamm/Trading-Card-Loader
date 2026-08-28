// Public pricing page: Free (the price catalog) vs. Pro ($15/month — the seller
// workspace). Rendered inside the shared page() shell. The Pro call-to-action is
// state-aware (logged out / on Free / on Pro) and, since online checkout isn't
// wired yet, is honest about how Pro is activated today.

import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL, type PlanTier } from "../app/billing.ts";
import type { HeaderAccount } from "../app/session-context.ts";

type Rendered = { html: string; title: string; description: string };

const CHECK = `<svg class="pl-ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l3.5 3.5L15.5 5.5"/></svg>`;

function featureList(items: string[]): string {
  return `<ul class="pl-feats">${items
    .map((f) => `<li>${CHECK}<span>${f}</span></li>`)
    .join("")}</ul>`;
}

const FREE_FEATURES = [
  "Browse the full price catalog",
  "Search every card, set & variant",
  "Live market prices",
  "Price history &amp; sold comps",
  "Per-grade values (PSA · BGS · CGC)",
];

const PRO_FEATURES = [
  "<b>Everything in Free</b>, plus:",
  "Bulk scan &amp; AI card identification",
  "Review queue with duplicate detection",
  "Automatic pricing rules (market ± % or fixed)",
  "SKU scheme &amp; inventory management",
  "eBay listing builder + File Exchange CSV",
  "Saved listing preferences &amp; title editor",
];

export function renderPricing(opts: {
  account: HeaderAccount;
  tier: PlanTier;
  upgrade?: boolean;
}): Rendered {
  const { account, tier, upgrade } = opts;
  const loggedIn = !!account;
  const onPro = tier === "pro";
  const onFree = loggedIn && !onPro;

  const banner = upgrade
    ? `<div class="pay-banner" role="status">
        <span aria-hidden="true">🔒</span>
        <span>The <b>seller workspace</b> is a Pro feature. Subscribe to Pro (${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL})
        to scan, price and list your cards. Browsing the price catalog stays free.</span>
      </div>`
    : "";

  // Free plan CTA — the catalog needs no account, so this is always an entry point.
  const freeCta = onFree
    ? `<span class="plan-current on">✓ Your current plan</span>`
    : `<a class="btn lg ghost" href="/browse">Browse the catalog</a>`;

  // Pro plan CTA — state-aware. Online checkout is the next seam, so a signed-in
  // free user sees an honest "coming soon" rather than a button that can't charge.
  let proCta: string;
  if (onPro) {
    proCta = `<span class="plan-current on">✓ Your current plan</span>
      <a class="btn lg ghost" href="/app">Open your workspace →</a>`;
  } else if (onFree) {
    proCta = `<button type="button" class="btn primary lg" disabled>Subscribe — ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}</button>
      <p class="plan-note">Secure online checkout is coming soon — contact us and we'll activate Pro on your account.</p>`;
  } else {
    proCta = `<a class="btn primary lg" href="/signup?next=%2Fpricing">Create your account</a>
      <p class="plan-note">${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL} · cancel anytime</p>`;
  }

  const html = `
<section class="pricing">
  <div class="wrap">
    <div class="pricing-head">
      <div class="eyebrow">Pricing</div>
      <h1>One plan for sellers. The catalog is always free.</h1>
      <p>Look up any card's value for free. When you're ready to turn a collection into listings,
         Pro gives you the whole workspace for ${PRO_PRICE_LABEL} a ${PRO_PERIOD_LABEL}.</p>
    </div>

    ${banner}

    <div class="plans">
      <div class="plan${onFree ? " current" : ""}">
        <div class="plan-name">Free</div>
        <div class="plan-price"><span class="amt">$0</span><span class="per">/ forever</span></div>
        <div class="plan-sub">The public price catalog — no account required.</div>
        ${featureList(FREE_FEATURES)}
        <div class="plan-cta">${freeCta}</div>
      </div>

      <div class="plan featured${onPro ? " current" : ""}">
        <div class="plan-badge">For sellers</div>
        <div class="plan-name">Pro</div>
        <div class="plan-price"><span class="amt">${PRO_PRICE_LABEL}</span><span class="per">/ ${PRO_PERIOD_LABEL}</span></div>
        <div class="plan-sub">Scan, identify, price, organize and list — end to end.</div>
        ${featureList(PRO_FEATURES)}
        <div class="plan-cta">${proCta}</div>
      </div>
    </div>

    <p class="pricing-foot">
      Prices in USD. Billed monthly, cancel anytime. The Free catalog and Pro workspace
      run on the same live pricing data.
    </p>
  </div>
</section>`;

  return {
    html,
    title: `Pricing — ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL} for the full seller workspace | CardIndex`,
    description: `Browse the trading-card price catalog free. Go Pro for ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL} to scan, price, organize and list your cards on eBay and beyond.`,
  };
}
