// Owner console pages (/admin): overview, members, one member's profile (plan,
// usage, activity, open their collection), the site-wide activity feed, the
// feedback queue, and the owner's own uploader. Server-rendered forms like the
// rest of the site; only reachable behind the owner gate in server.ts.

import { esc, money } from "../util.ts";
import { flash, APP_JS, conditionOptions, languageOptions, opt } from "./collection.ts";
import { BRAND_MARK } from "./layout.ts";
import { FEEDBACK_KINDS } from "../app/feedback.ts";
import { PRO_PRICE_LABEL, PRO_PERIOD_LABEL } from "../app/billing.ts";
import { MAX_UPLOAD_FILES_PRO, MAX_UPLOAD_BYTES, UPLOAD_CHUNK_FILES, UPLOAD_MAX_EDGE } from "../upload.ts";
import type { Member } from "../app/collection.ts";
import type { UserRow, UserFilter, UserUsage, Overview, ActivityRow, ActivityFilter, FeedbackRow } from "../app/admin.ts";
import type { SoldArchiveSummary } from "../app/soldimport.ts";

type Page = { html: string; title: string; description: string };
type BatchRow = { id: number; label: string | null; source: string; kind: string; status: string; total: number; review: number; created_at: string };

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
  return `<a href="${userHref(u.id)}"><b>${esc(u.display_name)}</b></a><div class="sub">${u.email ? esc(u.email) : `<i>legacy account · no login</i>`}</div>`;
}

const KIND_LABEL: Record<string, string> = {
  login: "Login", signup: "Sign-up", logout: "Logout", page: "Page", action: "Action", plan_change: "Plan", owner: "Owner",
};

function kindPill(kind: string): string {
  return `<span class="pill ev-${esc(kind)}">${esc(KIND_LABEL[kind] ?? kind)}</span>`;
}

function batchName(b: BatchRow): string {
  if (b.label) return b.label;
  if (b.kind === "pricing") return "Price check";
  return b.source === "upload" ? "Photo upload" : b.source === "certs" ? "Graded slabs" : b.source === "catalog" ? "Set picks" : "Pasted list";
}
const batchHref = (b: BatchRow) => (b.kind === "pricing" ? `/collection/priced/${b.id}` : `/collection/review/${b.id}`);

function subnav(active: string): string {
  const items: Array<[string, string, string]> = [
    ["/admin", "Overview", "home"],
    ["/admin/users", "Members", "users"],
    ["/admin/upload", "My uploader", "upload"],
    ["/admin/sold", "Sold prices", "sold"],
    ["/admin/activity", "Activity", "activity"],
    ["/admin/feedback", "Feedback", "feedback"],
  ];
  return `<nav class="ws-nav" aria-label="Owner console"><div class="ws-group">${items
    .map(([href, text, key]) => `<a href="${href}" class="${key === active ? "active" : ""}">${text}</a>`)
    .join("")}</div><div class="ws-group ws-group-end"><form method="post" action="/admin/logout" class="inline-form"><button type="submit" class="ws-nav-btn">Sign out of console</button></form></div></nav>`;
}

// ---- Owner sign-in --------------------------------------------------------

export function renderAdminLogin(opts: { error?: string; email?: string; configured: boolean; lockedMinutes?: number; next?: string } = { configured: true }): Page {
  const { error, email = "", configured, lockedMinutes, next } = opts;
  const html = `<div class="auth-wrap">
    <div class="auth-card admin-auth">
      <a class="auth-brand" href="/">${BRAND_MARK}<span>CardIndex</span></a>
      <div class="eyebrow" style="color:var(--gold);margin-bottom:4px">Owner console</div>
      <h1>Owner sign-in</h1>
      <p class="auth-sub">Separate from member accounts. Members, plan tiers, activity, feedback, and the owner uploader.</p>
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
      <div class="auth-alt">Looking for your collection? <a href="/login">Member sign-in</a></div>
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
      <th>When</th>${opts.showUser ? "<th>Member</th>" : ""}<th>Event</th><th>What</th><th>Path</th></tr></thead><tbody>${rows
    .map(
      (a) => `<tr>
        <td class="sub" title="${esc(stamp(a.created_at))}">${ago(a.created_at)}</td>
        ${opts.showUser ? `<td>${userCell(a)}</td>` : ""}
        <td>${kindPill(a.kind)}</td>
        <td>${esc(a.detail ?? "")}${a.by_owner ? ` <span class="pill owner" title="Done by you, inside this member's collection">by owner</span>` : ""}</td>
        <td class="mono sub">${esc(a.method)} ${esc(a.path)}</td>
      </tr>`
    )
    .join("")}</tbody></table></div>`;
}

