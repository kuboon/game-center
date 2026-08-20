/**
 * API tokens: how a CI job proves it may write to a game it owns.
 *
 * The plaintext exists only in the response that creates it. What is stored is
 * a SHA-256 hash, so a leaked database read does not hand anyone a working
 * token. Tokens carry no scope of their own: they act as their owner, and the
 * registry checks ownership per game.
 */

import { encodeBase64Url, encodeHex } from "@std/encoding";

import type { Client } from "./client.ts";
import { findUserById, type User } from "./users.ts";

/** Prefix so a leaked token is recognisable in a log or a secret scanner. */
const TOKEN_PREFIX = "gct_";
const TOKEN_BYTES = 32;

export interface ApiToken {
  readonly id: number;
  readonly userId: number;
  readonly name: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface IssuedToken {
  readonly record: ApiToken;
  /** The only time this is ever available. */
  readonly token: string;
}

/**
 * Mint a token for a player.
 *
 * @param client Database to write to
 * @param userId Owner of the token
 * @param name Label shown in the dashboard, e.g. the repository it lives in
 * @returns The stored record and the plaintext to show once
 */
export async function issueToken(
  client: Client,
  userId: number,
  name: string,
): Promise<IssuedToken> {
  const token = TOKEN_PREFIX +
    encodeBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  const result = await client.execute({
    sql:
      "insert into api_tokens (user_id, token_hash, name) values (?, ?, ?) returning id, created_at",
    args: [userId, await hashToken(token), name],
  });
  const row = result.rows[0];
  return {
    token,
    record: {
      id: Number(row.id),
      userId,
      name,
      createdAt: String(row.created_at),
      lastUsedAt: null,
    },
  };
}

/**
 * Resolve a plaintext token to the player it acts as.
 *
 * Records `last_used_at` on the way through, which is the only signal a player
 * has that a token they forgot about is still in use.
 *
 * @param client Database to read
 * @param token The plaintext from the Authorization header
 * @returns The owner, or null when the token is unknown
 */
export async function authenticateToken(
  client: Client,
  token: string,
): Promise<User | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const result = await client.execute({
    sql: "select id, user_id from api_tokens where token_hash = ?",
    args: [await hashToken(token)],
  });
  const row = result.rows[0];
  if (!row) return null;

  await client.execute({
    sql: "update api_tokens set last_used_at = datetime('now') where id = ?",
    args: [Number(row.id)],
  });
  return await findUserById(client, Number(row.user_id));
}

/** A player's tokens, newest first. Never includes the plaintext. */
export async function listTokens(
  client: Client,
  userId: number,
): Promise<ApiToken[]> {
  const result = await client.execute({
    sql: `select id, user_id, name, created_at, last_used_at
            from api_tokens where user_id = ? order by id desc`,
    args: [userId],
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    name: String(row.name),
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
  }));
}

/**
 * Delete one of a player's tokens.
 *
 * Scoped by `user_id` in the statement rather than checked first, so a guessed
 * id belonging to someone else deletes nothing.
 *
 * @returns Whether a token was removed
 */
export async function revokeToken(
  client: Client,
  userId: number,
  id: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: "delete from api_tokens where id = ? and user_id = ?",
    args: [id, userId],
  });
  return result.rowsAffected > 0;
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return encodeHex(new Uint8Array(digest));
}
