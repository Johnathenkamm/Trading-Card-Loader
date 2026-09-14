// Daily TCGplayer price + catalog-ID sync via TCGCSV (tcgcsv.com).
//
// Why TCGCSV (research: carduploader-data-sourcing-research.md §4, §8.3):
// TCGplayer's developer API is closed to new developers, and the affiliate
// program carries no data feed. TCGCSV is the free public mirror of TCGplayer's
// catalog and prices, refreshed daily (~20:00 UTC): products with collector
// number/rarity/image/canonical URL, and prices per PRINTING sub-type
// (Normal / Holofoil / Reverse Holofoil / 1st Edition ...). That printing
// granularity maps 1:1 onto our card_variants — the variant-level pricing
// CardUploader deliberately collapses. What the mirror can NOT provide is
// per-condition (NM/LP/...) SKU prices — that data is SKU-level in TCGplayer's
// API and is unavailable without a grandfathered key.
//
// What one run does, per seeded set:
//   1. resolves the set's TCGplayer group (by name; cached in sets.tcgplayer_group_id)
//   2. matches our cards to products by collector number (name as tie-break),
//      storing cards.tcgplayer_product_id + cards.tcgplayer_url (affiliate-ready)
//   3. upserts REAL market prices as price_points rows (source='tcgplayer',
//      kind='market' + a same-day kind='history' observation, is_demo=false),
//      creating card_variants for printings TCGCSV knows that we don't
//   4. deletes the synthetic demo *market* rows a variant no longer needs
//      (demo history/graded/sold stay until real depth accrues — still flagged)
//
// Re-runnable: same-day rows are replaced, not duplicated. Run daily (cron /
// Railway scheduled job) and kind='history' becomes real accumulated history —
// the "start archiving day one" rule applied to prices.
//
// Run:  npm run sync:tcgcsv

import { query, one, close } from "../pg.ts";
import { numberSort, sleep } from "../util.ts";
import { notifyWishlistAlerts } from "../app/collection.ts";
import { appBaseUrl } from "../app/mailer.ts";

const BASE = process.env.TCGCSV_BASE ?? "https://tcgcsv.com/tcgplayer";

// game slug (ours) -> TCGplayer category id. Extend as games are added
// (85 = Pokemon Japan when a JP catalog lands).
const CATEGORY_BY_GAME: Record<string, number> = {
  pokemon: 3,
  mtg: 1,
};

// TCGCSV subTypeName -> our variant finish vocabulary (identify.ts FINISH_RULES).
// Unknown sub-types still sync: they become a new finish slug + label as-is.
const SUBTYPE_FINISH: Record<string, { finish: string; label: string }> = {
  normal: { finish: "normal", label: "Normal" },
  holofoil: { finish: "holofoil", label: "Holo" },
  "reverse holofoil": { finish: "reverse_holofoil", label: "Reverse Holo" },
  "1st edition": { finish: "1st_edition", label: "1st Edition" },
  "1st edition normal": { finish: "1st_edition", label: "1st Edition" },
  "1st edition holofoil": { finish: "1st_edition_holofoil", label: "1st Edition Holo" },
  unlimited: { finish: "unlimited", label: "Unlimited" },
  "unlimited holofoil": { finish: "unlimited_holofoil", label: "Unlimited Holo" },
  foil: { finish: "foil", label: "Foil" },
  etched: { finish: "etched", label: "Etched Foil" },
  "foil etched": { finish: "etched", label: "Etched Foil" },
};

type TcgProduct = {
  productId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
  url?: string;
  extendedData?: Array<{ name: string; value: string }>;
};
type TcgPrice = {
  productId: number;
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  subTypeName: string;
};

// The route to tcgcsv.com drops connections mid-transfer fairly often (observed
// ECONNRESET on large payloads) — retry hard before giving up on a set.
async function fetchJson(url: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: { "User-Agent": "CardIndex/0.1 (catalog sync)", Accept: "application/json" },
      });
      if (res.status === 404) throw Object.assign(new Error(`404 for ${url}`), { permanent: true });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err: any) {
      if (err?.permanent) throw err;
      lastErr = err;
      await sleep(800 * attempt);
    }
  }
  throw lastErr;
}

function results(payload: any): any[] {
  return Array.isArray(payload) ? payload : payload?.results ?? [];
}

// "SWSH04: Vivid Voltage" / "Base Set" / "Kamigawa: Neon Dynasty" -> comparable key
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/^[a-z]{2,5}\d{1,3}:\s*/, "") // strip "SWSH04: " style prefixes
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extNumber(p: TcgProduct): string | null {
  return p.extendedData?.find((d) => d.name === "Number")?.value ?? null;
}

// Punctuation-proof name key: "Ao, the Dawn Sky" == "Ao the Dawn Sky",
// "Befriending the Moths // Imperial Moth" starts with "Befriending the Moths".
function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function ensureSchema(): Promise<void> {
  await query("ALTER TABLE sets  ADD COLUMN IF NOT EXISTS tcgplayer_group_id integer");
  await query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS tcgplayer_product_id bigint");
  await query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS tcgplayer_url text");
}

