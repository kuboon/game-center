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

/**
 * The first migration, which every later one sits on top of.
 *
 * Named rather than counted: `rollback --to` reverts back through a migration
 * inclusive, so this unwinds the whole schema however many migrations exist by
 * then. A `--step` count would have to be edited every time one is added, and
 * would quietly stop testing what it claims to when somebody forgot.
 */
const FIRST_MIGRATION = "20260824000000_initial";

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
        "follows",
        "kv",
      ]
    ) {
      assert(tables.includes(table), `missing table: ${table}`);
    }
    // Sessions live in the generic kv store, not a table of their own.
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

Deno.test("seeding is safe to repeat, and reset rebuilds from nothing", async () => {
  await withDb(async (url, client) => {
    assertOk(await runDb(url, "migrate"), "migrate");
    assertOk(await runDb(url, "seed"), "seed");
    assertOk(await runDb(url, "seed"), "second seed");

    // Every insert ignores a row that is already there, so a second run
    // neither duplicates nor fails.
    const games = await client.execute("select count(*) as n from games");
    assertEquals(Number(games.rows[0].n), 1);

    // wipe + migrate + seed, in one command.
    assertOk(await runDb(url, "reset", "--force"), "reset");
    assert((await tableNames(client)).includes("games"));
    const after = await client.execute("select count(*) as n from games");
    assertEquals(Number(after.rows[0].n), 1);
  });
});

Deno.test("migrate is a no-op once applied", async () => {
  await withDb(async (url) => {
    assertOk(await runDb(url, "migrate"), "migrate");
    assertOk(await runDb(url, "migrate"), "second migrate");

    // Asserted as "nothing is outstanding" rather than by naming a migration:
    // that is what idempotent means here, and it keeps saying so as
    // migrations are added.
    const status = assertOk(await runDb(url, "status"), "status").stdout;
    assertStringIncludes(status, "applied");
    for (const outstanding of ["pending", "drifted", "missing"]) {
      assertEquals(
        status.includes(outstanding),
        false,
        `status reported ${outstanding}:\n${status}`,
      );
    }
  });
});

Deno.test("rollback takes the schema back to nothing, and forward again", async () => {
  await withDb(async (url, client) => {
    assertOk(await runDb(url, "migrate"), "migrate");
    assert((await tableNames(client)).includes("games"));

    assertOk(
      await runDb(url, "rollback", "--to", FIRST_MIGRATION),
      "rollback",
    );
    const bare = await tableNames(client);
    for (
      const table of [
        "users",
        "games",
        "achievements",
        "user_achievements",
        "game_registrations",
        "follows",
        "kv",
      ]
    ) {
      assertEquals(bare.includes(table), false, `${table} survived rollback`);
    }

    assertOk(await runDb(url, "migrate"), "migrate again");
    assert((await tableNames(client)).includes("games"));
  });
});

Deno.test("a slug is unique per author, not globally", async () => {
  await migratedDb(async (client) => {
    await client.execute(
      "insert into users (external_id, display_name, handle) values ('u', 'u', 'kuboon')",
    );
    await client.execute(
      "insert into users (external_id, display_name, handle) values ('v', 'v', 'someone-else')",
    );

    const game = (id: string, ownerId: number, slug: string) =>
      client.execute({
        sql: `insert into games (id, owner_id, slug, title, url)
              values (?, ?, ?, 't', 'https://example.com/')`,
        args: [id, ownerId, slug],
      });

    // Two authors, one slug, no argument.
    await game("kuboon/tetris", 1, "tetris");
    await game("someone-else/tetris", 2, "tetris");

    // One author cannot use a slug twice.
    await assertRejects(() => game("kuboon/tetris-2", 1, "tetris"));

    // A game with no author cannot be attributed to anyone.
    await assertRejects(() =>
      client.execute(
        `insert into games (id, slug, title, url) values ('orphan', 'orphan', 't', 'https://example.com/')`,
      )
    );

    // Handles are one per player.
    await assertRejects(() =>
      client.execute(
        "update users set handle = 'kuboon' where external_id = 'v'",
      )
    );
  });
});

Deno.test("a pending registration reserves nothing", async () => {
  await migratedDb(async (client) => {
    await client.execute(
      "insert into users (external_id, display_name, handle) values ('u', 'u', 'kuboon')",
    );
    const submit = (url: string) =>
      client.execute({
        sql: `insert into game_registrations
                (slug, manifest_url, game_url, author_id, manifest)
              values ('my-puzzle', ?, 'https://example.com/', 1, '{}')`,
        args: [url],
      });

    // Two submissions may ask for the same slug: neither has taken it.
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
      sql:
        "insert into games (id, owner_id, slug, title, url) values (?, 1, ?, ?, ?)",
      args: [
        "kuboon/my-puzzle",
        "my-puzzle",
        "My Puzzle",
        "https://example.github.io/my-puzzle/",
      ],
    });
    await client.execute({
      sql:
        "insert into achievements (game_id, key, title, points) values (?, ?, ?, ?)",
      args: ["kuboon/my-puzzle", "first_clear", "はじめてのクリア", 10],
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
      "insert into games (id, owner_id, slug, title, url) values ('u/g', 1, 'g', 'g', 'https://example.com/')",
    );
    const achievement =
      "insert into achievements (game_id, key, title) values ('u/g', 'k', 'k')";
    await client.execute(achievement);

    // One achievement key per game.
    await assertRejects(() => client.execute(achievement));

    // Foreign keys are on: libSQL enables them, unlike stock SQLite.
    await assertRejects(() =>
      client.execute(
        "insert into games (id, owner_id, slug, title, url) values ('x/x', 999, 'x', 'x', 'https://example.com/')",
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
