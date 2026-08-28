/**
 * What the people you follow have been doing.
 *
 * Two kinds of event, read from the tables that already record them: an
 * achievement someone unlocked, and a game someone registered. There is no
 * events table — a feed built from a log would have to be written on every
 * unlock and would drift from the rows it describes. These are the rows.
 *
 * Confined to the viewer's follows, and to them alone. There is no "everyone"
 * feed and there will not be one: an unlock is a claim rather than a fact, and
 * a page that ranks or aggregates strangers is where making a false one starts
 * to pay. See docs/grand_design.md, "偽装は防がない、代わりに誰を見るかを選ばせる".
 *
 * The viewer's own rows are not in it. A timeline is for what other people did.
 */

import { MASKED_TITLE } from "../lib/spoilers.ts";

import type { Client } from "./client.ts";

/** One thing that happened, as the timeline shows it. */
export interface TimelineEvent {
  readonly kind: "unlock" | "game";
  /** ISO-8601 UTC, and the only thing the ordering depends on. */
  readonly at: string;
  /** Who did it. */
  readonly handle: string;
  readonly displayName: string;
  /** The game it happened in or to, as `{handle}/{slug}`. */
  readonly gameId: string;
  readonly gameSlug: string;
  readonly gameTitle: string;
  /** The game's author handle, for the link. Null only if it went missing. */
  readonly gameAuthorHandle: string | null;
  /** Set on an unlock: the achievement, already masked if it is hidden. */
  readonly achievementTitle: string | null;
  readonly points: number | null;
  readonly score: number | null;
  /** True when the achievement is hidden, so the title above is masked. */
  readonly hidden: boolean;
}

/**
 * The timeline for one viewer, newest first.
 *
 * Hidden achievements arrive with their titles already masked. The masking has
 * to happen here rather than in the page: the response leaves the server, and
 * a title stripped in the browser is a title that was still sent.
 *
 * @param client Database to read from
 * @param viewerId The player whose follows decide whose events appear
 * @param limit How many events to return
 */
export async function listFollowedTimeline(
  client: Client,
  viewerId: number,
  limit: number,
): Promise<TimelineEvent[]> {
  const result = await client.execute({
    sql: `select 'unlock' as kind,
                 user_achievements.unlocked_at as at,
                 actor.handle as handle, actor.display_name as display_name,
                 games.id as game_id, games.slug as game_slug,
                 games.title as game_title,
                 owner.handle as game_author_handle,
                 achievements.title as achievement_title,
                 achievements.points as points,
                 user_achievements.score as score,
                 achievements.hidden as hidden
            from user_achievements
            join achievements
              on achievements.id = user_achievements.achievement_id
            join games on games.id = achievements.game_id
            join users owner on owner.id = games.owner_id
            join users actor on actor.id = user_achievements.user_id
           where actor.handle is not null
             and actor.id in (select followee_id from follows
                               where follower_id = ?)

           union all

          select 'game' as kind,
                 games.created_at as at,
                 owner.handle as handle, owner.display_name as display_name,
                 games.id as game_id, games.slug as game_slug,
                 games.title as game_title,
                 owner.handle as game_author_handle,
                 null as achievement_title,
                 null as points,
                 null as score,
                 0 as hidden
            from games
            join users owner on owner.id = games.owner_id
           where games.status = 'active'
             and owner.handle is not null
             and owner.id in (select followee_id from follows
                               where follower_id = ?)

           order by at desc
           limit ?`,
    args: [viewerId, viewerId, limit],
  });
  return result.rows.map(toEvent);
}

function toEvent(row: Record<string, unknown>): TimelineEvent {
  const hidden = Number(row.hidden) === 1;
  const title = row.achievement_title === null
    ? null
    : String(row.achievement_title);
  return {
    kind: String(row.kind) === "game" ? "game" : "unlock",
    at: String(row.at),
    handle: String(row.handle),
    displayName: String(row.display_name),
    gameId: String(row.game_id),
    gameSlug: String(row.game_slug),
    gameTitle: String(row.game_title),
    gameAuthorHandle: row.game_author_handle === null
      ? null
      : String(row.game_author_handle),
    achievementTitle: title === null ? null : hidden ? MASKED_TITLE : title,
    points: row.points === null ? null : Number(row.points),
    score: row.score === null ? null : Number(row.score),
    hidden,
  };
}
