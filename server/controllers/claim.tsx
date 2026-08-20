/**
 * GET /claim/{game_id}/{key} — the unlock path that works everywhere.
 *
 * A game with no way to fetch anything (a Claude Artifact, a hand-written page
 * with no SDK) opens this URL, and the player confirms the unlock here. The
 * page names what is about to be recorded before the button is pressed, so the
 * player knows what a link they were handed actually does.
 *
 * The unlock itself is the {@link ClaimPanel} clientEntry: writing needs a DPoP
 * proof, and an SSR request carries none.
 */

import type { Action } from "@remix-run/fetch-router";

import { ClaimPanel } from "../../client/claim_panel.tsx";
import { getDb } from "../db/client.ts";
import { findGame, listAchievements } from "../db/games.ts";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const claimPageAction = {
  async handler(context) {
    const { gameId, key } = context.params;
    const client = getDb();
    const game = client ? await findGame(client, gameId) : null;
    const achievement = game
      ? (await listAchievements(client!, game.id)).find((a) => a.key === key)
      : undefined;

    if (!game || !achievement) {
      return renderPage(
        context,
        <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
          <h1 class="text-3xl font-bold">この実績は見つかりません</h1>
          <p>
            <code>{gameId}</code> の <code>{key}</code>{" "}
            は登録されていないか、すでに廃止されています。
            ゲーム側のマニフェストが更新されている可能性があります。
          </p>
          <a class="link" href={routes.home.href()} rmx-target="content">
            カタログに戻る
          </a>
        </main>,
      );
    }

    // `?score=1200`. Anything that is not a plain integer is ignored rather
    // than rejected: the score is optional, and a broken link should still let
    // the player record the unlock.
    const raw = context.url.searchParams.get("score");
    const parsed = raw === null ? Number.NaN : Number(raw);
    const score = Number.isInteger(parsed) ? parsed : null;

    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <h1 class="text-3xl font-bold">実績の記録</h1>
        <div class="card card-border bg-base-100">
          <div class="card-body space-y-2">
            <p class="text-sm opacity-70">
              <a
                class="link"
                href={routes.game.href({ id: game.id })}
                rmx-target="content"
              >
                {game.title}
              </a>
            </p>
            <h2 class="card-title">{achievement.title}</h2>
            {achievement.description ? <p>{achievement.description}</p> : null}
            <p class="text-sm opacity-70">
              {achievement.points} ポイント
              {score === null ? null : ` / スコア ${score}`}
            </p>
            <ClaimPanel
              gameId={game.id}
              achievementKey={achievement.key}
              score={score}
            />
          </div>
        </div>
        <p class="text-sm opacity-70">
          このページはゲームから渡されたリンクです。
          記録されるのは上の実績だけで、 ボタンを押すまで何も書き込まれません。
        </p>
      </main>,
    );
  },
} satisfies Action<typeof routes.claim>;
