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
  /**
   * Public name, seeded from the IdP's user id at first sign-in.
   *
   * A column of its own rather than a read of `external_id`, because a game's
   * id is built from the handle once and then stored. Giving someone a shorter
   * name later would change what their next game is called and leave every
   * published claim URL pointing at something that still exists.
   */
  readonly handle: string | null;
}

/**
 * A player with a handle.
 *
 * Worth its own type: a game's id is built from a handle, so the places that
 * build one should be unable to reach a player who has none. Every player
 * gets one at sign-in, so this is about proving it to the compiler rather than
 * about a state anyone is really in.
 */
export type NamedUser = User & { readonly handle: string };

/**
 * Find the player behind an IdP userId, creating the row on first sign-in.
 *
 * `display_name` is only ever seeded, never overwritten: the IdP nickname is a
 * starting point, and a player who renames themselves here should keep that
 * name across later sign-ins. `handle` is seeded from the IdP's user id, which
 * is already unique and already theirs, so nobody has to choose one before they
 * can publish anything.
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
    sql: `insert into users (external_id, display_name, handle) values (?, ?, ?)
          on conflict (external_id) do nothing`,
    args: [externalId, nickname || externalId, externalId],
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
    sql: `${USER_COLUMNS} where id = ?`,
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
    sql: `${USER_COLUMNS} where external_id = ?`,
    args: [externalId],
  });
  return toUser(result.rows[0]);
}

/**
 * Look up a player by their public handle.
 *
 * This is how a manifest names its author, so an unknown handle has to be
 * distinguishable from a taken one.
 */
export async function findUserByHandle(
  client: Client,
  handle: string,
): Promise<NamedUser | null> {
  // Compared verbatim. The handle is the IdP's identifier, whose case is not
  // ours to fold.
  const result = await client.execute({
    sql: `${USER_COLUMNS} where handle = ?`,
    args: [handle],
  });
  const user = toUser(result.rows[0]);
  // Found by handle, so it has one — say so in the type.
  return user?.handle ? { ...user, handle: user.handle } : null;
}

const USER_COLUMNS =
  "select id, external_id, display_name, avatar_url, handle from users";

function toUser(row: Record<string, unknown> | undefined): User | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    externalId: String(row.external_id),
    displayName: String(row.display_name),
    avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
    handle: row.handle === null ? null : String(row.handle),
  };
}
