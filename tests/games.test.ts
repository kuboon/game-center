/**
 * `registerGame` against a real migrated database.
 *
 * The behaviour under test is what registration promises: re-registering
 * changes nothing, a slug belongs to the URL or the account that took it, and
 * an achievement dropped from the manifest stops being offered without taking
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

const GAME_URL = "https://example.github.io/my-puzzle/";
const MANIFEST_URL = "https://example.github.io/my-puzzle/gamecenter.json";

const manifest = (overrides: Partial<GameManifest> = {}): GameManifest => ({
  id: "my-puzzle",
  title: "My Puzzle",
  description: "3分で遊べるパズル",
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

/** The usual registration: fetched from the game's own URL. */
const fromUrl = (client: Client, m: GameManifest = manifest()) =>
  registerGame(client, { manifestUrl: MANIFEST_URL }, m, GAME_URL);

const owner = (client: Client, externalId = "idp-owner") =>
  upsertUser(client, externalId, externalId);

Deno.test("claims the slug for the URL it was fetched from", async () => {
  await migratedDb(async (client) => {
    const result = await fromUrl(client);

    assertEquals(result.created, true);
    assertEquals(result.game.id, "my-puzzle");
    assertEquals(result.game.manifestUrl, MANIFEST_URL);
    assertEquals(result.game.ownerId, null);
    assertEquals(result.game.url, GAME_URL);
    assertEquals(result.retired, []);
    assertEquals((await listAchievements(client, "my-puzzle")).length, 2);
  });
});

Deno.test("claims the slug for the account that pasted it", async () => {
  await migratedDb(async (client) => {
    const user = await owner(client);
    const result = await registerGame(
      client,
      { ownerId: user.id },
      manifest(),
      GAME_URL,
    );

    assertEquals(result.game.ownerId, user.id);
    assertEquals(result.game.manifestUrl, null);
    assertEquals((await listGamesOwnedBy(client, user.id)).length, 1);
  });
});

Deno.test("registering the same manifest twice changes nothing", async () => {
  await migratedDb(async (client) => {
    await fromUrl(client);
    const again = await fromUrl(client);

    assertEquals(again.created, false);
    assertEquals(again.retired, []);
    assertEquals(
      (await listAchievements(client, "my-puzzle")).map((a) => a.key),
      ["first_clear", "no_hints"],
    );
    assertEquals((await listGames(client)).length, 1);
  });
});

Deno.test("resolves a relative icon against the game's url", async () => {
  await migratedDb(async (client) => {
    const result = await fromUrl(client, manifest({ iconUrl: "icon.png" }));
    assertEquals(
      result.game.iconUrl,
      "https://example.github.io/my-puzzle/icon.png",
    );
  });
});

Deno.test("updates the fields a later manifest changes", async () => {
  await migratedDb(async (client) => {
    await fromUrl(client);
    const updated = await fromUrl(
      client,
      manifest({
        title: "My Puzzle 2",
        achievements: [
          { key: "first_clear", title: "初クリア", points: 20, hidden: false },
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
    const player = await owner(client, "idp-player");
    await fromUrl(client);

    // Someone already unlocked what is about to disappear.
    const [, second] = await listAchievements(client, "my-puzzle");
    await client.execute({
      sql:
        "insert into user_achievements (user_id, achievement_id, via) values (?, ?, 'rest')",
      args: [player.id, second.id],
    });

    const result = await fromUrl(
      client,
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
    await fromUrl(client);
    await fromUrl(client, manifest({ achievements: [] }));
    const back = await fromUrl(client);

    assertEquals(back.retired, []);
    assertEquals((await listAchievements(client, "my-puzzle")).length, 2);
  });
});

Deno.test("refuses a slug another URL is already serving", async () => {
  await migratedDb(async (client) => {
    await fromUrl(client);

    await assertRejects(
      () =>
        registerGame(
          client,
          { manifestUrl: "https://evil.example.com/gamecenter.json" },
          manifest({ title: "Mine now" }),
          "https://evil.example.com/",
        ),
      GameOwnershipError,
    );

    const [stored] = await listGames(client);
    assertEquals(stored.title, "My Puzzle");
    assertEquals(stored.manifestUrl, MANIFEST_URL);
  });
});

Deno.test("refuses a slug another account pasted", async () => {
  await migratedDb(async (client) => {
    const first = await owner(client, "idp-owner");
    const second = await owner(client, "idp-intruder");
    await registerGame(client, { ownerId: first.id }, manifest(), GAME_URL);

    await assertRejects(
      () =>
        registerGame(
          client,
          { ownerId: second.id },
          manifest({ title: "Mine now" }),
          GAME_URL,
        ),
      GameOwnershipError,
    );
    assertEquals((await listGamesOwnedBy(client, second.id)).length, 0);
  });
});

Deno.test("neither kind of ownership can take over the other", async () => {
  await migratedDb(async (client) => {
    const user = await owner(client);

    // A URL cannot take over what an account pasted...
    await registerGame(client, { ownerId: user.id }, manifest(), GAME_URL);
    await assertRejects(() => fromUrl(client), GameOwnershipError);

    // ...nor an account take over what a URL is serving.
    await registerGame(
      client,
      { manifestUrl: "https://example.github.io/other/gamecenter.json" },
      manifest({ id: "other-game" }),
      "https://example.github.io/other/",
    );
    await assertRejects(
      () =>
        registerGame(
          client,
          { ownerId: user.id },
          manifest({ id: "other-game" }),
          GAME_URL,
        ),
      GameOwnershipError,
    );
  });
});

Deno.test("orders achievements the way the manifest does", async () => {
  await migratedDb(async (client) => {
    await fromUrl(client);
    await fromUrl(
      client,
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
