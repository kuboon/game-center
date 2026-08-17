/**
 * Schema migrations.
 *
 * Migrations are numbered `.sql` files under `./migrations`, listed in
 * {@link MIGRATIONS} in the order they must run. Applied names are recorded in
 * `schema_migrations`, so re-running is a no-op, and each migration runs inside
 * a transaction together with its own bookkeeping row: a migration that fails
 * halfway leaves the database untouched rather than half-migrated.
 *
 * Migrations run as a deploy step (`deno task migrate`), not on server start —
 * on Deno Deploy an isolate boots per request, and having each of them race to
 * migrate would be both wasteful and unsafe.
 *
 * libSQL enforces foreign keys (unlike stock SQLite, where the pragma is off by
 * default), so a migration that rebuilds a referenced table has to turn them off
 * for the duration itself.
 *
 * ```bash
 * deno task migrate
 * ```
 */

import type { Client } from "./client.ts";
import { splitStatements } from "./sql_script.ts";

/** Migration file names, in the order they must be applied. */
export const MIGRATIONS = [
  "001_initial.sql",
] as const;

const CREATE_BOOKKEEPING = `
  create table if not exists schema_migrations (
    name       text primary key,
    applied_at text not null default (datetime('now'))
  )
`;

/**
 * Apply every migration the database has not seen yet.
 *
 * @param client Database to migrate
 * @returns Names of the migrations applied by this call, in order
 */
export async function applyMigrations(client: Client): Promise<string[]> {
  await client.execute(CREATE_BOOKKEEPING);
  const applied = await appliedMigrations(client);

  const newlyApplied: string[] = [];
  for (const name of MIGRATIONS) {
    if (applied.has(name)) continue;
    await applyMigration(client, name);
    newlyApplied.push(name);
  }
  return newlyApplied;
}

/** Names already recorded in `schema_migrations`. */
export async function appliedMigrations(client: Client): Promise<Set<string>> {
  const result = await client.execute("select name from schema_migrations");
  return new Set(result.rows.map((row) => String(row.name)));
}

async function applyMigration(client: Client, name: string): Promise<void> {
  const script = await Deno.readTextFile(
    new URL(`./migrations/${name}`, import.meta.url),
  );
  await applyScript(client, name, script);
}

/**
 * Run one migration script and record it, in a single transaction.
 *
 * Exported so tests can drive the runner with a script of their own instead of
 * a file from {@link MIGRATIONS}.
 *
 * @param client Database to migrate
 * @param name Name recorded in `schema_migrations`
 * @param script Contents of the migration
 */
export async function applyScript(
  client: Client,
  name: string,
  script: string,
): Promise<void> {
  const statements = splitStatements(script);

  const tx = await client.transaction("write");
  try {
    for (const statement of statements) {
      await tx.execute(statement);
    }
    await tx.execute({
      sql: "insert into schema_migrations (name) values (?)",
      args: [name],
    });
    await tx.commit();
  } catch (cause) {
    await tx.rollback();
    throw new Error(`Migration ${name} failed`, { cause });
  }
}

if (import.meta.main) {
  const { getDb } = await import("./client.ts");
  const client = getDb();
  if (!client) {
    console.error("TURSO_DATABASE_URL is not set — nothing to migrate.");
    Deno.exit(1);
  }
  try {
    const applied = await applyMigrations(client);
    console.log(
      applied.length
        ? `Applied ${applied.length} migration(s): ${applied.join(", ")}`
        : "Already up to date.",
    );
  } finally {
    client.close();
  }
}
