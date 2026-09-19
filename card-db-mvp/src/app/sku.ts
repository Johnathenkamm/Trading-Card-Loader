// SKU system (spec §14): custom prefix + zero-padded auto-increment, e.g.
// HOH-000001. The seller row carries the prefix, pad width, and next counter;
// commit-to-inventory draws SKUs from it in order.

export function formatSku(prefix: string, n: number, pad = 6): string {
  const clean = (prefix || "CARD").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "CARD";
  return `${clean}-${String(n).padStart(pad, "0")}`;
}
