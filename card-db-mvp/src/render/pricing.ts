// Public pricing page: Free (look anything up, price-check your cards, keep a
// small wishlist) vs. Pro ($15/month — your collection, unlimited wishlist with
// alerts, export). Rendered inside the shared page() shell. The Pro
// call-to-action is state-aware (logged out / on Free / on Pro) and, since
// online checkout isn't wired yet, is honest about how Pro is activated today.

import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL, type PlanTier } from "../app/billing.ts";
import { WISHLIST_FREE_MAX } from "../app/collection.ts";
import { MAX_UPLOAD_FILES_FREE, MAX_UPLOAD_FILES_PRO } from "../upload.ts";
import type { HeaderAccount } from "../app/session-context.ts";
import { esc } from "../util.ts";

type Rendered = { html: string; title: string; description: string };

const CHECK = `<svg class="pl-ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l3.5 3.5L15.5 5.5"/></svg>`;

function featureList(items: string[]): string {
  return `<ul class="pl-feats">${items.map((f) => `<li>${CHECK}<span>${f}</span></li>`).join("")}</ul>`;
}

const FREE_FEATURES = [
  "Browse &amp; search every card, set and printing",
  "Live market prices, price history &amp; sold comps",
  "Per-grade values (PSA · BGS · CGC)",
  "Sold-price lookup across eBay, Goldin &amp; Fanatics",
  `<b>Price check</b> — photograph or paste your cards, get every one identified and priced, share by link (${MAX_UPLOAD_FILES_FREE} photos per upload)`,
  `Wishlist of up to ${WISHLIST_FREE_MAX} cards`,
];

const PRO_FEATURES = [
  "<b>Everything in Free</b>, plus:",
  "<b>Your collection</b> — add cards from photos, pasted lists, cert numbers or a set checklist",
  "Collection value at today's market, and what you paid vs. what it's worth",
  "Unlimited wishlist with <b>target-price alerts</b> by email",
  "Export your collection as a spreadsheet (CSV)",
  `${MAX_UPLOAD_FILES_PRO} photos per upload`,
];

export function renderPricing(opts: { account: HeaderAccount; tier: PlanTier; upgrade?: boolean; msg?: string }): Rendered {
  const { account, tier, upgrade, msg } = opts;
  const loggedIn = !!account;
  const onPro = tier === "pro";
  const onFree = loggedIn && !onPro;

  const banner = upgrade
    ? `<div class="pay-banner" role="status">
        <span aria-hidden="true">🔒</span>
        <span>${msg ? esc(msg) + " " : ""}<b>Your collection</b> is a Pro feature. Subscribe to Pro (${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL})
        to keep track of the cards you own, their value, and an unlimited wishlist with price alerts. Looking up prices, checking a stack of cards and a ${WISHLIST_FREE_MAX}-card wishlist stay free.</span>
      </div>`
    : "";

  const freeCta = onFree
    ? `<span class="plan-current on">✓ Your current plan</span>
      <a class="btn lg ghost" href="/collection">Open my collection →</a>`
    : loggedIn
    ? `<a class="btn lg ghost" href="/browse">Browse the catalog</a>`
    : `<a class="btn lg ghost" href="/signup">Start free</a>`;

  let proCta: string;
  if (onPro) {
    proCta = `<span class="plan-current on">✓ Your current plan</span>
      <a class="btn lg ghost" href="/collection">Open my collection →</a>`;
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
      <h1>Free to look up. Pro to keep track.</h1>
      <p>Every price, every sold comp and a photo price check are free. When you want to keep your
         collection and wishlist in one place, Pro is ${PRO_PRICE_LABEL} a ${PRO_PERIOD_LABEL}.</p>
    </div>

    ${banner}

    <div class="plans">
      <div class="plan${onFree ? " current" : ""}">
        <div class="plan-name">Free</div>
        <div class="plan-price"><span class="amt">$0</span><span class="per">/ forever</span></div>
        <div class="plan-sub">The price guide needs no account. A free account adds price checks and a wishlist.</div>
        ${featureList(FREE_FEATURES)}
        <div class="plan-cta">${freeCta}</div>
      </div>

      <div class="plan featured${onPro ? " current" : ""}">
        <div class="plan-badge">For collectors</div>
        <div class="plan-name">Pro</div>
        <div class="plan-price"><span class="amt">${PRO_PRICE_LABEL}</span><span class="per">/ ${PRO_PERIOD_LABEL}</span></div>
        <div class="plan-sub">Know what you own, what it's worth, and when the cards you want hit your price.</div>
        ${featureList(PRO_FEATURES)}
        <div class="plan-cta">${proCta}</div>
      </div>
    </div>

    <p class="pricing-foot">
      Prices in USD. Billed monthly, cancel anytime. Free and Pro run on the same live pricing data.
    </p>
  </div>
</section>`;

  return {
    html,
    title: `Pricing — ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL} for collection tracking | CardIndex`,
    description: `Look up trading-card prices and sold comps free. Go Pro for ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL} to track your collection's value and get wishlist price alerts.`,
  };
}
