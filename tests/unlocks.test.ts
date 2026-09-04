/**
 * Unlocking against a real migrated database.
 *
 * A game may report the same achievement on every load, so what matters most
 * here is that the second report is harmless: no duplicate row, no moved
 * timestamp, and a score that only ever goes up.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";

import type { GameManifest } from "@game-center/protocol";
import { registerGame } from "../server/db/games.ts";
import {
  listUnlocks,
  listUnlocksForGame,
  totalPoints,
  UnknownAchievementError,
  unlockAchievement,
  unlockMany,
} from "../server/db/unlocks.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

const GAME_URL = "https://example.github.io/my-puzzle/";
const MANIFEST_URL = "https://example.github.io/my-puzzle/gamecenter.json";

const manifest: GameManifest = {
  id: "my-puzzle",
  author: "kuboon",
  title: "My Puzzle",
  achievements: [
    {
      key: "first_clear",
      title: "はじめてのクリア",
      points: 10,
      hidden: false,
    },
    { key: "high_score", title: "ハイスコア", points: 30, hidden: false },
  ],
};

/** A player and one registered game, the starting point for every test here. */
async function playable(client: Client) {
  const player = await upsertUser(client, "idp-player", "player");
  await register(client, manifest);
  return player;
}

async function register(client: Client, m: GameManifest) {
  const author = await upsertUser(client, "kuboon", "author");
  return await registerGame(
    client,
    {
      ownerId: author.id,
      authorHandle: "kuboon",
      manifestUrl: MANIFEST_URL,
    },
    m,
    GAME_URL,
  );
}

Deno.test("records an unlock the first time", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    const result = await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      { via: "rest" },
    );

    assertEquals(result.created, true);
    assertEquals(result.scoreImproved, false);
    assertEquals(result.unlock.title, "はじめてのクリア");
    assertEquals(result.unlock.gameTitle, "My Puzzle");
    assertEquals(result.unlock.score, null);
    assertEquals(result.unlock.via, "rest");
  });
});

Deno.test("reporting the same unlock again changes nothing", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    const first = await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      { via: "claim" },
    );
    const again = await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      { via: "rest" },
    );

    assertEquals(again.created, false);
    // The first unlock is the one that happened; a later report does not
    // rewrite when or how.
    assertEquals(again.unlock.unlockedAt, first.unlock.unlockedAt);
    assertEquals(again.unlock.via, "claim");
    assertEquals((await listUnlocks(client, player.id)).length, 1);
  });
});

Deno.test("keeps the highest score ever reported", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    const unlock = (score?: number) =>
      unlockAchievement(client, player.id, "kuboon/my-puzzle", "high_score", {
        via: "rest",
        score,
      });

    assertEquals((await unlock(1200)).unlock.score, 1200);

    const better = await unlock(1800);
    assertEquals(better.scoreImproved, true);
    assertEquals(better.unlock.score, 1800);

    const worse = await unlock(900);
    assertEquals(worse.scoreImproved, false);
    assertEquals(worse.unlock.score, 1800);

    // A report with no score at all leaves the record alone.
    assertEquals((await unlock()).unlock.score, 1800);
  });
});

Deno.test("takes the first score even when the unlock came without one", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    const unlock = (score?: number) =>
      unlockAchievement(client, player.id, "kuboon/my-puzzle", "high_score", {
        via: "rest",
        score,
      });

    assertEquals((await unlock()).unlock.score, null);
    const scored = await unlock(500);
    assertEquals(scored.scoreImproved, true);
    assertEquals(scored.unlock.score, 500);
  });
});

Deno.test("refuses an achievement the game never declared", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    await assertRejects(
      () =>
        unlockAchievement(client, player.id, "kuboon/my-puzzle", "invented", {
          via: "rest",
        }),
      UnknownAchievementError,
    );
    await assertRejects(
      () =>
        unlockAchievement(client, player.id, "no-such-game", "first_clear", {
          via: "rest",
        }),
      UnknownAchievementError,
    );
  });
});

