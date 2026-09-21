// Catalog importer: grow the card catalog straight into Postgres from TCGCSV,
// the free daily mirror of TCGplayer's catalog (tcgcsv.com; research report
// §4). One source for every game the client sells — Pokémon (category 3) and
// One Piece (category 68) first — with the same product ids that
// `sync:tcgcsv` prices against, so a card imported here is priced on the next
// daily sync and photo-identifiable as soon as the hash index catches up.
//
// Why not the seed script: `npm run seed` builds a SQLite file from
// pokemontcg.io/Scryfall and `pg:migrate` TRUNCATES every table — including
// members and inventory — to copy it in. That was fine for a demo catalog of
// three sets; it cannot grow a live site. This importer is incremental and
// idempotent (upserts by TCGplayer product id / group id), touches only the
// catalog tables, and runs in-process so the owner console can trigger it on
// Railway (where no shell reaches the database) — /admin/catalog — or via
// `npm run import:catalog -- pokemon|onepiece|all [--force] [--groups=id,id]`.
//
// Per group (= set): products with a "Number" extended field are singles;
// sealed products (boxes, packs, decks) are skipped. Each single becomes a
// card, each price sub-type (Normal / Holofoil / Reverse Holofoil / Foil …)
// a variant, and today's market/low/mid/high prices land as price_points
// exactly the way sync:tcgcsv writes them. Parallel / alternate-art One Piece
// printings are separate TCGplayer products sharing a collector number; they
// stay separate cards (name carries the "(Parallel)" suffix).

import { query, one } from "../pg.ts";
import { slugify, numberSort, sleep } from "../util.ts";
import { buildHashIndex } from "./hashindex.ts";

const BASE = process.env.TCGCSV_BASE ?? "https://tcgcsv.com/tcgplayer";

export type CatalogGame = { slug: string; name: string; category: number; sort: number };
export const CATALOG_GAMES: Record<string, CatalogGame> = {
  pokemon: { slug: "pokemon", name: "Pokemon", category: 3, sort: 0 },
  onepiece: { slug: "onepiece", name: "One Piece Card Game", category: 68, sort: 1 },
  mtg: { slug: "mtg", name: "Magic: The Gathering", category: 1, sort: 2 },
};

// TCGCSV subTypeName -> our finish vocabulary (mirrors sync-tcgcsv.ts).
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
const FINISH_RANK = ["holofoil", "reverse_holofoil", "normal", "foil", "1st_edition_holofoil", "1st_edition", "unlimited_holofoil", "unlimited", "etched"];

type TcgGroup = { groupId: number; name: string; abbreviation?: string; publishedOn?: string };
type TcgProduct = { productId: number; name: string; cleanName?: string; imageUrl?: string; url?: string; extendedData?: Array<{ name: string; value: string }> };
type TcgPrice = { productId: number; marketPrice: number | null; lowPrice: number | null; midPrice: number | null; highPrice: number | null; subTypeName: string };

// tcgcsv.com drops connections mid-transfer fairly often — retry hard.
async function fetchJson(url: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { "User-Agent": "CardIndex/0.1 (catalog import)", Accept: "application/json" } });
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
const results = (payload: any): any[] => (Array.isArray(payload) ? payload : payload?.results ?? []);
const ext = (p: TcgProduct, name: string): string | null => p.extendedData?.find((d) => d.name === name)?.value ?? null;
const today = () => new Date().toISOString().slice(0, 10);

/** TCGplayer's CDN serves the same product image at several widths; 200w is what TCGCSV lists. */
function imageUrls(p: TcgProduct): { small: string | null; large: string | null } {
  const u = p.imageUrl ?? null;
  if (!u) return { small: null, large: null };
  return { small: u, large: u.replace(/_200w\.jpg$/i, "_400w.jpg") };
}

/** "Pikachu - 025/185" (a few Pokémon products) -> "Pikachu". */
function cleanCardName(name: string, number: string | null): string {
  let n = name.trim();
  if (number) n = n.replace(new RegExp(`\\s*[-–]\\s*${number.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*$`, "i"), "");
  return n.trim() || name.trim();
}

