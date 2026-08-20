/**
 * API tokens against a real migrated database.
 *
 * What matters here is that the plaintext never lands in the database, that a
 * token resolves to exactly its owner, and that revoking is scoped so one
 * player cannot delete another's token by guessing an id.
 */

import { assert, assertEquals } from "@std/assert";

import {
  authenticateToken,
  issueToken,
  listTokens,
  revokeToken,
} from "../server/db/api_tokens.ts";
import { upsertUser } from "../server/db/users.ts";
import { migratedDb } from "./support/db.ts";

Deno.test("stores a hash, never the token itself", async () => {
  await migratedDb(async (client) => {
    const user = await upsertUser(client, "idp-owner", "owner");
    const { token } = await issueToken(client, user.id, "owner/repo");

    assert(token.startsWith("gct_"), token);
    const stored = await client.execute("select token_hash from api_tokens");
    assertEquals(stored.rows.length, 1);
    assertEquals(String(stored.rows[0].token_hash).includes(token), false);
  });
});

Deno.test("resolves a token to its owner and records the use", async () => {
  await migratedDb(async (client) => {
    const user = await upsertUser(client, "idp-owner", "owner");
    const { token } = await issueToken(client, user.id, "owner/repo");

    assertEquals((await listTokens(client, user.id))[0].lastUsedAt, null);

    const authenticated = await authenticateToken(client, token);
    assertEquals(authenticated?.id, user.id);
    assert((await listTokens(client, user.id))[0].lastUsedAt);
  });
});

Deno.test("resolves nothing for a token that was never issued", async () => {
  await migratedDb(async (client) => {
    assertEquals(await authenticateToken(client, "gct_nope"), null);
    assertEquals(await authenticateToken(client, "not-even-a-token"), null);
  });
});

Deno.test("revokes only the caller's own token", async () => {
  await migratedDb(async (client) => {
    const owner = await upsertUser(client, "idp-owner", "owner");
    const other = await upsertUser(client, "idp-other", "other");
    const { record, token } = await issueToken(client, owner.id, "owner/repo");

    assertEquals(await revokeToken(client, other.id, record.id), false);
    assert(await authenticateToken(client, token));

    assertEquals(await revokeToken(client, owner.id, record.id), true);
    assertEquals(await authenticateToken(client, token), null);
    assertEquals(await listTokens(client, owner.id), []);
  });
});

Deno.test("keeps one player's tokens out of another's list", async () => {
  await migratedDb(async (client) => {
    const owner = await upsertUser(client, "idp-owner", "owner");
    const other = await upsertUser(client, "idp-other", "other");
    await issueToken(client, owner.id, "owner/repo");

    assertEquals((await listTokens(client, owner.id)).length, 1);
    assertEquals(await listTokens(client, other.id), []);
  });
});
