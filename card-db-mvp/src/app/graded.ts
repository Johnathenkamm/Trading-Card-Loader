// Graded cards (CardUploader's "Graded Cards" page, teardown §3): paste cert
// numbers or ranges per grading company, look the certs up, price at the grade,
// and list with the grade in the title/specifics.
//
// Cert lookup is provider-based like vision.ts: PSA has a public cert API (key
// required), the others are site lookups. With no provider configured the cert
// is kept on the item, the grade is chosen in review, and a link-out opens the
// grader's own cert page — exactly CardUploader's fallback.

import { gradedValues } from "../pg.ts";
import { hashString } from "../util.ts";

export type Grader = { key: string; name: string; url: (cert: string) => string };

export const GRADERS: Grader[] = [
  { key: "PSA", name: "Professional Sports Authenticator", url: (c) => `https://www.psacard.com/cert/${encodeURIComponent(c)}` },
  { key: "CGC", name: "Certified Guaranty Company", url: (c) => `https://www.cgccards.com/certlookup/${encodeURIComponent(c)}/` },
  { key: "BGS", name: "Beckett Grading Services", url: (c) => `https://www.beckett.com/grading/card-lookup?item_id=${encodeURIComponent(c)}&item_type=BGS` },
  { key: "SGC", name: "Sportscard Guaranty", url: (c) => `https://gosgc.com/cert-code-lookup/${encodeURIComponent(c)}` },
  { key: "TAG", name: "Technical Authentication & Grading", url: (c) => `https://my.taggrading.com/card/${encodeURIComponent(c)}` },
  { key: "ACE", name: "Ace Grading", url: (c) => `https://acegrading.com/cert/${encodeURIComponent(c)}` },
];

export const GRADE_VALUES = ["10", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6", "5", "4", "3", "2", "1"];

export function graderOf(key: string | null | undefined): Grader | undefined {
  return GRADERS.find((g) => g.key === String(key ?? "").toUpperCase());
}

export function certUrl(grader: string | null | undefined, cert: string | null | undefined): string | null {
  const g = graderOf(grader);
  return g && cert ? g.url(cert) : null;
}

/** "PSA" + "10" → "PSA 10"; the label stored on items/inventory and used for pricing. */
export function gradeLabel(grader: string, value: string): string {
  return `${grader.toUpperCase()} ${value}`;
}

/** Split "PSA 10" → {grader, value}; null when not a grade label. */
export function splitGrade(label: string | null | undefined): { grader: string; value: string } | null {
  const m = String(label ?? "").trim().match(/^([A-Za-z]{2,4})\s+(10|[1-9](?:\.5)?)$/);
  return m ? { grader: m[1].toUpperCase(), value: m[2] } : null;
}

const MAX_CERTS = 200;

/**
 * Parse the cert textarea: one per line, comma/space separated, and numeric
 * ranges like `12345678-12345690` (expanded, same width, capped). Deduped.
 */
export function parseCerts(text: string): { certs: string[]; truncated: boolean } {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (c: string) => {
    const v = c.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const tok of String(text ?? "").split(/[\s,;]+/)) {
    if (!tok) continue;
    const range = tok.match(/^(\d{4,12})\s*[-–]\s*(\d{4,12})$/);
    if (range) {
      const a = BigInt(range[1]);
      const b = BigInt(range[2]);
      if (b >= a && b - a <= BigInt(MAX_CERTS)) {
        const width = range[1].length;
        for (let n = a; n <= b && out.length < MAX_CERTS; n++) push(n.toString().padStart(width, "0"));
        continue;
      }
    }
    push(tok.replace(/[^A-Za-z0-9-]/g, ""));
    if (out.length >= MAX_CERTS) break;
  }
  return { certs: out.slice(0, MAX_CERTS), truncated: out.length > MAX_CERTS };
}

// ---- cert lookup provider -------------------------------------------------

export type CertLookup = { grader: string; cert: string; grade: string | null; hint: string | null; provider: string };

export function certProviderName(): string {
  return (process.env.CERT_PROVIDER ?? "none").toLowerCase();
}

/**
 * Resolve a cert to a grade + a card hint. `mock` returns deterministic values
 * so the graded pipeline can be exercised offline; `none` returns nulls (the
 * seller picks the card and grade in review). A real provider (PSA's public cert
 * API with a key; scraped lookups for the rest) drops in here.
 */
export async function lookupCert(grader: string, cert: string): Promise<CertLookup> {
  const provider = certProviderName();
  if (provider === "mock") {
    const h = hashString(`${grader}:${cert}`);
    const hints = ["Charizard 4/102 Base Set holo", "Pikachu 58/102 Base", "Blastoise 2/102 Base holo", "Mewtwo 10/102 Base holo"];
    const grades = ["10", "9", "9", "8", "10", "9.5"];
    return { grader, cert, grade: gradeLabel(grader, grades[h % grades.length]), hint: hints[h % hints.length], provider };
  }
  return { grader, cert, grade: null, hint: null, provider: "none" };
}

/** Latest catalog value for a printing at a grade ("PSA 10"), if the catalog has one. */
export async function gradedMarketCents(variantId: number, grade: string | null | undefined): Promise<number | null> {
  if (!grade) return null;
  const want = grade.trim().toUpperCase();
  const rows = await gradedValues(variantId);
  const hit = rows.find((r) => (r.grade ?? "").toUpperCase() === want);
  return hit?.price_cents ?? null;
}