// Provider set names that differ from TCGplayer's group names (normalized on
// both sides). pokemontcg.io calls Base Set just "Base".
const SET_ALIASES: Record<string, string> = {
  base: "base set",
};

async function resolveGroup(
  set: { id: number; name: string; tcgplayer_group_id: number | null },
  groups: Array<{ groupId: number; name: string }>
): Promise<number | null> {
  if (set.tcgplayer_group_id) return set.tcgplayer_group_id;
  let want = normName(set.name);
  want = SET_ALIASES[want] ?? want;
  const exact = groups.filter((g) => normName(g.name) === want);
  // exact normalized match first ("Base Set" must not catch "Base Set 2" /
  // "Base Set (Shadowless)"); fall back to a group whose name contains ours.
  const candidates = exact.length ? exact : groups.filter((g) => normName(g.name).includes(want));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.name.length - b.name.length);
  const chosen = candidates[0];
  await query("UPDATE sets SET tcgplayer_group_id=$1 WHERE id=$2", [chosen.groupId, set.id]);
  return chosen.groupId;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function syncSet(
  set: { id: number; name: string; tcgplayer_group_id: number | null },
  categoryId: number,
  groups: Array<{ groupId: number; name: string }>
): Promise<void> {
  const groupId = await resolveGroup(set, groups);
  if (!groupId) {
    console.log(`  ~ ${set.name}: no TCGplayer group matched — skipped`);
    return;
  }

  const [productsRaw, pricesRaw] = await Promise.all([
    fetchJson(`${BASE}/${categoryId}/${groupId}/products`),
    fetchJson(`${BASE}/${categoryId}/${groupId}/prices`),
  ]);
  const products = results(productsRaw) as TcgProduct[];
  const prices = results(pricesRaw) as TcgPrice[];

  const byNumber = new Map<number, TcgProduct[]>();
  const byName = new Map<string, TcgProduct>();
  for (const p of products) {
    const n = numberSort(extNumber(p));
    if (n != null) {
      const arr = byNumber.get(n) ?? [];
      arr.push(p);
      byNumber.set(n, arr);
    }
    const key = nameKey(p.cleanName ?? p.name);
    if (!byName.has(key)) byName.set(key, p);
  }
  const priceByProduct = new Map<number, TcgPrice[]>();
  for (const pr of prices) {
    const arr = priceByProduct.get(pr.productId) ?? [];
    arr.push(pr);
    priceByProduct.set(pr.productId, arr);
  }

  const cards = (await query(
    "SELECT id, name, number, number_sort FROM cards WHERE set_id=$1",
    [set.id]
  )) as Array<{ id: number; name: string; number: string | null; number_sort: number | null }>;

  const day = today();
  let matched = 0;
  let priceRows = 0;
  let newVariants = 0;
  const unmatched: string[] = [];

  for (const card of cards) {
    // product match: collector number first, card name as tie-break/fallback
    let product: TcgProduct | undefined;
    const nm = nameKey(card.name);
    const numCandidates = card.number_sort != null ? byNumber.get(card.number_sort) ?? [] : [];
    if (numCandidates.length === 1) product = numCandidates[0];
    else if (numCandidates.length > 1) {
      product =
        numCandidates.find((p) => nameKey(p.cleanName ?? p.name) === nm) ??
        numCandidates.find((p) => nameKey(p.cleanName ?? p.name).startsWith(nm)) ??
        numCandidates.find((p) => nm.startsWith(nameKey(p.cleanName ?? p.name)));
    }
    if (!product) product = byName.get(nm);
    // split/double-faced cards: our name is the front face of TCGplayer's
    // "Front // Back"; last resort, a unique prefix match across the group.
    if (!product) {
      const pref = products.filter((p) => nameKey(p.cleanName ?? p.name).startsWith(nm));
      if (pref.length === 1) product = pref[0];
    }
    if (!product) {
      unmatched.push(`${card.name} #${card.number ?? "?"}`);
      continue;
    }
    matched++;

    await query("UPDATE cards SET tcgplayer_product_id=$1, tcgplayer_url=$2 WHERE id=$3", [
      product.productId,
      product.url ?? null,
      card.id,
    ]);

    const variants = (await query(
      "SELECT id, finish, tcgplayer_id FROM card_variants WHERE card_id=$1",
      [card.id]
    )) as Array<{ id: number; finish: string; tcgplayer_id: string | null }>;

    for (const pr of priceByProduct.get(product.productId) ?? []) {
      if (pr.marketPrice == null) continue;
      const key = pr.subTypeName.trim().toLowerCase();
      const mapped = SUBTYPE_FINISH[key] ?? {
        finish: key.replace(/[^a-z0-9]+/g, "_"),
        label: pr.subTypeName.trim(),
      };

      let variant = variants.find((v) => v.finish === mapped.finish);
      if (!variant) {
        const created = await one<{ id: number }>(
          `INSERT INTO card_variants (card_id, finish, finish_label, language, tcgplayer_id, is_default)
           VALUES ($1,$2,$3,'EN',$4,false) RETURNING id`,
          [card.id, mapped.finish, mapped.label, String(product.productId)]
        );
        variant = { id: created!.id, finish: mapped.finish, tcgplayer_id: String(product.productId) };
        variants.push(variant);
        newVariants++;
      } else if (!variant.tcgplayer_id) {
        await query("UPDATE card_variants SET tcgplayer_id=$1 WHERE id=$2", [
          String(product.productId),
          variant.id,
        ]);
      }

      const cents = Math.round(pr.marketPrice * 100);
      const ref = `${product.productId}:${pr.subTypeName}`;
      // replace today's observation (re-runs), keep other days -> real history
      await query(
        `DELETE FROM price_points
         WHERE variant_id=$1 AND source='tcgplayer' AND observed_on=$2
           AND kind IN ('market','history','market_low','market_mid','market_high')`,
        [variant.id, day]
      );
      await query(
        `INSERT INTO price_points (variant_id, source, kind, currency, price_cents, observed_on, is_demo, external_ref)
         VALUES ($1,'tcgplayer','market','USD',$2,$3,false,$4),
                ($1,'tcgplayer','history','USD',$2,$3,false,$4)`,
        [variant.id, cents, day, ref]
      );
      // full TCGplayer price spread (shown on card pages; TCGCSV carries it,
      // so don't throw it away): low / mid / high alongside market
      const stats: Array<[string, number | null]> = [
        ["market_low", pr.lowPrice],
        ["market_mid", pr.midPrice],
        ["market_high", pr.highPrice],
      ];
      for (const [kind, dollars] of stats) {
        if (dollars == null) continue;
        await query(
          `INSERT INTO price_points (variant_id, source, kind, currency, price_cents, observed_on, is_demo, external_ref)
           VALUES ($1,'tcgplayer',$2,'USD',$3,$4,false,$5)`,
          [variant.id, kind, Math.round(dollars * 100), day, ref]
        );
      }
      // the variant now has a real current price: retire the synthetic market row
      await query(
        "DELETE FROM price_points WHERE variant_id=$1 AND kind='market' AND is_demo=true AND grade IS NULL",
        [variant.id]
      );
      priceRows++;
    }
  }

  console.log(
    `  ✓ ${set.name} -> group ${groupId}: ${matched}/${cards.length} cards matched, ` +
      `${priceRows} market prices, ${newVariants} new variants` +
      (unmatched.length ? `, unmatched: ${unmatched.slice(0, 4).join("; ")}${unmatched.length > 4 ? " …" : ""}` : "")
  );
}

