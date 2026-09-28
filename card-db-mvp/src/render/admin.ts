// Owner CRM pages (/admin): overview, users, one customer's profile (plan,
// usage, activity, add cards on their behalf, open their workspace), the
// site-wide activity feed, and the feedback queue. Server-rendered forms like
// the rest of the workspace; only reachable behind the owner gate in server.ts.

import { esc, money } from "../util.ts";
import { flash, APP_JS, conditionOptions, languageOptions, ruleOptions, opt, dropzone } from "./app.ts";
import { BRAND_MARK } from "./layout.ts";
import { ruleKey } from "../app/pricing.ts";
import { FEEDBACK_KINDS } from "../app/feedback.ts";
import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL } from "../app/billing.ts";
import { MAX_UPLOAD_FILES_PRO } from "../upload.ts";
import type { Seller } from "../app/store.ts";
import type { UserRow, UserFilter, UserUsage, Overview, ActivityRow, ActivityFilter, FeedbackRow } from "../app/admin.ts";
import type { SoldArchiveSummary } from "../app/soldimport.ts";
import type { CatalogGameStats, ImportProgress } from "../app/catalog-import.ts";
import { EBAY_MARKETPLACES, type EbayAdminStatus } from "../app/ebay-admin.ts";

type Page = { html: string; title: string; description: string };

// ---- helpers --------------------------------------------------------------

/** Relative time for a Postgres timestamptz / ISO string ("3 min ago", "Yesterday", "Aug 12"). */
export function ago(ts: string | null | undefined): string {
  if (!ts) return "never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return esc(ts.slice(0, 10));
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 2) return "yesterday";
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function stamp(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return esc(ts);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function tierPill(tier: string): string {
  return tier === "pro" ? `<span class="pill sold">Pro</span>` : `<span class="pill">Free</span>`;
}

const userHref = (id: number) => `/admin/users/${id}`;

function userCell(u: { id: number; display_name: string; email: string | null }): string {
  return `<a href="${userHref(u.id)}"><b>${esc(u.display_name)}</b></a><div class="sub">${u.email ? esc(u.email) : `<i>legacy seller · no login</i>`}</div>`;
}

const KIND_LABEL: Record<string, string> = {
  login: "Login", signup: "Sign-up", logout: "Logout", page: "Page", action: "Action", plan_change: "Plan", owner: "Owner",
};

function kindPill(kind: string): string {
  return `<span class="pill ev-${esc(kind)}">${esc(KIND_LABEL[kind] ?? kind)}</span>`;
}

function subnav(active: string): string {
  const items: Array<[string, string, string]> = [
    ["/admin", "Overview", "home"],
    ["/admin/users", "Users", "users"],
    ["/admin/upload", "My uploader", "upload"],
    ["/admin/sold", "Sold prices", "sold"],
    ["/admin/catalog", "Catalog", "catalog"],
    ["/admin/ebay", "eBay", "ebay"],
    ["/admin/activity", "Activity", "activity"],
    ["/admin/feedback", "Feedback", "feedback"],
  ];
  return `<nav class="ws-nav" aria-label="Owner console"><div class="ws-group">${items
    .map(([href, text, key]) => `<a href="${href}" class="${key === active ? "active" : ""}">${text}</a>`)
    .join("")}</div><div class="ws-group ws-group-end"><form method="post" action="/admin/logout" class="inline-form"><button type="submit" class="ws-nav-btn">Sign out of console</button></form></div></nav>`;
}

// ---- Owner sign-in --------------------------------------------------------
// Its own page and its own credentials (ADMIN_EMAIL / ADMIN_PASSWORD). Nothing a
// customer can do with a normal account gets them here.

export function renderAdminLogin(opts: { error?: string; email?: string; configured: boolean; lockedMinutes?: number; next?: string } = { configured: true }): Page {
  const { error, email = "", configured, lockedMinutes, next } = opts;
  const html = `<div class="auth-wrap">
    <div class="auth-card admin-auth">
      <a class="auth-brand" href="/">${BRAND_MARK}<span>CardIndex</span></a>
      <div class="eyebrow" style="color:var(--gold);margin-bottom:4px">Owner console</div>
      <h1>Owner sign-in</h1>
      <p class="auth-sub">Separate from customer accounts. Users, plan tiers, activity, feedback, and the owner uploader.</p>
      ${
        !configured
          ? `<div class="auth-error" role="alert">The owner console isn't configured on this server yet. Set <span class="mono">ADMIN_EMAIL</span> and <span class="mono">ADMIN_PASSWORD</span> in the environment and restart.</div>`
          : lockedMinutes
          ? `<div class="auth-error" role="alert">Too many failed attempts. Try again in ${lockedMinutes} min.</div>`
          : error
          ? `<div class="auth-error" role="alert">${esc(error)}</div>`
          : ""
      }
      <form method="post" action="/admin/login" class="auth-form" autocomplete="on">
        ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ""}
        <label class="fld"><span>Owner email</span>
          <input type="email" name="email" value="${esc(email)}" required autocomplete="username" autofocus inputmode="email" placeholder="owner@example.com"${configured ? "" : " disabled"}></label>
        <label class="fld"><span>Owner password</span>
          <input type="password" name="password" required autocomplete="current-password" placeholder="Owner password"${configured ? "" : " disabled"}></label>
        <button class="btn primary lg auth-submit" type="submit"${configured ? "" : " disabled"}>Open the console</button>
      </form>
      <div class="auth-alt">Looking for your seller workspace? <a href="/login">Customer sign-in</a></div>
    </div>
  </div>`;
  return { html, title: "Owner sign-in — CardIndex", description: "Owner console sign-in." };
}

export function adminHead(active: string, title: string, sub: string, actions = ""): string {
  return `<div class="ws-head admin-head">
    <div class="ws-title-row">
      <div>
        <div class="eyebrow">Owner console</div>
        <h1>${esc(title)}</h1>
        <p class="ws-sub">${sub}</p>
      </div>
      <div class="ws-actions">${actions}</div>
    </div>
    ${subnav(active)}
  </div>`;
}

function activityTable(rows: ActivityRow[], opts: { showUser: boolean }): string {
  if (!rows.length) return `<p class="hint">No activity recorded yet.</p>`;
  return `<div class="tablewrap"><table class="inv-table activity-table"><thead><tr>
      <th>When</th>${opts.showUser ? "<th>User</th>" : ""}<th>Event</th><th>What</th><th>Path</th></tr></thead><tbody>${rows
    .map(
      (a) => `<tr>
        <td class="sub" title="${esc(stamp(a.created_at))}">${ago(a.created_at)}</td>
        ${opts.showUser ? `<td>${userCell(a)}</td>` : ""}
        <td>${kindPill(a.kind)}</td>
        <td>${esc(a.detail ?? "")}${a.by_owner ? ` <span class="pill owner" title="Done by you, inside this user's workspace">by owner</span>` : ""}</td>
        <td class="mono sub">${esc(a.method)} ${esc(a.path)}</td>
      </tr>`
    )
    .join("")}</tbody></table></div>`;
}

// ---- Overview -------------------------------------------------------------

export function renderAdminHome(
  ov: Overview,
  daily: Array<{ day: string; users: number; events: number }>,
  recent: ActivityRow[],
  newest: UserRow[],
  msg?: string
): Page {
  const proPct = ov.total ? Math.round((ov.pro / ov.total) * 100) : 0;
  const stats = `<div class="stat-cards home-stats">
    <div class="stat"><div class="k">Accounts</div><div class="v mono">${ov.total}</div><div class="s">${ov.new_7d} new this week · ${ov.new_30d} this month</div></div>
    <div class="stat"><div class="k">Pro (paid)</div><div class="v mono">${ov.pro}</div><div class="s">${proPct}% of accounts · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL} each</div></div>
    <div class="stat"><div class="k">Free tier</div><div class="v mono">${ov.free}</div><div class="s">catalog only · upgrade candidates</div></div>
    <div class="stat"><div class="k">Active users</div><div class="v mono">${ov.active_7d}</div><div class="s">last 7 days · ${ov.active_30d} in 30 days</div></div>
    <div class="stat${ov.feedback_open ? " attn" : ""}"><div class="k">Open feedback</div><div class="v mono">${ov.feedback_open}</div><div class="s">${ov.feedback_open ? `<a href="/admin/feedback">answer →</a>` : "inbox is clear"}</div></div>
  </div>`;

  const max = Math.max(1, ...daily.map((d) => d.users));
  const bars = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Daily active users</h2><span class="eyebrow">last ${daily.length} days · ${ov.events_24h} events in 24 h</span></div>
    <div class="dau-bars" role="img" aria-label="Daily active users">${daily
      .map((d) => `<div class="dau-col" title="${esc(d.day)}: ${d.users} user${d.users === 1 ? "" : "s"}, ${d.events} events"><div class="dau-bar" style="height:${Math.round((d.users / max) * 100)}%"></div><span class="dau-lbl">${esc(d.day.slice(5))}</span></div>`)
      .join("")}</div>
  </div>`;

  const totals = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Across all accounts</h2></div>
    <div class="admin-kv">
      <div><span>Scan batches</span><b class="mono">${ov.batches}</b></div>
      <div><span>Inventory records</span><b class="mono">${ov.inventory_rows}</b></div>
      <div><span>Listings</span><b class="mono">${ov.listings}</b></div>
      <div><span>Events (24 h)</span><b class="mono">${ov.events_24h}</b></div>
    </div>
  </div>`;

  const newestPanel = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Newest accounts</h2><a href="/admin/users?sort=newest">All users →</a></div>
    ${
      newest.length
        ? `<div class="batch-list">${newest
            .map((u) => `<a class="batch-row" href="${userHref(u.id)}"><span class="blabel">${esc(u.display_name)}</span><span class="sub">${esc(u.email ?? "")}</span><span class="bmeta">${tierPill(u.plan_tier)} · joined ${ago(u.created_at)}</span></a>`)
            .join("")}</div>`
        : `<p class="hint">No accounts yet.</p>`
    }
  </div>`;

  const feed = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Latest activity</h2><a href="/admin/activity">Full log →</a></div>
    ${activityTable(recent, { showUser: true })}
  </div>`;

  const html = `<div class="wrap ws">
    ${adminHead("home", "Overview", "Who's on the platform, who's paying, and what they're doing.")}
    ${flash(msg)}
    ${stats}
    <div class="home-grid">
      <div>${bars}${feed}</div>
      <div>${totals}${newestPanel}</div>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: "Overview — Owner console | CardIndex", description: "Owner CRM overview." };
}

