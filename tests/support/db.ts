/**
 * Throwaway databases for the `-A` tests.
 *
 * The tests run `deno task db` itself rather than importing the runner, so what
 * they exercise is the command a deploy runs — including the version of it that
 * `deno.json` pins. Pinning it a second time here is how the two would drift.
 *
 * A file-backed database rather than `:memory:`, because the task is a separate
 * process from the client the test holds — an in-memory database could not be
 * shared between them.
 */

import { assertEquals } from "@std/assert";
import { type Client, createClient } from "@libsql/client/node";

export type { Client };

const ROOT = new URL("../../", import.meta.url).pathname;
const MIGRATIONS = new URL("../../db/migrations", import.meta.url).pathname;
const SEED = new URL("../../db/seed.sql", import.meta.url).pathname;

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run one `deno task db` command against `url`. */
export async function runDb(
  url: string,
  ...args: string[]
): Promise<CliResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "task",
      "--cwd",
      ROOT,
      "db",
      ...args,
      "--url",
      url,
      "--migrations",
      MIGRATIONS,
      "--seed",
      SEED,
    ],
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