// ---- Overview -------------------------------------------------------------

export function renderAdminHome(ov: Overview, daily: Array<{ day: string; users: number; events: number }>, recent: ActivityRow[], newest: UserRow[], msg?: string): Page {
  const proPct = ov.total ? Math.round((ov.pro / ov.total) * 100) : 0;
  const stats = `<div class="stat-cards home-stats">
    <div class="stat"><div class="k">Members</div><div class="v mono">${ov.total}</div><div class="s">${ov.new_7d} new this week · ${ov.new_30d} this month</div></div>
    <div class="stat"><div class="k">Pro (paid)</div><div class="v mono">${ov.pro}</div><div class="s">${proPct}% of members · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL} each</div></div>
    <div class="stat"><div class="k">Free tier</div><div class="v mono">${ov.free}</div><div class="s">price checks &amp; wishlist · upgrade candidates</div></div>
    <div class="stat"><div class="k">Active members</div><div class="v mono">${ov.active_7d}</div><div class="s">last 7 days · ${ov.active_30d} in 30 days</div></div>
    <div class="stat${ov.feedback_open ? " attn" : ""}"><div class="k">Open feedback</div><div class="v mono">${ov.feedback_open}</div><div class="s">${ov.feedback_open ? `<a href="/admin/feedback">answer →</a>` : "inbox is clear"}</div></div>
  </div>`;

  const max = Math.max(1, ...daily.map((d) => d.users));
  const bars = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Daily active members</h2><span class="eyebrow">last ${daily.length} days · ${ov.events_24h} events in 24 h</span></div>
    <div class="dau-bars" role="img" aria-label="Daily active members">${daily
      .map((d) => `<div class="dau-col" title="${esc(d.day)}: ${d.users} member${d.users === 1 ? "" : "s"}, ${d.events} events"><div class="dau-bar" style="height:${Math.round((d.users / max) * 100)}%"></div><span class="dau-lbl">${esc(d.day.slice(5))}</span></div>`)
      .join("")}</div>
  </div>`;

  const totals = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Across all members</h2></div>
    <div class="admin-kv">
      <div><span>Uploads &amp; price checks</span><b class="mono">${ov.batches}</b></div>
      <div><span>Collection rows</span><b class="mono">${ov.collection_rows}</b></div>
      <div><span>Wishlist cards</span><b class="mono">${ov.wishlist_rows}</b></div>
      <div><span>Events (24 h)</span><b class="mono">${ov.events_24h}</b></div>
    </div>
  </div>`;

  const newestPanel = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Newest members</h2><a href="/admin/users?sort=newest">All members →</a></div>
    ${
      newest.length
        ? `<div class="batch-list">${newest
            .map((u) => `<a class="batch-row" href="${userHref(u.id)}"><span class="blabel">${esc(u.display_name)}</span><span class="sub">${esc(u.email ?? "")}</span><span class="bmeta">${tierPill(u.plan_tier)} · joined ${ago(u.created_at)}</span></a>`)
            .join("")}</div>`
        : `<p class="hint">No members yet.</p>`
    }
  </div>`;

  const feed = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Latest activity</h2><a href="/admin/activity">Full log →</a></div>
    ${activityTable(recent, { showUser: true })}
  </div>`;

  const html = `<div class="wrap ws">
    ${adminHead("home", "Overview", "Who's on the site, who's paying, and what they're doing.")}
    ${flash(msg)}
    ${stats}
    <div class="home-grid">
      <div>${bars}${feed}</div>
      <div>${totals}${newestPanel}</div>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: "Overview — Owner console | CardIndex", description: "Owner console overview." };
}

// ---- Members --------------------------------------------------------------

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
      <td class="mono">${u.collection}</td>
      <td class="mono">${u.wishlist}</td>
      <td class="sub">${ago(u.created_at)}</td>
      <td class="act"><a class="btn sm" href="${userHref(u.id)}">Profile</a>
        <form method="post" action="/admin/users/${u.id}/act-as" class="inline-form"><button class="btn sm" type="submit" title="Open this member's collection as owner">Open collection</button></form></td>
    </tr>`
    )
    .join("");

  const html = `<div class="wrap ws">
    ${adminHead("users", "Members", "Every account, its plan tier, and how active it is. Open a profile to change the plan or work inside their collection.")}
    ${flash(msg)}
    <form class="inv-toolbar" method="get" action="/admin/users">
      <div class="tabs">${tierTabs}</div>
      <input type="search" name="q" value="${esc(f.q ?? "")}" placeholder="Search name or email…" aria-label="Search members">
      ${f.tier ? `<input type="hidden" name="tier" value="${esc(f.tier)}">` : ""}
      <select name="sort" onchange="this.form.submit()">${opt("recent", "Recently active", f.sort ?? "recent")}${opt("newest", "Newest", f.sort ?? "")}${opt("tier", "Pro first", f.sort ?? "")}${opt("collection", "Biggest collection", f.sort ?? "")}${opt("name", "Name", f.sort ?? "")}</select>
      <button class="btn sm" type="submit">Filter</button>
    </form>
    ${
      rows.length
        ? `<div class="tablewrap"><table class="inv-table users-table"><thead><tr><th>#</th><th>Member</th><th>Plan</th><th>Last seen</th><th>Last login</th><th title="Activity events in the last 7 days">7-day events</th><th>Uploads</th><th>Collection</th><th>Wishlist</th><th>Joined</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
           <p class="hint" style="margin-top:8px">${rows.length} member${rows.length === 1 ? "" : "s"}</p>`
        : `<div class="ws-empty"><h3>No members match</h3><p>Try a different search or tier.</p></div>`
    }
    ${APP_JS}
  </div>`;
  return { html, title: "Members — Owner console | CardIndex", description: "All accounts and plan tiers." };
}