// ---- Users ----------------------------------------------------------------

export function renderAdminUsers(rows: UserRow[], f: UserFilter, msg?: string): Page {
  const tierTabs = ["all", "pro", "free"]
    .map((t) => {
      const p = new URLSearchParams();
      if (t !== "all") p.set("tier", t);
      if (f.q) p.set("q", f.q);
      if (f.sort) p.set("sort", f.sort);
      return `<a href="/admin/users${p.toString() ? "?" + p : ""}" class="${(f.tier ?? "all") === t ? "active" : ""}">${t === "all" ? "All" : t === "pro" ? "Pro" : "Free"}</a>`;
    })
    .join("");
  const body = rows
    .map(
      (u) => `<tr>
      <td class="mono sub">#${u.id}</td>
      <td class="card">${userCell(u)}</td>
      <td>${tierPill(u.plan_tier)}</td>
      <td class="sub" title="${esc(stamp(u.last_seen_at))}">${ago(u.last_seen_at)}</td>
      <td class="sub" title="${esc(stamp(u.last_login_at))}">${ago(u.last_login_at)}</td>
      <td class="mono">${u.events_7d}</td>
      <td class="mono">${u.batches}</td>
      <td class="mono">${u.inventory}</td>
      <td class="mono">${u.listings}</td>
      <td class="sub">${ago(u.created_at)}</td>
      <td class="act"><a class="btn sm" href="${userHref(u.id)}">Profile</a>
        <form method="post" action="/admin/users/${u.id}/act-as" class="inline-form"><button class="btn sm" type="submit" title="Open this user's workspace as owner">Open workspace</button></form></td>
    </tr>`
    )
    .join("");

  const html = `<div class="wrap ws">
    ${adminHead("users", "Users", "Every account, its plan tier, and how active it is. Open a profile to change the plan or work inside their workspace.")}
    ${flash(msg)}
    <form class="inv-toolbar" method="get" action="/admin/users">
      <div class="tabs">${tierTabs}</div>
      <input type="search" name="q" value="${esc(f.q ?? "")}" placeholder="Search name or email…" aria-label="Search users">
      ${f.tier ? `<input type="hidden" name="tier" value="${esc(f.tier)}">` : ""}
      <select name="sort" onchange="this.form.submit()">${opt("recent", "Recently active", f.sort ?? "recent")}${opt("newest", "Newest", f.sort ?? "")}${opt("tier", "Pro first", f.sort ?? "")}${opt("inventory", "Most inventory", f.sort ?? "")}${opt("name", "Name", f.sort ?? "")}</select>
      <button class="btn sm" type="submit">Filter</button>
    </form>
    ${
      rows.length
        ? `<div class="tablewrap"><table class="inv-table users-table"><thead><tr><th>#</th><th>User</th><th>Plan</th><th>Last seen</th><th>Last login</th><th title="Activity events in the last 7 days">7-day events</th><th>Batches</th><th>Inventory</th><th>Listings</th><th>Joined</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
           <p class="hint" style="margin-top:8px">${rows.length} account${rows.length === 1 ? "" : "s"}</p>`
        : `<div class="ws-empty"><h3>No users match</h3><p>Try a different search or tier.</p></div>`
    }
    ${APP_JS}
  </div>`;
  return { html, title: "Users — Owner console | CardIndex", description: "All accounts and plan tiers." };
}

// ---- One user's profile ---------------------------------------------------

