/**
 * `upsertUser` against a real migrated database.
 *
 * Lives with the other `-A` tests because it needs the migration CLI and the
 * local libSQL client, the same way `migrate.test.ts` does.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";

import {
  claimHandle,
  findUserByExternalId,
  findUserByHandle,
  HandleError,
  upsertUser,
} from "../server/db/users.ts";
import { migratedDb } from "./support/db.ts";

Deno.test("creates the player on first sign-in", async () => {
  await migratedDb(async (client) => {
    const user = await upsertUser(client, "idp-user-1", "kuboon");
    assertEquals(user.externalId, "idp-user-1");
    assertEquals(user.displayName, "kuboon");
    assert(user.id > 0);
  });
});

Deno.test("returns the same row on later sign-ins", async () => {
  await migratedDb(async (client) => {
    const first = await upsertUser(client, "idp-user-1", "kuboon");
    const second = await upsertUser(client, "idp-user-1", "kuboon");
    assertEquals(second.id, first.id);

    const count = await client.execute("select count(*) as n from users");
    assertEquals(Number(count.rows[0].n), 1);
  });
});

Deno.test("keeps the stored display name when the IdP nickname changes", async () => {
  await migratedDb(async (client) => {
    await upsertUser(client, "idp-user-1", "kuboon");
    const again = await upsertUser(client, "idp-user-1", "renamed-at-idp");
    assertEquals(again.displayName, "kuboon");
  });
});

Deno.test("falls back to the IdP id when there is no nickname", async () => {
  await migratedDb(async (client) => {
    const user = await upsertUser(client, "idp-user-2", null);
    assertEquals(user.displayName, "idp-user-2");
  });
});

Deno.test("finds nobody for an unknown id", async () => {
  await migratedDb(async (client) => {
    assertEquals(await findUserByExternalId(client, "nobody"), null);
  });
});

Deno.test("gives a player the handle they ask for", async () => {
  await migratedDb(async (client) => {
    const user = await upsertUser(client, "idp-user-1", "kuboon");
    assertEquals(user.handle, null);

    const named = await claimHandle(client, user.id, "Kuboon");
    // Lowercased on the way in: it ends up in URLs and in manifests, where
    // two spellings of one name would be two different authors.
    assertEquals(named.handle, "kuboon");
    assertEquals(
      (await findUserByHandle(client, "kuboon"))?.id,
      user.id,
    );
  });
});

Deno.test("a handle belongs to one player and is not changed", async () => {
  await migratedDb(async (client) => {
    const first = await upsertUser(client, "idp-user-1", "one");
    const second = await upsertUser(client, "idp-user-2", "two");
    await claimHandle(client, first.id, "kuboon");

    await assertRejects(
      () => claimHandle(client, second.id, "kuboon"),
      HandleError,
    );
    // Not even by its owner: manifests naming the old one would break.
    await assertRejects(
      () => claimHandle(client, first.id, "someone-else"),
      HandleError,
    );
    assertEquals(await findUserByHandle(client, "someone-else"), null);
  });
});

Deno.test("finds nobody behind an unclaimed handle", async () => {
  await migratedDb(async (client) => {
    assertEquals(await findUserByHandle(client, "nobody"), null);
  });
});
