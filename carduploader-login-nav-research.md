# CardUploader login pages and post-login navigation — verified research

**Date:** September 8, 2026
**Method:** Deep-research workflow (5 search angles, 18 sources, 82 extracted claims, 25 adversarially verified), plus direct rendering of carduploader.com in the in-app browser after the workflow's fetches of carduploader.com and youtube.com were denied. Every finding below is tagged with how it was verified: **[live]** = observed directly in the rendered page on Sept 5–8 2026; **[3-0]** etc. = adversarial verification vote; **[bundle]** = read from CardUploader's JavaScript chunks (see `carduploader-logged-in-teardown.md`) but not independently re-verified.
**Purpose:** Give the developer of tradingcardloader.com (code in `card-db-mvp/`) concrete, cited facts to redesign `/login`, `/signup` and the seller-workspace navigation, and to make it obvious which pages upload cards and which do not.

---

## 1. Bottom line

1. CardUploader's auth is deliberately minimal: two fields on sign-in, five on sign-up, one OAuth provider (Google), one inline "Forgot?" link, a one-field reset page. No remember-me, no terms checkbox, no CAPTCHA, no marketing copy. **[live, 3-0]**
2. The logged-out header funnels to login through a *Dashboard* item that literally links to `/signin`; deep links survive the round-trip via `?next=`. **[live]**
3. Post-login, uploading lives in exactly five places: Ungraded, Graded, Listing Creator, Blank Listing Creator, and the free Ungraded Pricing Tool. Everything else (Orders, Previous Batches, Inventory, Automatic Inventory, Card Search, Sales Lookup, Inbox, Configuration) is read-only or settings. The sidebar's group labels ("List Cards" vs "Tools") are the only signal of that split. **[teardown + bundle]**
4. The documented onboarding order is Account → Configuration → Upload → Review/Export; the creator walkthrough spends roughly 20 minutes in Configuration before the first upload. **[3-0, live video chapters]**
5. No public complaints about CardUploader's login or navigation were found. The one critical creator video is about a processing queue, not auth. The nearest documented auth complaint is a competitor's: TCGplayer's app forces re-login on every open and loses unsaved work. **[live, 1-1 / supported by two sources]**
6. Our own `/signup` never renders the display-name field the server reads, our header's "Start free" button lands Free users on the Pro paywall, and there is no forgot-password path or OAuth at all. Those are the three seams to fix first (Section 7).

---

## 2. The three auth pages, field by field

### 2.1 `/signin` — "Welcome back" **[live, 3-0]**

| Element | Exact copy / target |
|---|---|
| Heading | `Welcome back` |
| Field 1 | label `Email`, placeholder `Your email`, `type=email`, required |
| Field 2 | label `Password`, placeholder `Your password`, `type=password`, required |
| Reset link | `Forgot?` right-aligned on the Password label row → `/reset-password` |
| Primary button | `Sign in` (full width, purple) |
| Divider | `or` |
| OAuth | `Continue with Google` (Google "G" icon, grey button; the only provider) |
| Cross-link | `Don't you have an account? Sign Up` → `/signup` |

Absent: remember-me, terms/consent, CAPTCHA, display name, referral code. Inputs have `id` but no `name` attributes and the form's action is the page itself, so submission and error copy are handled client-side (Firebase Auth per the bundle). Error/validation copy could not be observed without submitting the form, which I did not do.

### 2.2 `/signup` — "Create your account" **[live, 3-0]**

| # | Label | Placeholder | Required |
|---|---|---|---|
| 1 | `Display Name` | `Your display name` | yes |
| 2 | `Email` | `Your email` | yes |
| 3 | `Password` | `Create a password` | yes (no `minlength`, no visible rules hint at rest) |
| 4 | `Confirm Password` | `Confirm your password` | yes |
| 5 | `Referral Code (Optional)` | `Enter referral code` | no |

Then `Create Account` → `or` → `Continue with Google` → `Already have an account? Sign In` (→ `/signin`).

