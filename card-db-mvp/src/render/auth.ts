// Login, sign-up and password-reset pages. Rendered inside the shared page()
// shell (so they get the header, theme toggle, and footer). Plain HTML forms
// (POST → redirect), no JS required; a few lines of inline script add the
// show-password toggle. The server handles verification, session creation,
// reset tokens and cookies.
//
// Shape follows what the Sept 8 CardUploader research found works: minimal
// fields, "Forgot?" on the password label row, the sign-up ↔ sign-in cross-link
// under the form, and a reset flow that is email → link → new password.

import { esc } from "../util.ts";
import { BRAND_MARK } from "./layout.ts";
import { PASSWORD_MIN } from "../app/auth.ts";

type Rendered = { html: string; title: string; description: string };

function safeNext(next: string | undefined): string {
  // Only allow internal app paths — never an absolute/protocol-relative URL.
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/app";
}

/** Append ?next= to an auth link when a deep link is being carried. */
function withNext(href: string, next: string | undefined, extra: Record<string, string> = {}): string {
  const u = new URLSearchParams();
  if (next) u.set("next", next);
  for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v);
  const q = u.toString();
  return q ? `${href}?${q}` : href;
}

// Show/hide toggle for password fields (progressive enhancement; the field is a
// normal password input without it).
const AUTH_JS = `<script>(function(){
  document.querySelectorAll('.pw-toggle').forEach(function(b){
    var inp=document.getElementById(b.getAttribute('data-for')); if(!inp)return;
    b.addEventListener('click',function(){var show=inp.type==='password';inp.type=show?'text':'password';b.textContent=show?'Hide':'Show';b.setAttribute('aria-pressed',show?'true':'false');});
  });
})();</script>`;

function passwordField(opts: { id: string; name: string; label: string; autocomplete: string; placeholder: string; hint?: string; labelRight?: string }): string {
  return `<label class="fld" for="${opts.id}"><span class="fld-lbl"><span>${opts.label}</span>${opts.labelRight ?? ""}</span>
      <span class="pw-wrap">
        <input type="password" id="${opts.id}" name="${opts.name}" required autocomplete="${opts.autocomplete}" minlength="${PASSWORD_MIN}" placeholder="${esc(opts.placeholder)}">
        <button type="button" class="pw-toggle" data-for="${opts.id}" aria-pressed="false" aria-label="Show password">Show</button>
      </span>
      ${opts.hint ? `<small class="fld-hint">${opts.hint}</small>` : ""}</label>`;
}

function card(inner: string, title: string, sub: string): string {
  return `<div class="auth-wrap">
    <div class="auth-card">
      <a class="auth-brand" href="/">${BRAND_MARK}<span>CardIndex</span></a>
      <h1>${title}</h1>
      <p class="auth-sub">${sub}</p>
      ${inner}
    </div>
  </div>${AUTH_JS}`;
}

// ---- sign in --------------------------------------------------------------

export function renderLogin(
  opts: { error?: string; email?: string; next?: string; showForgot?: boolean } = {}
): Rendered {
  const { error, email = "", next, showForgot } = opts;
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  const forgotHref = withNext("/reset-password", next, { email });
  const errorBox = error
    ? `<div class="auth-error" role="alert">${esc(error)}${showForgot ? ` <a href="${esc(forgotHref)}">Forgot your password?</a>` : ""}</div>`
    : "";
  const inner = `${errorBox}
      <form method="post" action="/login" class="auth-form" autocomplete="on">
        ${nextField}
        <label class="fld" for="email"><span>Email</span>
          <input type="email" id="email" name="email" value="${esc(email)}" required autocomplete="email" autofocus inputmode="email" placeholder="you@example.com"></label>
        ${passwordField({
          id: "password",
          name: "password",
          label: "Password",
          autocomplete: "current-password",
          placeholder: "Your password",
          labelRight: `<a class="fld-link" href="${esc(forgotHref)}">Forgot?</a>`,
        })}
        <button class="btn primary lg auth-submit" type="submit">Sign in</button>
      </form>
      <div class="auth-alt">New here? <a href="${esc(withNext("/signup", next))}">Create an account</a></div>`;
  return {
    html: card(inner, "Welcome back", "Your scans, inventory, pricing rules and listings."),
    title: "Sign in — CardIndex",
    description: "Sign in to your CardIndex seller workspace.",
  };
}

// ---- sign up --------------------------------------------------------------

