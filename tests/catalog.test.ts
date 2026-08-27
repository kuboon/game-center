/**
 * The two catalog listings that depend on who is asking.
 *
 * Both are driven entirely by the follow graph, which is the point: the hub
 * has no global popularity to sort by and never will. What a player is shown
 * comes from people they chose. See docs/grand_design.md,
 * "偽装は防がない、代わりに誰を見るかを選ばせる".
 */

import { assertEquals } from "@std/assert";

import { follow } from "../server/db/follows.ts";
import {
  listGamesByFollowedAuthors,
  listGamesPlayedByFollowed,
} from "../server/db/games.ts";
import { unlockAchievement } from "../server/db/unlocks.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

/** A game by `owner`, with one achievement to unlock. */
async function game(
  client: Client,
  owner: number,
  handle: string,
  slug: string,
): Promise<string> {
  const id = `${handle}/${slug}`;
  await client.execute({
    sql: `insert into games (id, owner_id, slug, title, url, status)
          values (?, ?, ?, ?, ?, 'active')`,
    args: [id, owner, slug, slug, `https://${handle}.example/${slug}/`],
  });
  await client.execute({
    sql:
      `insert into achievements (game_id, key, title) values (?, 'first', 'First')`,
    args: [id],
  });
  return id;
}

const titles = (games: { title: string }[]) => games.map((g) => g.title);

Deno.test("lists what the people you follow have made", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const stranger = await upsertUser(client, "stranger", "Stranger");

    await game(client, alice.id, "alice", "puzzle");
    await game(client, stranger.id, "stranger", "shooter");
    await follow(client, me.id, alice.id);

    assertEquals(
      titles(await listGamesByFollowedAuthors(client, me.id)),
      ["puzzle"],
    );
  });
});

Deno.test("shows nothing to someone who follows nobody", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await game(client, alice.id, "alice", "puzzle");

    // Not "everything" and not "the most popular": with no follows there is
    // nothing personal to say, and the catalog's own listing already exists.
    assertEquals(await listGamesByFollowedAuthors(client, me.id), []);
    assertEquals(await listGamesPlayedByFollowed(client, me.id), []);
  });
});

Deno.test("lists what the people you follow are playing", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const stranger = await upsertUser(client, "stranger", "Stranger");

    const played = await game(client, stranger.id, "stranger", "shooter");
    await game(client, stranger.id, "stranger", "unplayed");
    await follow(client, me.id, alice.id);
    await unlockAchievement(client, alice.id, played, "first", { via: "rest" });

    assertEquals(
      titles(await listGamesPlayedByFollowed(client, me.id)),
      ["shooter"],
    );
  });
});

Deno.test("does not repeat a followed author's own game in the played list", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");

    // Alice plays her own game. It belongs in "by people you follow" and would
    // be saying the same thing twice here.
    const own = await game(client, alice.id, "alice", "puzzle");
    await follow(client, me.id, alice.id);
    await unlockAchievement(client, alice.id, own, "first", { via: "rest" });

    assertEquals(titles(await listGamesByFollowedAuthors(client, me.id)), [
      "puzzle",
    ]);
    assertEquals(await listGamesPlayedByFollowed(client, me.id), []);
  });
});

Deno.test("lists a game once however many followed players unlocked it", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const bob = await upsertUser(client, "bob", "Bob");
    const stranger = await upsertUser(client, "stranger", "Stranger");

    const shared = await game(client, stranger.id, "stranger", "shooter");
    await follow(client, me.id, alice.id);
    await follow(client, me.id, bob.id);
    await unlockAchievement(client, alice.id, shared, "first", { via: "rest" });
    await unlockAchievement(client, bob.id, shared, "first", { via: "rest" });

    assertEquals(
      titles(await listGamesPlayedByFollowed(client, me.id)),
      ["shooter"],
    );
  });
});

Deno.test("ignores what people you do not follow are playing", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const stranger = await upsertUser(client, "stranger", "Stranger");
    const other = await upsertUser(client, "other", "Other");

    const played = await game(client, other.id, "other", "shooter");
    await unlockAchievement(client, stranger.id, played, "first", {
      via: "rest",
    });

    assertEquals(await listGamesPlayedByFollowed(client, me.id), []);
  });
});
