/**
 * GET /feedback/@{author}/{slug} — a bug report or request about one game.
 *
 * Sending is id.kbn.one's, not the hub's: `POST {IdP}/feedback` stores the
 * report and posts it to the owner's home portal, in the thread for this
 * hub's host. The IdP takes who sent it from the DPoP session and where from
 * the browser's `Origin`, so the hub has nothing to vouch for and nothing to
 * store. What the hub adds is which game: the report's page is the game's
 * page here, and that is the line the owner reads it by.
 *
 * A page of its own rather than something inside the game, for the reason the
 * claim page is one. A game cannot reach the IdP — it is not a registered RP
 * and holds no session — and a sandboxed game cannot even open a window. A
 * plain link works from anywhere, and here the player is signed in.
 *
 * The form is the {@link FeedbackForm} clientEntry: sending needs a DPoP proof,
 * and an SSR request carries none.
 */

import type { Action } from "@remix-run/fetch-router";

import { gameRef } from "@game-center/protocol";

import { FeedbackForm } from "../../client/feedback_form.tsx";
import { getDb } from "../db/client.ts";
import { findGame } from "../db/games.ts";
import { routes } from "../routes.ts";
import { absoluteUrl } from "../ui/page_meta.ts";
import { renderPage } from "../utils/render.tsx";

export const feedbackPageAction = {
  async handler(context) {
    const { handle, slug } = context.params;
    const gameId = gameRef(handle, slug);
    const client = getDb();
    const game = client ? await findGame(client, gameId) : null;

    if (!game) {
      return renderPage(
        context,
        <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
          <h1 class="text-3xl font-bold">ゲームが見つかりません</h1>
          <p>
            <code>@{gameId}</code> は登録されていません。{" "}
            <a class="link" href={routes.home.href()} data-rmx-target="content">
              カタログ
            </a>{" "}
            に戻る。
          </p>
        </main>,
        { title: `@${gameId} は見つかりません` },
      );
    }

    const gameHref = routes.game.href({ handle, slug });
    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <div class="space-y-1">
          <p class="text-sm opacity-70">
            <a class="link" href={gameHref} data-rmx-target="content">
              {game.title}
            </a>
          </p>
          <h1 class="text-3xl font-bold">フィードバックを送る</h1>
        </div>
        <p>
          不具合や「こうしてほしい」を GameCenter の運営に送れます。
          返信はできないので、気づいたことをそのまま書いてください。
        </p>
        <FeedbackForm
          gameTitle={game.title}
          gameHref={gameHref}
          pageUrl={absoluteUrl(gameHref) ?? gameHref}
        />
      </main>,
      { title: `${game.title} へのフィードバック` },
    );
  },
} satisfies Action<typeof routes.feedback>;
