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
  /** Public name, chosen once. Null until the player picks one. */
  readonly handle: string | null;
}

/**
 * A player who has chosen a handle.
 *
 * Worth its own type: a game's id is built from a handle, so the places that
 * build one should be unable to reach a player who has none.
 */
export type NamedUser = User & { readonly handle: string };

/** Raised when a handle is already someone else's, or already set. */
export class HandleError extends Error {
  override readonly name = "HandleError";
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
  const result = await client.execute({
    sql: `${USER_COLUMNS} where handle = ?`,
    args: [handle.toLowerCase()],
  });
  const user = toUser(result.rows[0]);
  // Found by handle, so it has one — say so in the type.
  return user?.handle ? { ...user, handle: user.handle } : null;
}

/**
 * Give a player their handle.
 *
 * Set once and not changed: it goes into manifests that the hub does not
 * control, and into author pages people link to. Renaming would silently break
 * every game whose `author` still says the old one.
 *
 * @param client Database to write to
 * @param userId The player
 * @param handle The requested handle, already known to be well-formed
 * @returns The updated player
 * @throws {HandleError} when they already have one, or someone else does
 */
export async function claimHandle(
  client: Client,
  userId: number,
  handle: string,
): Promise<NamedUser> {
  const wanted = handle.toLowerCase();
  const existing = await findUserById(client, userId);
  if (!existing) throw new HandleError("No such player");
  if (existing.handle) {
    throw new HandleError(`You already go by @${existing.handle}`);
  }
  if (await findUserByHandle(client, wanted)) {
    throw new HandleError(`@${wanted} is taken`);
  }

  // The unique index is what actually decides, so a race between two players
  // asking for the same handle ends here rather than in a double write.
  try {
    await client.execute({
      sql: "update users set handle = ? where id = ? and handle is null",
      args: [wanted, userId],
    });
  } catch {
    throw new HandleError(`@${wanted} is taken`);
  }

  const updated = await findUserById(client, userId);
  if (!updated?.handle) throw new HandleError(`@${wanted} is taken`);
  return { ...updated, handle: updated.handle };
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
