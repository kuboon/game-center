/**
 * Throwaway databases for the `-A` tests.
 *
 * Migrations are applied by spawning `deno task db`'s CLI, so what the tests
 * run against is the schema the deploy produces rather than a copy of it.
 *
 * A file-backed database rather than `:memory:`, because the CLI is a separate
 * process from the client the test holds — an in-memory database could not be
 * shared between them.
 */

import { assertEquals } from "@std/assert";
import { type Client, createClient } from "@libsql/client/node";

export type { Client };

const CLI = "jsr:@kuboon/remix-data-table-sqlite-turso@^0.3.0/cli";
const MIGRATIONS = new URL("../../db/migrations", import.meta.url).pathname;

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run one migration CLI command against `url`, as `deno task db` does. */
export async function runDb(
  url: string,
  ...args: string[]
): Promise<CliResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", CLI, ...args, "--url", url, "--migrations", MIGRATIONS],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

/** Assert the command succeeded, surfacing its output when it did not. */
export function assertOk(result: CliResult, what: string): CliResult {
  assertEquals(
    result.code,
    0,
    `${what} exited ${result.code}\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

/**
 * Give `run` an empty throwaway database plus a client on it, and clean up
 * afterwards. Use {@link migratedDb} unless the test is about migrating.
 */
export async function withDb(
  run: (url: string, client: Client) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "game-center-test-" });
  const url = `file:${dir}/test.db`;
  const client = createClient({ url });
  try {
    await run(url, client);
  } finally {
    client.close();
    await Deno.remove(dir, { recursive: true });
  }
}

/** Give `run` a client on a throwaway database with every migration applied. */
export function migratedDb(
  run: (client: Client) => Promise<void>,
): Promise<void> {
  return withDb(async (url, client) => {
    assertOk(await runDb(url, "migrate"), "migrate");
    await run(client);
  });
}

/** Every table in the database, sorted by name. */
export async function tableNames(client: Client): Promise<string[]> {
  const result = await client.execute(
    "select name from sqlite_master where type = 'table' order by name",
  );
  return result.rows.map((row) => String(row.name));
}
