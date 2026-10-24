/**
 * GET /@{author}/{slug} — one game, its achievements, and the way in.
 *
 * The achievement list is server-rendered from the manifest, so it reads the
 * same for a visitor, a crawler, and a browser without JavaScript. A signed-in
 * player's own state — marks, scores, progress, the people they follow — is
 * laid over that same list by `AchievementBoard` once the session answers.
 *
 * Hidden achievements go out without their wording, in the markup and in the
 * component's props alike: which ones exist is public, what they are is not.
 */

import type { Action } from "@remix-run/fetch-router";

import { AchievementBoard } from "../../client/achievement_board.tsx";
import { FollowButton } from "../../client/follow_button.tsx";
import { PlayButton } from "../../client/play_button.tsx";
import { ShareRow } from "../../client/share_row.tsx";
import { getDb } from "../db/client.ts";
import { gameRef } from "@game-center/protocol";

import { findGame, listAchievements } from "../db/games.ts";
import { findUserByHandle } from "../db/users.ts";
import { routes } from "../routes.ts";
import { gameMeta } from "../ui/share_cards.ts";
import { renderPage } from "../utils/render.tsx";

export const gamePageAction = {
  async handler(context) {
    const { handle, slug } = context.params;
    const ref = gameRef(handle, slug);
    const client = getDb();
    const game = client ? await findGame(client, ref) : null;
    if (!client || !game) {
      return renderPage(
        context,
        <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
          <h1 class="text-3xl font-bold">ゲームが見つかりません</h1>
          <p>
            <code>@{ref}</code> は登録されていません。{" "}
            <a class="link" href={routes.home.href()} data-rmx-target="content">
              カタログ
            </a>{" "}
            に戻る。
          </p>
        </main>,
        { title: `@${ref} は見つかりません` },
      );
    }

    const achievements = await listAchievements(client, game.id);
    const points = achievements.reduce((sum, a) => sum + a.points, 0);
    const author = await findUserByHandle(client, handle);

    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <div class="flex items-start gap-4">
          {game.iconUrl
            ? (
              <img
                src={game.iconUrl}
                alt=""
                class="h-16 w-16 rounded-box object-cover"
              />
            )
            : null}
          <div class="space-y-1">
            <h1 class="text-3xl font-bold">{game.title}</h1>
            {
              /* The display name, not the handle. A handle here is the
                identifier the IdP issued — unique, stable, and unreadable.
                It stays in the URL, where it has to be. */
            }
            {author
              ? (
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p class="text-sm opacity-70">
                    作者 {author.handle
                      ? (
                        <a
                          class="link"
                          href={routes.author.href({ handle: author.handle })}
                          data-rmx-target="content"
                        >
                          {author.displayName}
                        </a>
                      )
                      : author.displayName}
                  </p>
                  {
                    /* Following starts here more often than on the profile:
                      somebody who just found a game they like is one press
                      away from the next one its author makes. The counts and
                      the pitch stay on the profile — see `compact`. */
                  }
                  {author.handle
                    ? (
                      <FollowButton
                        handle={author.handle}
                        displayName={author.displayName}
                        compact
                      />
                    )
                    : null}
                </div>
              )
              : null}
            {game.description ? <p>{game.description}</p> : null}
            <p class="text-sm opacity-70 break-all">{game.url}</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-4">
          <PlayButton gameId={game.id} gameUrl={game.url} />
          {/* The other thing to do with a game you like: hand it to someone. */}
          <ShareRow />
        </div>

        <AchievementBoard
          handle={handle}
          slug={slug}
          achievements={achievements.map((achievement) => ({
            key: achievement.key,
            title: achievement.hidden ? null : achievement.title,
            description: achievement.hidden ? null : achievement.description,
            points: achievement.points,
            hidden: achievement.hidden,
          }))}
        />

        {
          /* Reachable without the game's help: a game that never adopted
            `feedbackLink()` still has players with something to say. */
        }
        <p class="text-sm opacity-70">
          不具合や要望は{" "}
          <a
            class="link"
            href={routes.feedback.href({ handle, slug })}
            data-rmx-target="content"
          >
            フィードバック
          </a>
          から。
        </p>
      </main>,
      gameMeta(
        game,
        { achievements: achievements.length, points },
        author?.handle,
      ),
    );
  },
} satisfies Action<typeof routes.game>;