Deno.test("refuses an achievement the manifest retired", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    await register(client, {
      ...manifest,
      achievements: [manifest.achievements[0]],
    });

    await assertRejects(
      () =>
        unlockAchievement(client, player.id, "kuboon/my-puzzle", "high_score", {
          via: "rest",
        }),
      UnknownAchievementError,
    );
  });
});

Deno.test("keeps an unlock the manifest later retired", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "high_score",
      {
        via: "rest",
        score: 1200,
      },
    );

    await register(client, {
      ...manifest,
      achievements: [manifest.achievements[0]],
    });

    const unlocks = await listUnlocks(client, player.id);
    assertEquals(unlocks.length, 1);
    assertEquals(unlocks[0].key, "high_score");
    assertEquals(unlocks[0].score, 1200);
    assertEquals(await totalPoints(client, player.id), 30);
  });
});

Deno.test("adds up points across games, and keeps players apart", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    const other = await upsertUser(client, "idp-other", "other");

    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      {
        via: "rest",
      },
    );
    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "high_score",
      {
        via: "rest",
      },
    );
    await unlockAchievement(
      client,
      other.id,
      "kuboon/my-puzzle",
      "first_clear",
      {
        via: "claim",
      },
    );

    assertEquals(await totalPoints(client, player.id), 40);
    assertEquals(await totalPoints(client, other.id), 10);
    assertEquals(
      (await listUnlocksForGame(client, other.id, "kuboon/my-puzzle"))
        .length,
      1,
    );
    assertEquals(await totalPoints(client, 999), 0);
  });
});

Deno.test("lists one game's unlocks in manifest order", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "high_score",
      {
        via: "rest",
      },
    );
    await unlockAchievement(
      client,
      player.id,
      "kuboon/my-puzzle",
      "first_clear",
      {
        via: "rest",
      },
    );

    const unlocks = await listUnlocksForGame(
      client,
      player.id,
      "kuboon/my-puzzle",
    );
    assertEquals(unlocks.map((u) => u.key), ["first_clear", "high_score"]);
    assert(unlocks.every((u) => u.gameId === "kuboon/my-puzzle"));
  });
});

Deno.test("records a whole queue in one call", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    const results = await unlockMany(
      client,
      player.id,
      "kuboon/my-puzzle",
      [{ key: "first_clear" }, { key: "high_score", score: 1200 }],
      "claim",
    );

    assertEquals(results.map((r) => [r.key, r.ok]), [
      ["first_clear", true],
      ["high_score", true],
    ]);
    assertEquals((await listUnlocks(client, player.id)).length, 2);
    assertEquals(await totalPoints(client, player.id), 40);
  });
});

Deno.test("answers for an unknown key without losing the rest", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    // A game replaying a queue it kept while offline can be carrying an
    // achievement the manifest has since dropped. Refusing the batch would
    // cost the player the ones that are still real.
    const results = await unlockMany(
      client,
      player.id,
      "kuboon/my-puzzle",
      [{ key: "invented" }, { key: "first_clear" }],
      "claim",
    );

    assertEquals(results.map((r) => [r.key, r.ok]), [
      ["invented", false],
      ["first_clear", true],
    ]);
    assertEquals((await listUnlocks(client, player.id)).length, 1);
  });
});

Deno.test("folds a key repeated in one call, keeping the best score", async () => {
  await migratedDb(async (client) => {
    const player = await playable(client);
    // Two rows for one achievement would race each other into the unique
    // constraint, so the same key can only appear once by the time it is sent.
    const results = await unlockMany(
      client,
      player.id,
      "kuboon/my-puzzle",
      [
        { key: "high_score", score: 900 },
        { key: "high_score", score: 1200 },
      ],
      "claim",
    );

    assertEquals(results.length, 1);
    const unlocks = await listUnlocksForGame(
      client,
      player.id,
      "kuboon/my-puzzle",
    );
    assertEquals(unlocks.map((u) => [u.key, u.score]), [["high_score", 1200]]);
  });
});
