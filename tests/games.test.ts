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
  countUnlocksForGame,
  findGame,
  GameOwnershipError,
  listAchievements,
  listGames,
  listGamesOwnedBy,
  registerGame,
  restoreGame,
  retireGame,
} from "../server/db/games.ts";
import {
  listUnlocks,
  UnknownAchievementError,
  unlockAchievement,
} from "../server/db/unlocks.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

const GAME_URL = "https://example.github.io/my-puzzle/";
const MANIFEST_URL = "https://example.github.io/my-puzzle/gamecenter.json";

const manifest = (overrides: Partial<GameManifest> = {}): GameManifest => ({
  id: "my-puzzle",
  author: "kuboon",
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

const owner = (client: Client, externalId = "idp-owner") =>
  upsertUser(client, externalId, externalId);

/** An author with the handle every manifest here names. */
async function author(client: Client, handle = "kuboon") {
  // The handle is the IdP id, so naming the account names the handle.
  const user = await owner(client, handle);
  return { ...user, handle: handle };
}

/** The usual registration: the author's game, fetched from its own URL. */
async function fromUrl(client: Client, m: GameManifest = manifest()) {
  const kuboon = await author(client);
  return await registerGame(
    client,
    {
      ownerId: kuboon.id,
      authorHandle: kuboon.handle,
      manifestUrl: MANIFEST_URL,
    },
    m,
    GAME_URL,
  );
}

Deno.test("names a game by its author and its slug", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const result = await fromUrl(client);

    assertEquals(result.created, true);
    // The slug only has to be free among this author's games.
    assertEquals(result.game.id, "kuboon/my-puzzle");
    assertEquals(result.game.slug, "my-puzzle");
    assertEquals(result.game.manifestUrl, MANIFEST_URL);
    assertEquals(result.game.ownerId, kuboon.id);
    assertEquals(result.game.url, GAME_URL);
    assertEquals(result.retired, []);
    assertEquals(
      (await listAchievements(client, "kuboon/my-puzzle")).length,
      2,
    );
  });
});

Deno.test("records a pasted game against the account that pasted it", async () => {
  await migratedDb(async (client) => {
    const user = await author(client);
    const result = await registerGame(
      client,
      { ownerId: user.id, authorHandle: user.handle },
      manifest(),
      GAME_URL,
    );

    assertEquals(result.game.ownerId, user.id);
    assertEquals(result.game.manifestUrl, null);
    assertEquals((await listGamesOwnedBy(client, user.id)).length, 1);
  });
});

Deno.test("two authors can give their games the same slug", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const other = await author(client, "someone-else");

    await fromUrl(client);
    const theirs = await registerGame(
      client,
      {
        ownerId: other.id,
        authorHandle: other.handle!,
        manifestUrl: "https://someone-else.example.com/",
      },
      manifest({ author: "someone-else", title: "Their Puzzle" }),
      "https://someone-else.example.com/",
    );

    // Nobody had to check whether the name was free.
    assertEquals(theirs.created, true);
    assertEquals(theirs.game.id, "someone-else/my-puzzle");
    assertEquals((await listGames(client)).length, 2);
    assertEquals((await listGamesOwnedBy(client, kuboon.id)).length, 1);
  });
});

Deno.test("registering the same manifest twice changes nothing", async () => {
  await migratedDb(async (client) => {
    await fromUrl(client);
    const again = await fromUrl(client);

    assertEquals(again.created, false);
    assertEquals(again.retired, []);
    assertEquals(
      (await listAchievements(client, "kuboon/my-puzzle")).map((a) => a.key),
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
    const [first] = await listAchievements(client, "kuboon/my-puzzle");
    assertEquals(first.title, "初クリア");
    assertEquals(first.points, 20);
  });
});

Deno.test("keeps an achievement dropped from the manifest, but stops offering it", async () => {
  await migratedDb(async (client) => {
    await fromUrl(client);
    const player = await owner(client, "idp-player");

    // Someone already unlocked what is about to disappear.
    const [, second] = await listAchievements(client, "kuboon/my-puzzle");
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
      (await listAchievements(client, "kuboon/my-puzzle")).map((a) => a.key),
      ["first_clear"],
    );
    assertEquals(
      (await listAchievements(client, "kuboon/my-puzzle", {
        includeRetired: true,
      }))
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
    assertEquals(
      (await listAchievements(client, "kuboon/my-puzzle")).length,
      2,
    );
  });
});

Deno.test("refuses one of an author's own slugs served from another URL", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    await fromUrl(client);

    await assertRejects(
      () =>
        registerGame(
          client,
          {
            ownerId: kuboon.id,
            authorHandle: kuboon.handle,
            manifestUrl: "https://elsewhere.example.com/gamecenter.json",
          },
          manifest({ title: "Mine now" }),
          "https://elsewhere.example.com/",
        ),
      GameOwnershipError,
    );

    const [stored] = await listGames(client);
    assertEquals(stored.title, "My Puzzle");
    assertEquals(stored.manifestUrl, MANIFEST_URL);
  });
});