export function renderSignup(
  opts: { error?: string; email?: string; displayName?: string; next?: string } = {}
): Rendered {
  const { error, email = "", displayName = "", next } = opts;
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  const inner = `${error ? `<div class="auth-error" role="alert">${esc(error)}</div>` : ""}
      <form method="post" action="/signup" class="auth-form" autocomplete="on">
        ${nextField}
        <label class="fld" for="display_name"><span>Shop name <small>— shown on your listings and share links</small></span>
          <input type="text" id="display_name" name="display_name" value="${esc(displayName)}" required maxlength="80" autocomplete="organization" autofocus placeholder="e.g. Kamm Cards"></label>
        <label class="fld" for="email"><span>Email</span>
          <input type="email" id="email" name="email" value="${esc(email)}" required autocomplete="email" inputmode="email" placeholder="you@example.com"></label>
        ${passwordField({
          id: "password",
          name: "password",
          label: "Password",
          autocomplete: "new-password",
          placeholder: "Create a password",
          hint: `At least ${PASSWORD_MIN} characters.`,
        })}
        <button class="btn primary lg auth-submit" type="submit">Create account</button>
        <p class="auth-fine">Free to start: the pricing tool, card search and sales lookup are included. Scanning, inventory and listings are part of Pro.</p>
      </form>
      <div class="auth-alt">Already have an account? <a href="${esc(withNext("/login", next))}">Sign in</a></div>`;
  return {
    html: card(inner, "Create your account", "Your cards, scans, pricing rules and listing preferences — saved and private to you."),
    title: "Create your account — CardIndex",
    description: "Create a CardIndex account to price, scan, and list your trading cards.",
  };
}

// ---- password reset: request a link -----------------------------------------

export function renderResetRequest(
  opts: { email?: string; next?: string; sent?: boolean; mode?: "live" | "log"; error?: string } = {}
): Rendered {
  const { email = "", next, sent, mode = "live", error } = opts;
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  const inner = sent
    ? `<div class="auth-ok" role="status">
        <b>Check your inbox.</b> If an account exists for <span class="mono">${esc(email)}</span>, we've emailed a link to set a new password. It expires in 60 minutes.
        ${mode === "log" ? `<div class="auth-devnote">Email isn't configured on this server yet (<span class="mono">MAIL_PROVIDER</span>), so the link was printed to the server log instead.</div>` : ""}
      </div>
      <div class="auth-alt"><a href="${esc(withNext("/login", next))}">Back to sign in</a></div>`
    : `${error ? `<div class="auth-error" role="alert">${esc(error)}</div>` : ""}
      <form method="post" action="/reset-password" class="auth-form" autocomplete="on">
        ${nextField}
        <label class="fld" for="email"><span>Email</span>
          <input type="email" id="email" name="email" value="${esc(email)}" required autocomplete="email" autofocus inputmode="email" placeholder="you@example.com"></label>
        <button class="btn primary lg auth-submit" type="submit">Send reset link</button>
      </form>
      <div class="auth-alt"><a href="${esc(withNext("/login", next))}">Back to sign in</a></div>`;
  return {
    html: card(inner, "Reset your password", "Enter the email you signed up with and we'll send you a link."),
    title: "Reset your password — CardIndex",
    description: "Reset your CardIndex password.",
  };
}

// ---- password reset: choose a new password ------------------------------------

export function renderResetForm(opts: { token: string; valid: boolean; error?: string; next?: string }): Rendered {
  const { token, valid, error, next } = opts;
  const inner = valid
    ? `${error ? `<div class="auth-error" role="alert">${esc(error)}</div>` : ""}
      <form method="post" action="/reset-password/${esc(token)}" class="auth-form" autocomplete="on">
        ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ""}
        ${passwordField({
          id: "password",
          name: "password",
          label: "New password",
          autocomplete: "new-password",
          placeholder: "Create a new password",
          hint: `At least ${PASSWORD_MIN} characters. Every other device will be signed out.`,
        })}
        <button class="btn primary lg auth-submit" type="submit">Set new password</button>
      </form>`
    : `<div class="auth-error" role="alert">This reset link has expired or was already used.</div>
      <div class="auth-alt"><a href="${esc(withNext("/reset-password", next))}">Request a new link</a></div>`;
  return {
    html: card(inner, "Choose a new password", valid ? "You'll be signed in as soon as it's saved." : "Reset links work once and expire after 60 minutes."),
    title: "Choose a new password — CardIndex",
    description: "Set a new CardIndex password.",
  };
}

export { safeNext };
