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

/** Someone who follows you, as the "new followers" list shows them. */
export interface Follower {
  readonly handle: string;
  readonly displayName: string;
  readonly followedAt: string;
  /** True when they arrived after this player last looked. */
  readonly unseen: boolean;
}

/**
 * Who follows this player, newest first.
 *
 * Being followed is the one thing that happens *to* a player, so it is the one
 * thing they cannot find by retracing their own steps — hence `unseen`, which
 * is what makes the list worth opening rather than a number worth ignoring.
 *
 * Only ever read for the player themselves. A follower list is not on anyone's
 * public page: the counts are, and that is a different question from naming
 * the people.
 *
 * @param client Database to read from
 * @param userId The player being followed
 * @param limit How many to return
 * @returns Followers, newest first
 */
export async function listFollowers(
  client: Client,
  userId: number,
  limit: number,
): Promise<Follower[]> {
  const result = await client.execute({
    sql: `select users.handle, users.display_name, follows.created_at,
                 (me.followers_seen_at is null
                  or follows.created_at > me.followers_seen_at) as unseen
            from follows
            join users on users.id = follows.follower_id
            join users me on me.id = follows.followee_id
           where follows.followee_id = ?
             and users.handle is not null
           order by follows.created_at desc, follows.follower_id desc
           limit ?`,
    args: [userId, limit],
  });
  return result.rows.map((row) => ({
    handle: String(row.handle),
    displayName: String(row.display_name),
    followedAt: String(row.created_at),
    unseen: Number(row.unseen) === 1,
  }));
}

/** How many followers arrived since this player last looked. */
export async function countUnseenFollowers(
  client: Client,
  userId: number,
): Promise<number> {
  const result = await client.execute({
    sql: `select count(*) as n
            from follows
            join users on users.id = follows.follower_id
            join users me on me.id = follows.followee_id
           where follows.followee_id = ?
             and users.handle is not null
             and (me.followers_seen_at is null
                  or follows.created_at > me.followers_seen_at)`,
    args: [userId],
  });
  return Number(result.rows[0].n);
}

/**
 * Record that this player has now seen their followers.
 *
 * Stamped with the newest follow already in the list rather than with `now`,
 * so a follow that lands between the read and this write is still new the next
 * time. Losing a notification is worse than showing one twice.
 *
 * @param client Database to write to
 * @param userId The player who looked
 * @param through The newest `followedAt` they were shown, if any
 */
export async function markFollowersSeen(
  client: Client,
  userId: number,
  through: string | undefined,
): Promise<void> {
  if (!through) return;
  await client.execute({
    sql: `update users
             set followers_seen_at = ?
           where id = ?
             and (followers_seen_at is null or followers_seen_at < ?)`,
    args: [through, userId, through],
  });
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