Deno.test("a game served from a URL is only ever updated from that URL", async () => {
  await migratedDb(async (client) => {
    const user = await author(client);
    const pasted = { ownerId: user.id, authorHandle: user.handle };

    // Even its own author cannot overwrite it by pasting: that would let a
    // hand-written manifest quietly replace what the URL is serving.
    await fromUrl(client);
    await assertRejects(
      () => registerGame(client, pasted, manifest(), GAME_URL),
      GameOwnershipError,
    );

    // A pasted game likewise does not start accepting writes from a URL.
    await registerGame(
      client,
      pasted,
      manifest({ id: "other-game" }),
      GAME_URL,
    );
    await assertRejects(
      () =>
        registerGame(
          client,
          {
            ...pasted,
            manifestUrl: "https://example.github.io/other/gamecenter.json",
          },
          manifest({ id: "other-game" }),
          "https://example.github.io/other/",
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

    const achievements = await listAchievements(client, "kuboon/my-puzzle");
    assertEquals(achievements.map((a) => a.key), ["no_hints", "first_clear"]);
    assert(achievements[0].hidden);
  });
});

Deno.test("deletes a game nobody has played", async () => {
  await migratedDb(async (client) => {
    const author = await upsertUser(client, "idp-kuboon", "kuboon");
    await registerGame(
      client,
      { ownerId: author.id, authorHandle: "kuboon", manifestUrl: MANIFEST_URL },
      manifest(),
      GAME_URL,
    );

    assertEquals(await retireGame(client, "kuboon/my-puzzle"), "deleted");
    assertEquals(await findGame(client, "kuboon/my-puzzle"), null);
    assertEquals(await listAchievements(client, "kuboon/my-puzzle"), []);

    // The slug goes back to its author, which is the point: the usual reason
    // to remove a game is having registered the wrong URL.
    const again = await registerGame(
      client,
      { ownerId: author.id, authorHandle: "kuboon", manifestUrl: MANIFEST_URL },
      manifest(),
      GAME_URL,
    );
    assertEquals(again.created, true);
  });
});

Deno.test("withdraws a game somebody has played, keeping their record", async () => {
  await migratedDb(async (client) => {
    const author = await upsertUser(client, "idp-kuboon", "kuboon");
    const player = await upsertUser(client, "idp-player", "player");
    await registerGame(
      client,
      { ownerId: author.id, authorHandle: "kuboon", manifestUrl: MANIFEST_URL },
      manifest(),
      GAME_URL,
    );
    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      { via: "rest" },
    );

    assertEquals(await retireGame(client, "kuboon/my-puzzle"), "withdrawn");

    // The author removed their game; they did not edit anyone's profile.
    const unlocks = await listUnlocks(client, player.id);
    assertEquals(unlocks.map((unlock) => unlock.key), ["first_clear"]);
    assertEquals(
      (await listAchievements(client, "kuboon/my-puzzle")).length,
      2,
    );

    const game = await findGame(client, "kuboon/my-puzzle");
    assertEquals(game?.status, "hidden");
    // Gone from the catalog, but still reachable by the links already handed
    // out — the records point at it.
    assertEquals(await listGames(client), []);
  });
});

Deno.test("a withdrawn game takes no more unlocks", async () => {
  await migratedDb(async (client) => {
    const author = await upsertUser(client, "idp-kuboon", "kuboon");
    const player = await upsertUser(client, "idp-player", "player");
    await registerGame(
      client,
      { ownerId: author.id, authorHandle: "kuboon", manifestUrl: MANIFEST_URL },
      manifest(),
      GAME_URL,
    );
    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      { via: "rest" },
    );
    await retireGame(client, "kuboon/my-puzzle");

    await assertRejects(
      () =>
        unlockAchievement(client, player.id, "kuboon/my-puzzle", "no_hints", {
          via: "rest",
        }),
      UnknownAchievementError,
    );
  });
});

Deno.test("restoring puts a withdrawn game back", async () => {
  await migratedDb(async (client) => {
    const author = await upsertUser(client, "idp-kuboon", "kuboon");
    const player = await upsertUser(client, "idp-player", "player");
    await registerGame(
      client,
      { ownerId: author.id, authorHandle: "kuboon", manifestUrl: MANIFEST_URL },
      manifest(),
      GAME_URL,
    );
    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      { via: "rest" },
    );
    await retireGame(client, "kuboon/my-puzzle");
    await restoreGame(client, "kuboon/my-puzzle");

    assertEquals((await listGames(client)).map((game) => game.id), [
      "kuboon/my-puzzle",
    ]);
    const result = await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "no_hints",
      { via: "rest" },
    );
    assertEquals(result.created, true);
  });
});

Deno.test("counts what removing a game would be weighed against", async () => {
  await migratedDb(async (client) => {
    const author = await upsertUser(client, "idp-kuboon", "kuboon");
    const player = await upsertUser(client, "idp-player", "player");
    await registerGame(
      client,
      { ownerId: author.id, authorHandle: "kuboon", manifestUrl: MANIFEST_URL },
      manifest(),
      GAME_URL,
    );
    assertEquals(await countUnlocksForGame(client, "kuboon/my-puzzle"), 0);

    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      { via: "rest" },
    );
    assertEquals(await countUnlocksForGame(client, "kuboon/my-puzzle"), 1);
  });
});

Deno.test("a withdrawn game keeps its manifest updates, and its withdrawal", async () => {
  await migratedDb(async (client) => {
    const author = await upsertUser(client, "idp-kuboon", "kuboon");
    const player = await upsertUser(client, "idp-player", "player");
    const registrant = {
      ownerId: author.id,
      authorHandle: "kuboon",
      manifestUrl: MANIFEST_URL,
    };
    await registerGame(client, registrant, manifest(), GAME_URL);
    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      { via: "rest" },
    );
    await retireGame(client, "kuboon/my-puzzle");

    // CI keeps pushing. Registering again must not undo the author's decision
    // from the dashboard — coming back is a thing they do on purpose.
    await registerGame(
      client,
      registrant,
      manifest({ title: "My Puzzle 2" }),
      GAME_URL,
    );

    const game = await findGame(client, "kuboon/my-puzzle");
    assertEquals(game?.title, "My Puzzle 2");
    assertEquals(game?.status, "hidden");
  });
});