- `?ref=CODE` pre-fills the referral field: loading `/signup?ref=TESTCODE` rendered the field with value `TESTCODE`. **[live]** Creators promote this: the Pokemon Steven walkthrough's description links `https://carduploader.com/signup?ref=STEVE` under "SIGN UP HERE FOR BONUS CREDITS!". **[live]**
- No terms-of-service checkbox; Privacy Policy, Terms of Service and a `Cookie Settings` button live only in the footer. **[live]**
- What signup gets you: "Sign up for a free account… New users receive a 3-day free trial" (Getting Started guide) and "3-day free trial (100 credits)" with a `Start Free Trial` CTA on `/pricing`. The only plan shown on the public pricing page is Unlimited at $9.99/month. **[live]**

### 2.3 `/reset-password` — "Reset your password" **[live]**

Heading `Reset your password` · one field `Email` (`Your email`, required) · button `Send Reset Email` · link `Back to Sign In` → `/signin`. Email-link reset (Firebase); no security questions, no username step.

### 2.4 Verification and guards **[3-0 from bundle, next= confirmed live]**

- Unauthenticated hits on any `/dashboard/*` route return the SPA shell (HTTP 200) and a client-side layout guard redirects to `/signin?next=<path+query>`. Confirmed live: `/dashboard/orders?status=pending` → `/signin?next=%2Fdashboard%2Forders%3Fstatus%3Dpending`.
- A signed-in but unverified user is pushed to `/verify-email` instead. Logged out, `/verify-email` itself bounces to plain `/signin`.
- Firebase Auth also carries MFA enrollment endpoints (from the earlier teardown), but nothing on the public auth pages exposes 2FA.

---

## 3. Public vs. logged-in surface

**Logged-out header** **[live]**: `Home` (/) · `Dashboard` (**→ `/signin`**) · `Guides` (/guides) · `Pricing` (/pricing) · `Sales Lookup` (/sales) · `Contact` (/contact) · Light/Dark theme radio · `Sign In` (/signin) · `Register` (/signup). Mobile: "Open main menu" button.

**Footer** **[live]**: Product (`Pricing & Plans`, `Dashboard` → `/dashboard`, i.e. it does *not* rewrite to /signin) · Company (`Privacy Policy`, `Terms of Service`, `Cookie Settings`) · Support (`Contact`) · Follow Us (Discord, Instagram).

**Public routes confirmed:** `/`, `/guides/*`, `/pricing`, `/sales`, `/contact`, `/privacy`, `/terms`, `/signin`, `/signup`, `/reset-password`. The public Guides sidebar is ordered Getting Started · Configuration · Ungraded Cards · Graded Cards · Listing Creator · CardUploader-Managed Inventory · Inventory · Duplicates · Orders · Troubleshooting · FAQ, which loosely mirrors the app's own page order. **[live]**

**Behind login (14 sidebar routes + hidden):** see Section 4.

Nothing in the FAQ covers sign-in, password reset, or verification; the only account item is "How do I delete my account?" (answer: contact support; deletion is permanent, credits forfeited, cancel subscription first). Subscription cancellation is at `Account Settings → Manage Subscription`. **[live]**

---

## 4. Logged-in navigation: where the uploader is and isn't

Source: the September 3 teardown of saved dashboard pages plus the JS bundle; account-menu structure verified 3-0 from the bundle.

| Sidebar group | Item | Uploads cards? | Cost |
|---|---|---|---|
| (top) | Dashboard | no | — |
| | Orders (pending-count badge) | no | — |
| | Previous Batches (`/history`) | no | — |
| Inventory | All Inventory | no | — |
| | Automatic Inventory (BETA) | no | — |
| List Cards | **Ungraded Cards** | **yes — photos** | 1 credit/card |
| | **Graded Cards** | **yes — cert numbers / camera scan** | 2 credits (PSA/CGC/TAG/ACE), 1 (BGS) |
| | **Listing Creator** | **yes — from database, no photos** | 1 credit/card |
| | **Blank Listing Creator** (Beta) | **yes — manual, no lookup** | free |
| Tools | **Ungraded Pricing Tool** | **yes — photos, pricing only** | free (100 images on Free, 500 paid) |
| | Card Search | no | — |
| | Sales Lookup | no | — |
| (footer) | Feedback (modal) · Inbox (unread badge) · Configuration | no | — |
| | Account menu | — | — |