export function renderAdminUser(
  u: UserRow,
  usage: UserUsage,
  seller: Seller,
  batches: Array<{ id: number; label: string | null; source: string; kind: string; status: string; total: number; review: number; created_at: string }>,
  activity: ActivityRow[],
  feedback: FeedbackRow[],
  msg?: string
): Page {
  const pro = u.plan_tier === "pro";
  const idCard = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Account</h2><span class="mono sub">#${u.id}</span></div>
    <div class="admin-kv">
      <div><span>Email</span><b>${u.email ? esc(u.email) : "<i>none (legacy seller)</i>"}</b></div>
      <div><span>Shop name</span><b>${esc(u.display_name)}</b></div>
      <div><span>Joined</span><b title="${esc(stamp(u.created_at))}">${ago(u.created_at)}</b></div>
      <div><span>Last login</span><b title="${esc(stamp(u.last_login_at))}">${ago(u.last_login_at)}</b></div>
      <div><span>Last seen</span><b title="${esc(stamp(u.last_seen_at))}">${ago(u.last_seen_at)}</b></div>
      <div><span>Events (7 d)</span><b class="mono">${u.events_7d}</b></div>
      <div><span>SKU scheme</span><b class="mono">${esc(seller.sku_prefix)}-${String(seller.sku_next).padStart(seller.sku_pad, "0")}</b></div>
      <div><span>Default pricing</span><b>${esc(seller.price_mode === "pct" ? `Market ${seller.price_pct >= 0 ? "+" : ""}${seller.price_pct}%` : seller.price_mode === "fixed" ? "Fixed" : "Market")}</b></div>
    </div>
  </div>`;

  const planCard = `<div class="ws-panel plan-card ${pro ? "is-pro" : "is-free"}">
    <div class="ws-panel-head"><h2>Plan</h2>${tierPill(u.plan_tier)}</div>
    <p class="hint">${pro ? `Pro · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}. Full seller workspace.` : "Free · public catalog only. The seller workspace is locked until upgraded."}</p>
    <form method="post" action="/admin/users/${u.id}/plan" class="plan-form">
      <input type="hidden" name="tier" value="${pro ? "free" : "pro"}">
      <button class="btn ${pro ? "" : "primary"}" type="submit"${pro ? ` data-confirm="${esc(`Move ${u.display_name} to the Free tier? They lose workspace access until re-upgraded.`)}" onclick="return confirm(this.dataset.confirm)"` : ""}>${pro ? "Downgrade to Free" : "Upgrade to Pro"}</button>
    </form>
    <p class="hint" style="margin-top:8px">Plan changes are logged in the activity feed. Stripe will flip this automatically once checkout is wired up.</p>
  </div>`;

  const usageCard = `<div class="stat-cards">
    <div class="stat"><div class="k">Inventory value</div><div class="v mono">${money(usage.inventory_value_cents)}</div><div class="s">${usage.inventory_units} unit${usage.inventory_units === 1 ? "" : "s"} · ${u.inventory} record${u.inventory === 1 ? "" : "s"}</div></div>
    <div class="stat"><div class="k">Batches</div><div class="v mono">${u.batches}</div><div class="s">${usage.last_batch_at ? `last ${ago(usage.last_batch_at)}` : "none yet"}</div></div>
    <div class="stat${usage.review_items ? " attn" : ""}"><div class="k">Awaiting review</div><div class="v mono">${usage.review_items}</div><div class="s">${usage.review_items ? "cards waiting on them" : "nothing waiting"}</div></div>
    <div class="stat"><div class="k">Listings</div><div class="v mono">${u.listings}</div><div class="s">${usage.listed} listed · ${usage.sold} sold · ${usage.orders} order${usage.orders === 1 ? "" : "s"}</div></div>
  </div>`;

  const actAs = `<div class="ws-panel act-panel">
    <div class="ws-panel-head"><h2>Work in their workspace</h2></div>
    <p class="hint">Opens the full seller workspace — scan, listing creator, card search, inventory, listings, settings — <b>as ${esc(u.display_name)}</b>. Everything you add lands in their account and is tagged as done by you. The banner at the top ends owner mode.</p>
    <div class="act-buttons">
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/app"><button class="btn primary" type="submit">Open workspace</button></form>
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/app/scan"><button class="btn" type="submit">Scan / add cards</button></form>
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/app/listing-creator"><button class="btn" type="submit">Listing creator</button></form>
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/app/card-search"><button class="btn" type="submit">Card search</button></form>
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/app/inventory"><button class="btn" type="submit">Inventory</button></form>
    </div>
  </div>`;

  const batchPanel = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Recent batches</h2></div>
    ${
      batches.length
        ? `<div class="batch-list">${batches
            .map(
              (b) => `<form method="post" action="/admin/users/${u.id}/act-as" class="batch-row-form"><input type="hidden" name="next" value="${b.kind === "pricing" ? `/app/pricing/${b.id}` : `/app/review/${b.id}`}"><button type="submit" class="batch-row as-btn"><span class="bid">#${b.id}</span><span class="blabel">${esc(b.label || (b.source === "upload" ? "Photo batch" : b.source === "certs" ? "Graded batch" : b.source === "catalog" ? "Catalog picks" : "Pasted batch"))}</span><span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"} · ${b.review ? `<span class="warn">${b.review} to review</span>` : esc(b.status)} · ${ago(b.created_at)}</span></button></form>`
            )
            .join("")}</div>`
        : `<p class="hint">No batches yet.</p>`
    }
  </div>`;

  const fbPanel = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Feedback from this user</h2>${usage.feedback_open ? `<span class="pill pending">${usage.feedback_open} open</span>` : ""}</div>
    ${feedback.length ? feedback.map(feedbackCard).join("") : `<p class="hint">Nothing sent yet.</p>`}
  </div>`;

  const actPanel = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Activity</h2><a href="/admin/activity?user=${u.id}">Full history →</a></div>
    ${activityTable(activity, { showUser: false })}
  </div>`;

  const html = `<div class="wrap ws">
    ${adminHead("users", u.display_name, `${u.email ? esc(u.email) + " · " : ""}account #${u.id} · ${pro ? "Pro" : "Free"} tier`, `<a class="btn" href="/admin/users">← All users</a>`)}
    ${flash(msg)}
    ${usageCard}
    <div class="home-grid">
      <div>${actAs}${actPanel}</div>
      <div>${planCard}${idCard}${batchPanel}${fbPanel}</div>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: `${u.display_name} — Owner console | CardIndex`, description: "Customer profile." };
}

// ---- Owner uploader -------------------------------------------------------
// The owner's PERSONAL scan page: upload photos or paste a list exactly like
// /app/scan, into the owner's own account (app/admin.ts ensureOwnerSeller) —
// never into a customer's. Posts to /admin/upload/photos and /admin/upload;
// the batch lands in the owner's own review queue and they're taken there to
// confirm and add to their inventory. Same element ids as the customer scan
// page so APP_JS enhances the dropzone (previews, drag & drop, file limits)
// and the sample loader.