async function ensureCatalogSchema(): Promise<void> {
  await query("ALTER TABLE sets  ADD COLUMN IF NOT EXISTS tcgplayer_group_id integer");
  await query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS tcgplayer_product_id bigint");
  await query("ALTER TABLE cards ADD COLUMN IF NOT EXISTS tcgplayer_url text");
  await query("CREATE INDEX IF NOT EXISTS idx_cards_tcg_product ON cards(tcgplayer_product_id)");
  await query("CREATE INDEX IF NOT EXISTS idx_sets_tcg_group ON sets(tcgplayer_group_id)");
  await query(`CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL)`);
}

async function ensureGame(g: CatalogGame): Promise<number> {
  const row = await one<{ id: number }>("SELECT id FROM games WHERE slug=$1", [g.slug]);
  if (row) return row.id;
  const ins = await one<{ id: number }>("INSERT INTO games (slug, name, sort) VALUES ($1,$2,$3) RETURNING id", [g.slug, g.name, g.sort]);
  return ins!.id;
}

async function uniqueSetSlug(base: string, groupId: number): Promise<string> {
  const taken = await one<{ id: number }>("SELECT id FROM sets WHERE slug=$1", [base]);
  return taken ? `${base}-${groupId}` : base;
}

/** Find or create the set row for a TCGplayer group. Existing sets seeded from other providers are adopted via their cached group id. */
async function upsertSet(gameId: number, gameName: string, g: TcgGroup, singles: number): Promise<{ id: number; name: string; adopted: boolean }> {
  const existing = await one<{ id: number; name: string }>("SELECT id, name FROM sets WHERE tcgplayer_group_id=$1", [g.groupId]);
  const release = g.publishedOn ? g.publishedOn.slice(0, 10) : null;
  if (existing) {
    await query("UPDATE sets SET card_count=GREATEST(card_count,$1), release_date=COALESCE(release_date,$2), code=COALESCE(code,$3) WHERE id=$4", [singles, release, g.abbreviation ?? null, existing.id]);
    return { id: existing.id, name: existing.name, adopted: true };
  }
  const slug = await uniqueSetSlug(slugify(`${g.name}-${g.abbreviation || gameName}`) || `set-${g.groupId}`, g.groupId);
  const ins = await one<{ id: number }>(
    `INSERT INTO sets (game_id, slug, name, code, release_date, card_count, image_url, external_id, tcgplayer_group_id)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8) RETURNING id`,
    [gameId, slug, g.name, g.abbreviation ?? null, release, singles, `tcg:${g.groupId}`, g.groupId]
  );
  return { id: ins!.id, name: g.name, adopted: false };
}

export type ImportProgress = {
  running: boolean;
  game: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  groupsTotal: number;
  groupsDone: number;
  current: string | null;
  sets: number;
  cardsAdded: number;
  cardsUpdated: number;
  variants: number;
  prices: number;
  skipped: number;
  errors: number;
  log: string[];
  error: string | null;
};

const fresh = (): ImportProgress => ({
  running: false, game: null, startedAt: null, finishedAt: null, groupsTotal: 0, groupsDone: 0, current: null,
  sets: 0, cardsAdded: 0, cardsUpdated: 0, variants: 0, prices: 0, skipped: 0, errors: 0, log: [], error: null,
});
let progress: ImportProgress = fresh();
export function catalogImportProgress(): ImportProgress {
  return progress;
}
function note(line: string, log?: (l: string) => void) {
  progress.log.push(line);
  if (progress.log.length > 60) progress.log.splice(0, progress.log.length - 60);
  log?.(line);
}

export type ImportOptions = {
  force?: boolean; // re-import groups already recorded in meta
  groups?: number[]; // only these TCGplayer group ids
  log?: (line: string) => void;
  hashAfter?: boolean; // build the photo-ID index when done (default true)
};

