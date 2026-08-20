/**
 * Player records, keyed to the IdP's user identifier.
 *
 * Every function takes its `Client` so tests can pass a local database; the
 * controllers hand it the shared one from `./client.ts`.
 */

import type { Client } from "./client.ts";

export interface User {
  readonly id: number;
  readonly externalId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

/**
 * Find the player behind an IdP userId, creating the row on first sign-in.
 *
 * `display_name` is only ever seeded, never overwritten: the IdP nickname is a
 * starting point, and a player who renames themselves here should keep that
 * name across later sign-ins.
 *
 * @param client Database to write to
 * @param externalId The IdP's user identifier
 * @param nickname Display name to seed a new row with
 * @returns The stored player
 */
export async function upsertUser(
  client: Client,
  externalId: string,
  nickname: string | null,
): Promise<User> {
  await client.execute({
    sql: `insert into users (external_id, display_name) values (?, ?)
          on conflict (external_id) do nothing`,
    args: [externalId, nickname || externalId],
  });
  const user = await findUserByExternalId(client, externalId);
  if (!user) {
    throw new Error(`User ${externalId} vanished right after being inserted`);
  }
  return user;
}

/** Look up a player by their local row id. */
export async function findUserById(
  client: Client,
  id: number,
): Promise<User | null> {
  const result = await client.execute({
    sql:
      "select id, external_id, display_name, avatar_url from users where id = ?",
    args: [id],
  });
  return toUser(result.rows[0]);
}

/** Look up a player by the IdP's user identifier. */
export async function findUserByExternalId(
  client: Client,
  externalId: string,
): Promise<User | null> {
  const result = await client.execute({
    sql:
      "select id, external_id, display_name, avatar_url from users where external_id = ?",
    args: [externalId],
  });
  return toUser(result.rows[0]);
}

function toUser(row: Record<string, unknown> | undefined): User | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    externalId: String(row.external_id),
    displayName: String(row.display_name),
    avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
  };
}