export function renderAdminUpload(
  owner: UserRow | null,
  seller: Seller | null,
  usage: UserUsage | null,
  batches: Array<{ id: number; label: string | null; source: string; kind: string; status: string; total: number; review: number; created_at: string }>,
  msg?: string
): Page {
  const account = owner && usage
    ? `<div class="ws-panel act-panel upload-target">
    <div class="ws-panel-head"><h2>Your account</h2><span class="mono sub">seller #${owner.id}${owner.email ? ` · ${esc(owner.email)}` : ""}</span></div>
    <p class="hint">Everything you add here goes into <b>your own</b> inventory — the owner's account, separate from every customer. Each upload becomes a batch in your review queue; confirm it there and it's in your inventory.</p>
    <div class="stat-cards">
      <div class="stat"><div class="k">Inventory</div><div class="v mono">${owner.inventory}</div><div class="s">${usage.inventory_units} unit${usage.inventory_units === 1 ? "" : "s"} · ${money(usage.inventory_value_cents)}</div></div>
      <div class="stat"><div class="k">Batches</div><div class="v mono">${owner.batches}</div><div class="s">${usage.last_batch_at ? `last ${ago(usage.last_batch_at)}` : "none yet"}</div></div>
      <div class="stat${usage.review_items ? " attn" : ""}"><div class="k">Awaiting review</div><div class="v mono">${usage.review_items}</div><div class="s">${usage.review_items ? "cards waiting on you" : "nothing waiting"}</div></div>
      <div class="stat"><div class="k">Listings</div><div class="v mono">${owner.listings}</div><div class="s">${usage.listed} listed · ${usage.sold} sold</div></div>
    </div>
    <div class="act-buttons">
      <a class="btn primary" href="/app">Open my workspace</a>
      <a class="btn" href="/app/batches">My batches</a>
      <a class="btn" href="/app/inventory">My inventory</a>
      <a class="btn" href="/app/listings">My listings</a>
      <a class="btn" href="/app/settings">My settings</a>
    </div>
  </div>`
    : "";

  let forms = "";
  if (owner && seller) {
    const rk = ruleKey(seller.price_mode, seller.price_pct);
    forms = `<div class="scan-grid">
      <div class="scan-main">
        <form class="ws-panel upload-form" method="post" action="/admin/upload/photos" enctype="multipart/form-data">
          <div class="ws-panel-head"><h2>Upload photos</h2><span class="eyebrow">phone or scanner</span></div>
          ${dropzone({ max: MAX_UPLOAD_FILES_PRO, pro: true, what: "These photos are <b>stored with each card</b> in your own inventory and become its listing images." })}
          <div class="fld-row">
            <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. Saturday show pickups"></label>
            <label class="fld"><span>Default condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
            <label class="fld"><span>Default language</span><select name="language">${languageOptions(seller.default_language)}</select></label>
          </div>
          <div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(rk)}</select></label>
            <label class="fld"><span>SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit" id="uploadBtn">Upload &amp; identify →</button>
            <span class="hint" id="dzCount">No photos selected yet</span>
          </div>
        </form>

        <form class="scan-form ws-panel" method="post" action="/admin/upload" id="paste">
          <div class="ws-panel-head"><h2>Or paste a list</h2><button type="button" class="btn sm" id="loadsample">Load sample</button></div>
          <label class="fld">
            <span>Cards <small>one per line — name, number (4/102 or #119), set, finish, condition, language, qty (e.g. 3x)</small></span>
            <textarea name="lines" id="lines" rows="7" placeholder="Charizard 4/102 Base Set holo NM&#10;3x Pikachu 58/102 Base&#10;The Wandering Emperor Neon Dynasty foil"></textarea>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. Box break"></label>
            <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
            <label class="fld"><span>Language</span><select name="language">${languageOptions(seller.default_language)}</select></label>
          </div>
          <div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(rk)}</select></label>
            <label class="fld"><span>SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit">Identify cards →</button>
            <span class="hint">You'll review every match in your queue before anything reaches your inventory.</span>
          </div>
        </form>
      </div>

      <aside class="ws-panel scan-side">
        <h2>How this works</h2>
        <p><b>Same pipeline as the customer scan page</b>, running in your own account. Photos are stored under your account and identified by the configured recognizer; pasted lines are parsed and matched against the catalog with a confidence score. Anything uncertain waits in <b>your</b> review queue.</p>
        <p><b>Prices</b> follow the rule you pick here, or the price you last listed the same printing at, per your automatic-pricing setting.</p>
        <p><b>SKUs</b> come from your own counter (<span class="mono">${esc(seller.sku_prefix)}-${String(seller.sku_next).padStart(seller.sku_pad, "0")}</span> is next).</p>
        <p>Nothing here touches a customer's account. To work inside a customer's workspace, open it from <a href="/admin/users">Users</a>.</p>
        ${
          batches.length
            ? `<h2 style="margin-top:18px">Your recent batches</h2><div class="batch-list">${batches
                .map(
                  (b) => `<a class="batch-row" href="${b.kind === "pricing" ? `/app/pricing/${b.id}` : `/app/review/${b.id}`}"><span class="bid">#${b.id}</span><span class="blabel">${esc(b.label || (b.source === "upload" ? "Photo batch" : b.source === "certs" ? "Graded batch" : b.source === "catalog" ? "Catalog picks" : "Pasted batch"))}</span><span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"} · ${b.review ? `<span class="warn">${b.review} to review</span>` : esc(b.status)} · ${ago(b.created_at)}</span></a>`
                )
                .join("")}</div>`
            : ""
        }
      </aside>
    </div>
    <script>window.__SAMPLE__=${JSON.stringify("Charizard 4/102 Base Set holo NM\n3x Pikachu 58/102 Base\nThe Wandering Emperor Neon Dynasty foil")};</script>`;
  }

  const html = `<div class="wrap ws">
    ${adminHead("upload", "My uploader", "Scan or paste cards into <b>your own</b> account — the owner's personal version of the scan page. Customer accounts are never touched here.")}
    ${flash(msg)}
    ${account}
    ${forms}
    ${APP_JS}
  </div>`;
  return { html, title: "My uploader — Owner console | CardIndex", description: "The owner's personal card uploader." };
}

// ---- Sold prices (the sold_sales archive) ----------------------------------
// The public /sales page and the sold comps on card pages read from this
// archive. It only fills through imports: a feed file uploaded here, the CLI
// (`npm run import:sold`), or the bundled sample for demos.

const FEED_COLUMNS: Array<[string, string, string]> = [
  ["title", "required", "the listing title as sold — matched to a catalog card, printing and grade automatically"],
  ["price", "required", "sale price in dollars (aliases: sold_price, sale_price, amount)"],
  ["date", "required", "date sold, yyyy-mm-dd or any parseable date (aliases: sold_on, sold_date)"],
  ["marketplace", "optional", "ebay · goldin · fanatics … (default ebay)"],
  ["sale_type", "optional", "auction · bin · best_offer"],
  ["list_price", "optional", "the pre-offer list price — shown struck through on Best Offer sales"],
  ["external_id", "optional", "listing / item id; re-uploads with the same id update instead of duplicating"],
  ["url, image_url, bids, grade, condition, currency", "optional", "carried through; grade like “PSA 10”, condition like NM"],
];