Hidden/gated routes: `/dashboard/storefront`, `/dashboard/buylist`, `/dashboard/history/pricing/{job}`, `/dashboard/settings`.

**Account menu (sidebar footer)** **[3-0, bundle]**: avatar initial + display name + email (hidden when "hidePersonalInfo" is on) → `Account Settings` (/dashboard/settings) · `Billing` (opens Stripe portal) for subscribers **or** `Upgrade plan` (→ /pricing) for everyone else · `Guides` · Discord · Theme toggle · `Sign out` (→ /signin).

**Dashboard home** (teardown): plan card ("Plan: Free · Active · Pricing"), `Credits Left`, `Cards Uploaded Total`, Community & Support (Discord, email), the embedded Getting Started Tutorial video, and a five-question FAQ. The home page has *no* upload control; the user must pick a List Cards item from the sidebar.

**Sidebar behaviour** **[bundle, unverified]**: forced open on Configuration and Settings, forced collapsed on `/dashboard/history/*` result pages to give the card grid room, otherwise the user's choice persisted in localStorage (`cu-sidebar-open`); a mobile top bar exposes the trigger.

**Credits model the UI has to surface** **[live FAQ]**: credits are only consumed during the trial or without an active Unlimited subscription; they never expire; pricing-only lookups are free.

---

## 5. The prescribed onboarding path

- Getting Started guide, verbatim order **[3-0]**: 1 `Create an Account` → 2 `Configure Your Settings` ("eBay store details, business policies and title preferences in the Configuration page") → 3 `Upload Your Cards` ("Navigate to the Ungraded or Graded Cards section… Choose your database") → 4 `Review and Export`.
- The Ungraded guide's wording for the entry point: "Navigate to Dashboard → Ungraded Cards and upload images via drag and drop, or click to browse." **[live]**
- Pokemon Steven's 38-minute walkthrough (chapters from the description) **[live]**: Dashboard 5:50 → Pricing 6:05 → Credits 6:13 → eBay Settings 6:50 → Business Policies 7:30 → Shipping 10:05 → Auction/Best Offer → Description Template 13:01 → Store Categories 15:34 → Ungraded Settings 17:45 → Title 21:00 → Variants → Graded Settings → Account Settings 25:30 → **Job walkthrough 26:35**. Configuration is 20 of the 38 minutes.
- Troubleshooting's first item is "eBay CSV won't upload", and the fix is policy names that "must match EXACTLY (case-sensitive)" plus a postal code. That is the cost of the configure-first path. **[live]**

---

## 6. What users say, and what the practitioner literature says

**Complaints found**
- Hobby Over Hype, "The Downside of CardUploader.com Nobody Talks About" (YouTube Short, TikTok mirror): scanned ~500 of 5,000 cards then was "put into a queue at around 26th in line"; frames it as the trade-off of $10/month unlimited. Not a login or nav complaint. **[live description]**
- Searches of Reddit, Discord and Twitter for CardUploader login/onboarding/navigation complaints returned nothing relevant. Old Skool Pokemon's "I Was Wrong About CardUploader" is a positive workflow review.
- Competitor anti-pattern: TCGplayer's app "requires you to log in every single time you open it" and "any unsaved work can be lost" (Lotus Scan review; matching App Store review). **[supported by both sources]**

