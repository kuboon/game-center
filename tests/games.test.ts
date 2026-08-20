/**
 * `registerGame` against a real migrated database.
 *
 * The behaviour under test is what the GitHub Action depends on: registering
 * twice changes nothing, the slug belongs to whoever took it first, and an
 * achievement dropped from the manifest stops being offered without taking
 * anyone's unlock with it.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";

import type { GameManifest } from "@game-center/protocol";
import {
  GameOwnershipError,
  listAchievements,
  listGames,
  listGamesOwnedBy,
  registerGame,
} from "../server/db/games.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

const manifest = (
  overrides: Partial<GameManifest> = {},
): GameManifest => ({
  id: "my-puzzle",
  title: "My Puzzle",
  description: "3分で遊べるパズル",
  url: "https://example.github.io/my-puzzle/",
  achievements: [
    {
      key: "first_clear",
      title: "はじめてのクリア",
      points: 10,
      hidden: false,
    },
    { key: "no_hints", title: "ノーヒント", points: 30, hidden: true },
  ],
  ...overrides,
});

const owner = (client: Client, externalId = "idp-owner") =>
  upsertUser(client, externalId, externalId);

Deno.test("claims the slug on first registration", async () => {
  await migratedDb(async (client) => {
    const user = await owner(client);
    const result = await registerGame(client, user.id, manifest());

    assertEquals(result.created, true);
    assertEquals(result.game.id, "my-puzzle");
    assertEquals(result.game.ownerId, user.id);
    assertEquals(result.retired, []);
    assertEquals((await listAchievements(client, "my-puzzle")).length, 2);
  });
});

Deno.test("registering the same manifest twice changes nothing", async () => {
  await migratedDb(async (client) => {
    const user = await owner(client);
    await registerGame(client, user.id, manifest());
    const again = await registerGame(client, user.id, manifest());

    assertEquals(again.created, false);
    assertEquals(again.retired, []);

    const achievements = await listAchievements(client, "my-puzzle");
    assertEquals(achievements.map((a) => a.key), ["first_clear", "no_hints"]);
    assertEquals((await listGames(client)).length, 1);
  });
});

Deno.test("updates the fields a later manifest changes", async () => {
  await migratedDb(async (client) => {
    const user = await owner(client);
    await registerGame(client, user.id, manifest());
    const updated = await registerGame(
      client,
      user.id,
      manifest({
        title: "My Puzzle 2",
        achievements: [
          {
            key: "first_clear",
            title: "初クリア",
            points: 20,
            hidden: false,
          },
          { key: "no_hints", title: "ノーヒント", points: 30, hidden: true },
        ],
      }),
    );

    assertEquals(updated.game.title, "My Puzzle 2");
    const [first] = await listAchievements(client, "my-puzzle");
    assertEquals(first.title, "初クリア");
    assertEquals(first.points, 20);
  });
});

Deno.test("keeps an achievement dropped from the manifest, but stops offering it", async () => {
  await migratedDb(async (client) => {
    const user = await owner(client);
    await registerGame(client, user.id, manifest());

    // Someone already unlocked what is about to disappear.
    const [, second] = await listAchievements(client, "my-puzzle");
    await client.execute({
      sql:
        "insert into user_achievements (user_id, achievement_id, via) values (?, ?, 'rest')",
      args: [user.id, second.id],
    });

    const result = await registerGame(
      client,
      user.id,
      manifest({
        achievements: [
          {
            key: "first_clear",
            title: "はじめてのクリア",
            points: 10,
            hidden: false,
          },
        ],
      }),
    );

    assertEquals(result.retired, ["no_hints"]);
    assertEquals(
      (await listAchievements(client, "my-puzzle")).map((a) => a.key),
      ["first_clear"],
    );
    assertEquals(
      (await listAchievements(client, "my-puzzle", { includeRetired: true }))
        .length,
      2,
    );

    const unlocked = await client.execute(
      "select count(*) as n from user_achievements",
    );
    assertEquals(Number(unlocked.rows[0].n), 1);
  });
});

Deno.test("un-retires an achievement the manifest brings back", async () => {
  await migratedDb(async (client) => {
    const user = await owner(client);
    await registerGame(client, user.id, manifest());
    await registerGame(client, user.id, manifest({ achievements: [] }));
    const back = await registerGame(client, user.id, manifest());

    assertEquals(back.retired, []);
    assertEquals((await listAchievements(client, "my-puzzle")).length, 2);
  });
});

Deno.test("refuses a slug someone else claimed", async () => {
  await migratedDb(async (client) => {
    const first = await owner(client, "idp-owner");
    const second = await owner(client, "idp-intruder");
    await registerGame(client, first.id, manifest());

    await assertRejects(
      () => registerGame(client, second.id, manifest({ title: "Mine now" })),
      GameOwnershipError,
    );

    const stored = await listGamesOwnedBy(client, first.id);
    assertEquals(stored.length, 1);
    assertEquals(stored[0].title, "My Puzzle");
    assertEquals((await listGamesOwnedBy(client, second.id)).length, 0);
  });
});

Deno.test("orders achievements the way the manifest does", async () => {
  await migratedDb(async (client) => {
    const user = await owner(client);
    await registerGame(client, user.id, manifest());
    await registerGame(
      client,
      user.id,
      manifest({
        achievements: [
          { key: "no_hints", title: "ノーヒント", points: 30, hidden: true },
          {
            key: "first_clear",
            title: "はじめてのクリア",
            points: 10,
            hidden: false,
          },
        ],
      }),
    );

    const achievements = await listAchievements(client, "my-puzzle");
    assertEquals(achievements.map((a) => a.key), ["no_hints", "first_clear"]);
    assert(achievements[0].hidden);
  });
});
