# Database & storage (Postgres + bucket)

The MVP runs on `node:sqlite` (`data/catalog.db`) with zero setup. This folder adds
the **production stack** the build plan calls for — Postgres for card data and an
S3-compatible **bucket** for image files — running locally in Docker and
host-agnostic so it lifts to Supabase / Neon / R2 by changing one env var.

Both run side by side: the SQLite demo (`npm start`) keeps working while the app
is ported to Postgres one route at a time.

## Why both Postgres *and* a bucket

| Stores | Where | Examples |
|---|---|---|
| **Structured card data** | Postgres | names, sets, variants, prices, SKUs, inventory, listings, and the image **key/URL** |
| **Image files** | Bucket (object storage) | seller-uploaded scan photos (`scan_items.image_url` / `back_image_url`), cached catalog art |

Never put image binaries in Postgres — it bloats the DB, is slow to serve, and
can't be CDN-cached. Postgres holds a short key; the file lives in the bucket.
Showing a card to a customer = Postgres returns the row + key → `<img>` loads the
file from the bucket/CDN. (Catalog art today is hot-linked from the Pokémon TCG
API / Scryfall; the bucket is mainly for seller uploads and any cached art.)

## Quick start

```bash
cd card-db-mvp
cp .env.example .env      # adjust if you like
npm install               # adds the pg driver
npm run db:up             # start Postgres + MinIO (bucket); schema auto-applies

npm run seed              # build data/catalog.db from the APIs (if not done yet)
npm run pg:migrate        # copy SQLite -> Postgres
```

Then:
- **Postgres** — `postgres://cardindex:cardindex@localhost:5435/cardindex` (`npm run db:psql` for a shell)
- **MinIO console** — http://localhost:9001 (user/pass `minioadmin`), bucket `card-images`
- **Image URL shape** — `http://localhost:9000/card-images/<key>` (public read)

> Host port is **5435**, not 5432 — 5432/5433/5544 are already used by your other
> project databases. Inside the container Postgres still listens on 5432.

## Commands

| Command | Does |
|---|---|
| `npm run db:up` | start Postgres + MinIO + create bucket (detached) |
| `npm run db:down` | stop containers (data kept in volumes) |
| `npm run db:reset` | **wipe** volumes and recreate from scratch |
| `npm run db:schema` | re-apply `db/schema.postgres.sql` |
| `npm run db:psql` | open a psql shell |
| `npm run pg:migrate` | copy `data/catalog.db` → Postgres (idempotent) |

## Point at Supabase / Neon (production)

No code changes — just env:

```bash
DATABASE_URL=postgres://USER:PASS@HOST:5432/postgres   # from the provider
PGSSLMODE=require                                       # hosted Postgres needs TLS
```

Apply the schema (`psql "$DATABASE_URL" -f db/schema.postgres.sql`) and, if
moving demo data, run `npm run pg:migrate`. On **Supabase** you also get Storage
buckets built in — point the storage layer at its S3 endpoint (below).

## Storage / bucket config

`src/storage.ts` has two drivers, chosen by `STORAGE_DRIVER`:

- **`local`** (default) — writes under `./data/uploads`, zero dependencies. Good for dev.
- **`s3`** — any S3-compatible bucket: the bundled MinIO, AWS S3, Cloudflare R2,
  or Supabase Storage's S3 endpoint. Requires `npm i @aws-sdk/client-s3`, then set
  `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_PUBLIC_BASE` (see `.env.example`).

```ts
import { storage, keyFor } from "./storage.ts";
const key = keyFor(sellerId, "front.jpg");          // sellers/1/scan/<uuid>.jpg
const { url } = await storage().put(key, bytes, "image/jpeg");
// save `key` on scan_items.image_url; serve `url` to the customer
```

## How the app uses Postgres (port complete)

The whole app runs on Postgres — public catalog, search, and the full seller
workspace (scan → review → commit → inventory → listings). `src/pg.ts` is the
async data layer (pool, `query`/`one`/`tx`/`toPg` helpers, and the catalog
reads); `src/app/store.ts` holds the workspace queries; `src/search.ts` and
`src/app/identify.ts` are async too. `server.ts` pings Postgres on startup and
fails fast with setup instructions if it can't connect.

`src/db.ts` now serves only as the SQLite staging layer for `seed.ts` (the
`seed` → `pg:migrate` data flow); nothing in the running server imports it.

A few Postgres-vs-SQLite differences handled during the port, worth knowing if
you add queries:

- **bigint ids** come back as strings by default — `pg.ts` registers a type
  parser to return them as JS numbers (safe at this data scale).
- **jsonb / dates** are returned as raw strings (parity with the old SQLite
  layer); writes cast JSON params with `::jsonb`, and 0/1 flags are coerced to
  real booleans.
- **`GROUP BY`** must list every non-aggregated selected column (Postgres is
  strict); a **SELECT alias can't be used inside an `ORDER BY` expression** (wrap
  in a subquery). Both were adjusted in `search.ts`.
- **`lastInsertRowid`** → `INSERT … RETURNING id`; multi-statement writes use the
  `tx()` helper (`commitBatch` is the one real transaction).

## Schema notes (`schema.postgres.sql`)

Idiomatic translation of `src/schema.sql` + `src/schema.app.sql`:

- `INTEGER PRIMARY KEY AUTOINCREMENT` → `bigint GENERATED ALWAYS AS IDENTITY`
- 0/1 flags → `boolean`; ISO text dates → `date` / `timestamptz`; JSON text → `jsonb`
- real foreign keys with `ON DELETE` on every reference; `UNIQUE (seller_id, sku)`
- `pg_trgm` trigram indexes on `cards.name` / `search_text` — typo-tolerant search
  natively (replaces the MVP's app-side Levenshtein). Example:
  `SELECT name FROM cards WHERE name % 'Charzard' ORDER BY similarity(name,'Charzard') DESC;`

`pg.ts` returns `date`/`timestamp` columns as raw ISO **strings** (matching the
SQLite layer) so ported render code needs no date-handling changes. Money stays
integer cents.
