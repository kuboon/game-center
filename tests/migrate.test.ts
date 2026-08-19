/**
 * Migrations and schema, exercised through the CLI the deploy actually runs.
 *
 * `deno task db` wraps `@kuboon/remix-data-table-sqlite-turso/cli`, so the tests
 * spawn that same command rather than reimplementing the runner. What is under
 * test is our migration SQL — that it applies, reverts, and produces the
 * constraints the design relies on.
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

import {
  assertOk,
  migratedDb,
  runDb,
  tableNames,
  withDb,
} from "./support/db.ts";

const LATEST_MIGRATION = "20260819000000";

Deno.test("migrate creates every table the design declares", async () => {
  await migratedDb(async (client) => {
    const tables = await tableNames(client);
    for (
      const table of [
        "users",
        "games",
        "achievements",
        "user_achievements",
        "api_tokens",
        "kv",
      ]
    ) {
      assert(tables.includes(table), `missing table: ${table}`);
    }
    // Sessions moved into the generic kv store.
    assertEquals(tables.includes("dpop_sessions"), false);
  });
});

Deno.test("migrate is a no-op once applied", async () => {
  await withDb(async (url) => {
    assertOk(await runDb(url, "migrate"), "migrate");
    assertOk(await runDb(url, "migrate"), "second migrate");
    assertStringIncludes(
      assertOk(await runDb(url, "status"), "status").stdout,
      LATEST_MIGRATION,
    );
  });
});

Deno.test("rollback reverts one migration at a time", async () => {
  await withDb(async (url, client) => {
    assertOk(await runDb(url, "migrate"), "migrate");

    // Undo the kv migration: sessions go back to their own table.
    assertOk(await runDb(url, "rollback", "--step", "1"), "rollback kv");
    let tables = await tableNames(client);
    assert(tables.includes("dpop_sessions"), "dpop_sessions was not restored");
    assertEquals(tables.includes("kv"), false);

    // Undo the initial migration: nothing of ours is left.
    assertOk(await runDb(url, "rollback", "--step", "1"), "rollback initial");
    tables = await tableNames(client);
    for (const table of ["users", "games", "achievements", "dpop_sessions"]) {
      assertEquals(tables.includes(table), false, `${table} survived rollback`);
    }
  });
});

Deno.test("schema accepts a full unlock round trip", async () => {
  await migratedDb(async (client) => {
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
  await migratedDb(async (client) => {
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
