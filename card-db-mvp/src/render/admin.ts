// Owner CRM pages (/admin): overview, users, one customer's profile (plan,
// usage, activity, add cards on their behalf, open their workspace), the
// site-wide activity feed, and the feedback queue. Server-rendered forms like
// the rest of the workspace; only reachable behind the owner gate in server.ts.

import { esc, money } from "../util.ts";
import { flash, APP_JS, conditionOptions, languageOptions, ruleOptions, opt } from "./app.ts";
import { BRAND_MARK } from "./layout.ts";
import { ruleKey } from "../app/pricing.ts";
import { FEEDBACK_KINDS } from "../app/feedback.ts";
import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL } from "../app/billing.ts";
import { MAX_UPLOAD_FILES, MAX_UPLOAD_BYTES } from "../upload.ts";
import type { Seller } from "../app/store.ts";
import type { UserRow, UserFilter, UserUsage, Overview, ActivityRow, ActivityFilter, FeedbackRow } from "../app/admin.ts";

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
    ["/admin/upload", "Upload cards", "upload"],
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
    ${adminHead("users", "Users", "Every account, its plan tier, and how active it is. Open a profile to change the plan, add cards, or work inside their workspace.")}
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

  const addCards = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Add cards for ${esc(u.display_name)}</h2><a class="btn sm" href="/admin/upload?user=${u.id}">Full uploader →</a></div>
    <form method="post" action="/admin/users/${u.id}/add-cards" class="scan-form">
      <label class="fld">
        <span>Cards <small>one per line — name, number (4/102 or #119), set, finish, condition, language, qty (e.g. 3x)</small></span>
        <textarea name="lines" rows="5" placeholder="Charizard 4/102 Base Set holo NM&#10;3x Pikachu 58/102 Base&#10;The Wandering Emperor Neon Dynasty foil"></textarea>
      </label>
      <div class="fld-row">
        <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. Added by owner · consignment"></label>
        <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
        <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(ruleKey(seller.price_mode, seller.price_pct))}</select></label>
      </div>
      <div class="scan-submit">
        <button class="btn primary" type="submit">Identify &amp; queue for review →</button>
        <span class="hint">Photos? Use the <a href="/admin/upload?user=${u.id}">uploader</a>.</span>
      </div>
    </form>
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
      <div>${actAs}${addCards}${actPanel}</div>
      <div>${planCard}${idCard}${batchPanel}${fbPanel}</div>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: `${u.display_name} — Owner console | CardIndex`, description: "Customer profile." };
}

// ---- Owner uploader -------------------------------------------------------
// The owner's own scan page: pick an account, then upload photos or paste a
// list exactly like /app/scan. Posts to the per-user add routes, so the batch
// lands in that customer's review queue and the owner is taken there in owner
// mode. Same element ids as the customer scan page so APP_JS enhances the
// dropzone (previews, drag & drop, file limits) and the sample loader.

