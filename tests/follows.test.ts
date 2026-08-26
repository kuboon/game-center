/**
 * Following, against a real migrated database.
 *
 * Most of what is worth asserting here is that the table refuses things the
 * controllers would otherwise have to remember: a duplicate follow, and a
 * follow of oneself. Both are constraints, so both hold no matter which
 * caller arrives next.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";

import {
  countFollows,
  follow,
  isFollowing,
  SelfFollowError,
  unfollow,
} from "../server/db/follows.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

/** Two players, since a follow needs both ends. */
async function players(client: Client) {
  const alice = await upsertUser(client, "alice", "Alice");
  const bob = await upsertUser(client, "bob", "Bob");
  return { alice, bob };
}

Deno.test("records a follow in one direction only", async () => {
  await migratedDb(async (client) => {
    const { alice, bob } = await players(client);

    assertEquals(await follow(client, alice.id, bob.id), true);
    assert(await isFollowing(client, alice.id, bob.id));
    // Nothing reciprocal was written: Bob did not agree to anything.
    assertEquals(await isFollowing(client, bob.id, alice.id), false);
  });
});

Deno.test("following twice changes nothing", async () => {
  await migratedDb(async (client) => {
    const { alice, bob } = await players(client);

    assertEquals(await follow(client, alice.id, bob.id), true);
    const first = await client.execute(
      "select created_at from follows where follower_id = ?",
      [alice.id],
    );

    // The second call reports that it created nothing, and leaves the original
    // timestamp alone: a button that fires twice must not look like two events.
    assertEquals(await follow(client, alice.id, bob.id), false);
    const again = await client.execute(
      "select created_at, count(*) as n from follows where follower_id = ?",
      [alice.id],
    );
    assertEquals(Number(again.rows[0].n), 1);
    assertEquals(again.rows[0].created_at, first.rows[0].created_at);
  });
});

Deno.test("unfollowing what you do not follow is not an error", async () => {
  await migratedDb(async (client) => {
    const { alice, bob } = await players(client);

    assertEquals(await unfollow(client, alice.id, bob.id), false);
    await follow(client, alice.id, bob.id);
    assertEquals(await unfollow(client, alice.id, bob.id), true);
    assertEquals(await isFollowing(client, alice.id, bob.id), false);
  });
});

Deno.test("refuses to let anyone follow themselves", async () => {
  await migratedDb(async (client) => {
    const { alice } = await players(client);

    await assertRejects(
      () => follow(client, alice.id, alice.id),
      SelfFollowError,
    );

    // And the database refuses it too, so a caller that skips `follow` cannot
    // write the row either.
    await assertRejects(() =>
      client.execute(
        "insert into follows (follower_id, followee_id) values (?, ?)",
        [alice.id, alice.id],
      )
    );
  });
});

Deno.test("counts both directions", async () => {
  await migratedDb(async (client) => {
    const { alice, bob } = await players(client);
    const carol = await upsertUser(client, "carol", "Carol");

    await follow(client, alice.id, bob.id);
    await follow(client, carol.id, bob.id);
    await follow(client, bob.id, alice.id);

    assertEquals(await countFollows(client, bob.id), {
      followers: 2,
      followees: 1,
    });
    assertEquals(await countFollows(client, carol.id), {
      followers: 0,
      followees: 1,
    });
  });
});
