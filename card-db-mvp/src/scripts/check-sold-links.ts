// Link health for the sold-sales archive: probe every listing URL and record the
// HTTP status on the row (sold_sales.url_status / url_checked_at). Sales Lookup
// and the card page hide the link when the status is a definitive 404/410, so
// a buyer is never sent to a dead listing page.
//
// Marketplaces are not honest to server-side probes — eBay answers 403 to any
// bot, Goldin and TCGplayer return 200 for nonexistent pages — so only 404/410
// counts as "dead"; everything else is recorded but treated as inconclusive
// (the shape check in sales.ts handles the obvious junk before this runs).
//
// Run:  npm run check:sold-links               (rows unchecked or older than 7 days)
//       npm run check:sold-links -- --force    (recheck everything)
//       npm run check:sold-links -- --limit=200

import { query, close } from "../pg.ts";
import { sleep } from "../util.ts";
import { DEAD_LINK_STATUSES } from "../sales.ts";

const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;
const RECHECK_AFTER_DAYS = 7;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 CardIndex-linkcheck";

type Row = { id: number; url: string; marketplace: string };

/** Final status after redirects; 0 = network error / timeout (inconclusive). */
async function probe(url: string): Promise<number> {
  const opts = { redirect: "follow" as const, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": UA, Accept: "text/html,*/*" } };
  try {
    const head = await fetch(url, { ...opts, method: "HEAD" });
    // Some hosts refuse HEAD (405) or answer it differently from GET; confirm with GET.
    if (head.status !== 405 && head.status !== 403 && head.status !== 404) return head.status;
    const get = await fetch(url, { ...opts, method: "GET" });
    try { await get.body?.cancel(); } catch { /* ignore */ }
    return get.status;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? 0) || null;

  const rows = await query<Row>(
    `SELECT id, url, marketplace FROM sold_sales
     WHERE url IS NOT NULL AND NOT is_demo
       AND (${force ? "TRUE" : `url_checked_at IS NULL OR url_checked_at < now() - interval '${RECHECK_AFTER_DAYS} days'`})
     ORDER BY url_checked_at NULLS FIRST, sold_on DESC
     ${limit ? `LIMIT ${limit}` : ""}`
  );
  console.log(`check:sold-links — ${rows.length} row${rows.length === 1 ? "" : "s"} to probe${force ? " (forced)" : ""}`);
  if (!rows.length) { await close(); return; }

  // Probe each distinct URL once, then write the status to every row sharing it.
  const byUrl = new Map<string, Row[]>();
  for (const r of rows) byUrl.set(r.url, [...(byUrl.get(r.url) ?? []), r]);
  const urls = [...byUrl.keys()];

  const tally = { ok: 0, dead: 0, inconclusive: 0 };
  let next = 0;
  async function worker(): Promise<void> {
    while (next < urls.length) {
      const url = urls[next++];
      const status = await probe(url);
      const ids = byUrl.get(url)!.map((r) => r.id);
      await query(`UPDATE sold_sales SET url_status=$1, url_checked_at=now() WHERE id = ANY($2::bigint[])`, [status, ids]);
      const kind = DEAD_LINK_STATUSES.has(status) ? "dead" : status >= 200 && status < 400 ? "ok" : "inconclusive";
      tally[kind]++;
      if (kind !== "ok") console.log(`  ${String(status).padStart(3)}  ${kind.padEnd(12)} ${url}`);
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));

  console.log(`done — ${urls.length} URL${urls.length === 1 ? "" : "s"}: ${tally.ok} ok, ${tally.dead} dead (link hidden), ${tally.inconclusive} inconclusive (link kept)`);
  await close();
}

main().catch(async (err) => {
  console.error(err);
  await close();
  process.exit(1);
});