async function main(): Promise<void> {
  console.log("TCGCSV sync — real TCGplayer market prices at printing granularity");
  await ensureSchema();

  const games = (await query("SELECT id, slug, name FROM games ORDER BY sort")) as Array<{
    id: number;
    slug: string;
    name: string;
  }>;

  for (const game of games) {
    const categoryId = CATEGORY_BY_GAME[game.slug];
    if (!categoryId) {
      console.log(`- ${game.name}: no TCGplayer category mapping — skipped`);
      continue;
    }
    console.log(`- ${game.name} (category ${categoryId})`);
    const groups = results(await fetchJson(`${BASE}/${categoryId}/groups`)) as Array<{
      groupId: number;
      name: string;
    }>;
    const sets = (await query(
      "SELECT id, name, tcgplayer_group_id FROM sets WHERE game_id=$1 ORDER BY id",
      [game.id]
    )) as Array<{ id: number; name: string; tcgplayer_group_id: number | null }>;
    for (const set of sets) {
      try {
        await syncSet(set, categoryId, groups);
      } catch (err: any) {
        console.log(`  ! ${set.name}: sync failed — ${err?.message ?? err}`);
      }
    }
  }

  await query(
    `INSERT INTO meta (key, value) VALUES ('tcgcsv_last_sync', $1)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    [new Date().toISOString()]
  );
  const stat = await one<{ n: number }>(
    "SELECT COUNT(*)::int n FROM price_points WHERE source='tcgplayer' AND is_demo=false"
  );
  console.log(`Done. Real TCGplayer price rows in DB: ${stat!.n}`);

  // Fresh prices may have crossed a wishlist target: email Pro members whose
  // wanted cards are now at or below the price they set (app/collection.ts).
  try {
    const sent = await notifyWishlistAlerts(appBaseUrl("https://tradingcardloader.com"));
    if (sent) console.log(`Wishlist alerts: emailed ${sent} member${sent === 1 ? "" : "s"}.`);
  } catch (err: any) {
    console.log(`Wishlist alerts skipped: ${err?.message ?? err}`);
  }
}

main()
  .then(() => close())
  .catch(async (err) => {
    console.error("sync failed:", err);
    await close();
    process.exit(1);
  });
