/**
 * Noticing that somebody followed you, against a real migrated database.
 *
 * The interesting part is not the list — it is `unseen`, because that is the
 * whole reason the feature exists. A follower count nobody is told about is a
 * number that changes while nobody is looking.
 *
 * The seen mark is a timestamp rather than a per-row flag, so what needs
 * pinning down is the boundary: a follow that arrives during the round trip
 * must still be new afterwards.
 */

import { assert, assertEquals } from "@std/assert";

import {
  countUnseenFollowers,
  follow,
  listFollowers,
  markFollowersSeen,
} from "../server/db/follows.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

/** Follow at a chosen time, so ordering and the seen mark are testable. */
async function followAt(
  client: Client,
  followerId: number,
  followeeId: number,
  at: string,
) {
  await follow(client, followerId, followeeId);
  await client.execute({
    sql: `update follows set created_at = ?
           where follower_id = ? and followee_id = ?`,
    args: [at, followerId, followeeId],
  });
}

const rows = (followers: Awaited<ReturnType<typeof listFollowers>>) =>
  followers.map((f) => `${f.handle}${f.unseen ? ":new" : ""}`);

Deno.test("lists followers newest first", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const bob = await upsertUser(client, "bob", "Bob");

    await followAt(client, alice.id, me.id, "2026-01-01T00:00:00Z");
    await followAt(client, bob.id, me.id, "2026-02-01T00:00:00Z");

    assertEquals(rows(await listFollowers(client, me.id, 50)), [
      "bob:new",
      "alice:new",
    ]);
  });
});

Deno.test("everything is new to a player who has never looked", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await followAt(client, alice.id, me.id, "2026-01-01T00:00:00Z");

    // Null `followers_seen_at` is every existing player. Their followers have
    // never been shown to them, so calling them old would be a lie.
    assertEquals(await countUnseenFollowers(client, me.id), 1);
  });
});

Deno.test("looking clears what was shown and nothing else", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const bob = await upsertUser(client, "bob", "Bob");

    await followAt(client, alice.id, me.id, "2026-01-01T00:00:00Z");
    await markFollowersSeen(client, me.id, "2026-01-01T00:00:00Z");
    assertEquals(await countUnseenFollowers(client, me.id), 0);

    await followAt(client, bob.id, me.id, "2026-02-01T00:00:00Z");
    assertEquals(await countUnseenFollowers(client, me.id), 1);
    assertEquals(rows(await listFollowers(client, me.id, 50)), [
      "bob:new",
      "alice",
    ]);
  });
});

Deno.test("a follow arriving mid-request stays new", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const bob = await upsertUser(client, "bob", "Bob");

    await followAt(client, alice.id, me.id, "2026-01-01T00:00:00Z");
    const shown = await listFollowers(client, me.id, 50);

    // Bob arrives after the read but before the mark. Stamping "now" would
    // swallow him; stamping what was actually shown does not.
    await followAt(client, bob.id, me.id, "2026-01-15T00:00:00Z");
    await markFollowersSeen(client, me.id, shown[0].followedAt);

    assertEquals(await countUnseenFollowers(client, me.id), 1);
  });
});

Deno.test("the mark never moves backwards", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    await followAt(client, alice.id, me.id, "2026-01-01T00:00:00Z");

    await markFollowersSeen(client, me.id, "2026-03-01T00:00:00Z");
    // A slow response carrying an older mark must not re-light the badge.
    await markFollowersSeen(client, me.id, "2026-01-01T00:00:00Z");

    assertEquals(await countUnseenFollowers(client, me.id), 0);
  });
});

Deno.test("marking with nothing to mark is a no-op", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    await markFollowersSeen(client, me.id, undefined);

    const result = await client.execute({
      sql: "select followers_seen_at from users where id = ?",
      args: [me.id],
    });
    assertEquals(result.rows[0].followers_seen_at, null);
  });
});

Deno.test("one player's followers are not another's", async () => {
  await migratedDb(async (client) => {
    const me = await upsertUser(client, "me", "Me");
    const alice = await upsertUser(client, "alice", "Alice");
    const bob = await upsertUser(client, "bob", "Bob");

    await followAt(client, alice.id, bob.id, "2026-01-01T00:00:00Z");

    assertEquals(await listFollowers(client, me.id, 50), []);
    assert((await listFollowers(client, bob.id, 50)).length === 1);
  });
});
