/**
 * GET /games/{id} — one game, its achievements, and the way in.
 *
 * The achievement list is server-rendered from the manifest, so it reads the
 * same for a visitor as for a signed-in player. Hidden achievements are shown
 * as locked without their wording: which ones exist is public, what they are
 * is not.
 */

import type { Action } from "@remix-run/fetch-router";

import { PlayButton } from "../../client/play_button.tsx";
import { getDb } from "../db/client.ts";
import { type Achievement, findGame, listAchievements } from "../db/games.ts";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const gamePageAction = {
  async handler(context) {
    const client = getDb();
    const game = client ? await findGame(client, context.params.id) : null;
    if (!client || !game) {
      return renderPage(
        context,
        <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
          <h1 class="text-3xl font-bold">ゲームが見つかりません</h1>
          <p>
            <code>{context.params.id}</code> は登録されていません。{" "}
            <a class="link" href={routes.home.href()} rmx-target="content">
              カタログ
            </a>{" "}
            に戻る。
          </p>
        </main>,
      );
    }

    const achievements = await listAchievements(client, game.id);
    const points = achievements.reduce((sum, a) => sum + a.points, 0);

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
            {game.description ? <p>{game.description}</p> : null}
            <p class="text-sm opacity-70 break-all">{game.url}</p>
          </div>
        </div>

        <div class="space-y-2">
          <PlayButton gameId={game.id} gameUrl={game.url} />
        </div>

        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">
              実績 {achievements.length} 件 / {points} ポイント
            </h2>
            {achievements.length === 0
              ? <p>このゲームはまだ実績を定義していません。</p>
              : (
                <ul class="space-y-3">
                  {achievements.map(achievementRow)}
                </ul>
              )}
          </div>
        </div>
      </main>,
    );
  },
} satisfies Action<typeof routes.game>;

/** One row of the achievement list. See `gameCard` on why it is not a component. */
function achievementRow(achievement: Achievement) {
  return (
    <li key={achievement.key} class="border-base-300 border-t pt-3">
      <div class="flex items-baseline gap-2">
        <span class="font-bold">
          {achievement.hidden ? "??????" : achievement.title}
        </span>
        <span class="badge badge-ghost badge-sm">{achievement.points} pt</span>
        {achievement.hidden
          ? <span class="badge badge-outline badge-sm">隠し実績</span>
          : null}
      </div>
      {!achievement.hidden && achievement.description
        ? <p class="text-sm opacity-70">{achievement.description}</p>
        : null}
    </li>
  );
}
