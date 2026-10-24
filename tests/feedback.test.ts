/**
 * Player feedback, against a real migrated database.
 *
 * Two things are worth proving here rather than in a controller: an author
 * reads and deletes only reports about their own games, and a report does not
 * stop an unplayed game from being deleted.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";

import type { GameManifest } from "@game-center/protocol";
import {
  deleteFeedback,
  listFeedbackForOwner,
  submitFeedback,
} from "../server/db/feedback.ts";
import { findGame, registerGame, retireGame } from "../server/db/games.ts";
import { upsertUser } from "../server/db/users.ts";
import { type Client, migratedDb } from "./support/db.ts";

function manifest(author: string, id: string): GameManifest {
  return {
    id,
    author,
    title: `${id} by ${author}`,
    achievements: [
      { key: "first_clear", title: "はじめて", points: 10, hidden: false },
    ],
  };
}

/** Two authors with a game each, and a player who reports on both. */
async function setup(client: Client) {
  const kuboon = await upsertUser(client, "kuboon", "Kuboon");
  const midori = await upsertUser(client, "midori", "Midori");
  const player = await upsertUser(client, "player", "Player");
  for (const [author, id] of [[kuboon, "blocks"], [midori, "stars"]] as const) {
    await registerGame(
      client,
      {
        ownerId: author.id,
        authorHandle: author.handle!,
        manifestUrl: `https://example.github.io/${id}/gamecenter.json`,
      },
      manifest(author.handle!, id),
      `https://example.github.io/${id}/`,
    );
  }
  return { kuboon, midori, player };
}

Deno.test("an author reads only reports about their own games", async () => {
  await migratedDb(async (client) => {
    const { kuboon, midori, player } = await setup(client);
    await submitFeedback(client, {
      gameId: "kuboon/blocks",
      senderId: player.id,
      kind: "bug",
      message: "ボールがすり抜ける",
    });
    await submitFeedback(client, {
      gameId: "midori/stars",
      senderId: player.id,
      kind: "request",
      message: "BGM を消したい",
    });

    const inbox = await listFeedbackForOwner(client, kuboon.id);
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0].gameId, "kuboon/blocks");
    assertEquals(inbox[0].kind, "bug");
    assertEquals(inbox[0].message, "ボールがすり抜ける");
    // The sender is named: that is the point of requiring a session.
    assertEquals(inbox[0].sender, { handle: "player", displayName: "Player" });

    assertEquals(
      (await listFeedbackForOwner(client, midori.id)).map((r) => r.message),
      ["BGM を消したい"],
    );
    assertEquals(await listFeedbackForOwner(client, player.id), []);
  });
});

Deno.test("only the game's author can delete a report", async () => {
  await migratedDb(async (client) => {
    const { kuboon, midori, player } = await setup(client);
    const id = await submitFeedback(client, {
      gameId: "kuboon/blocks",
      senderId: player.id,
      kind: "other",
      message: "楽しかった",
    });

    assertEquals(await deleteFeedback(client, midori.id, id), false);
    assertEquals(await deleteFeedback(client, player.id, id), false);
    assertEquals((await listFeedbackForOwner(client, kuboon.id)).length, 1);

    assert(await deleteFeedback(client, kuboon.id, id));
    assertEquals(await listFeedbackForOwner(client, kuboon.id), []);
    // Twice is not an error at this layer; it just finds nothing.
    assertEquals(await deleteFeedback(client, kuboon.id, id), false);
  });
});

Deno.test("a report does not keep an unplayed game from being deleted", async () => {
  await migratedDb(async (client) => {
    const { kuboon, player } = await setup(client);
    await submitFeedback(client, {
      gameId: "kuboon/blocks",
      senderId: player.id,
      kind: "bug",
      message: "登録先の URL が違う",
    });

    // libSQL enforces foreign keys; without the cascade this delete would be
    // refused, and a mistaken registration could never be taken back.
    assertEquals(await retireGame(client, "kuboon/blocks"), "deleted");
    assertEquals(await findGame(client, "kuboon/blocks"), null);
    assertEquals(await listFeedbackForOwner(client, kuboon.id), []);
  });
});

Deno.test("the table refuses what the form would refuse", async () => {
  await migratedDb(async (client) => {
    const { player } = await setup(client);
    for (const [kind, message] of [["praise", "すごい"], ["bug", ""]]) {
      await assertRejects(() =>
        client.execute({
          sql: `insert into game_feedback (game_id, sender_id, kind, message)
                values ('kuboon/blocks', ?, ?, ?)`,
          args: [player.id, kind, message],
        })
      );
    }
  });
});
