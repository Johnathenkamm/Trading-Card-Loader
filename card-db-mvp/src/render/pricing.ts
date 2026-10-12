// Public pricing page: Free (the price catalog) vs. Pro ($15/month — the seller
// workspace). Rendered inside the shared page() shell. The Pro call-to-action is
// state-aware (logged out / on Free / on Pro) and, since online checkout isn't
// wired yet, is honest about how Pro is activated today.

import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL, type PlanTier } from "../app/billing.ts";
import type { HeaderAccount } from "../app/session-context.ts";
import { SITE, SUPPORT_EMAIL } from "./layout.ts";

type Rendered = { html: string; title: string; description: string };

/** Logged-out visitors request Pro by email (signed-in sellers use their Inbox). */
const PRO_REQUEST_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Pro request (${SITE})`)}`;

const CHECK = `<svg class="pl-ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l3.5 3.5L15.5 5.5"/></svg>`;

function featureList(items: string[]): string {
  return `<ul class="pl-feats">${items
    .map((f) => `<li>${CHECK}<span>${f}</span></li>`)
    .join("")}</ul>`;
}

const FREE_FEATURES = [
  "Browse the full price catalog",
  "Search every card, set & variant",
  "Market prices from TCGplayer, updated daily",
  "Grade values (PSA · BGS · CGC), price history and sold prices, including sample data for now",
  "<b>Ungraded pricing tool</b> — price a binder page by photo, share by link",
  "Card search &amp; sales lookup in your dashboard",
];

const PRO_FEATURES = [
  "<b>Everything in Free</b>, plus:",
  "Bulk photo matching",
  "Review queue with duplicate detection",
  "Automatic pricing rules (market ± % or fixed)",
  "SKU scheme &amp; inventory management",
  "eBay listing drafts + eBay CSV for Seller Hub",
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
        <span><b>Scanning, inventory and listings</b> are Pro features. Get Pro (${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL})
        to add cards, build inventory and list on eBay. The catalog, pricing tool, card search and sales lookup stay free.</span>
      </div>`
    : "";

  // Free plan CTA — the catalog needs no account, so this is always an entry point.
  const freeCta = onFree
    ? `<span class="plan-current on">✓ Your current plan</span>
      <a class="btn lg ghost" href="/app">Open your dashboard →</a>`
    : loggedIn
    ? `<a class="btn lg ghost" href="/browse">Browse the catalog</a>`
    : `<a class="btn lg ghost" href="/signup">Start free</a>`;

  // Pro plan CTA — state-aware. There's no online checkout yet, so anyone not
  // on Pro gets a working "Request Pro": signed-in sellers write from their
  // Inbox, logged-out visitors email support.
  let proCta: string;
  if (onPro) {
    proCta = `<span class="plan-current on">✓ Your current plan</span>
      <a class="btn lg ghost" href="/app">Open your dashboard →</a>`;
  } else if (onFree) {
    proCta = `<a class="btn primary lg" href="/app/inbox">Request Pro</a>
      <p class="plan-note">Online payment isn't available yet. Send a request from your Inbox and we'll switch Pro on for your account.</p>`;
  } else {
    proCta = `<a class="btn primary lg" href="${PRO_REQUEST_MAILTO}">Request Pro</a>
      <p class="plan-note">Online payment isn't available yet. Send a request and we'll switch Pro on for your account. New here? <a href="/signup?next=%2Fpricing">Create an account</a> first.</p>`;
  }

  const html = `
<section class="pricing">
  <div class="wrap">
    <div class="pricing-head">
      <div class="eyebrow">Plans</div>
      <h1>One plan for sellers. The catalog is always free.</h1>
      <p>Look up any card's value for free. When you're ready to turn your cards into listings,
         Pro adds inventory, listings and exports for ${PRO_PRICE_LABEL} a ${PRO_PERIOD_LABEL}.</p>
    </div>

    ${banner}

    <div class="plans">
      <div class="plan${onFree ? " current" : ""}">
        <div class="plan-name">Free</div>
        <div class="plan-price"><span class="amt">$0</span><span class="per">/ forever</span></div>
        <div class="plan-sub">The price catalog needs no account. A free account adds the pricing tool and lookups.</div>
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
      Prices in USD. Free and Pro use the same market prices, updated daily from TCGplayer.
    </p>
  </div>
</section>`;

  return {
    html,
    title: `Plans — Free and Pro (${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}) | ${SITE}`,
    description: `Browse the trading card price catalog free. Pro (${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}) adds scanning into inventory, eBay listings and CSV exports for other marketplaces.`,
  };
}