**Best-practice sources (all verified against the article text)**
- Authgear, *Login & Signup UX guide* (updated Feb 12, 2026): ~10% of active users hit password-reset flows monthly and 75% quit them; put "Forgot password?" right below the password field; ask only what is needed, collect profile details later; prefer a Show Password toggle with rules shown upfront over Confirm Password; inline errors that keep the email pre-filled; surface "Forgot password?" after repeated failures; log users in immediately after signup and verify email in the background with a one-click resend.
- Baymard, *Accounts & Self-Service*: the sign-in topics that matter are password reset and lockouts, "soft" sign-in, automatic sign-out, sign-in from email links, and where users land after sign-in; a dashboard home should give paths to all account features, highlight recent orders, use icons, and use sidebar or card navigation.
- Rakesh Mondal, *SaaS navigation UX patterns* (June 8, 2026): a top bar suits products with a handful of primary areas and "runs out of room fast"; a sidebar "handles longer lists and nested sections", usually "with grouped sections and a collapse control"; mature products use both, "a top bar for global context — search, account, notifications — and a sidebar for primary navigation."

**Refuted during verification (do not cite):** that the top bar should be *reserved* for global utilities plus one primary create action (0-3; the article does not say that); that the signup page shows *no* validation copy at all (0-3; only "none visible at rest" is defensible).

---

## 7. Where our site stands (code in `card-db-mvp/`) and what to change

### 7.1 Auth pages — `src/render/auth.ts`, `src/server.ts` (`handleAuth`)

| CardUploader has | We have | Change |
|---|---|---|
| Display Name on signup | Server reads `display_name` (`server.ts:1173`) but the form never renders it, so every account is named "My card shop" | Add a `Shop name` field (first, required) to the signup shell |
| `Forgot?` on the password row + `/reset-password` | Nothing | Add the link and a one-field reset page; the send step needs an email provider (Railway env), so ship the page with a "we'll email you" state now and wire SMTP next |
| `Continue with Google` | Nothing | Optional; needs Google OAuth credentials. Lower priority than reset |
| Confirm Password | Single password field with `minlength=8` | Keep ours (the literature prefers show-password + visible rules); add a `Show` toggle and state the 8-character rule under the field |
| Referral code with `?ref=` prefill | None | Skip until a referral program exists |
| `?next=` deep-link preservation | Already implemented (`safeNext`, `/login?next=`) | Keep; also carry `next` through the reset page |
| Error copy keeps email filled | `Wrong email or password.` with email preserved | Keep; after a second failure add "Forgot your password?" inline |
| Terms/Privacy in footer only | Same | Keep; add a one-line "By creating an account you agree to the Terms" under the button when Terms exist |
| Heading `Welcome back` / `Create your account` | `Sign in` / `Create your account` with a one-line sub | Fine as is |

### 7.2 Header and entry funnel — `src/render/layout.ts`

- Logged out we show `Sign in` + `Start free` → `/app/scan`. `/app/scan` redirects to `/login?next=/app/scan`, and a Free account is then bounced to `/pricing?upgrade=1`. "Start free" therefore ends on a paywall. Either make the button `Create account` → `/signup`, or let Free accounts into the workspace (see 7.4).
- CardUploader's pattern is a nav item named for the destination (`Dashboard`) that resolves to `/signin` when logged out. Our `Seller tools` → `/app` behaves the same way via redirect; keep the label but make the redirect explicit in the href (`/login?next=/app`) so the browser status bar is honest.
- Logged in, our header shows name + `Log out`. Add the plan pill and an `Upgrade` / `Billing` item, mirroring their account menu, so plan state is visible on every page, not only the dashboard plan card.

### 7.3 Workspace navigation — `src/render/app.ts` (`subnav`, `wsHead`)

Our strip already copies their grouping: (Dashboard, Orders, Batches) · Inventory (All, Automatic) · List cards (Ungraded, Graded, Listing creator, Blank listing, Listings) · Tools (Pricing tool, Card search, Sales lookup) · (Inbox, Settings). The confusion the user reports ("some pages have uploader while others don't") is exactly CardUploader's situation: uploads only on the List cards items and the Pricing tool, and nothing marks that.

