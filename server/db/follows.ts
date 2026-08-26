/**
 * Who follows whom.
 *
 * A follow is one-way and needs no approval, so every function here is about
 * one row keyed by a pair. The reason the table exists is in
 * `db/migrations/20260826150000_follows/up.sql`: the hub cannot tell a forged
 * unlock from a real one, so it lets each player decide whose records to look
 * at instead of pretending to verify them.
 *
 * Every function takes its `Client` so tests can pass a local database.
 */

import type { Client } from "./client.ts";

/** The numbers a profile page shows next to a name. */
export interface FollowCounts {
  readonly followers: number;
  readonly followees: number;
}

/**
 * Start following someone.
 *
 * Idempotent: the pair is the primary key, so a second call changes nothing
 * and keeps the original `created_at`. Callers get to say "follow" without
 * first asking whether they already do.
 *
 * @param client Database to write to
 * @param followerId The player doing the following
 * @param followeeId The player being followed
 * @returns True when this call created the follow
 * @throws {SelfFollowError} when the two are the same player
 */
export async function follow(
  client: Client,
  followerId: number,
  followeeId: number,
): Promise<boolean> {
  if (followerId === followeeId) throw new SelfFollowError();
  const result = await client.execute({
    sql: `insert into follows (follower_id, followee_id) values (?, ?)
          on conflict (follower_id, followee_id) do nothing`,
    args: [followerId, followeeId],
  });
  return result.rowsAffected > 0;
}

/** Raised when a player tries to follow themselves. */
export class SelfFollowError extends Error {
  override readonly name = "SelfFollowError";
}

/**
 * Stop following someone.
 *
 * Also idempotent, and deliberately silent about which case happened: a caller
 * that wants to stop following is done either way.
 *
 * @param client Database to write to
 * @param followerId The player doing the unfollowing
 * @param followeeId The player being unfollowed
 * @returns True when a follow was removed
 */
export async function unfollow(
  client: Client,
  followerId: number,
  followeeId: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: `delete from follows where follower_id = ? and followee_id = ?`,
    args: [followerId, followeeId],
  });
  return result.rowsAffected > 0;
}

/** Whether one player follows another. */
export async function isFollowing(
  client: Client,
  followerId: number,
  followeeId: number,
): Promise<boolean> {
  const result = await client.execute({
    sql: `select 1 from follows where follower_id = ? and followee_id = ?`,
    args: [followerId, followeeId],
  });
  return result.rows.length > 0;
}

/** How many follow this player, and how many they follow. */
export async function countFollows(
  client: Client,
  userId: number,
): Promise<FollowCounts> {
  const result = await client.execute({
    sql: `select
            (select count(*) from follows where followee_id = ?) as followers,
            (select count(*) from follows where follower_id = ?) as followees`,
    args: [userId, userId],
  });
  const row = result.rows[0];
  return { followers: Number(row.followers), followees: Number(row.followees) };
}
