/**
 * Unlocking achievements, and reading back what a player has.
 *
 * Unlocking is idempotent by design: a game may report the same achievement on
 * every load, and the second report must not move `unlocked_at` or create a
 * second row. Score is the one thing a later report can change, and only
 * upward — the record is a personal best, not a last-seen value.
 *
 * Retired achievements cannot be unlocked. They exist so old unlocks keep
 * meaning something, not as a target a game can still hand out.
 */

import type { Client } from "./client.ts";

/**
 * How an unlock reached the hub. Mirrors the `via` check constraint.
 *
 * `postmessage` is history. The hub used to embed games in an iframe and
 * record what a game asked its embedder to record; that mode is gone, but the
 * rows it wrote are players' records and stay readable. The value also stays
 * in the check constraint, because dropping one means recreating a table that
 * has rows in it, which a migration cannot do here (see db/README.md).
 */
export type UnlockVia = "claim" | "rest" | "postmessage";

/** How an unlock can be recorded now. The hub no longer writes `postmessage`. */
export type NewUnlockVia = Exclude<UnlockVia, "postmessage">;

/** Raised when the game or achievement named does not exist, or is retired. */
export class UnknownAchievementError extends Error {
  override readonly name = "UnknownAchievementError";
}

/** One of a player's unlocked achievements, with the game it belongs to. */
export interface Unlock {
  readonly gameId: string;
  readonly gameTitle: string;
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly points: number;
  /**
   * Whether the manifest keeps this achievement's name secret until it is
   * earned. Carried on the unlock because a profile page is public: the owner
   * has earned the right to read the title, and a visitor reading their page
   * has not.
   */
  readonly hidden: boolean;
  readonly unlockedAt: string;
  readonly score: number | null;
  readonly via: UnlockVia;
}

/** What an unlock call did, so the caller can tell the player. */
export interface UnlockResult {
  /** True when this call unlocked the achievement for the first time. */
  readonly created: boolean;
  /** True when this call raised a previously recorded score. */
  readonly scoreImproved: boolean;
  readonly unlock: Unlock;
}

/**
 * Record an unlock, or fold a new score into an existing one.
 *
 * @param client Database to write to
 * @param userId The player
 * @param gameId The game reporting the unlock
 * @param key The achievement key, as the manifest declares it
 * @param options How it was reported, and the score if any
 * @returns What changed, and the resulting record
 * @throws {UnknownAchievementError} when the game has no such live
 * achievement — retired, or the game itself withdrawn
 */
export async function unlockAchievement(
  client: Client,
  userId: number,
  gameId: string,
  key: string,
  { via, score = null }: { via: NewUnlockVia; score?: number | null },
): Promise<UnlockResult> {
  // Live means both halves: the manifest still declares it, and the game is
  // still in the hub. A withdrawn game stops taking records the moment its
  // author withdraws it, without any of the old ones moving.
  const found = await client.execute({
    sql: `select achievements.id
            from achievements
            join games on games.id = achievements.game_id
           where achievements.game_id = ? and achievements.key = ?
             and achievements.retired = 0 and games.status = 'active'`,
    args: [gameId, key],
  });
  const row = found.rows[0];
  if (!row) {
    throw new UnknownAchievementError(
      `${gameId} has no achievement named "${key}"`,
    );
  }
  const achievementId = Number(row.id);

  const existing = await client.execute({
    sql:
      "select score from user_achievements where user_id = ? and achievement_id = ?",
    args: [userId, achievementId],
  });
  const previous = existing.rows[0];
  const previousScore = previous
    ? (previous.score === null ? null : Number(previous.score))
    : null;

  if (!previous) {
    await client.execute({
      sql: `insert into user_achievements (user_id, achievement_id, via, score)
            values (?, ?, ?, ?)`,
      args: [userId, achievementId, via, score],
    });
  } else if (
    score !== null && (previousScore === null || score > previousScore)
  ) {
    // Only the score moves. `unlocked_at` and `via` record the first unlock,
    // which is what the player actually did first.
    await client.execute({
      sql:
        "update user_achievements set score = ? where user_id = ? and achievement_id = ?",
      args: [score, userId, achievementId],
    });
  }

  const unlock = await findUnlock(client, userId, achievementId);
  if (!unlock) {
    throw new Error(`Unlock of ${gameId}/${key} vanished right after writing`);
  }
  return {
    created: !previous,
    scoreImproved: Boolean(previous) && unlock.score !== previousScore,
    unlock,
  };
}