Concrete changes:
1. **Name the groups by verb, not noun.** `Add cards` (Ungraded, Graded, Listing creator, Blank listing, Pricing tool) · `Manage` (Inventory, Automatic, Listings, Batches, Orders) · `Look up` (Card search, Sales lookup) · `Account` (Inbox, Settings). The uploader pages become one contiguous group and the Pricing tool stops hiding under Tools.
2. **Persistent primary action.** `wsHead` renders an `actions` slot per page; put `+ Add cards` (→ `/app/scan`) in that slot on every non-uploader page, so Orders, Inventory and Card search each offer a way in. Today only Dashboard has `+ Scan cards`.
3. **Mark upload pages in the nav** with a small camera/upload glyph and, where credits or plan apply, a `Pro` pill, so the split is visible before the click.
4. **Finish the sidebar.** Since Sept 5 `wsHead` already renders `.ws-nav` as a sticky 212px left rail (`styles.css:750`), which is the right call for 15 routes. What it lacks from their pattern: a collapse control with the choice persisted in localStorage, forced-collapsed on `/app/review/*` so the review grid gets the width, and forced-open on Settings.
5. **Sales lookup opens the public `/sales` page from inside the workspace**, dropping the workspace chrome. Either render it inside `wsHead` like Card search, or open it in a new tab.

### 7.4 Plan gate — `src/server.ts` (`handleApp`)

CardUploader lets a Free account into the whole dashboard, gates spend with credits, and keeps the Pricing Tool, Card Search and Blank Listing Creator free. We bounce every Free account out of `/app` to `/pricing`. If Pro stays the gate, at minimum let Free users reach `/app` (dashboard with plan card and checklist), `/app/pricing-tool`, `/app/card-search` and `/sales`, and gate only the pages in the `Add cards` group and eBay publishing. That also makes "Start free" true.

### 7.5 Post-signup landing — `src/server.ts` (`handleAuth`)

We already log the user in and redirect to `next` (default `/app`), which matches the literature. Under the current paywall a fresh Free signup lands on `/pricing?upgrade=1` instead. Fix by 7.4, or route new signups to `/pricing` deliberately with a "Welcome, <shop name>" flash.

---

## 8. Sources

Primary (rendered live in the in-app browser, Sept 5–8 2026): https://carduploader.com/signin · https://carduploader.com/signup (and `?ref=TESTCODE`) · https://carduploader.com/reset-password · https://carduploader.com/pricing · https://carduploader.com/guides/getting-started · https://carduploader.com/guides/ungraded · https://carduploader.com/guides/faq · https://carduploader.com/guides/troubleshooting · https://carduploader.com/dashboard/orders?status=pending (redirect test) · https://carduploader.com/verify-email (redirect test).

Video (descriptions and chapter lists read live; transcripts unavailable): Pokemon Steven, *Automated Trading Card Listing is Here! (Carduploader Setup & Walkthrough)* https://www.youtube.com/watch?v=luSdX4LOcII · Hobby Over Hype, *The Downside of CardUploader.com Nobody Talks About* https://www.youtube.com/shorts/a7blPEkZRzA · Old Skool Pokemon, *I Was Wrong About CardUploader…* https://www.youtube.com/watch?v=lTKUoyqcFi4.

Prior internal reports: `carduploader-competitive-research-report.md` (Aug 23) · `carduploader-data-sourcing-research.md` (Sept 1) · `carduploader-logged-in-teardown.md` (Sept 3, JS-bundle read for Section 4).

Practitioner and competitor: https://www.authgear.com/post/login-signup-ux-guide/ · https://baymard.com/research/self-service · https://www.saasui.design/blog/saas-navigation-ux-patterns · https://www.scanyourmtg.com/review/tcgplayer/ · https://apps.apple.com/us/app/tcgplayer/id1247645833 (reviews) · https://www.ludex.com/scan-and-price/ · https://play.google.com/store/apps/details?id=com.collectrinc.collectr · https://cardgrader.ai/blog/best-ai-powered-apps-scan-value-trading-cards · https://edana.ch/en/2026/04/26/saas-navigation-how-to-design-a-menu-that-accelerates-adoption-reduces-friction-and-supports-product-growth/.

Workflow artefacts: run `wf_8834bfe5-9d5` (two passes; synthesis failed both times on the session usage cap, so this document is the synthesis). Journal: `.claude/projects/.../subagents/workflows/wf_8834bfe5-9d5/journal.jsonl`.
