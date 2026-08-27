/**
 * What the two shareable pages say about themselves.
 *
 * Kept out of the controllers because this is the part worth testing: the
 * server cannot be pointed at a local database (it uses the fetch-based libSQL
 * build, which has no `file:` support), so a test that renders a populated
 * page is not available. These take the data the controller already fetched
 * and are exercised directly.
 */

import type { Game } from "../db/games.ts";
import type { NamedUser } from "../db/users.ts";
import { absoluteUrl, type PageMeta, summarize } from "./page_meta.ts";

/**
 * A profile, as it appears when its owner posts the URL somewhere.
 *
 * This is the card that has to do the most work. It is the hub's main way of
 * reaching anybody, and the reader has usually never heard of game-center — so
 * it says what this person has made and played rather than naming features.
 */
export function profileMeta(
  author: NamedUser,
  counts: {
    games: number;
    unlocks: number;
    points: number;
    followers: number;
  },
): PageMeta {
  return {
    title: `${author.displayName} (@${author.handle})`,
    description: summarize(
      `ゲーム ${counts.games} 本、` +
        `解除した実績 ${counts.unlocks} 件 / ${counts.points} ポイント。` +
        `フォロワー ${counts.followers} 人。`,
    ),
    // From the IdP, when there is one. Nothing is generated to stand in.
    image: absoluteUrl(author.avatarUrl),
    type: "profile",
  };
}

/** A game, as it appears when somebody posts its page. */
export function gameMeta(
  game: Game,
  counts: { achievements: number; points: number },
  authorHandle?: string | null,
): PageMeta {
  return {
    title: game.title,
    // The game's own words when it has any. Otherwise say what this page is
    // for, which is the achievements.
    description: summarize(game.description) ??
      summarize(
        `実績 ${counts.achievements} 件 / ${counts.points} ポイント。` +
          (authorHandle ? `作者 @${authorHandle}。` : ""),
      ),
    // Straight from the manifest, and absent when the manifest gave none.
    image: absoluteUrl(game.iconUrl),
  };
}