export function renderAdminUpload(users: UserRow[], target: UserRow | null, seller: Seller | null, msg?: string): Page {
  const picker = `<form method="get" action="/admin/upload" class="ws-panel upload-target">
    <div class="ws-panel-head"><h2>Add cards to</h2><span class="eyebrow">${users.length} account${users.length === 1 ? "" : "s"}</span></div>
    <div class="fld-row">
      <label class="fld"><span>Account</span>
        <select name="user" onchange="this.form.submit()">${opt("", "Choose an account…", String(target?.id ?? ""))}${users
          .map((u) => opt(String(u.id), `${u.display_name}${u.email ? " · " + u.email : ""} (${u.plan_tier === "pro" ? "Pro" : "Free"})`, String(target?.id ?? "")))
          .join("")}</select></label>
      <div class="fld"><span>&nbsp;</span><button class="btn" type="submit">Select</button></div>
    </div>
    ${
      target
        ? `<p class="hint">Cards go into <b>${esc(target.display_name)}</b>'s account (${tierPill(target.plan_tier)} · ${target.inventory} in inventory · ${target.batches} batch${target.batches === 1 ? "" : "es"}). Each upload becomes a batch in their review queue; you'll be taken there in owner mode to confirm and add to inventory. <a href="/admin/users/${target.id}">Their profile →</a></p>`
        : `<p class="hint">Pick the customer whose account the cards belong to. Your own account is in the list too.</p>`
    }
  </form>`;

  let forms = "";
  if (target && seller) {
    const rk = ruleKey(seller.price_mode, seller.price_pct);
    forms = `<div class="scan-grid">
      <div class="scan-main">
        <form class="ws-panel upload-form" method="post" action="/admin/users/${target.id}/add-photos" enctype="multipart/form-data">
          <div class="ws-panel-head"><h2>Upload photos</h2><span class="eyebrow">phone or scanner</span></div>
          <label class="dropzone" id="dropzone" data-max-files="${MAX_UPLOAD_FILES}" data-max-bytes="${MAX_UPLOAD_BYTES}">
            <input type="file" name="images" id="imgInput" accept="image/*" capture="environment" multiple hidden>
            <div class="dz-inner">
              <div class="dz-ic">📷</div>
              <div class="dz-main"><b>Tap to choose</b> or drag &amp; drop card photos</div>
              <div class="dz-hint">JPG / PNG / WebP / HEIC · one card per image · front side · up to ${MAX_UPLOAD_FILES} photos or ${Math.round(MAX_UPLOAD_BYTES / 1_000_000)} MB per batch</div>
            </div>
            <div class="dz-preview" id="dzPreview" hidden></div>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. Consignment box · ${esc(target.display_name)}"></label>
            <label class="fld"><span>Default condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
            <label class="fld"><span>Default language</span><select name="language">${languageOptions(seller.default_language)}</select></label>
          </div>
          <div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(rk)}</select></label>
            <label class="fld"><span>Their SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit" id="uploadBtn">Upload &amp; identify →</button>
            <span class="hint" id="dzCount">No photos selected yet</span>
          </div>
        </form>

        <form class="scan-form ws-panel" method="post" action="/admin/users/${target.id}/add-cards" id="paste">
          <div class="ws-panel-head"><h2>Or paste a list</h2><button type="button" class="btn sm" id="loadsample">Load sample</button></div>
          <label class="fld">
            <span>Cards <small>one per line — name, number (4/102 or #119), set, finish, condition, language, qty (e.g. 3x)</small></span>
            <textarea name="lines" id="lines" rows="7" placeholder="Charizard 4/102 Base Set holo NM&#10;3x Pikachu 58/102 Base&#10;The Wandering Emperor Neon Dynasty foil"></textarea>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Batch label</span><input type="text" name="label" placeholder="e.g. Box break · ${esc(target.display_name)}"></label>
            <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(seller.default_condition)}</select></label>
            <label class="fld"><span>Language</span><select name="language">${languageOptions(seller.default_language)}</select></label>
          </div>
          <div class="fld-row">
            <label class="fld"><span>Pricing rule</span><select name="rule">${ruleOptions(rk)}</select></label>
            <label class="fld"><span>Their SKU prefix</span><input type="text" name="sku_prefix" value="${esc(seller.sku_prefix)}" maxlength="12"></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit">Identify cards →</button>
            <span class="hint">You'll review every match in their queue before anything reaches their inventory.</span>
          </div>
        </form>
      </div>

      <aside class="ws-panel scan-side">
        <h2>How this works</h2>
        <p><b>Same pipeline as the customer's scan page.</b> Photos are stored under their account and identified by the configured recognizer; pasted lines are parsed and matched against the catalog with a confidence score. Anything uncertain waits in <b>their</b> review queue.</p>
        <p><b>Prices</b> follow the rule you pick here, or the price they last listed the same printing at, per their automatic-pricing setting.</p>
        <p><b>SKUs</b> come from their counter (<span class="mono">${esc(seller.sku_prefix)}-${String(seller.sku_next).padStart(seller.sku_pad, "0")}</span> is next), so nothing collides with cards they added themselves.</p>
        <p>Every batch you add is tagged <span class="pill owner">by owner</span> in the activity log.</p>
      </aside>
    </div>
    <script>window.__SAMPLE__=${JSON.stringify("Charizard 4/102 Base Set holo NM\n3x Pikachu 58/102 Base\nThe Wandering Emperor Neon Dynasty foil")};</script>`;
  }

  const html = `<div class="wrap ws">
    ${adminHead("upload", "Upload cards", "Scan or paste cards straight into any customer's account — the owner's own version of the scan page.")}
    ${flash(msg)}
    ${picker}
    ${forms}
    ${APP_JS}
  </div>`;
  return { html, title: "Upload cards — Owner console | CardIndex", description: "Owner uploader." };
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
