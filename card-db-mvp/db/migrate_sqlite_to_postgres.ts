// One-shot ETL: copy the seeded SQLite catalog (data/catalog.db) into Postgres.
//
//   npm run seed        # build data/catalog.db from the APIs (if not done yet)
//   npm run db:up       # start Postgres
//   npm run pg:migrate  # copy SQLite -> Postgres  (loads .env for DATABASE_URL)
//
// Idempotent: truncates the Postgres tables and re-copies. Preserves primary-key
// ids (so foreign keys line up) and resets identity sequences afterward. Handles
// the type differences between the two schemas: 0/1 -> boolean, JSON text ->
// jsonb, ISO text -> date/timestamptz (Postgres parses ISO strings directly).

import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const SQLITE_PATH = join(here, "..", "data", "catalog.db");

// Columns that are 0/1 integers in SQLite but boolean in Postgres.
const BOOL_COLS = new Set([
  "is_default",
  "is_demo",
  "training_opt_in",
  "ebay_connected",
  "price_overridden",
]);
// Columns that are JSON stored as TEXT in SQLite but jsonb in Postgres.
const JSON_COLS = new Set(["alternatives", "item_specifics", "title_structure"]);

// FK-safe insertion order (parents before children).
const TABLES = [
  "games",
  "sets",
  "cards",
  "card_variants",
  "price_points",
  "catalog_issue_reports",
  "meta",
  "sellers",
  "scan_batches",
  "scan_items",
  "inventory",
  "inventory_price_history",
  "listings",
];

const CHUNK = 500;

function sslFromEnv() {
  const mode = (process.env.PGSSLMODE ?? "").toLowerCase();
  return ["require", "prefer", "verify-ca", "verify-full"].includes(mode)
    ? { rejectUnauthorized: false }
    : undefined;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL not set. Run via `npm run pg:migrate` (it loads .env).");
  }

  const sqlite = new DatabaseSync(SQLITE_PATH);
  const pool = new pg.Pool({ connectionString, ssl: sslFromEnv() });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);

    for (const table of TABLES) {
      const cols = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map((c) => c.name);
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;

      if (rows.length === 0) {
        console.log(`  ${table.padEnd(24)} 0`);
        continue;
      }

      const hasId = cols.includes("id");
      const overriding = hasId ? "OVERRIDING SYSTEM VALUE" : "";
      const colList = cols.map((c) => `"${c}"`).join(", ");

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const tuples = chunk.map((row) => {
          const placeholders = cols.map((col) => {
            let v = row[col];
            if (BOOL_COLS.has(col) && v !== null && v !== undefined) v = !!v;
            params.push(v ?? null);
            const idx = params.length;
            return JSON_COLS.has(col) ? `$${idx}::jsonb` : `$${idx}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await client.query(
          `INSERT INTO ${table} (${colList}) ${overriding} VALUES ${tuples.join(", ")}`,
          params
        );
      }

      if (hasId) {
        // Bump the identity sequence past the copied ids.
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'),
                         (SELECT COALESCE(MAX(id), 0) FROM ${table}) + 1, false)`,
          [table]
        );
      }
      console.log(`  ${table.padEnd(24)} ${rows.length}`);
    }

    await client.query("COMMIT");
    console.log("Migration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed, rolled back:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

await main();