/** One achievement a bulk caller wants recorded. */
export interface UnlockRequest {
  readonly key: string;
  readonly score?: number | null;
}

/** What became of one entry in a bulk unlock. */
export type UnlockOutcome =
  | ({ readonly key: string; readonly ok: true } & UnlockResult)
  | { readonly key: string; readonly ok: false };

/**
 * Record several unlocks for one game at once.
 *
 * One bad key does not sink the batch. A game replaying a queue it kept while
 * offline can be carrying an achievement the manifest has since retired, and
 * refusing the whole list would lose the other nine. Each entry answers for
 * itself, and `ok: false` means the game has no such live achievement.
 *
 * Entries run concurrently because they touch different rows, and the calls go
 * to Turso over HTTP where the round trip dominates. Duplicate keys are folded
 * first — the same key twice would otherwise race itself into the unique
 * constraint — keeping the highest score, which is the one that would survive
 * anyway.
 *
 * @param client Database to write to
 * @param userId The player
 * @param gameId The game reporting the unlocks
 * @param requests What to record, in the caller's order
 * @param via How they were reported
 * @returns One outcome per distinct key, in the order first seen
 */
export async function unlockMany(
  client: Client,
  userId: number,
  gameId: string,
  requests: readonly UnlockRequest[],
  via: NewUnlockVia,
): Promise<UnlockOutcome[]> {
  const folded = new Map<string, number | null>();
  for (const { key, score = null } of requests) {
    if (!folded.has(key)) {
      folded.set(key, score);
      continue;
    }
    const kept = folded.get(key) ?? null;
    if (score !== null && (kept === null || score > kept)) {
      folded.set(key, score);
    }
  }

  return await Promise.all(
    [...folded].map(async ([key, score]): Promise<UnlockOutcome> => {
      try {
        const result = await unlockAchievement(client, userId, gameId, key, {
          via,
          score,
        });
        return { key, ok: true, ...result };
      } catch (cause) {
        if (cause instanceof UnknownAchievementError) return { key, ok: false };
        throw cause;
      }
    }),
  );
}

const UNLOCK_COLUMNS = `select games.id as game_id, games.title as game_title,
         achievements.key, achievements.title, achievements.description,
         achievements.points, achievements.hidden,
         user_achievements.unlocked_at,
         user_achievements.score, user_achievements.via
    from user_achievements
    join achievements on achievements.id = user_achievements.achievement_id
    join games on games.id = achievements.game_id`;

async function findUnlock(
  client: Client,
  userId: number,
  achievementId: number,
): Promise<Unlock | null> {
  const result = await client.execute({
    sql:
      `${UNLOCK_COLUMNS} where user_achievements.user_id = ? and user_achievements.achievement_id = ?`,
    args: [userId, achievementId],
  });
  const row = result.rows[0];
  return row ? toUnlock(row) : null;
}

/**
 * Everything a player has unlocked, newest first.
 *
 * Retired achievements are included: the player earned them, and hiding them
 * would make their record shrink when a developer edits a manifest.
 */
export async function listUnlocks(
  client: Client,
  userId: number,
): Promise<Unlock[]> {
  const result = await client.execute({
    sql: `${UNLOCK_COLUMNS} where user_achievements.user_id = ?
          order by user_achievements.unlocked_at desc, achievements.id desc`,
    args: [userId],
  });
  return result.rows.map(toUnlock);
}

