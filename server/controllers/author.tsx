/**
 * GET /@{handle} — a player, what they have made, and what they have earned.
 *
 * The public face of a handle. A manifest names one, the catalog links to one,
 * and this is the page people are meant to post elsewhere. Everything on it is
 * public, deliberately: a follow is worth nothing if you cannot see what you
 * would be following before you decide.
 *
 * Server-rendered, with one exception. Whether the visitor follows this player
 * depends on the visitor, and SSR carries no DPoP proof, so `FollowButton`
 * fills that in from the browser.
 *
 * Author and player are not separate pages. They are the same account reached
 * at the same URL, which is also why there is one kind of follow rather than
 * two.
 */

import type { Action } from "@remix-run/fetch-router";

import { parseGameRef } from "@game-center/protocol";

import { FollowButton } from "../../client/follow_button.tsx";
import { getDb } from "../db/client.ts";
import { countFollows } from "../db/follows.ts";
import { listGamesOwnedBy } from "../db/games.ts";
import { listUnlocks, totalPoints, type Unlock } from "../db/unlocks.ts";
import { findUserByHandle } from "../db/users.ts";
import { publicTitle } from "../lib/spoilers.ts";
import { routes } from "../routes.ts";
import { profileMeta } from "../ui/share_cards.ts";
import { renderPage } from "../utils/render.tsx";

/** How much of a record to show before it stops being a summary. */
const RECENT_UNLOCKS = 20;

export const authorPageAction = {
  async handler(context) {
    const handle = context.params.handle;
    const client = getDb();
    const author = client ? await findUserByHandle(client, handle) : null;

    if (!client || !author) {
      return renderPage(
        context,
        <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
          <h1 class="text-3xl font-bold">この作者は見つかりません</h1>
          <p>
            <code>@{handle}</code> という作者はいません。{" "}
            <a class="link" href={routes.home.href()} data-rmx-target="content">
              カタログに戻る
            </a>
            。
          </p>
        </main>,
        { title: `@${handle} は見つかりません` },
      );
    }

    const [games, unlocks, follows, points] = await Promise.all([
      listGamesOwnedBy(client, author.id),
      listUnlocks(client, author.id),
      countFollows(client, author.id),
      totalPoints(client, author.id),
    ]);
    const active = games.filter((game) => game.status === "active");
    const recent = unlocks.slice(0, RECENT_UNLOCKS);

    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-8 p-8">
        <div class="space-y-3">
          <div>
            <h1 class="text-3xl font-bold">{author.displayName}</h1>
            <p class="opacity-70">@{author.handle}</p>
          </div>
          <FollowButton
            handle={author.handle}
            displayName={author.displayName}
            followers={follows.followers}
            followees={follows.followees}
          />
          {
            /* The cabinet's score panel, moved to where the score belongs.
              On the landing page it could only ever show the visitor their
              own; here it is part of what someone reads before deciding to
              follow, and it is server-rendered like the rest of the page. */
          }
          <dl class="stats stats-horizontal border-base-300 border">
            <div class="stat px-5 py-3">
              <dt class="stat-title text-xs">ポイント</dt>
              <dd class="stat-value text-2xl tabular-nums">{points}</dd>
            </div>
            <div class="stat px-5 py-3">
              <dt class="stat-title text-xs">実績</dt>
              <dd class="stat-value text-2xl tabular-nums">{unlocks.length}</dd>
            </div>
            <div class="stat px-5 py-3">
              <dt class="stat-title text-xs">ゲーム</dt>
              <dd class="stat-value text-2xl tabular-nums">{active.length}</dd>
            </div>
          </dl>
        </div>

        <section class="space-y-3">
          <h2 class="text-xl font-bold">作ったゲーム</h2>
          {active.length === 0
            ? <p class="opacity-70">公開しているゲームはまだありません。</p>
            : (
              <ul class="space-y-3">
                {active.map((game) => gameRow(game, author.handle))}
              </ul>
            )}
        </section>

        <section class="space-y-3">
          <h2 class="text-xl font-bold">解除した実績</h2>
          {recent.length === 0
            ? <p class="opacity-70">解除した実績はまだありません。</p>
            : <ul class="space-y-3">{recent.map(unlockRow)}</ul>}
          {unlocks.length > recent.length
            ? (
              <p class="text-sm opacity-70">
                ほか {unlocks.length - recent.length} 件
              </p>
            )
            : null}
        </section>
      </main>,
      profileMeta(author, {
        games: active.length,
        unlocks: unlocks.length,
        points,
        followers: follows.followers,
      }),
    );
  },
} satisfies Action<typeof routes.author>;

/** One of the player's games. See `gameCard` in home.tsx on why it is not a component. */
function gameRow(
  game: { id: string; slug: string; title: string; description: string | null },
  handle: string,
) {
  return (
    <li key={game.id} class="border-base-300 border-t pt-3">
      <a
        class="link link-hover font-bold"
        href={routes.game.href({ handle, slug: game.slug })}
        data-rmx-target="content"
      >
        {game.title}
      </a>
      {game.description
        ? <p class="text-sm opacity-70">{game.description}</p>
        : null}
    </li>
  );
}

/**
 * One unlocked achievement.
 *
 * Hidden achievements keep their title hidden even here. The page is public
 * and this is somebody else's record for almost everyone reading it; a player
 * who wants to read their own titles has `/me`. Spoiling a game to everyone
 * who visits its author's page would be a poor trade for a line of text.
 */
function unlockRow(unlock: Unlock) {
  const ref = parseGameRef(unlock.gameId);
  return (
    <li
      key={`${unlock.gameId}/${unlock.key}`}
      class="border-base-300 border-t pt-3"
    >
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="font-bold">{publicTitle(unlock)}</span>
        <span class="badge badge-ghost badge-sm">{unlock.points} pt</span>
        {unlock.score !== null
          ? <span class="badge badge-sm">{unlock.score}</span>
          : null}
      </div>
      <p class="text-sm opacity-70">
        {ref
          ? (
            <a
              class="link link-hover"
              href={routes.game.href({
                handle: ref.author,
                slug: ref.slug,
              })}
              data-rmx-target="content"
            >
              {unlock.gameTitle}
            </a>
          )
          : unlock.gameTitle}
        {" · "}
        {unlock.unlockedAt.slice(0, 10)}
      </p>
    </li>
  );
}
