import { esc, money, fmtDate, pct } from "../util.ts";
import type { Card, PricePoint, Variant } from "../db.ts";

/** URL for a card detail page. */
export function cardUrl(card: { id: number; slug: string }, variantFinish?: string): string {
  const base = `/c/${card.slug}-${card.id}`;
  return variantFinish ? `${base}?v=${encodeURIComponent(variantFinish)}` : base;
}

const FINISH_TITLE: Record<string, string> = {
  holofoil: "Holo",
  reverse_holofoil: "Reverse Holo",
  normal: "Normal",
  foil: "Foil",
  etched: "Etched",
};

export function finishChip(v: { finish: string; finish_label: string }): string {
  return `<span class="chip finish-${esc(v.finish)}">${esc(v.finish_label)}</span>`;
}

export function cardTile(
  card: Card & { set_name?: string; price_cents?: number | null; currency?: string; finish_label?: string; finish?: string; rarity?: string | null }
): string {
  const img = card.image_small || card.image_large;
  const price =
    card.price_cents != null
      ? `<span class="v">${money(card.price_cents, card.currency)}</span>`
      : `<span class="no">No price</span>`;
  const chip =
    card.finish && card.finish_label
      ? finishChip({ finish: card.finish, finish_label: card.finish_label })
      : card.rarity
      ? `<span class="chip rar">${esc(card.rarity)}</span>`
      : "";
  return `<div class="tile"><a href="${cardUrl(card)}">
    <div class="img">${img ? `<img src="${esc(img)}" alt="${esc(card.name)}" loading="lazy" width="245" height="342">` : ""}</div>
    <div class="body">
      <div class="nm">${esc(card.name)}</div>
      <div class="meta">${esc(card.set_name ?? "")}${card.number ? " · #" + esc(card.number) : ""}</div>
      <div class="price">${price}${chip}</div>
    </div>
  </a></div>`;
}

export function breadcrumb(parts: Array<{ label: string; href?: string }>): string {
  const items = parts
    .map((p, i) => {
      const sep = i > 0 ? `<span class="sep" aria-hidden="true">›</span>` : "";
      return p.href
        ? `${sep}<a href="${esc(p.href)}">${esc(p.label)}</a>`
        : `${sep}<span>${esc(p.label)}</span>`;
    })
    .join("");
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${parts.length ? `<span class="sep">›</span>` : ""}${items}</nav>`;
}

export function demoNote(text: string): string {
  return `<div class="demo-note"><span class="i" aria-hidden="true">◆</span><div>${text}</div></div>`;
}

/** SVG area chart of a price history series. Colored by first→last direction. */
export function priceChart(history: PricePoint[], currency = "USD"): string {
  if (history.length < 2) return `<div class="chart" style="color:var(--muted);padding:20px">Not enough history.</div>`;
  const W = 720,
    H = 220,
    padL = 8,
    padR = 8,
    padT = 14,
    padB = 26;
  const vals = history.map((h) => h.price_cents);
  const min = Math.min(...vals),
    max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const n = history.length;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const up = vals[n - 1] >= vals[0];
  const col = up ? "var(--up)" : "var(--down)";

  const linePts = history.map((h, i) => `${x(i).toFixed(1)},${y(h.price_cents).toFixed(1)}`).join(" ");
  const areaPts = `${padL},${(H - padB).toFixed(1)} ${linePts} ${(W - padR).toFixed(1)},${(H - padB).toFixed(1)}`;

  // gridlines at min / mid / max
  const grid = [max, (max + min) / 2, min]
    .map((v) => {
      const yy = y(v).toFixed(1);
      return `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-width="1"/>
        <text x="${W - padR}" y="${(+yy - 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--faint)" font-family="IBM Plex Mono, monospace">${esc(money(Math.round(v), currency))}</text>`;
    })
    .join("");

  // a few date labels
  const ticks = [0, Math.floor(n / 2), n - 1]
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}" font-size="11" fill="var(--faint)" font-family="IBM Plex Mono, monospace">${esc(fmtDate(history[i].observed_on))}</text>`)
    .join("");

  const gid = "g" + Math.abs(vals[0] + n);
  const endX = x(n - 1).toFixed(1),
    endY = y(vals[n - 1]).toFixed(1);

  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history chart" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${col}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <polygon points="${areaPts}" fill="url(#${gid})"/>
    <polyline points="${linePts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${endX}" cy="${endY}" r="4" fill="${col}"/>
    <circle cx="${endX}" cy="${endY}" r="8" fill="${col}" fill-opacity="0.18"/>
    ${ticks}
  </svg></div>`;
}

export function sourceChip(source: string): string {
  const known = ["ebay", "tcgplayer", "goldin"].includes(source) ? source : "";
  const label = source === "tcgplayer" ? "TCGplayer" : source.charAt(0).toUpperCase() + source.slice(1);
  return `<span class="src ${known}">${esc(label)}</span>`;
}

export function deltaBadge(first: number, last: number): string {
  if (!first) return "";
  const r = (last - first) / first;
  const cls = r >= 0 ? "up" : "down";
  return `<span class="delta ${cls}">${esc(pct(r))}</span>`;
}

export function pager(base: string, page: number, totalPages: number): string {
  if (totalPages <= 1) return "";
  const link = (p: number, label: string, cur = false, gap = false) => {
    if (gap) return `<span class="gap">…</span>`;
    if (cur) return `<span class="cur">${label}</span>`;
    const sep = base.includes("?") ? "&" : "?";
    return `<a href="${esc(base)}${sep}page=${p}">${label}</a>`;
  };
  const out: string[] = [];
  if (page > 1) out.push(link(page - 1, "‹"));
  const nums = new Set<number>([1, totalPages, page, page - 1, page + 1]);
  let prev = 0;
  for (const p of [...nums].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)) {
    if (p - prev > 1) out.push(link(0, "", false, true));
    out.push(link(p, String(p), p === page));
    prev = p;
  }
  if (page < totalPages) out.push(link(page + 1, "›"));
  return `<nav class="pager" aria-label="Pagination">${out.join("")}</nav>`;
}

export { money, fmtDate };
