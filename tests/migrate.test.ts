/**
 * Migration runner and schema checks against a real libSQL database.
 *
 * Uses `@libsql/client/node` against a file in a temp dir — no network and no
 * Turso credentials, but the same SQLite engine and the same `Client` API the
 * app drives in production. A file rather than `:memory:` because the node
 * client opens more than one connection and each would get its own empty
 * in-memory database.
 *
 * Lives here rather than under `server/` because the native libSQL addon needs
 * `-A`, while the server's unit tests run under the workspace's `-P` default.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { type Client, createClient } from "@libsql/client/node";

import {
  appliedMigrations,
  applyMigrations,
  applyScript,
  MIGRATIONS,
} from "../server/db/migrate.ts";

/** Open a throwaway file-backed database, and clean it up afterwards. */
async function withDb(run: (client: Client) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "game-center-test-" });
  const client = createClient({ url: `file:${dir}/test.db` });
  try {
    await run(client);
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

Deno.test("applies every migration to an empty database", async () => {
  await withDb(async (client) => {
    const applied = await applyMigrations(client);
    assertEquals(applied, [...MIGRATIONS]);

    const tables = await tableNames(client);
    for (
      const table of [
        "users",
        "games",
        "achievements",
        "user_achievements",
        "api_tokens",
        "dpop_sessions",
        "schema_migrations",
      ]
    ) {
      assert(tables.includes(table), `missing table: ${table}`);
    }
    assertEquals(await appliedMigrations(client), new Set(MIGRATIONS));
  });
});

Deno.test("is a no-op on an already migrated database", async () => {
  await withDb(async (client) => {
    await applyMigrations(client);
    assertEquals(await applyMigrations(client), []);
  });
});

Deno.test("rolls a failed migration back whole", async () => {
  await withDb(async (client) => {
    await applyMigrations(client);

    await assertRejects(() =>
      applyScript(
        client,
        "002_broken.sql",
        "create table half_applied (id integer primary key);\nthis is not sql;",
      )
    );

    assertEquals((await tableNames(client)).includes("half_applied"), false);
    assertEquals(
      (await appliedMigrations(client)).has("002_broken.sql"),
      false,
    );
  });
});

Deno.test("enforces the foreign keys the schema declares", async () => {
  await withDb(async (client) => {
    await applyMigrations(client);

    await assertRejects(() =>
      client.execute(
        "insert into games (id, owner_id, title, url) values ('g', 999, 'g', 'https://example.com/')",
      )
    );
  });
});

Deno.test("schema accepts a full unlock round trip", async () => {
  await withDb(async (client) => {
    await applyMigrations(client);

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

Deno.test("unlocking twice collides on the primary key", async () => {
  await withDb(async (client) => {
    await applyMigrations(client);
    await client.execute(
      "insert into users (external_id, display_name) values ('u', 'u')",
    );
    await client.execute(
      "insert into games (id, owner_id, title, url) values ('g', 1, 'g', 'https://example.com/')",
    );
    await client.execute(
      "insert into achievements (game_id, key, title) values ('g', 'k', 'k')",
    );
    const insert =
      "insert into user_achievements (user_id, achievement_id, via) values (1, 1, 'claim')";

    await client.execute(insert);
    await assertRejects(() => client.execute(insert));
  });
});

Deno.test("rejects an unknown unlock source", async () => {
  await withDb(async (client) => {
    await applyMigrations(client);
    await client.execute(
      "insert into users (external_id, display_name) values ('u', 'u')",
    );
    await client.execute(
      "insert into games (id, owner_id, title, url) values ('g', 1, 'g', 'https://example.com/')",
    );
    await client.execute(
      "insert into achievements (game_id, key, title) values ('g', 'k', 'k')",
    );

    await assertRejects(() =>
      client.execute(
        "insert into user_achievements (user_id, achievement_id, via) values (1, 1, 'telepathy')",
      )
    );
  });
});

Deno.test("keeps one achievement key per game", async () => {
  await withDb(async (client) => {
    await applyMigrations(client);
    await client.execute(
      "insert into users (external_id, display_name) values ('u', 'u')",
    );
    await client.execute(
      "insert into games (id, owner_id, title, url) values ('g', 1, 'g', 'https://example.com/')",
    );
    const insert =
      "insert into achievements (game_id, key, title) values ('g', 'k', 'k')";

    await client.execute(insert);
    await assertRejects(() => client.execute(insert));
  });
});