export function renderAdminSold(s: SoldArchiveSummary, msg?: string, sampleOnBoot = false): Page {
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const stats = `<div class="stat-cards home-stats">
    <div class="stat"><div class="k">Sales in the archive</div><div class="v mono">${s.total.toLocaleString()}</div><div class="s">${s.real.toLocaleString()} real · ${s.demo.toLocaleString()} demo</div></div>
    <div class="stat"><div class="k">Tied to a catalog card</div><div class="v mono">${pct(s.canonized, s.total)}%</div><div class="s">${s.canonized.toLocaleString()} sales across ${s.cards.toLocaleString()} card${s.cards === 1 ? "" : "s"}</div></div>
    <div class="stat"><div class="k">Marketplaces</div><div class="v mono">${s.marketplaces.length}</div><div class="s">${s.marketplaces.slice(0, 4).map((m) => `${esc(m.marketplace)} ${m.n.toLocaleString()}`).join(" · ") || "none yet"}</div></div>
    <div class="stat"><div class="k">Feed sources</div><div class="v mono">${s.sources.length}</div><div class="s">${s.sources[0] ? `latest import ${ago(s.sources[0].imported_at)}` : "nothing imported yet"}</div></div>
  </div>`;

  const upload = `<form class="ws-panel" method="post" action="/admin/sold/import" enctype="multipart/form-data">
    <div class="ws-panel-head"><h2>Upload a sales file</h2><span class="eyebrow">.csv or .json · up to 60 MB</span></div>
    <label class="fld"><span>File</span><input type="file" name="feed" accept=".csv,.json,text/csv,application/json" required></label>
    <div class="fld-row">
      <label class="fld"><span>Source name <small>groups the rows so a bad upload can be removed; the same id dedupes re-uploads</small></span><input name="source" value="upload-${new Date().toISOString().slice(0, 10)}" maxlength="60" class="mono" required></label>
      <label class="fld ckbox"><input type="checkbox" name="demo" value="1"> <span>Mark as demo data <small>(shown with a “sample” chip; excluded from “real” counts)</small></span></label>
    </div>
    <div class="scan-submit"><button class="btn primary" type="submit">Import sales →</button><span class="hint">Each row is matched to the catalog by title; rows without a title, price or date are skipped.</span></div>
  </form>`;

  const sample = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Demo sample</h2><span class="pill listed">demo</span></div>
    <p class="hint">Loads the bundled 10-row sample feed (Charizard and friends, demo-flagged) so the sold-price pages have something to show. ${
      sampleOnBoot ? "This server keeps sample rows across restarts (<span class=\"mono\">SOLD_SAMPLE_ON_BOOT=1</span>)." : "This server <b>removes sample rows on every restart</b> so the public archive only shows real sales — set <span class=\"mono\">SOLD_SAMPLE_ON_BOOT=1</span> to keep them."
    }</p>
    <form method="post" action="/admin/sold/sample" class="inline"><button class="btn" type="submit">Load the sample feed</button></form>
  </div>`;

  const columns = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>File format</h2><span class="eyebrow">header names are case-insensitive</span></div>
    <div class="tablewrap"><table class="inv-table"><thead><tr><th>Column</th><th></th><th>Meaning</th></tr></thead><tbody>${FEED_COLUMNS.map(
      ([c, req, why]) => `<tr><td class="mono">${esc(c)}</td><td><span class="pill ${req === "required" ? "pending" : ""}">${req}</span></td><td class="sub" style="white-space:normal">${esc(why)}</td></tr>`
    ).join("")}</tbody></table></div>
    <p class="hint" style="margin-top:8px">Example line: <span class="mono">1999 Pokemon Base Set Charizard 4/102 Holo PSA 10,26500,,auction,ebay,2026-08-24,47,item-1001,https://…</span> under the header <span class="mono">title,price,list_price,sale_type,marketplace,date,bids,external_id,url</span>.</p>
  </div>`;

  const sources = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Imports by source</h2><a href="/sales">Open Sold prices →</a></div>
    ${
      s.sources.length
        ? `<div class="tablewrap"><table class="inv-table"><thead><tr><th>Source</th><th>Sales</th><th>Tied to a card</th><th>Sold between</th><th>Imported</th><th></th></tr></thead><tbody>${s.sources
            .map(
              (r) => `<tr>
              <td class="mono">${esc(r.source)}${r.is_demo ? ` <span class="pill listed">demo</span>` : ""}</td>
              <td class="mono">${r.n.toLocaleString()}</td>
              <td class="mono">${r.canonized.toLocaleString()} <span class="sub">(${pct(r.canonized, r.n)}%)</span></td>
              <td class="sub">${esc(r.first_sale ?? "")} → ${esc(r.last_sale ?? "")}</td>
              <td class="sub" title="${esc(stamp(r.imported_at))}">${ago(r.imported_at)}</td>
              <td class="act"><form method="post" action="/admin/sold/source/remove" class="inline" onsubmit="return confirm('Remove all ${r.n} sales imported as ${esc(r.source)}?')"><input type="hidden" name="source" value="${esc(r.source)}"><button class="btn sm ghost" type="submit">Remove</button></form></td>
            </tr>`
            )
            .join("")}</tbody></table></div>`
        : `<p class="hint">Nothing imported yet. Upload a file above or load the demo sample.</p>`
    }
  </div>`;

  const html = `<div class="wrap ws">
    ${adminHead("sold", "Sold prices", "The sold-sales archive behind the public Sold prices page and every card's sold comps. It fills only through imports — upload a feed file here, or run <span class=\"mono\">npm run import:sold</span>.")}
    ${flash(msg)}
    ${stats}
    <div class="home-grid">
      <div>${upload}${columns}</div>
      <div>${sample}${sources}</div>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: "Sold prices — Owner console | CardIndex", description: "Import sold-sales feeds." };
}

// ---- Catalog (games, sets, cards; TCGCSV import) ----------------------------
// Hosted deploys have no shell to the database, so growing the catalog is a
// button here: the import runs inside the server (src/app/catalog-import.ts)
// and this page shows its progress; the photo-ID index follows automatically.

