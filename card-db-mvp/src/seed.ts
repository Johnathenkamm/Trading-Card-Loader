// Seeds the catalog from the free Pokemon TCG API and Scryfall (research report
// section 6.2). Real data ingested: cards, sets, images, variant finishes, and
// CURRENT market prices. Synthesized + flagged is_demo=1: daily price history,
// per-grade values, and sold comps -- because a single API call has no history,
// and real eBay sold-comp data is gated to approved partners (report 6.3).
//
// Run:  npm run seed        (rebuilds data/catalog.db from scratch)

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DB_PATH } from "./db.ts";
import {
  slugify,
  rng,
  hashString,
  isoDaysAgo,
  numberSort,
  sleep,
} from "./util.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(here, "schema.sql");
const SEED_ON = "2026-08-23"; // deterministic "today" for the demo

// ---- which sets to pull ---------------------------------------------------
const POKEMON_SETS = ["base1", "swsh4"]; // Base Set + Darkness Ablaze (both have a Charizard used in the wireframes)
const MAGIC_SETS = ["neo"]; // Kamigawa: Neon Dynasty (foil + etched variants)

// ---- finish maps ----------------------------------------------------------
type FinishDef = { finish: string; label: string; rank: number };
const PKMN_FINISH: Record<string, FinishDef> = {
  holofoil: { finish: "holofoil", label: "Holo", rank: 0 },
  reverseHolofoil: { finish: "reverse_holofoil", label: "Reverse Holo", rank: 1 },
  normal: { finish: "normal", label: "Normal", rank: 2 },
  "1stEditionHolofoil": { finish: "1st_edition_holofoil", label: "1st Edition Holo", rank: 3 },
  "1stEditionNormal": { finish: "1st_edition", label: "1st Edition", rank: 4 },
  unlimitedHolofoil: { finish: "unlimited_holofoil", label: "Unlimited Holo", rank: 5 },
  unlimited: { finish: "unlimited", label: "Unlimited", rank: 6 },
};
const MTG_FINISH: Record<string, FinishDef & { priceKey: string }> = {
  nonfoil: { finish: "normal", label: "Normal", rank: 0, priceKey: "usd" },
  foil: { finish: "foil", label: "Foil", rank: 1, priceKey: "usd_foil" },
  etched: { finish: "etched", label: "Etched Foil", rank: 2, priceKey: "usd_etched" },
};

// grade multipliers off the raw market price -- DEMO ONLY, clearly flagged.
const GRADES: Array<{ grade: string; mult: number }> = [
  { grade: "PSA 8", mult: 2.2 },
  { grade: "PSA 9", mult: 4.6 },
  { grade: "PSA 10", mult: 12.5 },
  { grade: "CGC 9.5", mult: 5.4 },
  { grade: "BGS 9.5", mult: 6.8 },
];

// ---- fetch helpers --------------------------------------------------------
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429 || res.status >= 500) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}
const SCRYFALL_HEADERS = { "User-Agent": "CardDB-MVP/0.1 (research demo)", Accept: "application/json" };

// ---- db setup -------------------------------------------------------------
mkdirSync(join(here, "..", "data"), { recursive: true });
for (const ext of ["", "-wal", "-shm"]) {
  const p = DB_PATH + ext;
  if (existsSync(p)) rmSync(p);
}
const db = new DatabaseSync(DB_PATH);
db.exec(readFileSync(SCHEMA_PATH, "utf8"));

const insGame = db.prepare("INSERT INTO games(slug,name,sort) VALUES (?,?,?)");
const insSet = db.prepare(
  "INSERT INTO sets(game_id,slug,name,code,release_date,card_count,image_url,external_id) VALUES (?,?,?,?,?,?,?,?)"
);
const insCard = db.prepare(
  "INSERT INTO cards(set_id,slug,name,number,number_sort,rarity,artist,image_small,image_large,external_id,search_text) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
);
const insVariant = db.prepare(
  "INSERT INTO card_variants(card_id,finish,finish_label,language,printing_note,tcgplayer_id,is_default) VALUES (?,?,?,?,?,?,?)"
);
const insPrice = db.prepare(
  "INSERT INTO price_points(variant_id,source,kind,grade,condition,currency,price_cents,observed_on,is_demo) VALUES (?,?,?,?,?,?,?,?,?)"
);
const insMeta = db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)");

function ensureGame(slug: string, name: string, sort: number): number {
  const row = db.prepare("SELECT id FROM games WHERE slug=?").get(slug) as { id: number } | undefined;
  if (row) return row.id;
  return Number(insGame.run(slug, name, sort).lastInsertRowid);
}

// track variants we insert so we can synthesize pricing afterwards
type SeedVariant = { variantId: number; key: string; marketCents: number | null };
const seededVariants: SeedVariant[] = [];

