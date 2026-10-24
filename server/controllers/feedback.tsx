/**
 * GET /feedback/@{author}/{slug} — a bug report or request for a game's
 * author.
 *
 * The report is the author's to read: the person who can act on "stage 3 lets
 * the ball through" is whoever made stage 3. The hub keeps it and shows it on
 * the author's `/dev`, and tells them it arrived.
 *
 * A page of its own rather than something inside the game, for the reason the
 * claim page is one. Sending needs to say who is sending, and a game holds no
 * session; a sandboxed one cannot even open a window. A plain link works from
 * anywhere, and here the player is signed in.
 *
 * The form is the {@link FeedbackForm} clientEntry: sending needs a DPoP proof,
 * and an SSR request carries none.
 */

import type { Action } from "@remix-run/fetch-router";

import { gameRef } from "@game-center/protocol";

import { FeedbackForm } from "../../client/feedback_form.tsx";
import { getDb } from "../db/client.ts";
import { findGame } from "../db/games.ts";
import { findUserById } from "../db/users.ts";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const feedbackPageAction = {
  async handler(context) {
    const { handle, slug } = context.params;
    const gameId = gameRef(handle, slug);
    const client = getDb();
    const game = client ? await findGame(client, gameId) : null;

    // A withdrawn game takes no reports; its author stepped away from it.
    if (!client || !game || game.status !== "active") {
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
    const author = await findUserById(client, game.ownerId);
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
          {author
            ? `不具合や「こうしてほしい」を、作者の ${author.displayName} さんに送れます。`
            : "不具合や「こうしてほしい」を、作者に送れます。"}
          {"返信の仕組みは無いので、気づいたことをそのまま書いてください。"}
        </p>
        <FeedbackForm
          handle={handle}
          slug={slug}
          gameTitle={game.title}
          gameHref={gameHref}
        />
      </main>,
      { title: `${game.title} へのフィードバック` },
    );
  },
} satisfies Action<typeof routes.feedback>;