/** Import (or refresh) one game's catalog from TCGCSV. Resolves when the import is complete. */
export async function importGame(slug: string, opts: ImportOptions = {}): Promise<ImportProgress> {
  const g = CATALOG_GAMES[slug];
  if (!g) throw new Error(`Unknown game "${slug}" — one of ${Object.keys(CATALOG_GAMES).join(", ")}`);
  if (progress.running) throw new Error(`An import is already running (${progress.game}).`);
  progress = { ...fresh(), running: true, game: slug, startedAt: new Date().toISOString() };
  const log = opts.log;
  try {
    await ensureCatalogSchema();
    const gameId = await ensureGame(g);
    const groupsAll = results(await fetchJson(`${BASE}/${g.category}/groups`)) as TcgGroup[];
    const groups = opts.groups?.length ? groupsAll.filter((x) => opts.groups!.includes(x.groupId)) : groupsAll;
    progress.groupsTotal = groups.length;
    note(`${g.name}: ${groups.length} TCGplayer groups (sets) to look at${opts.force ? " — forced refresh" : ""}`, log);
    const day = today();

    for (const grp of groups) {
      progress.current = grp.name;
      try {
        const metaKey = `catalog:tcgcsv:${grp.groupId}`;
        const seen = await one<{ value: string }>("SELECT value FROM meta WHERE key=$1", [metaKey]);
        if (seen && !opts.force) {
          progress.skipped++;
          progress.groupsDone++;
          continue;
        }
        const [productsRaw, pricesRaw] = await Promise.all([fetchJson(`${BASE}/${g.category}/${grp.groupId}/products`), fetchJson(`${BASE}/${g.category}/${grp.groupId}/prices`)]);
        const singles = (results(productsRaw) as TcgProduct[]).filter((p) => ext(p, "Number"));
        if (!singles.length) {
          await query("INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [metaKey, JSON.stringify({ singles: 0, at: day })]);
          progress.groupsDone++;
          continue; // sealed-only group (boxes, accessories)
        }
        const priceByProduct = new Map<number, TcgPrice[]>();
        for (const pr of results(pricesRaw) as TcgPrice[]) {
          const arr = priceByProduct.get(pr.productId) ?? [];
          arr.push(pr);
          priceByProduct.set(pr.productId, arr);
        }

        const set = await upsertSet(gameId, g.name, grp, singles.length);
        if (!set.adopted) progress.sets++;
        let added = 0, updated = 0;

        for (const p of singles) {
          const number = ext(p, "Number");
          const name = cleanCardName(p.name, number);
          const rarity = ext(p, "Rarity");
          const img = imageUrls(p);
          const searchText = [name, set.name, number, g.name, rarity].filter(Boolean).join(" ").toLowerCase();
          const cardSlug = slugify(`${name}-${number ?? ""}`) || slugify(name) || `card-${p.productId}`;

          let card = await one<{ id: number; image_small: string | null }>("SELECT id, image_small FROM cards WHERE tcgplayer_product_id=$1", [p.productId]);
          if (!card && set.adopted) {
            // a set seeded from another provider: adopt its card by collector number + name
            const ns = numberSort(number);
            const cands = (await query("SELECT id, name, image_small FROM cards WHERE set_id=$1 AND number_sort=$2 AND tcgplayer_product_id IS NULL", [set.id, ns])) as Array<{ id: number; name: string; image_small: string | null }>;
            const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            const hit = cands.find((c) => key(c.name) === key(name)) ?? (cands.length === 1 ? cands[0] : undefined);
            if (hit) card = { id: hit.id, image_small: hit.image_small };
          }
          if (card) {
            // keep a higher-quality provider image when one is already there
            const keepImg = !!card.image_small && !/tcgplayer-cdn\.tcgplayer\.com/.test(card.image_small);
            await query(
              `UPDATE cards SET name=$1, number=$2, number_sort=$3, rarity=COALESCE($4, rarity), search_text=$5,
                 image_small=CASE WHEN $6 THEN image_small ELSE $7 END, image_large=CASE WHEN $6 THEN image_large ELSE $8 END,
                 tcgplayer_product_id=$9, tcgplayer_url=$10, external_id=COALESCE(external_id,$11)
               WHERE id=$12`,
              [name, number, numberSort(number), rarity, searchText, keepImg, img.small, img.large, p.productId, p.url ?? null, `tcg:${p.productId}`, card.id]
            );
            updated++;
          } else {
            const ins = await one<{ id: number }>(
              `INSERT INTO cards (set_id, slug, name, number, number_sort, rarity, artist, image_small, image_large, external_id, search_text, tcgplayer_product_id, tcgplayer_url)
               VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12) RETURNING id`,
              [set.id, cardSlug, name, number, numberSort(number), rarity, img.small, img.large, `tcg:${p.productId}`, searchText, p.productId, p.url ?? null]
            );
            card = { id: ins!.id, image_small: img.small };
            added++;
          }

          // variants + today's prices, one per TCGplayer price sub-type
          const prices = (priceByProduct.get(p.productId) ?? []).filter((pr) => pr.marketPrice != null || pr.midPrice != null);
          const subtypes = prices.length ? prices : [{ productId: p.productId, subTypeName: "Normal", marketPrice: null, lowPrice: null, midPrice: null, highPrice: null } as TcgPrice];
          const variants = (await query("SELECT id, finish, is_default FROM card_variants WHERE card_id=$1", [card.id])) as Array<{ id: number; finish: string; is_default: boolean }>;
          for (const pr of subtypes) {
            const key = pr.subTypeName.trim().toLowerCase();
            const mapped = SUBTYPE_FINISH[key] ?? { finish: key.replace(/[^a-z0-9]+/g, "_"), label: pr.subTypeName.trim() };
            let v = variants.find((x) => x.finish === mapped.finish);
            if (!v) {
              const created = await one<{ id: number }>(
                `INSERT INTO card_variants (card_id, finish, finish_label, language, tcgplayer_id, is_default) VALUES ($1,$2,$3,'EN',$4,false) RETURNING id`,
                [card.id, mapped.finish, mapped.label, String(p.productId)]
              );
              v = { id: created!.id, finish: mapped.finish, is_default: false };
              variants.push(v);
              progress.variants++;
            }
            if (pr.marketPrice == null) continue;
            const cents = Math.round(pr.marketPrice * 100);
            const ref = `${p.productId}:${pr.subTypeName}`;
            await query(
              `DELETE FROM price_points WHERE variant_id=$1 AND source='tcgplayer' AND observed_on=$2 AND kind IN ('market','history','market_low','market_mid','market_high')`,
              [v.id, day]
            );
            await query(
              `INSERT INTO price_points (variant_id, source, kind, currency, price_cents, observed_on, is_demo, external_ref)
               VALUES ($1,'tcgplayer','market','USD',$2,$3,false,$4), ($1,'tcgplayer','history','USD',$2,$3,false,$4)`,
              [v.id, cents, day, ref]
            );
            for (const [kind, dollars] of [["market_low", pr.lowPrice], ["market_mid", pr.midPrice], ["market_high", pr.highPrice]] as Array<[string, number | null]>) {
              if (dollars == null) continue;
              await query(
                `INSERT INTO price_points (variant_id, source, kind, currency, price_cents, observed_on, is_demo, external_ref) VALUES ($1,'tcgplayer',$2,'USD',$3,$4,false,$5)`,
                [v.id, kind, Math.round(dollars * 100), day, ref]
              );
            }
            await query("DELETE FROM price_points WHERE variant_id=$1 AND kind='market' AND is_demo=true AND grade IS NULL", [v.id]);
            progress.prices++;
          }
          // a card needs one default printing: the best-ranked finish that exists
          if (!variants.some((x) => x.is_default) && variants.length) {
            const best = [...variants].sort((a, b) => (FINISH_RANK.indexOf(a.finish) + 1 || 99) - (FINISH_RANK.indexOf(b.finish) + 1 || 99))[0];
            await query("UPDATE card_variants SET is_default=true WHERE id=$1", [best.id]);
            best.is_default = true;
          }
        }

        await query("INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [metaKey, JSON.stringify({ singles: singles.length, at: day })]);
        progress.cardsAdded += added;
        progress.cardsUpdated += updated;
        note(`  ✓ ${grp.name}: ${singles.length} singles (${added} new, ${updated} updated)`, log);
      } catch (err: any) {
        progress.errors++;
        note(`  ! ${grp.name}: ${err?.message ?? err}`, log);
      }
      progress.groupsDone++;
      await sleep(120); // be polite to the mirror
    }

    await query("INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [`catalog_import_${slug}`, new Date().toISOString()]);
    note(`${g.name} done: ${progress.sets} new sets, ${progress.cardsAdded} new cards, ${progress.cardsUpdated} updated, ${progress.variants} new printings, ${progress.prices} prices, ${progress.skipped} groups skipped (already imported), ${progress.errors} errors.`, log);

    if (opts.hashAfter !== false && progress.cardsAdded > 0) {
      progress.current = "photo-ID index";
      note("Building the photo-ID index for the new cards…", log);
      const h = await buildHashIndex({ log: (l) => note("  " + l, log) });
      note(`Photo-ID index: ${h.hashed}/${h.cards} cards covered (${h.failed} failed).`, log);
    }
  } catch (err: any) {
    progress.error = err?.message ?? String(err);
    note(`Import failed: ${progress.error}`, log);
  } finally {
    progress.running = false;
    progress.current = null;
    progress.finishedAt = new Date().toISOString();
  }
  return progress;
}

/** Fire-and-forget for the owner console; progress is read back with catalogImportProgress(). */
export function startCatalogImport(slug: string, opts: ImportOptions = {}): void {
  if (progress.running) return;
  importGame(slug, { ...opts, log: opts.log ?? ((l) => console.log("  " + l)) }).catch((err) => console.error("catalog import:", err));
}

export type CatalogGameStats = { slug: string; name: string; sets: number; cards: number; hashed: number; lastImport: string | null; inCatalog: boolean };

/** Per-game counts for the owner console. Games without a row yet are listed as importable. */
export async function catalogStats(): Promise<CatalogGameStats[]> {
  await ensureCatalogSchema();
  const rows = (await query(
    `SELECT g.slug, g.name,
            (SELECT COUNT(*)::int FROM sets s WHERE s.game_id=g.id) AS sets,
            (SELECT COUNT(*)::int FROM cards c JOIN sets s ON s.id=c.set_id WHERE s.game_id=g.id) AS cards,
            (SELECT COUNT(*)::int FROM card_image_hashes h JOIN cards c ON c.id=h.card_id JOIN sets s ON s.id=c.set_id WHERE s.game_id=g.id) AS hashed
     FROM games g ORDER BY g.sort, g.name`
  ).catch(async () => query(
    `SELECT g.slug, g.name,
            (SELECT COUNT(*)::int FROM sets s WHERE s.game_id=g.id) AS sets,
            (SELECT COUNT(*)::int FROM cards c JOIN sets s ON s.id=c.set_id WHERE s.game_id=g.id) AS cards, 0 AS hashed
     FROM games g ORDER BY g.sort, g.name`
  ))) as Array<{ slug: string; name: string; sets: number; cards: number; hashed: number }>;
  const meta = (await query("SELECT key, value FROM meta WHERE key LIKE 'catalog_import_%'")) as Array<{ key: string; value: string }>;
  const last = new Map(meta.map((m) => [m.key.replace("catalog_import_", ""), m.value]));
  const out: CatalogGameStats[] = rows.map((r) => ({ ...r, lastImport: last.get(r.slug) ?? null, inCatalog: true }));
  for (const g of Object.values(CATALOG_GAMES)) if (!out.some((r) => r.slug === g.slug)) out.push({ slug: g.slug, name: g.name, sets: 0, cards: 0, hashed: 0, lastImport: null, inCatalog: false });
  return out;
}