// ---- One member's profile -------------------------------------------------

export function renderAdminUser(u: UserRow, usage: UserUsage, batches: BatchRow[], activity: ActivityRow[], feedback: FeedbackRow[], msg?: string): Page {
  const pro = u.plan_tier === "pro";
  const idCard = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Account</h2><span class="mono sub">#${u.id}</span></div>
    <div class="admin-kv">
      <div><span>Email</span><b>${u.email ? esc(u.email) : "<i>none (legacy account)</i>"}</b></div>
      <div><span>Display name</span><b>${esc(u.display_name)}</b></div>
      <div><span>Joined</span><b title="${esc(stamp(u.created_at))}">${ago(u.created_at)}</b></div>
      <div><span>Last login</span><b title="${esc(stamp(u.last_login_at))}">${ago(u.last_login_at)}</b></div>
      <div><span>Last seen</span><b title="${esc(stamp(u.last_seen_at))}">${ago(u.last_seen_at)}</b></div>
      <div><span>Events (7 d)</span><b class="mono">${u.events_7d}</b></div>
      <div><span>Price checks</span><b class="mono">${usage.price_checks}</b></div>
      <div><span>Graded slabs</span><b class="mono">${usage.graded}</b></div>
    </div>
  </div>`;

  const planCard = `<div class="ws-panel plan-card ${pro ? "is-pro" : "is-free"}">
    <div class="ws-panel-head"><h2>Plan</h2>${tierPill(u.plan_tier)}</div>
    <p class="hint">${pro ? `Pro · ${PRO_PRICE_LABEL}/${PRO_PERIOD_LABEL}. Collection tracking, unlimited wishlist with alerts, export.` : "Free · price checks, sold-price lookup and a capped wishlist. The collection is locked until upgraded."}</p>
    <form method="post" action="/admin/users/${u.id}/plan" class="plan-form">
      <input type="hidden" name="tier" value="${pro ? "free" : "pro"}">
      <button class="btn ${pro ? "" : "primary"}" type="submit"${pro ? ` data-confirm="${esc(`Move ${u.display_name} to the Free tier? They lose access to their collection until re-upgraded.`)}" onclick="return confirm(this.dataset.confirm)"` : ""}>${pro ? "Downgrade to Free" : "Upgrade to Pro"}</button>
    </form>
    <p class="hint" style="margin-top:8px">Plan changes are logged in the activity feed. Stripe will flip this automatically once checkout is wired up.</p>
  </div>`;

  const usageCard = `<div class="stat-cards">
    <div class="stat"><div class="k">Collection value</div><div class="v mono">${money(usage.collection_value_cents)}</div><div class="s">${usage.collection_units} card${usage.collection_units === 1 ? "" : "s"} · ${u.collection} printing${u.collection === 1 ? "" : "s"}</div></div>
    <div class="stat"><div class="k">Uploads</div><div class="v mono">${u.batches}</div><div class="s">${usage.last_batch_at ? `last ${ago(usage.last_batch_at)}` : "none yet"}</div></div>
    <div class="stat${usage.review_items ? " attn" : ""}"><div class="k">Awaiting review</div><div class="v mono">${usage.review_items}</div><div class="s">${usage.review_items ? "cards waiting on them" : "nothing waiting"}</div></div>
    <div class="stat"><div class="k">Wishlist</div><div class="v mono">${u.wishlist}</div><div class="s">${usage.wishlist_hits ? `${usage.wishlist_hits} at target price` : "none at target"}</div></div>
  </div>`;

  const actAs = `<div class="ws-panel act-panel">
    <div class="ws-panel-head"><h2>Work in their collection</h2></div>
    <p class="hint">Opens the member area — add cards, review, collection, wishlist, settings — <b>as ${esc(u.display_name)}</b>. Everything you add lands in their account and is tagged as done by you. The banner at the top ends owner mode.</p>
    <div class="act-buttons">
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/collection"><button class="btn primary" type="submit">Open collection</button></form>
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/collection/add"><button class="btn" type="submit">Add cards</button></form>
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/collection/cards"><button class="btn" type="submit">Their cards</button></form>
      <form method="post" action="/admin/users/${u.id}/act-as"><input type="hidden" name="next" value="/collection/wishlist"><button class="btn" type="submit">Wishlist</button></form>
    </div>
  </div>`;

  const batchPanel = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Recent uploads</h2></div>
    ${
      batches.length
        ? `<div class="batch-list">${batches
            .map(
              (b) => `<form method="post" action="/admin/users/${u.id}/act-as" class="batch-row-form"><input type="hidden" name="next" value="${batchHref(b)}"><button type="submit" class="batch-row as-btn"><span class="bid">#${b.id}</span><span class="blabel">${esc(batchName(b))}</span><span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"} · ${b.review ? `<span class="warn">${b.review} to review</span>` : esc(b.status)} · ${ago(b.created_at)}</span></button></form>`
            )
            .join("")}</div>`
        : `<p class="hint">No uploads yet.</p>`
    }
  </div>`;

  const fbPanel = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Feedback from this member</h2>${usage.feedback_open ? `<span class="pill pending">${usage.feedback_open} open</span>` : ""}</div>
    ${feedback.length ? feedback.map(feedbackCard).join("") : `<p class="hint">Nothing sent yet.</p>`}
  </div>`;

  const actPanel = `<div class="ws-panel">
    <div class="ws-panel-head"><h2>Activity</h2><a href="/admin/activity?user=${u.id}">Full history →</a></div>
    ${activityTable(activity, { showUser: false })}
  </div>`;

  const html = `<div class="wrap ws">
    ${adminHead("users", u.display_name, `${u.email ? esc(u.email) + " · " : ""}member #${u.id} · ${pro ? "Pro" : "Free"} tier`, `<a class="btn" href="/admin/users">← All members</a>`)}
    ${flash(msg)}
    ${usageCard}
    <div class="home-grid">
      <div>${actAs}${actPanel}</div>
      <div>${planCard}${idCard}${batchPanel}${fbPanel}</div>
    </div>
    ${APP_JS}
  </div>`;
  return { html, title: `${u.display_name} — Owner console | CardIndex`, description: "Member profile." };
}

// ---- Owner uploader -------------------------------------------------------
// The owner's PERSONAL add page: upload photos or paste a list exactly like
// /collection/add, into the owner's own account (app/admin.ts ensureOwnerSeller)
// — never into a member's. Posts to /admin/upload/photos and /admin/upload; the
// batch lands in the owner's own review queue. Same element ids as the member
// add page so APP_JS enhances the dropzone and the sample loader.

export function renderAdminUpload(owner: UserRow | null, member: Member | null, usage: UserUsage | null, batches: BatchRow[], msg?: string): Page {
  const account = owner && usage
    ? `<div class="ws-panel act-panel upload-target">
    <div class="ws-panel-head"><h2>Your account</h2><span class="mono sub">member #${owner.id}${owner.email ? ` · ${esc(owner.email)}` : ""}</span></div>
    <p class="hint">Everything you add here goes into <b>your own</b> collection — the owner's account, separate from every member. Each upload becomes a batch in your review queue; confirm it there and it's in your collection.</p>
    <div class="stat-cards">
      <div class="stat"><div class="k">Collection</div><div class="v mono">${usage.collection_units}</div><div class="s">card${usage.collection_units === 1 ? "" : "s"} · ${money(usage.collection_value_cents)}</div></div>
      <div class="stat"><div class="k">Uploads</div><div class="v mono">${owner.batches}</div><div class="s">${usage.last_batch_at ? `last ${ago(usage.last_batch_at)}` : "none yet"}</div></div>
      <div class="stat${usage.review_items ? " attn" : ""}"><div class="k">Awaiting review</div><div class="v mono">${usage.review_items}</div><div class="s">${usage.review_items ? "cards waiting on you" : "nothing waiting"}</div></div>
      <div class="stat"><div class="k">Wishlist</div><div class="v mono">${owner.wishlist}</div><div class="s">${usage.wishlist_hits ? `${usage.wishlist_hits} at target` : "none at target"}</div></div>
    </div>
    <div class="act-buttons">
      <a class="btn primary" href="/collection">Open my collection</a>
      <a class="btn" href="/collection/uploads">My uploads</a>
      <a class="btn" href="/collection/cards">My cards</a>
      <a class="btn" href="/collection/wishlist">My wishlist</a>
      <a class="btn" href="/collection/settings">My settings</a>
    </div>
  </div>`
    : "";

  let forms = "";
  if (owner && member) {
    forms = `<div class="scan-grid">
      <div class="scan-main">
        <form class="ws-panel upload-form" method="post" action="/admin/upload/photos" enctype="multipart/form-data">
          <div class="ws-panel-head"><h2>Upload photos</h2><span class="eyebrow">phone or scanner</span></div>
          <label class="dropzone" id="dropzone" data-max-files="${MAX_UPLOAD_FILES_PRO}" data-max-bytes="${MAX_UPLOAD_BYTES}" data-chunk="${UPLOAD_CHUNK_FILES}" data-max-edge="${UPLOAD_MAX_EDGE}">
            <input type="file" name="images" id="imgInput" accept="image/*" capture="environment" multiple hidden>
            <div class="dz-inner">
              <div class="dz-ic">📷</div>
              <div class="dz-main"><b>Tap to choose</b> or drag &amp; drop card photos</div>
              <div class="dz-hint">JPG / PNG / WebP / HEIC · one card per image · front side · up to ${MAX_UPLOAD_FILES_PRO} photos per upload · resized to ${UPLOAD_MAX_EDGE} px on your device and sent in groups of ${UPLOAD_CHUNK_FILES}</div>
            </div>
            <div class="dz-preview" id="dzPreview" hidden></div>
          </label>
          <div class="fld-row">
            <label class="fld"><span>Label</span><input type="text" name="label" placeholder="e.g. Saturday show pickups"></label>
            <label class="fld"><span>Default condition</span><select name="condition">${conditionOptions(member.default_condition)}</select></label>
            <label class="fld"><span>Default language</span><select name="language">${languageOptions(member.default_language)}</select></label>
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
            <label class="fld"><span>Label</span><input type="text" name="label" placeholder="e.g. Box break"></label>
            <label class="fld"><span>Condition</span><select name="condition">${conditionOptions(member.default_condition)}</select></label>
            <label class="fld"><span>Language</span><select name="language">${languageOptions(member.default_language)}</select></label>
          </div>
          <div class="scan-submit">
            <button class="btn primary" type="submit">Identify cards →</button>
            <span class="hint">You'll confirm every match in your queue before anything reaches your collection.</span>
          </div>
        </form>
      </div>

      <aside class="ws-panel scan-side">
        <h2>How this works</h2>
        <p><b>Same pipeline as the member add page</b>, running in your own account. Photos are stored under your account and identified by the configured recognizer; pasted lines are parsed and matched against the catalog with a confidence score. Anything uncertain waits in <b>your</b> review queue.</p>
        <p><b>Values</b> are today's TCGplayer market price per printing, or the catalog's value at the grade for slabs.</p>
        <p>Nothing here touches a member's account. To work inside a member's collection, open it from <a href="/admin/users">Members</a>.</p>
        ${
          batches.length
            ? `<h2 style="margin-top:18px">Your recent uploads</h2><div class="batch-list">${batches
                .map((b) => `<a class="batch-row" href="${batchHref(b)}"><span class="bid">#${b.id}</span><span class="blabel">${esc(batchName(b))}</span><span class="bmeta">${b.total} card${b.total === 1 ? "" : "s"} · ${b.review ? `<span class="warn">${b.review} to review</span>` : esc(b.status)} · ${ago(b.created_at)}</span></a>`)
                .join("")}</div>`
            : ""
        }
      </aside>
    </div>
    <script>window.__SAMPLE__=${JSON.stringify("Charizard 4/102 Base Set holo NM\n3x Pikachu 58/102 Base\nThe Wandering Emperor Neon Dynasty foil")};</script>`;
  }

  const html = `<div class="wrap ws">
    ${adminHead("upload", "My uploader", "Identify cards into <b>your own</b> collection — the owner's personal version of the add page. Member accounts are never touched here.")}
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

// ---- Activity feed --------------------------------------------------------

export function renderAdminActivity(rows: ActivityRow[], f: ActivityFilter, users: UserRow[], msg?: string): Page {
  const kinds = ["all", "login", "signup", "action", "page", "plan_change", "owner"];
  const html = `<div class="wrap ws">
    ${adminHead("activity", "Activity log", "Every login, page view, and action across all members — newest first. Events tagged “by owner” happened while you were working inside a member's collection.")}
    ${flash(msg)}
    <form class="inv-toolbar" method="get" action="/admin/activity">
      <select name="user" onchange="this.form.submit()">${opt("", "All members", String(f.sellerId ?? ""))}${users.map((u) => opt(String(u.id), `${u.display_name}${u.email ? " · " + u.email : ""}`, String(f.sellerId ?? ""))).join("")}</select>
      <select name="kind" onchange="this.form.submit()">${kinds.map((k) => opt(k, k === "all" ? "All events" : KIND_LABEL[k] ?? k, f.kind ?? "all")).join("")}</select>
      <button class="btn sm" type="submit">Filter</button>
    </form>
    ${activityTable(rows, { showUser: true })}
    <p class="hint" style="margin-top:8px">Showing the latest ${rows.length} event${rows.length === 1 ? "" : "s"}.</p>
    ${APP_JS}
  </div>`;
  return { html, title: "Activity — Owner console | CardIndex", description: "Site-wide member activity." };
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
    ${adminHead("feedback", "Feedback", "Notes, bug reports and missing-card requests from every member. Replies land in the sender's inbox.")}
    ${flash(msg)}
    <div class="inv-toolbar"><div class="tabs">${tabs}</div></div>
    ${rows.length ? rows.map(feedbackCard).join("") : `<div class="ws-empty"><h3>Nothing here</h3><p>No ${status === "all" ? "" : status + " "}feedback.</p></div>`}
    ${APP_JS}
  </div>`;
  return { html, title: "Feedback — Owner console | CardIndex", description: "Member feedback queue." };
}