export function renderAdminCatalog(stats: CatalogGameStats[], p: ImportProgress, msg?: string): Page {
  const pct = p.groupsTotal ? Math.round((p.groupsDone / p.groupsTotal) * 100) : 0;
  const rows = stats
    .map(
      (g) => `<tr>
        <td><b>${esc(g.name)}</b><div class="sub mono">${esc(g.slug)}</div></td>
        <td class="mono">${g.sets.toLocaleString()}</td>
        <td class="mono">${g.cards.toLocaleString()}</td>
        <td class="mono">${g.cards ? `${g.hashed.toLocaleString()} <span class="sub">(${Math.round((g.hashed / g.cards) * 100)}%)</span>` : "—"}</td>
        <td class="sub" title="${esc(g.lastImport ?? "")}">${g.lastImport ? ago(g.lastImport) : g.inCatalog ? "seeded" : "not imported"}</td>
        <td class="act">${
          ["pokemon", "onepiece", "mtg"].includes(g.slug)
            ? `<form method="post" action="/admin/catalog/import" class="inline"><input type="hidden" name="game" value="${esc(g.slug)}"><button class="btn sm${g.inCatalog ? "" : " primary"}" type="submit" ${p.running ? "disabled" : ""}>${g.inCatalog ? "Import new sets" : "Import"}</button><label class="ckbox sm" title="Re-import every set, not just new ones"><input type="checkbox" name="force" value="1"> force</label></form>`
            : ""
        }</td>
      </tr>`
    )
    .join("");

  const status = p.startedAt
    ? `<div class="ws-panel">
        <div class="ws-panel-head"><h2>${p.running ? "Importing…" : p.error ? "Last import failed" : "Last import"}</h2><span class="eyebrow">${esc(p.game ?? "")} · ${p.running ? `${p.groupsDone}/${p.groupsTotal} sets` : `finished ${ago(p.finishedAt)}`}</span></div>
        ${p.running ? `<div class="batch-progress"><div class="bp-bar"><div class="bp-fill" style="width:${pct}%"></div></div><div class="bp-stats"><span>${pct}%</span><span>${esc(p.current ?? "")}</span></div></div>` : ""}
        <div class="stat-cards home-stats">
          <div class="stat"><div class="k">New sets</div><div class="v mono">${p.sets}</div></div>
          <div class="stat"><div class="k">New cards</div><div class="v mono">${p.cardsAdded.toLocaleString()}</div><div class="s">${p.cardsUpdated.toLocaleString()} updated</div></div>
          <div class="stat"><div class="k">Prices written</div><div class="v mono">${p.prices.toLocaleString()}</div><div class="s">${p.variants.toLocaleString()} new printings</div></div>
          <div class="stat${p.errors ? " attn" : ""}"><div class="k">Skipped · errors</div><div class="v mono">${p.skipped} · ${p.errors}</div></div>
        </div>
        <pre class="import-log">${esc(p.log.slice(-30).join("\n"))}</pre>
        ${p.running ? `<p class="hint">This page refreshes itself every 5 seconds while the import runs.</p>` : ""}
      </div>`
    : `<div class="ws-panel"><div class="ws-panel-head"><h2>No import yet this session</h2></div><p class="hint">Press <b>Import</b> on a game. Pokémon is ~220 TCGplayer groups (sets, promos, trainer kits) and One Piece ~90; a first import takes several minutes and then hashes every new card image for photo identification, which takes longer. Re-running only fetches sets that were not imported before; <b>force</b> refreshes everything.</p></div>`;

  const html = `<div class="wrap ws">
    ${adminHead("catalog", "Catalog", "Every game, set and card the site knows. Cards come from <b>TCGCSV</b> (TCGplayer's free daily mirror): the same product ids that price them every day and the images the photo recognizer hashes.")}
    ${flash(msg)}
    <div class="ws-panel">
      <div class="ws-panel-head"><h2>Games</h2><form method="post" action="/admin/catalog/hash" class="inline"><button class="btn sm" type="submit" ${p.running ? "disabled" : ""} title="Hash every card image that isn't in the photo-ID index yet">Rebuild photo-ID index</button></form></div>
      <div class="tablewrap"><table class="inv-table"><thead><tr><th>Game</th><th>Sets</th><th>Cards</th><th>Photo-ID index</th><th>Last import</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    ${status}
    ${p.running ? `<meta http-equiv="refresh" content="5">` : ""}
    ${APP_JS}
  </div>`;
  return { html, title: "Catalog — Owner console | CardIndex", description: "Import and refresh the card catalog." };
}

// ---- eBay integration -------------------------------------------------------
// One page for everything eBay: the keyset (entered here, or from the env),
// whether live listings + prices (Browse API) and the seller link (Sell APIs)
// can run, a live search test, and how much eBay data the site holds.

type EbayConnRow = { seller_id: number; display_name: string; email: string | null; ebay_user: string | null; marketplace: string; connected_at: string; last_policy_sync: string | null; last_order_sync: string | null; last_sold_harvest: string | null; published: number };