function addCardWithVariants(opts: {
  gameId: number;
  gameName: string;
  setId: number;
  setName: string;
  name: string;
  number: string | null;
  rarity: string | null;
  artist: string | null;
  imageSmall: string | null;
  imageLarge: string | null;
  externalId: string;
  variants: Array<{ finish: string; label: string; rank: number; marketCents: number | null; tcgId?: string | null }>;
}) {
  const slug = slugify(`${opts.name}-${opts.number ?? ""}`) || slugify(opts.name);
  const searchText = [opts.name, opts.setName, opts.number, opts.gameName, opts.rarity, opts.artist]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const cardId = Number(
    insCard.run(
      opts.setId,
      slug,
      opts.name,
      opts.number,
      numberSort(opts.number),
      opts.rarity,
      opts.artist,
      opts.imageSmall,
      opts.imageLarge,
      opts.externalId,
      searchText
    ).lastInsertRowid
  );

  const ordered = [...opts.variants].sort((a, b) => a.rank - b.rank);
  // default = first priced variant, else first
  const defIdx = Math.max(0, ordered.findIndex((v) => v.marketCents != null));
  ordered.forEach((v, i) => {
    const variantId = Number(
      insVariant.run(cardId, v.finish, v.label, "EN", null, v.tcgId ?? null, i === defIdx ? 1 : 0)
        .lastInsertRowid
    );
    if (v.marketCents != null) {
      insPrice.run(variantId, "tcgplayer", "market", null, "NM", "USD", v.marketCents, SEED_ON, 0);
    }
    seededVariants.push({
      variantId,
      key: `${opts.externalId}:${v.finish}`,
      marketCents: v.marketCents,
    });
  });
}

