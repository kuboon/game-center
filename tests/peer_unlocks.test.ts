/**
 * Comparing records with the people you follow, against a real database.
 *
 * The ordering is the interesting part — it decides what "並んで表示" actually
 * shows — and so is who is allowed to appear at all. Nobody outside the
 * viewer's follows may turn up here; there is no game-wide leaderboard and
 * there will not be one.
 */

import { assertEquals } from "@std/assert";

import { follow } from "../server/db/follows.ts";
import {
  listUnlocksAmongFollowed,
  unlockAchievement,
} from "../server/db/unlocks.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

const GAME = "author/puzzle";

/** One game with two achievements, in manifest order. */
async function setUp(client: Client) {
  const author = await upsertUser(client, "author", "Author");
  await client.execute({
    sql: `insert into games (id, owner_id, slug, title, url, status)
          values (?, ?, 'puzzle', 'Puzzle', 'https://example.test/', 'active')`,
    args: [GAME, author.id],
  });
  await client.execute({
    sql: `insert into achievements (game_id, key, title, sort_order)
          values (?, 'first', 'First Clear', 0), (?, 'speed', 'Speed Run', 1)`,
    args: [GAME, GAME],
  });
  return author;
}

const rows = (unlocks: Awaited<ReturnType<typeof listUnlocksAmongFollowed>>) =>
  unlocks.map((u) => `${u.key}:${u.handle}:${u.score ?? "-"}`);

Deno.test("puts the viewer's own record in the comparison", async () => {
  await migratedDb(async (client) => {
    await setUp(client);
    const me = await upsertUser(client, "me", "Me");
    await unlockAchievement(client, me.id, GAME, "first", {
      via: "rest",
      score: 10,
    });

    // A comparison the viewer is not in is just a list of other people.
    assertEquals(rows(await listUnlocksAmongFollowed(client, me.id, GAME)), [
      "first:me:10",
    ]);
  });
});

Deno.test("shows the people you follow and nobody else", async () => {
  await migratedDb(async (client) => {
    await setUp(client);
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const stranger = await upsertUser(client, "stranger", "Stranger");

    await follow(client, me.id, alice.id);
    await unlockAchievement(client, alice.id, GAME, "first", {
      via: "rest",
      score: 20,
    });
    await unlockAchievement(client, stranger.id, GAME, "first", {
      via: "rest",
      score: 999,
    });

    // The stranger's 999 does not appear, however high it is. That is the
    // whole design: you see the records of people you chose.
    assertEquals(rows(await listUnlocksAmongFollowed(client, me.id, GAME)), [
      "first:alice:20",
    ]);
  });
});

Deno.test("orders by the manifest, then by score, then by who was first", async () => {
  await migratedDb(async (client) => {
    await setUp(client);
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const bob = await upsertUser(client, "bob", "Bob");
    await follow(client, me.id, alice.id);
    await follow(client, me.id, bob.id);

    // 'speed' is second in the manifest, so it comes second however it scores.
    await unlockAchievement(client, alice.id, GAME, "speed", {
      via: "rest",
      score: 5000,
    });
    await unlockAchievement(client, me.id, GAME, "first", {
      via: "rest",
      score: 10,
    });
    await unlockAchievement(client, alice.id, GAME, "first", {
      via: "rest",
      score: 30,
    });
    await unlockAchievement(client, bob.id, GAME, "first", {
      via: "rest",
      score: 20,
    });

    assertEquals(rows(await listUnlocksAmongFollowed(client, me.id, GAME)), [
      "first:alice:30",
      "first:bob:20",
      "first:me:10",
      "speed:alice:5000",
    ]);
  });
});

Deno.test("sorts an unscored unlock behind every scored one", async () => {
  await migratedDb(async (client) => {
    await setUp(client);
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await follow(client, me.id, alice.id);

    // Not every achievement carries a score, and a missing one is not a zero.
    await unlockAchievement(client, alice.id, GAME, "first", { via: "claim" });
    await unlockAchievement(client, me.id, GAME, "first", {
      via: "rest",
      score: 1,
    });

    assertEquals(rows(await listUnlocksAmongFollowed(client, me.id, GAME)), [
      "first:me:1",
      "first:alice:-",
    ]);
  });
});

Deno.test("marks which row is the viewer's own", async () => {
  await migratedDb(async (client) => {
    await setUp(client);
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await follow(client, me.id, alice.id);
    await unlockAchievement(client, me.id, GAME, "first", { via: "rest" });
    await unlockAchievement(client, alice.id, GAME, "first", { via: "rest" });

    const unlocks = await listUnlocksAmongFollowed(client, me.id, GAME);
    assertEquals(
      unlocks.map((u) => [u.handle, u.self]),
      [["me", true], ["alice", false]],
    );
  });
});

Deno.test("carries hidden so a secret title is not handed out", async () => {
  await migratedDb(async (client) => {
    await setUp(client);
    await client.execute({
      sql: `insert into achievements (game_id, key, title, hidden, sort_order)
            values (?, 'secret', 'Secret Ending', 1, 2)`,
      args: [GAME],
    });
    const me = await upsertUser(client, "me", "Me");
    await unlockAchievement(client, me.id, GAME, "secret", { via: "claim" });

    const [unlock] = await listUnlocksAmongFollowed(client, me.id, GAME);
    assertEquals(unlock.hidden, true);
  });
});

Deno.test("says nothing about a game nobody you follow has touched", async () => {
  await migratedDb(async (client) => {
    await setUp(client);
    const me = await upsertUser(client, "me", "Me");
    assertEquals(await listUnlocksAmongFollowed(client, me.id, GAME), []);
  });
});