export function renderAdminEbay(s: EbayAdminStatus, conns: EbayConnRow[], msg?: string): Page {
  const src = (k: keyof EbayAdminStatus["sources"]) => {
    const v = s.sources[k];
    return v === "console" ? `<span class="pill sold">console</span>` : v === "env" ? `<span class="pill listed">env</span>` : `<span class="pill">not set</span>`;
  };
  const okPill = (ok: boolean, yes = "ready", no = "not ready") => (ok ? `<span class="pill sold">${yes}</span>` : `<span class="pill pending">${no}</span>`);

  const stats = `<div class="stat-cards home-stats">
    <div class="stat${s.browseReady ? "" : " attn"}"><div class="k">Live listings &amp; prices</div><div class="v" style="font-size:1.1rem">${okPill(s.browseReady)}</div><div class="s">Browse API · ${s.config.mock ? "mock mode" : s.config.env}${s.health.calls ? ` · ${s.health.calls} calls this boot` : ""}</div></div>
    <div class="stat${s.sellReady ? "" : " attn"}"><div class="k">Seller link</div><div class="v" style="font-size:1.1rem">${okPill(s.sellReady)}</div><div class="s">Sell APIs · ${s.connections} account${s.connections === 1 ? "" : "s"} connected · ${s.published} live listing${s.published === 1 ? "" : "s"}</div></div>
    <div class="stat${s.epnCampaign ? "" : " attn"}"><div class="k">Affiliate campaign</div><div class="v" style="font-size:1.1rem">${okPill(!!s.epnCampaign, "tagging links", "not set")}</div><div class="s">${s.epnCampaign ? `Ambassador / EPN campaign <span class="mono">${esc(s.epnCampaign)}</span>` : `paste the client's campaign id below`}</div></div>
    <div class="stat"><div class="k">Sold prices from eBay</div><div class="v mono">${s.harvestedSales.toLocaleString()}</div><div class="s">real sales harvested from connected sellers' orders</div></div>
  </div>`;

  const keys = `<form class="ws-panel settings-form" method="post" action="/admin/ebay/settings">
    <div class="ws-panel-head"><h2>Developer keyset</h2><span class="eyebrow">values saved here override the env</span></div>
    <p class="hint">Register free at <a href="https://developer.ebay.com" target="_blank" rel="noopener">developer.ebay.com</a> → <b>Application Keys</b> → create a <b>Production</b> keyset. The <b>App ID</b> is the client id, the <b>Cert ID</b> the client secret. That alone powers the live-listings popup and the price research links. For "Connect eBay account" (policies, direct publish, orders), open <b>User Tokens</b> → <b>Get a token from eBay via your application</b>, add a redirect whose <em>auth accepted URL</em> is <span class="mono">${esc(s.callbackUrl)}</span>, and paste the RuName below.</p>
    <div class="fld-row">
      <label class="fld"><span>App ID (client id) ${src("client_id")}</span><input name="client_id" value="" placeholder="${esc(s.config.clientIdMasked || "e.g. JohnDoe-CardInde-PRD-1a2b3c4d5-6e7f8g9h")}" class="mono" autocomplete="off"></label>
      <label class="fld"><span>Cert ID (client secret) ${src("client_secret")}</span><input name="client_secret" type="password" value="" placeholder="${esc(s.config.hasSecret ? s.config.secretMasked + " (kept unless you type a new one)" : "PRD-…")}" class="mono" autocomplete="new-password"></label>
    </div>
    <div class="fld-row">
      <label class="fld"><span>RuName (redirect name) ${src("ru_name")}</span><input name="ru_name" value="${esc(s.config.ruName)}" placeholder="optional · needed for Connect eBay account" class="mono" autocomplete="off"></label>
      <label class="fld"><span>Environment ${src("env")}</span><select name="env">${opt("production", "Production (real listings)", s.config.env)}${opt("sandbox", "Sandbox (test keys, fake listings)", s.config.env)}</select></label>
      <label class="fld"><span>Marketplace ${src("marketplace")}</span><select name="marketplace">${EBAY_MARKETPLACES.map(([id, label]) => opt(id, label, s.config.marketplace)).join("")}</select></label>
    </div>
    <label class="fld ckbox"><input type="checkbox" name="mock" value="1"${s.config.mock ? " checked" : ""}> <span><b>Mock mode</b> <small>canned listings and a canned seller flow so every screen can be tried with no keys; turn it off once real keys are in</small></span></label>
    <h3 class="set-sub">Affiliate campaign (eBay Ambassador / Partner Network) ${src("epn_campid")}</h3>
    <p class="hint">The client's Ambassador account is an eBay Partner Network membership. Paste the <b>10-digit campaign id</b> from their EPN dashboard, or simply paste <b>any share link</b> they generated at ambassador.ebay.com — the id is read out of <span class="mono">campid=…</span>. Every eBay link the site emits then carries it.</p>
    <div class="fld-row">
      <label class="fld"><span>Campaign id or share link</span><input name="epn_campid" value="" placeholder="${esc(s.epnCampaign ? `current: ${s.epnCampaign} (kept unless you paste a new one)` : "5339141403 — or https://www.ebay.com/itm/…&campid=5339141403&…")}" class="mono" autocomplete="off"></label>
      <label class="fld ckbox"><input type="checkbox" name="epn_clear" value="1"> <span>Clear the console value <small>(fall back to EBAY_EPN_CAMPID in the env)</small></span></label>
    </div>
    <div class="cfg-actions">
      <button class="btn primary" type="submit">Save eBay settings</button>
      <button class="btn ghost" type="submit" formaction="/admin/ebay/clear" onclick="return confirm('Remove the keys saved in the console? The env values (if any) apply again.')">Remove console keys</button>
    </div>
  </form>`;

  const t = s.lastTest;
  const testResult = t
    ? `<div class="ws-panel">
        <div class="ws-panel-head"><h2>Last test</h2><span class="eyebrow">${esc(ago(t.at))} · ${t.ms} ms · ${t.ok ? `${t.count} listing${t.count === 1 ? "" : "s"}` : "failed"}</span></div>
        <p class="hint">Query: <span class="mono">${esc(t.query)}</span></p>
        ${
          t.ok
            ? t.items.length
              ? `<div class="ebay-pop-list">${t.items
                  .map(
                    (it) => `<a class="ebay-item" href="${esc(it.url ?? "#")}" target="_blank" rel="noopener nofollow">
                    ${it.image ? `<img src="${esc(it.image)}" alt="">` : `<span class="ebay-noimg"></span>`}
                    <span class="ebay-t">${esc(it.title)}</span>
                    <span class="ebay-m">${esc(it.condition ?? "")}${it.buying ? " · " + esc(it.buying) : ""}${it.seller ? " · " + esc(it.seller) : ""}${it.country ? " · " + esc(it.country) : ""}</span>
                    <span class="ebay-p">${it.price_cents != null ? money(it.price_cents) : "—"}${it.shipping_cents != null ? `<small>${it.shipping_cents ? "+" + money(it.shipping_cents) + " ship" : "free ship"}</small>` : ""}</span>
                  </a>`
                  )
                  .join("")}</div>`
              : `<p class="hint">eBay answered but found no live listings for that query.</p>`
            : `<div class="auth-error" role="alert">${esc(t.error ?? "unknown error")}</div>
               <p class="hint">Common causes: keys copied with a stray space, a <b>sandbox</b> keyset with Environment set to Production (or the reverse), or a brand-new keyset that eBay has not activated yet (takes a few minutes).</p>`
        }
      </div>`
    : "";

  const test = `<form class="ws-panel" method="post" action="/admin/ebay/test">
    <div class="ws-panel-head"><h2>Test a live search</h2><span class="eyebrow">Browse API · bypasses the 10-minute cache</span></div>
    <p class="hint">Runs the same request the review-row <b>eBay Listed</b> popup and the card-page panel use. ${s.browseReady ? "" : `<b>Nothing will run until a keyset is saved above (or mock mode is on).</b>`}</p>
    <div class="fld-row">
      <label class="fld"><span>Search</span><input name="q" value="${esc(t?.query ?? "Charizard 4/102 Base Set Holo")}" class="mono"></label>
      <label class="fld"><span>Listings</span><input name="limit" value="${t?.items.length ? Math.max(10, t.items.length) : 10}" class="mono" inputmode="numeric" style="max-width:90px"></label>
    </div>
    <div class="cfg-actions"><button class="btn primary" type="submit" ${s.browseReady ? "" : "disabled"}>Run test</button><span class="hint">${s.health.lastOkAt ? `last successful call ${esc(ago(s.health.lastOkAt))}` : "no successful call yet this boot"}${s.health.lastError ? ` · last error ${esc(ago(s.health.lastErrorAt))}: <span class="mono">${esc(s.health.lastError.slice(0, 160))}</span>` : ""}${s.health.tokenUntil ? ` · app token valid until ${esc(stamp(s.health.tokenUntil))}` : ""}</span></div>
  </form>`;

  const where = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Where eBay shows up on the site</h2></div>
    <div class="tablewrap"><table class="inv-table"><thead><tr><th>Surface</th><th>What it does</th><th>Needs</th><th>Status</th></tr></thead><tbody>
      <tr><td><b>eBay Listed</b> popup on review rows</td><td class="sub" style="white-space:normal">Live listings for the matched card with price, shipping, condition, seller — every row an affiliate link.</td><td class="sub">App ID + Cert ID</td><td>${okPill(s.browseReady, "live", "hidden — link-out only")}</td></tr>
      <tr><td><b>Live on eBay</b> panel on card pages</td><td class="sub" style="white-space:normal">Same data on the public card page, loaded on demand.</td><td class="sub">App ID + Cert ID</td><td>${okPill(s.browseReady, "live", "hidden")}</td></tr>
      <tr><td><b>eBay listed ↗ / eBay sold ↗</b> buttons</td><td class="sub" style="white-space:normal">Link-outs to eBay's search and completed-sales filter; no API involved.</td><td class="sub">nothing (affiliate tag needs the campaign id)</td><td>${okPill(true, "always on")}</td></tr>
      <tr><td><b>Connect eBay account</b> (Configuration → eBay)</td><td class="sub" style="white-space:normal">Business policies by id, ship-from location, publish / revise / end listings, pull orders, mark shipped.</td><td class="sub">App ID + Cert ID + RuName</td><td>${okPill(s.sellReady, "available", "needs RuName")}</td></tr>
      <tr><td><b>Sold prices from eBay</b></td><td class="sub" style="white-space:normal">Connected sellers' paid orders are folded into the sold-sales archive every 6 h — real comps that grow with every user. (eBay has no public sold-price API; the archive is the substitute.)</td><td class="sub">a connected seller</td><td>${s.harvestedSales ? `<span class="pill sold">${s.harvestedSales.toLocaleString()} sales</span>` : `<span class="pill">none yet</span>`}</td></tr>
    </tbody></table></div>
  </div>`;

  const connTable = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Connected sellers</h2><span class="eyebrow">${conns.length} account${conns.length === 1 ? "" : "s"}</span></div>
    ${
      conns.length
        ? `<div class="tablewrap"><table class="inv-table"><thead><tr><th>Seller</th><th>eBay user</th><th>Market</th><th>Connected</th><th>Policies synced</th><th>Orders pulled</th><th>Sold harvested</th><th>Live listings</th></tr></thead><tbody>${conns
            .map(
              (c) => `<tr><td><a href="/admin/users/${c.seller_id}"><b>${esc(c.display_name)}</b></a><div class="sub">${esc(c.email ?? "")}</div></td><td class="mono">${esc(c.ebay_user ?? "—")}</td><td class="mono">${esc(c.marketplace)}</td><td class="sub">${esc(ago(c.connected_at))}</td><td class="sub">${c.last_policy_sync ? esc(ago(c.last_policy_sync)) : "never"}</td><td class="sub">${c.last_order_sync ? esc(ago(c.last_order_sync)) : "never"}</td><td class="sub">${c.last_sold_harvest ? esc(ago(c.last_sold_harvest)) : "never"}</td><td class="mono">${c.published}</td></tr>`
            )
            .join("")}</tbody></table></div>`
        : `<p class="hint">No seller has connected an eBay account yet. Once the RuName is saved, sellers connect from Configuration → eBay.</p>`
    }
  </div>`;

  const d = s.deletion;
  const deletion = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Account deletion notifications</h2><span class="eyebrow">required before eBay enables a Production keyset</span></div>
    <p class="hint">On <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener">developer.ebay.com → Application Keys</a>, open <b>Notifications</b> next to the Production keyset and pick <b>Marketplace Account Deletion</b>, enter an alert email, paste these two values and click <b>Save</b>. eBay checks the endpoint on the spot. Then click <b>Send Test Notification</b>. It should show up in the count below.</p>
    <label class="fld"><span>Notification endpoint URL</span><input readonly value="${esc(d.endpoint)}" class="mono" onclick="this.select()"></label>
    <label class="fld"><span>Verification token</span><input readonly value="${esc(d.token)}" class="mono" onclick="this.select()"></label>
    <p class="hint">${d.received ? `${d.received.toLocaleString()} notification${d.received === 1 ? "" : "s"} received, the last ${esc(ago(d.lastAt))} · ${d.removed} connected seller${d.removed === 1 ? "" : "s"} removed.` : "No notifications received yet."} When a deletion names a connected seller, their eBay link (username, tokens, policies, address) is deleted and they have to connect again.${d.endpoint.startsWith("https://") ? "" : ` <b>eBay only accepts an https:// endpoint.</b> Open this page on the live site, or set APP_BASE_URL.`}</p>
  </div>`;

  const html = `<div class="wrap ws">
    ${adminHead("ebay", "eBay", "Live listings and prices from eBay, the seller account link, and the affiliate tagging — configured here, no redeploy needed.")}
    ${flash(msg)}
    ${stats}
    <div class="home-grid">
      <div>${keys}${deletion}${test}${testResult}</div>
      <div>${where}${connTable}</div>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: "eBay — Owner console | CardIndex", description: "eBay integration status, keys and tests." };
}