// ---- Pokemon --------------------------------------------------------------
async function seedPokemon(gameId: number) {
  for (const setId of POKEMON_SETS) {
    const setMeta = (await fetchJson(`https://api.pokemontcg.io/v2/sets/${setId}`)).data;
    const releaseDate = (setMeta.releaseDate || "").replace(/\//g, "-") || null;
    const dbSetId = Number(
      insSet.run(
        gameId,
        slugify(`${setMeta.name}-${setMeta.id}`),
        setMeta.name,
        setMeta.ptcgoCode || setMeta.id,
        releaseDate,
        setMeta.total || 0,
        setMeta.images?.logo || null,
        setMeta.id
      ).lastInsertRowid
    );

    const cards = (
      await fetchJson(
        `https://api.pokemontcg.io/v2/cards?q=set.id:${setId}&pageSize=250&orderBy=number`
      )
    ).data as any[];

    for (const c of cards) {
      const prices = c.tcgplayer?.prices ?? {};
      const variants: any[] = [];
      for (const [k, def] of Object.entries(PKMN_FINISH)) {
        const p = prices[k];
        if (!p) continue;
        const market = p.market ?? p.mid ?? p.high ?? null;
        variants.push({
          finish: def.finish,
          label: def.label,
          rank: def.rank,
          marketCents: market != null ? Math.round(market * 100) : null,
          tcgId: c.tcgplayer?.url ? String(c.id) : null,
        });
      }
      if (variants.length === 0) {
        variants.push({ finish: "normal", label: "Normal", rank: 2, marketCents: null });
      }
      addCardWithVariants({
        gameId,
        gameName: "Pokemon",
        setId: dbSetId,
        setName: setMeta.name,
        name: c.name,
        number: c.number ? `${c.number}/${setMeta.printedTotal ?? setMeta.total ?? ""}`.replace(/\/$/, "") : null,
        rarity: c.rarity ?? null,
        artist: c.artist ?? null,
        imageSmall: c.images?.small ?? null,
        imageLarge: c.images?.large ?? null,
        externalId: c.id,
        variants,
      });
    }
    console.log(`  Pokemon set ${setMeta.name}: ${cards.length} cards`);
    await sleep(150);
  }
}

// ---- Magic ----------------------------------------------------------------
async function seedMagic(gameId: number) {
  for (const code of MAGIC_SETS) {
    const setMeta = await fetchJson(`https://api.scryfall.com/sets/${code}`, SCRYFALL_HEADERS);
    const dbSetId = Number(
      insSet.run(
        gameId,
        slugify(`${setMeta.name}-${setMeta.code}`),
        setMeta.name,
        setMeta.code?.toUpperCase() ?? null,
        setMeta.released_at ?? null,
        setMeta.card_count ?? 0,
        setMeta.icon_svg_uri ?? null,
        setMeta.code
      ).lastInsertRowid
    );

    let url: string | null = `https://api.scryfall.com/cards/search?q=set:${code}+is:booster&unique=prints&order=set`;
    let total = 0;
    while (url) {
      const page = await fetchJson(url, SCRYFALL_HEADERS);
      for (const c of page.data as any[]) {
        const imgs = c.image_uris ?? c.card_faces?.[0]?.image_uris ?? {};
        const finishes: string[] = c.finishes ?? [];
        const variants: any[] = [];
        for (const f of finishes) {
          const def = MTG_FINISH[f];
          if (!def) continue;
          const raw = c.prices?.[def.priceKey];
          const marketCents = raw != null ? Math.round(parseFloat(raw) * 100) : null;
          variants.push({ finish: def.finish, label: def.label, rank: def.rank, marketCents });
        }
        if (variants.length === 0) {
          variants.push({ finish: "normal", label: "Normal", rank: 0, marketCents: null });
        }
        addCardWithVariants({
          gameId,
          gameName: "Magic: The Gathering",
          setId: dbSetId,
          setName: setMeta.name,
          name: c.name,
          number: c.collector_number ?? null,
          rarity: c.rarity ? c.rarity[0].toUpperCase() + c.rarity.slice(1) : null,
          artist: c.artist ?? null,
          imageSmall: imgs.small ?? null,
          imageLarge: imgs.large ?? imgs.normal ?? null,
          externalId: c.id,
          variants,
        });
        total++;
      }
      url = page.has_more ? page.next_page : null;
      await sleep(120); // Scryfall politeness
    }
    console.log(`  Magic set ${setMeta.name}: ${total} cards`);
  }
}

// ---- price synthesis (demo, flagged) -------------------------------------
function synthesizePricing() {
  let history = 0,
    graded = 0,
    sold = 0;
  const soldSources = ["ebay", "ebay", "ebay", "tcgplayer", "goldin"];

  for (const sv of seededVariants) {
    if (sv.marketCents == null || sv.marketCents <= 0) continue;
    const rand = rng(hashString(sv.key));
    const current = sv.marketCents;

    // 90-day daily history ending at the current market price (random walk backwards)
    const series: number[] = new Array(90);
    series[89] = current;
    for (let i = 88; i >= 0; i--) {
      const drift = (rand() - 0.5) * 0.06; // +/-3% day-to-day
      series[i] = Math.max(5, Math.round(series[i + 1] / (1 + drift)));
    }
    for (let i = 0; i < 90; i++) {
      insPrice.run(sv.variantId, "synthetic", "history", null, "NM", "USD", series[i], isoDaysAgo(89 - i, new Date(SEED_ON + "T00:00:00Z")), 1);
      history++;
    }

    // per-grade values (only worth showing above a small floor)
    if (current >= 200) {
      for (const g of GRADES) {
        const jitter = 1 + (rand() - 0.5) * 0.12;
        const cents = Math.round(current * g.mult * jitter);
        insPrice.run(sv.variantId, "synthetic", "market", g.grade, null, "USD", cents, SEED_ON, 1);
        graded++;
      }
    }

    // sold comps across the last 90 days
    const n = 12 + Math.floor(rand() * 12);
    for (let i = 0; i < n; i++) {
      const daysAgo = Math.floor(rand() * 90);
      // ~70% raw, else a graded bucket
      let grade: string | null = null;
      let base = current;
      const roll = rand();
      if (roll > 0.85 && current >= 200) {
        grade = "PSA 10";
        base = current * 12.5;
      } else if (roll > 0.7 && current >= 200) {
        grade = "PSA 9";
        base = current * 4.6;
      }
      const noise = 1 + (rand() - 0.5) * 0.22;
      const cents = Math.max(5, Math.round(base * noise));
      const src = soldSources[Math.floor(rand() * soldSources.length)];
      insPrice.run(sv.variantId, src, "sold", grade, grade ? null : "NM", "USD", cents, isoDaysAgo(daysAgo, new Date(SEED_ON + "T00:00:00Z")), 1);
      sold++;
    }
  }
  return { history, graded, sold };
}

// ---- run ------------------------------------------------------------------
async function main() {
  const t0 = Date.now();
  console.log("Seeding catalog from Pokemon TCG API + Scryfall ...");
  const pokemonId = ensureGame("pokemon", "Pokemon", 0);
  const magicId = ensureGame("mtg", "Magic: The Gathering", 1);

  db.exec("BEGIN");
  try {
    await seedPokemon(pokemonId);
    await seedMagic(magicId);
    console.log("Synthesizing demo price history, grades, and sold comps ...");
    const s = synthesizePricing();
    insMeta.run("seeded_on", SEED_ON);
    insMeta.run("sources", "pokemontcg.io, scryfall.com (catalog + current market); synthetic history/grades/sold comps flagged is_demo=1");
    db.exec("COMMIT");
    const c = db.prepare("SELECT (SELECT COUNT(*) FROM cards) c,(SELECT COUNT(*) FROM card_variants) v").get() as any;
    console.log(
      `Done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${c.c} cards, ${c.v} variants; ` +
        `${s.history} history + ${s.graded} graded + ${s.sold} sold price points.`
    );
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
