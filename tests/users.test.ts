/**
 * `upsertUser` against a real migrated database.
 *
 * Lives with the other `-A` tests because it needs the migration CLI and the
 * local libSQL client, the same way `migrate.test.ts` does.
 */

import { assert, assertEquals } from "@std/assert";

import {
  findUserByExternalId,
  findUserByHandle,
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

Deno.test("hands a player the IdP's id as their handle", () => {
  return migratedDb(async (client) => {
    const user = await upsertUser(client, "idp-user-1", "kuboon");
    // Nothing to choose: the id they already sign in with is unique, stable,
    // and theirs, so they can publish without deciding anything first.
    assertEquals(user.handle, "idp-user-1");
    assertEquals((await findUserByHandle(client, "idp-user-1"))?.id, user.id);
  });
});

Deno.test("compares a handle verbatim, since its case is the IdP's", () => {
  return migratedDb(async (client) => {
    await upsertUser(client, "Vk9tZ3JlZW4", "mixed case");
    assert(await findUserByHandle(client, "Vk9tZ3JlZW4"));
    assertEquals(await findUserByHandle(client, "vk9tz3jlzw4"), null);
  });
});

Deno.test("finds nobody behind an unused handle", () => {
  return migratedDb(async (client) => {
    assertEquals(await findUserByHandle(client, "nobody"), null);
  });
});