// ---- Activity feed --------------------------------------------------------

export function renderAdminActivity(rows: ActivityRow[], f: ActivityFilter, users: UserRow[], msg?: string): Page {
  const kinds = ["all", "login", "signup", "action", "page", "plan_change", "owner"];
  const html = `<div class="wrap ws">
    ${adminHead("activity", "Activity log", "Every login, page view, and action across all accounts — newest first. Events tagged “by owner” happened while you were working inside a customer's workspace.")}
    ${flash(msg)}
    <form class="inv-toolbar" method="get" action="/admin/activity">
      <select name="user" onchange="this.form.submit()">${opt("", "All users", String(f.sellerId ?? ""))}${users.map((u) => opt(String(u.id), `${u.display_name}${u.email ? " · " + u.email : ""}`, String(f.sellerId ?? ""))).join("")}</select>
      <select name="kind" onchange="this.form.submit()">${kinds.map((k) => opt(k, k === "all" ? "All events" : KIND_LABEL[k] ?? k, f.kind ?? "all")).join("")}</select>
      <button class="btn sm" type="submit">Filter</button>
    </form>
    ${activityTable(rows, { showUser: true })}
    <p class="hint" style="margin-top:8px">Showing the latest ${rows.length} event${rows.length === 1 ? "" : "s"}.</p>
    ${APP_JS}
  </div>`;
  return { html, title: "Activity — Owner console | CardIndex", description: "Site-wide user activity." };
}

// ---- Feedback queue -------------------------------------------------------

function feedbackCard(f: FeedbackRow): string {
  const kind = FEEDBACK_KINDS.find((k) => k.key === f.kind)?.label ?? f.kind;
  return `<div class="fb ws-panel ${esc(f.status)}" id="fb-${f.id}">
    <div class="fb-head"><span class="pill ${esc(f.kind)}">${esc(kind)}</span><b>${esc(f.title)}</b><span class="hint"><a href="${userHref(f.seller_id)}">${esc(f.display_name)}</a> · ${ago(f.created_at)}</span><span class="pill ${f.status === "answered" ? "sold" : f.status === "open" ? "pending" : ""}">${esc(f.status)}</span></div>
    <p class="fb-body">${esc(f.body)}</p>
    ${f.reply ? `<div class="fb-reply"><span class="te-lbl">Your reply · ${ago(f.replied_at)}</span><p>${esc(f.reply)}</p></div>` : ""}
    <form method="post" action="/admin/feedback/${f.id}/reply" class="fb-reply-form">
      <textarea name="reply" rows="2" placeholder="${f.reply ? "Update your reply…" : "Write a reply — it shows up in their inbox."}">${esc(f.reply ?? "")}</textarea>
      <div class="fb-reply-actions"><button class="btn sm primary" type="submit">${f.reply ? "Update reply" : "Send reply"}</button>
        ${f.status !== "closed" ? `<button class="btn sm ghost" type="submit" name="close" value="1">Close</button>` : ""}</div>
    </form>
  </div>`;
}

export function renderAdminFeedback(rows: FeedbackRow[], status: string, msg?: string): Page {
  const tabs = ["open", "answered", "closed", "all"]
    .map((s) => `<a href="/admin/feedback${s === "all" ? "" : "?status=" + s}" class="${status === s ? "active" : ""}">${s[0].toUpperCase() + s.slice(1)}</a>`)
    .join("");
  const html = `<div class="wrap ws">
    ${adminHead("feedback", "Feedback", "Notes, bug reports and missing-card requests from every account. Replies land in the sender's inbox.")}
    ${flash(msg)}
    <div class="inv-toolbar"><div class="tabs">${tabs}</div></div>
    ${rows.length ? rows.map(feedbackCard).join("") : `<div class="ws-empty"><h3>Nothing here</h3><p>No ${status === "all" ? "" : status + " "}feedback.</p></div>`}
    ${APP_JS}
  </div>`;
  return { html, title: "Feedback — Owner console | CardIndex", description: "Customer feedback queue." };
}
