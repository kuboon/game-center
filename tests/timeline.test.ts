/**
 * The `/me` timeline, against a real migrated database.
 *
 * Three things decide whether this feed is the right one: who is allowed to
 * appear in it (only people the viewer follows, and not the viewer), what the
 * two kinds of event look like side by side, and whether a hidden achievement
 * keeps its secret on the way out. The last one matters most — the response
 * leaves the server, so masking in the browser would be masking too late.
 */

import { assertEquals } from "@std/assert";

import { follow } from "../server/db/follows.ts";
import { listFollowedTimeline } from "../server/db/timeline.ts";
import { unlockAchievement } from "../server/db/unlocks.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

const GAME = "author/puzzle";

/** One game with a plain achievement and a hidden one. */
async function setUpGame(client: Client, ownerId: number, at: string) {
  await client.execute({
    sql: `insert into games (id, owner_id, slug, title, url, status, created_at)
          values (?, ?, 'puzzle', 'Puzzle', 'https://example.test/', 'active', ?)`,
    args: [GAME, ownerId, at],
  });
  await client.execute({
    sql:
      `insert into achievements (game_id, key, title, points, hidden, sort_order)
          values (?, 'first', 'First Clear', 10, 0, 0),
                 (?, 'secret', 'The True Ending', 50, 1, 1)`,
    args: [GAME, GAME],
  });
}

/** `kind:handle:title` — enough to see who did what, in order. */
const rows = (events: Awaited<ReturnType<typeof listFollowedTimeline>>) =>
  events.map((e) =>
    `${e.kind}:${e.handle}:${e.achievementTitle ?? e.gameTitle}`
  );

Deno.test("carries both kinds of event, newest first", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await follow(client, me.id, alice.id);

    await setUpGame(client, alice.id, "2026-01-01T00:00:00Z");
    await unlockAchievement(client, alice.id, GAME, "first", { via: "rest" });

    // The unlock happened after the registration, so it comes first.
    assertEquals(rows(await listFollowedTimeline(client, me.id, 40)), [
      "unlock:alice:First Clear",
      "game:alice:Puzzle",
    ]);
  });
});

Deno.test("shows the people you follow and nobody else", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const stranger = await upsertUser(client, "stranger", "Stranger");
    await follow(client, me.id, alice.id);

    await setUpGame(client, alice.id, "2026-01-01T00:00:00Z");
    await unlockAchievement(client, stranger.id, GAME, "first", {
      via: "rest",
    });

    // A stranger's unlock in a followed author's game is still a stranger's.
    assertEquals(rows(await listFollowedTimeline(client, me.id, 40)), [
      "game:alice:Puzzle",
    ]);
  });
});

Deno.test("leaves the viewer's own doings out of it", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await follow(client, me.id, alice.id);

    await setUpGame(client, alice.id, "2026-01-01T00:00:00Z");
    await unlockAchievement(client, me.id, GAME, "first", { via: "rest" });

    // You already know what you did; `/@{handle}` is where your record lives.
    assertEquals(rows(await listFollowedTimeline(client, me.id, 40)), [
      "game:alice:Puzzle",
    ]);
  });
});

Deno.test("masks a hidden achievement before it leaves the server", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await follow(client, me.id, alice.id);

    await setUpGame(client, alice.id, "2026-01-01T00:00:00Z");
    await unlockAchievement(client, alice.id, GAME, "secret", { via: "rest" });

    const events = await listFollowedTimeline(client, me.id, 40);
    const unlock = events.find((event) => event.kind === "unlock");
    assertEquals(unlock?.achievementTitle, "??????");
    assertEquals(unlock?.hidden, true);
    // The points are not a secret — only the wording is.
    assertEquals(unlock?.points, 50);
  });
});

Deno.test("hides a game whose registration was hidden", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await follow(client, me.id, alice.id);

    await setUpGame(client, alice.id, "2026-01-01T00:00:00Z");
    await client.execute({
      sql: `update games set status = 'hidden' where id = ?`,
      args: [GAME],
    });

    assertEquals(rows(await listFollowedTimeline(client, me.id, 40)), []);
  });
});

Deno.test("stops at the limit it was given", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await follow(client, me.id, alice.id);

    await setUpGame(client, alice.id, "2026-01-01T00:00:00Z");
    await unlockAchievement(client, alice.id, GAME, "first", { via: "rest" });

    assertEquals((await listFollowedTimeline(client, me.id, 1)).length, 1);
  });
});