/** What a player has unlocked in one game, in manifest order. */
export async function listUnlocksForGame(
  client: Client,
  userId: number,
  gameId: string,
): Promise<Unlock[]> {
  const result = await client.execute({
    sql: `${UNLOCK_COLUMNS}
          where user_achievements.user_id = ? and games.id = ?
          order by achievements.sort_order, achievements.id`,
    args: [userId, gameId],
  });
  return result.rows.map(toUnlock);
}

/**
 * One player's unlock of one achievement, as it appears next to somebody
 * else's.
 */
export interface PeerUnlock {
  readonly key: string;
  readonly title: string;
  readonly hidden: boolean;
  readonly handle: string;
  readonly displayName: string;
  readonly score: number | null;
  readonly unlockedAt: string;
  /** True for the viewer's own row, so it can be marked as theirs. */
  readonly self: boolean;
}

/**
 * What the viewer and the people they follow have unlocked in one game.
 *
 * The viewer is included on purpose: the point of the list is comparison, and
 * a comparison you are not in is just a list of other people.
 *
 * Confined to people the viewer chose. There is no game-wide leaderboard here
 * and there will not be one — an unlock is a claim, not a fact, and a ranking
 * is the place where making a false one starts to pay. See
 * docs/grand_design.md, "偽装は防がない、代わりに誰を見るかを選ばせる".
 *
 * Ordered by the manifest's own achievement order, then by score with the
 * highest first, then by who got there earliest. Unscored unlocks sort after
 * scored ones rather than in front of them.
 *
 * @param client Database to read from
 * @param viewerId The player looking, whose follows decide who else appears
 * @param gameId The game being looked at
 */
export async function listUnlocksAmongFollowed(
  client: Client,
  viewerId: number,
  gameId: string,
): Promise<PeerUnlock[]> {
  const result = await client.execute({
    sql: `select achievements.key, achievements.title, achievements.hidden,
                 users.handle, users.display_name,
                 user_achievements.score, user_achievements.unlocked_at,
                 user_achievements.user_id = ? as self
            from user_achievements
            join achievements
              on achievements.id = user_achievements.achievement_id
            join users on users.id = user_achievements.user_id
           where achievements.game_id = ?
             and users.handle is not null
             and (user_achievements.user_id = ?
                  or user_achievements.user_id in
                     (select followee_id from follows where follower_id = ?))
           order by achievements.sort_order, achievements.id,
                    user_achievements.score is null,
                    user_achievements.score desc,
                    user_achievements.unlocked_at asc`,
    args: [viewerId, gameId, viewerId, viewerId],
  });
  return result.rows.map((row) => ({
    key: String(row.key),
    title: String(row.title),
    hidden: Number(row.hidden) === 1,
    handle: String(row.handle),
    displayName: String(row.display_name),
    score: row.score === null ? null : Number(row.score),
    unlockedAt: String(row.unlocked_at),
    self: Number(row.self) === 1,
  }));
}

/** Total points a player has earned, across every game. */
export async function totalPoints(
  client: Client,
  userId: number,
): Promise<number> {
  const result = await client.execute({
    sql: `select coalesce(sum(achievements.points), 0) as points
            from user_achievements
            join achievements on achievements.id = user_achievements.achievement_id
           where user_achievements.user_id = ?`,
    args: [userId],
  });
  return Number(result.rows[0].points);
}

function toUnlock(row: Record<string, unknown>): Unlock {
  return {
    gameId: String(row.game_id),
    gameTitle: String(row.game_title),
    key: String(row.key),
    title: String(row.title),
    description: row.description === null ? null : String(row.description),
    points: Number(row.points),
    hidden: Number(row.hidden) === 1,
    unlockedAt: String(row.unlocked_at),
    score: row.score === null ? null : Number(row.score),
    via: String(row.via) as UnlockVia,
  };
}
