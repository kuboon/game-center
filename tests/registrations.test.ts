/**
 * The approval handshake, end to end against a real database.
 *
 * A submission and an approval are two different claims — control of a URL, and
 * consent of a person — and the point of the design is that neither works
 * without the other. So most of what is tested here is what a submission alone
 * does *not* do.
 */

import { assert, assertEquals } from "@std/assert";

import type { GameManifest } from "@game-center/protocol";
import { findGame, listGames, registerGame } from "../server/db/games.ts";
import {
  findPending,
  hasRefused,
  listPending,
  MAX_PENDING_PER_AUTHOR,
  refusePending,
  removePending,
  submitRegistration,
  TooManyPendingError,
} from "../server/db/registrations.ts";
import { upsertUser } from "../server/db/users.ts";
import { approveRegistration } from "../server/lib/game_registration.ts";
import { type Client, migratedDb } from "./support/db.ts";

const GAME_URL = "https://example.github.io/my-puzzle/";
const MANIFEST_URL = "https://example.github.io/my-puzzle/";

const manifest = (overrides: Partial<GameManifest> = {}): GameManifest => ({
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
  ],
  ...overrides,
});

/** An author, ready to be named by a manifest. Its handle is its IdP id. */
async function author(client: Client, handle = "kuboon") {
  const user = await upsertUser(client, handle, handle);
  return { ...user, handle };
}

const submit = (
  client: Client,
  authorId: number,
  overrides: Partial<
    { slug: string; manifestUrl: string; manifest: GameManifest }
  > = {},
) =>
  submitRegistration(client, authorId, {
    slug: overrides.slug ?? "my-puzzle",
    manifestUrl: overrides.manifestUrl ?? MANIFEST_URL,
    gameUrl: GAME_URL,
    manifest: overrides.manifest ?? manifest(),
  });

Deno.test("a submission registers nothing on its own", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    await submit(client, kuboon.id);

    assertEquals(await listGames(client), []);
    assertEquals((await listPending(client, kuboon.id)).length, 1);
  });
});

Deno.test("a pending submission holds no slug, so one author can race themselves", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);

    // The same author submitted the same slug from two different URLs.
    await submit(client, kuboon.id, { manifestUrl: "https://a.example.com/" });
    await submit(client, kuboon.id, { manifestUrl: "https://b.example.com/" });

    // Whichever they approve first takes the name; the other then collides.
    const [first, second] = await listPending(client, kuboon.id);
    assertEquals(
      (await approveRegistration(client, kuboon, first)).status,
      201,
    );
    assertEquals(
      (await approveRegistration(client, kuboon, second)).status,
      409,
    );
    assertEquals(
      (await findGame(client, "kuboon/my-puzzle"))?.manifestUrl,
      "https://a.example.com/",
    );
  });
});

Deno.test("another author submitting the same slug collides with nobody", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const other = await author(client, "someone-else");

    await submit(client, kuboon.id);
    await submit(client, other.id, {
      manifestUrl: "https://b.example.com/",
      manifest: manifest({ author: "someone-else" }),
    });

    const [mine] = await listPending(client, kuboon.id);
    const [theirs] = await listPending(client, other.id);
    assertEquals((await approveRegistration(client, kuboon, mine)).status, 201);
    // Scoped by author, so this is a different game entirely.
    assertEquals(
      (await approveRegistration(client, other, theirs)).status,
      201,
    );
    assertEquals((await listGames(client)).length, 2);
  });
});

Deno.test("approving records the author and the URL that may write", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const pending = await submit(client, kuboon.id);

    const response = await approveRegistration(client, kuboon, pending);
    assertEquals(response.status, 201);

    const game = await findGame(client, "kuboon/my-puzzle");
    assertEquals(game?.ownerId, kuboon.id);
    assertEquals(game?.manifestUrl, MANIFEST_URL);
  });
});

Deno.test("re-submitting one URL replaces what is waiting", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    await submit(client, kuboon.id);
    await submit(client, kuboon.id, {
      manifest: manifest({ title: "My Puzzle 2" }),
    });

    // CI may run many times before anyone approves; the author should see the
    // document as it stands now, not a pile of old ones.
    const waiting = await listPending(client, kuboon.id);
    assertEquals(waiting.length, 1);
    assertEquals(waiting[0].manifest.title, "My Puzzle 2");
  });
});

