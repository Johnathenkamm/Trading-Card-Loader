// Small shared helpers. No dependencies.

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
/** Escape text for safe HTML interpolation. */
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Escape for use inside a JSON-LD <script> block. */
export function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

export function money(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null) return "—";
  const n = cents / 100;
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  return sym + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pct(n: number): string {
  const s = (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
  return s;
}

/** Deterministic PRNG (mulberry32) so demo data is stable across seeds. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function isoDaysAgo(days: number, from = new Date("2026-08-23T00:00:00Z")): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Levenshtein distance, capped for speed. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length,
    bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    let cur = [i];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}

export function numberSort(num: string | null | undefined): number | null {
  if (!num) return null;
  const m = String(num).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
