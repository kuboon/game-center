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

import { ClaimAllPanel } from "../../client/claim_all_panel.tsx";
import { ClaimPanel } from "../../client/claim_panel.tsx";
import { gameRef } from "@game-center/protocol";

import { getDb } from "../db/client.ts";
import { findGame, listAchievements } from "../db/games.ts";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const claimPageAction = {
  async handler(context) {
    const { handle, slug, key } = context.params;
    const gameId = gameRef(handle, slug);
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
            <code>@{gameId}</code> の <code>{key}</code>{" "}
            は登録されていないか、すでに廃止されています。
            ゲーム側のマニフェストが更新されている可能性があります。
          </p>
          <a class="link" href={routes.home.href()} data-rmx-target="content">
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
                href={routes.game.href({ handle, slug })}
                data-rmx-target="content"
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

/**
 * GET /claim/@{author}/{slug} — everything one game has waiting.
 *
 * The list itself is in the URL fragment, which never reaches here. So this
 * page renders only the frame around it — which game, and the promise that
 * nothing is written until a button is pressed — and {@link ClaimAllPanel}
 * fills in the rest in the browser.
 *
 * The per-achievement page above stays for the SDK copies already shipped
 * inside games: a game embeds its own copy, so the links out there keep
 * pointing at the old shape long after this one exists.
 */
export const claimAllPageAction = {
  async handler(context) {
    const { handle, slug } = context.params;
    const gameId = gameRef(handle, slug);
    const client = getDb();
    const game = client ? await findGame(client, gameId) : null;

    if (!game) {
      return renderPage(
        context,
        <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
          <h1 class="text-3xl font-bold">このゲームは見つかりません</h1>
          <p>
            <code>@{gameId}</code> は登録されていません。{" "}
            <a class="link" href={routes.home.href()} data-rmx-target="content">
              カタログに戻る
            </a>
            。
          </p>
        </main>,
      );
    }

    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <h1 class="text-3xl font-bold">実績の記録</h1>
        <div class="card card-border bg-base-100">
          <div class="card-body space-y-2">
            <p class="text-sm opacity-70">
              <a
                class="link"
                href={routes.game.href({ handle, slug })}
                data-rmx-target="content"
              >
                {game.title}
              </a>
            </p>
            <ClaimAllPanel gameId={game.id} gameUrl={game.url} />
          </div>
        </div>
        <p class="text-sm opacity-70">
          このページはゲームから渡されたリンクです。
          記録されるのは上に並んだ実績だけで、
          ボタンを押すまで何も書き込まれません。
        </p>
      </main>,
    );
  },
} satisfies Action<typeof routes.claimAll>;
