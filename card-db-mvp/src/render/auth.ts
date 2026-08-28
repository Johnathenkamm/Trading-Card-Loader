// Login & sign-up pages. Rendered inside the shared page() shell (so they get the
// header, theme toggle, and footer). Plain HTML forms (POST → redirect), no JS
// required. The server handles verification, session creation, and cookies.

import { esc } from "../util.ts";
import { BRAND_MARK } from "./layout.ts";

type Rendered = { html: string; title: string; description: string };

function safeNext(next: string | undefined): string {
  // Only allow internal app paths — never an absolute/protocol-relative URL.
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/app";
}

function shell(opts: {
  mode: "login" | "signup";
  error?: string;
  email?: string;
  displayName?: string;
  next?: string;
}): string {
  const { mode, error, email = "", displayName = "", next } = opts;
  const isLogin = mode === "login";
  const action = isLogin ? "/login" : "/signup";
  const nextField = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";

  return `<div class="auth-wrap">
    <div class="auth-card">
      <a class="auth-brand" href="/">${BRAND_MARK}<span>CardIndex</span></a>
      <h1>${isLogin ? "Sign in" : "Create your account"}</h1>
      <p class="auth-sub">${
        isLogin
          ? "Access your inventory, scans, pricing rules and listings."
          : "Your cards, scans, pricing rules and listing preferences — saved and private to you."
      }</p>
      ${error ? `<div class="auth-error" role="alert">${esc(error)}</div>` : ""}
      <form method="post" action="${action}" class="auth-form" autocomplete="on">
        ${nextField}
        <label class="fld"><span>Email</span>
          <input type="email" name="email" value="${esc(email)}" required autocomplete="email" autofocus inputmode="email" placeholder="you@example.com"></label>
        <label class="fld"><span>Password</span>
          <input type="password" name="password" required autocomplete="${isLogin ? "current-password" : "new-password"}"${
            isLogin ? "" : ' minlength="8"'
          } placeholder="${isLogin ? "Your password" : "At least 8 characters"}"></label>
        <button class="btn primary lg auth-submit" type="submit">${isLogin ? "Sign in" : "Create account"}</button>
      </form>
      <div class="auth-alt">
        ${
          isLogin
            ? `New here? <a href="/signup${next ? "?next=" + encodeURIComponent(next) : ""}">Create an account</a>`
            : `Already have an account? <a href="/login${next ? "?next=" + encodeURIComponent(next) : ""}">Sign in</a>`
        }
      </div>
    </div>
  </div>`;
}

export function renderLogin(opts: { error?: string; email?: string; next?: string } = {}): Rendered {
  return {
    html: shell({ mode: "login", ...opts, next: opts.next }),
    title: "Sign in — CardIndex",
    description: "Sign in to your CardIndex seller workspace.",
  };
}

export function renderSignup(
  opts: { error?: string; email?: string; displayName?: string; next?: string } = {}
): Rendered {
  return {
    html: shell({ mode: "signup", ...opts }),
    title: "Create your account — CardIndex",
    description: "Create a CardIndex account to scan, price, and list your trading cards.",
  };
}

export { safeNext };
