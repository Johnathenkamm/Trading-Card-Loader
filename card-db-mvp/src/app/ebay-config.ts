// eBay API configuration at runtime.
//
// The keyset used to live only in env vars (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET
// / EBAY_RU_NAME / EBAY_ENV / EBAY_MARKETPLACE / EBAY_MOCK). Hosted deploys have
// no shell, and the client should be able to paste a keyset into the owner
// console (/admin/ebay) without a redeploy — so values saved there are kept in
// the `meta` table under `ebay.*` keys and take precedence over the env. The
// env remains the fallback (and the only source on a fresh database).
//
// Both API modules (src/ebay.ts for the Browse API, src/app/ebay-sell.ts for
// the Sell APIs) read `ebayConfig()`; `loadEbayConfig()` runs once at boot and
// after every save. Modules that cache tokens register `onEbayConfigChange`.

import { query } from "../pg.ts";

export type EbayConfig = {
  clientId: string;
  clientSecret: string;
  ruName: string;
  env: "production" | "sandbox";
  marketplace: string;
  mock: boolean;
};
export type EbayConfigSource = "console" | "env" | "none";

const KEYS = ["client_id", "client_secret", "ru_name", "env", "marketplace", "mock", "epn_campid"] as const;
type Key = (typeof KEYS)[number];

let db: Partial<Record<Key, string>> = {};
let loaded = false;
const listeners: Array<() => void> = [];

export function onEbayConfigChange(fn: () => void): void {
  listeners.push(fn);
}

/** Read the console-saved values from the database (boot + after save). */
export async function loadEbayConfig(): Promise<void> {
  try {
    const rows = (await query("SELECT key, value FROM meta WHERE key LIKE 'ebay.%'")) as Array<{ key: string; value: string }>;
    const next: Partial<Record<Key, string>> = {};
    for (const r of rows) {
      const k = r.key.slice(5) as Key;
      if ((KEYS as readonly string[]).includes(k)) next[k] = r.value;
    }
    db = next;
  } catch {
    db = {};
  }
  loaded = true;
  for (const fn of listeners) fn();
}

const envVal = (k: Key): string => {
  switch (k) {
    case "client_id": return process.env.EBAY_CLIENT_ID ?? "";
    case "client_secret": return process.env.EBAY_CLIENT_SECRET ?? "";
    case "ru_name": return process.env.EBAY_RU_NAME ?? "";
    case "env": return process.env.EBAY_ENV ?? "";
    case "marketplace": return process.env.EBAY_MARKETPLACE ?? "";
    case "mock": return process.env.EBAY_MOCK ?? "";
    case "epn_campid": return process.env.EBAY_EPN_CAMPID ?? "";
  }
};

/** The owner's eBay Partner Network / Ambassador campaign id (console over env), or "" . */
export function epnCampaignSetting(): string {
  return pick("epn_campid").trim();
}

/**
 * Accept a campaign id as typed, or pull it out of any EPN / Ambassador share
 * link ("…&campid=5339141403&…"). Returns "" when neither is present.
 */
export function parseCampaignId(input: string): string {
  const s = (input ?? "").trim();
  if (/^\d{6,12}$/.test(s)) return s;
  const m = s.match(/[?&]campid=(\d{6,12})/i);
  return m ? m[1] : "";
}
const pick = (k: Key): string => (db[k] != null && db[k] !== "" ? db[k]! : envVal(k));

export function ebayConfig(): EbayConfig {
  const env = pick("env").toLowerCase() === "sandbox" ? "sandbox" : "production";
  return {
    clientId: pick("client_id").trim(),
    clientSecret: pick("client_secret").trim(),
    ruName: pick("ru_name").trim(),
    env,
    marketplace: pick("marketplace").trim() || "EBAY_US",
    mock: pick("mock") === "1",
  };
}

/** Where each value comes from, for the console's status panel. */
export function ebayConfigSources(): Record<Key, EbayConfigSource> {
  const out = {} as Record<Key, EbayConfigSource>;
  for (const k of KEYS) out[k] = db[k] ? "console" : envVal(k) ? "env" : "none";
  return out;
}

export const ebayConfigLoaded = (): boolean => loaded;

/**
 * Save console values. An empty string leaves the stored value alone (so the
 * secret field can be left blank on re-save); `null` deletes the stored value
 * so the env fallback applies again.
 */
export async function saveEbayConfig(patch: Partial<Record<Key, string | null>>): Promise<void> {
  for (const k of KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null) await query("DELETE FROM meta WHERE key=$1", [`ebay.${k}`]);
    else if (v !== undefined && v !== "") await query("INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [`ebay.${k}`, v]);
  }
  await loadEbayConfig();
}

export async function clearEbayConfig(): Promise<void> {
  await query("DELETE FROM meta WHERE key LIKE 'ebay.%'");
  await loadEbayConfig();
}

/** Mask a secret for display: first 4 + last 4 characters. */
export function maskSecret(s: string): string {
  if (!s) return "";
  if (s.length <= 10) return "•".repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