Deno.test("keeps one author's queue out of another's", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const other = await author(client, "someone-else");
    const pending = await submit(client, kuboon.id);

    assertEquals(await listPending(client, other.id), []);
    // A guessed id belonging to someone else simply is not found.
    assertEquals(await findPending(client, other.id, pending.id), null);
    assertEquals(await removePending(client, other.id, pending.id), false);
    assert(await findPending(client, kuboon.id, pending.id));
  });
});

Deno.test("dismissing takes a submission off the queue", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const pending = await submit(client, kuboon.id);

    assertEquals(await removePending(client, kuboon.id, pending.id), true);
    assertEquals(await listPending(client, kuboon.id), []);
    assertEquals(await listGames(client), []);
  });
});

Deno.test("caps how much one author's queue can be filled with", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    for (let i = 0; i < MAX_PENDING_PER_AUTHOR; i++) {
      await submit(client, kuboon.id, {
        manifestUrl: `https://example.com/${i}/`,
      });
    }

    // Anyone may name anyone as author, so the queue is the spam surface.
    let refused = false;
    try {
      await submit(client, kuboon.id, {
        manifestUrl: "https://example.com/one-too-many/",
      });
    } catch (error) {
      refused = error instanceof TooManyPendingError;
    }
    assert(refused, "an unbounded queue is a spam target");

    // A URL already in the queue still updates: it takes no new room.
    await submit(client, kuboon.id, { manifestUrl: "https://example.com/0/" });
  });
});

Deno.test("approving twice is caught by the game's own ownership rule", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const pending = await submit(client, kuboon.id);
    await approveRegistration(client, kuboon, pending);

    // Same URL, so this is an update rather than a second claim.
    const again = await approveRegistration(client, kuboon, pending);
    assertEquals(again.status, 200);
    assertEquals((await listGames(client)).length, 1);
  });
});

Deno.test("an approved URL keeps writing without asking again", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    await approveRegistration(client, kuboon, await submit(client, kuboon.id));

    // What CI does on every later push.
    const updated = await registerGame(
      client,
      {
        ownerId: kuboon.id,
        authorHandle: kuboon.handle,
        manifestUrl: MANIFEST_URL,
      },
      manifest({ title: "My Puzzle 2" }),
      GAME_URL,
    );
    assertEquals(updated.created, false);
    assertEquals(updated.game.title, "My Puzzle 2");
  });
});

Deno.test("refusing a URL outlives the submission it removes", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const pending = await submit(client, kuboon.id);

    assertEquals(await hasRefused(client, kuboon.id, MANIFEST_URL), false);
    assertEquals(await refusePending(client, kuboon.id, pending.id), true);

    // The row is gone and the refusal is not. The endpoint that queued it
    // takes no credential, so forgetting would let the same URL come straight
    // back, and the queue would become a way to keep tapping someone on the
    // shoulder.
    assertEquals(await findPending(client, kuboon.id, pending.id), null);
    assertEquals(await hasRefused(client, kuboon.id, MANIFEST_URL), true);
  });
});

Deno.test("refusing the same URL a second time is not an error", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    await refusePending(
      client,
      kuboon.id,
      (await submit(client, kuboon.id)).id,
    );

    const again = await submit(client, kuboon.id);
    assertEquals(await refusePending(client, kuboon.id, again.id), true);
    assertEquals(await hasRefused(client, kuboon.id, MANIFEST_URL), true);
  });
});

Deno.test("one author's refusal says nothing about another's", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const other = await author(client, "someone-else");
    await refusePending(
      client,
      kuboon.id,
      (await submit(client, kuboon.id)).id,
    );

    // Refusing means "my name does not belong on that document", which is not
    // a claim about anybody else's name.
    assertEquals(await hasRefused(client, other.id, MANIFEST_URL), false);
  });
});

Deno.test("refusing a submission that is not yours does nothing", async () => {
  await migratedDb(async (client) => {
    const kuboon = await author(client);
    const other = await author(client, "someone-else");
    const pending = await submit(client, kuboon.id);

    assertEquals(await refusePending(client, other.id, pending.id), false);
    assertEquals(await hasRefused(client, other.id, MANIFEST_URL), false);
    // And the real author's submission is still waiting for them.
    assert(await findPending(client, kuboon.id, pending.id));
  });
});
