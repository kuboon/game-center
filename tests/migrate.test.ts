/**
 * Migrations and schema, exercised through the CLI the deploy actually runs.
 *
 * `deno task db` wraps `@kuboon/remix-data-table-sqlite-turso/cli`, so the tests
 * spawn that same command against a throwaway file database rather than
 * reimplementing the runner. What is under test is our migration SQL — that it
 * applies, reverts, and produces the constraints the design relies on.
 *
 * Lives here rather than under `server/` because the CLI and the local libSQL
 * client both need `-A`, while the server's unit tests run under the
 * workspace's `-P` default.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { type Client, createClient } from "@libsql/client/node";

const CLI = "jsr:@kuboon/remix-data-table-sqlite-turso@^0.3.0/cli";
const MIGRATIONS = new URL("../db/migrations", import.meta.url).pathname;

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run one CLI command against `url`, the same way `deno task db` does. */
async function db(
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
function assertOk(result: CliResult, what: string): CliResult {
  assertEquals(
    result.code,
    0,
    `${what} exited ${result.code}\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

/**
 * Give `run` a throwaway file-backed database plus a client on it, and clean up
 * afterwards. A file rather than `:memory:` because the CLI and the client are
 * separate connections — and separate processes — so an in-memory database
 * would not be shared between them.
 */
async function withDb(
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

async function tableNames(client: Client): Promise<string[]> {
  const result = await client.execute(
    "select name from sqlite_master where type = 'table' order by name",
  );
  return result.rows.map((row) => String(row.name));
}

/** A migrated database, ready for the schema assertions. */
async function migrated(url: string): Promise<void> {
  assertOk(await db(url, "migrate"), "migrate");
}

Deno.test("migrate creates every table the design declares", async () => {
  await withDb(async (url, client) => {
    await migrated(url);

    const tables = await tableNames(client);
    for (
      const table of [
        "users",
        "games",
        "achievements",
        "user_achievements",
        "api_tokens",
        "dpop_sessions",
      ]
    ) {
      assert(tables.includes(table), `missing table: ${table}`);
    }
  });
});

Deno.test("migrate is a no-op once applied", async () => {
  await withDb(async (url) => {
    await migrated(url);
    assertOk(await db(url, "migrate"), "second migrate");
    assertStringIncludes(
      assertOk(await db(url, "status"), "status").stdout,
      "20260818000000",
    );
  });
});

Deno.test("rollback reverts the schema", async () => {
  await withDb(async (url, client) => {
    await migrated(url);
    assertOk(await db(url, "rollback", "--step", "1"), "rollback");

    const tables = await tableNames(client);
    for (const table of ["users", "games", "achievements"]) {
      assertEquals(tables.includes(table), false, `${table} survived rollback`);
    }
  });
});

Deno.test("schema accepts a full unlock round trip", async () => {
  await withDb(async (url, client) => {
    await migrated(url);

    await client.execute({
      sql: "insert into users (external_id, display_name) values (?, ?)",
      args: ["idp-user-1", "kuboon"],
    });
    await client.execute({
      sql: "insert into games (id, owner_id, title, url) values (?, 1, ?, ?)",
      args: ["my-puzzle", "My Puzzle", "https://example.github.io/my-puzzle/"],
    });
    await client.execute({
      sql:
        "insert into achievements (game_id, key, title, points) values (?, ?, ?, ?)",
      args: ["my-puzzle", "first_clear", "はじめてのクリア", 10],
    });
    await client.execute({
      sql:
        "insert into user_achievements (user_id, achievement_id, via, score) values (1, 1, ?, ?)",
      args: ["rest", 1200],
    });

    const unlocked = await client.execute(
      "select score, via, unlocked_at from user_achievements",
    );
    assertEquals(unlocked.rows.length, 1);
    assertEquals(unlocked.rows[0].score, 1200);
    assertEquals(unlocked.rows[0].via, "rest");
    assert(String(unlocked.rows[0].unlocked_at).length > 0);
  });
});

Deno.test("schema enforces the constraints unlocking relies on", async () => {
  await withDb(async (url, client) => {
    await migrated(url);
    await client.execute(
      "insert into users (external_id, display_name) values ('u', 'u')",
    );
    await client.execute(
      "insert into games (id, owner_id, title, url) values ('g', 1, 'g', 'https://example.com/')",
    );
    const achievement =
      "insert into achievements (game_id, key, title) values ('g', 'k', 'k')";
    await client.execute(achievement);

    // One achievement key per game.
    await assertRejects(() => client.execute(achievement));

    // Foreign keys are on: libSQL enables them, unlike stock SQLite.
    await assertRejects(() =>
      client.execute(
        "insert into games (id, owner_id, title, url) values ('x', 999, 'x', 'https://example.com/')",
      )
    );

    // Only the three unlock paths the protocol defines.
    await assertRejects(() =>
      client.execute(
        "insert into user_achievements (user_id, achievement_id, via) values (1, 1, 'telepathy')",
      )
    );

    // Unlocking twice collides on the primary key.
    const unlock =
      "insert into user_achievements (user_id, achievement_id, via) values (1, 1, 'claim')";
    await client.execute(unlock);
    await assertRejects(() => client.execute(unlock));
  });
});
