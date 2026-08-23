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

const LATEST_MIGRATION = "20260821000000";

Deno.test("migrate creates every table the design declares", async () => {
  await migratedDb(async (client) => {
    const tables = await tableNames(client);
    for (
      const table of [
        "users",
        "games",
        "achievements",
        "user_achievements",
        "game_registrations",
        "kv",
      ]
    ) {
      assert(tables.includes(table), `missing table: ${table}`);
    }
    // Sessions moved into the generic kv store.
    assertEquals(tables.includes("dpop_sessions"), false);
    // The registry authenticates nobody, so there is nothing to store.
    assertEquals(tables.includes("api_tokens"), false);

    // Dropping an achievement from a manifest retires it rather than deleting
    // it, so the column has to be there.
    const columns = await client.execute("pragma table_info(achievements)");
    assert(
      columns.rows.some((row) => String(row.name) === "retired"),
      "achievements.retired is missing",
    );
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

    // Undo authors: the approval queue and handles go.
    assertOk(await runDb(url, "rollback", "--step", "1"), "rollback authors");
    assertEquals(
      (await tableNames(client)).includes("game_registrations"),
      false,
    );
    const columns = await client.execute("pragma table_info(users)");
    assertEquals(
      columns.rows.some((row) => String(row.name) === "handle"),
      false,
      "users.handle survived rollback",
    );

    // Undo URL ownership: games belong to accounts again, and tokens return.
    assertOk(await runDb(url, "rollback", "--step", "1"), "rollback ownership");
    assert((await tableNames(client)).includes("api_tokens"));

    // Undo the retired column: the table is rebuilt without it.
    assertOk(await runDb(url, "rollback", "--step", "1"), "rollback retired");
    const achievementColumns = await client.execute(
      "pragma table_info(achievements)",
    );
    assertEquals(
      achievementColumns.rows.some((row) => String(row.name) === "retired"),
      false,
      "achievements.retired survived rollback",
    );

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

Deno.test("every game has an author, and a handle belongs to one player", async () => {
  await migratedDb(async (client) => {
    await client.execute(
      "insert into users (external_id, display_name, handle) values ('u', 'u', 'kuboon')",
    );
    await client.execute(
      "insert into users (external_id, display_name) values ('v', 'v')",
    );

    // A game with no author cannot be attributed to anyone.
    await assertRejects(() =>
      client.execute(
        `insert into games (id, title, url) values ('orphan', 't', 'https://example.com/')`,
      )
    );

    // Handles are one per player.
    await assertRejects(() =>
      client.execute(
        "update users set handle = 'kuboon' where external_id = 'v'",
      )
    );

    // The author and the writing URL live side by side now.
    await client.execute({
      sql: `insert into games (id, owner_id, manifest_url, title, url)
            values ('g', 1, ?, 't', 'https://example.com/')`,
      args: ["https://example.com/gamecenter.json"],
    });
    const stored = await client.execute(
      "select owner_id, manifest_url from games",
    );
    assertEquals(Number(stored.rows[0].owner_id), 1);
    assertEquals(
      String(stored.rows[0].manifest_url),
      "https://example.com/gamecenter.json",
    );
  });
});

Deno.test("a pending registration holds no slug", async () => {
  await migratedDb(async (client) => {
    await client.execute(
      "insert into users (external_id, display_name, handle) values ('u', 'u', 'kuboon')",
    );
    const submit = (url: string) =>
      client.execute({
        sql: `insert into game_registrations
                (game_id, manifest_url, game_url, author_id, manifest)
              values ('my-puzzle', ?, 'https://example.com/', 1, '{}')`,
        args: [url],
      });

    // Two submissions may claim the same id: neither has taken it.
    await submit("https://a.example.com/gamecenter.json");
    await submit("https://b.example.com/gamecenter.json");
    const waiting = await client.execute(
      "select count(*) as n from game_registrations",
    );
    assertEquals(Number(waiting.rows[0].n), 2);

    // The same URL twice is one row, not two.
    await assertRejects(() => submit("https://a.example.com/gamecenter.json"));
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
