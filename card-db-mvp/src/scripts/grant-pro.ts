// Grant (or revoke) the Pro plan for an account, by email — the interim billing
// lever until Stripe Checkout is wired up.
//
//   npm run grant-pro -- someone@example.com          # → Pro ($15/month)
//   npm run grant-pro -- someone@example.com free      # → Free
//
// Uses DATABASE_URL from the environment (or card-db-mvp/.env), same as the app.

import { one, close } from "../pg.ts";
import { setPlanTier } from "../app/billing.ts";
import { isValidEmail, normalizeEmail } from "../app/auth.ts";

const emailArg = (process.argv[2] ?? "").trim();
const tier = (process.argv[3] ?? "pro").trim().toLowerCase();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!emailArg || !isValidEmail(normalizeEmail(emailArg))) {
  fail("Usage: npm run grant-pro -- <email> [pro|free]");
}
if (tier !== "pro" && tier !== "free") {
  fail(`Invalid tier "${tier}" — use "pro" or "free".`);
}

const email = normalizeEmail(emailArg);
const seller = await one<{ id: number; display_name: string }>(
  "SELECT id, display_name FROM sellers WHERE lower(email) = $1",
  [email]
);
if (!seller) {
  await close();
  fail(`No account found for ${email}.`);
}

await setPlanTier(seller.id, tier);
console.log(`✓ ${email} (${seller.display_name}) is now on the ${tier.toUpperCase()} plan.`);
await close();
