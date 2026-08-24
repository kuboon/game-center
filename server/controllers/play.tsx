/**
 * GET /play/@{author}/{slug} — the game in a frame, with the hub around it.
 *
 * This is the parent half of postMessage mode. The game asks its embedder to
 * record an achievement; the embedder is this page, which has the player's
 * session and can do it without the game holding any credential at all.
 *
 * What makes that safe is the origin check, and it happens in the browser
 * because that is the only place the message's origin is known. The page hands
 * the expected origin down to {@link PlayFrame}, which refuses anything else.
 *
 * Not every game can be framed. Claude Artifacts answer
 * `frame-ancestors 'self'`, so they cannot be embedded here at all — measured,
 * not assumed. Those games use claim URLs, which need no frame.
 */

import type { Action } from "@remix-run/fetch-router";
import { gameRef } from "@game-center/protocol";

import { PlayFrame } from "../../client/play_frame.tsx";
import { getDb } from "../db/client.ts";
import { findGame } from "../db/games.ts";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const playPageAction = {
  async handler(context) {
    const { handle, slug } = context.params;
    const ref = gameRef(handle, slug);
    const client = getDb();
    const game = client ? await findGame(client, ref) : null;

    if (!game) {
      return renderPage(
        context,
        <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
          <h1 class="text-3xl font-bold">ゲームが見つかりません</h1>
          <p>
            <code>@{ref}</code> は登録されていません。{" "}
            <a class="link" href={routes.home.href()} rmx-target="content">
              カタログに戻る
            </a>
            。
          </p>
        </main>,
      );
    }

    return renderPage(
      context,
      <main class="mx-auto w-full max-w-5xl space-y-4 p-4">
        <div class="flex items-baseline justify-between gap-4">
          <h1 class="text-xl font-bold">
            <a
              class="link link-hover"
              href={routes.game.href({ handle, slug })}
              rmx-target="content"
            >
              {game.title}
            </a>
          </h1>
          <a class="link text-sm break-all" href={game.url} rel="noreferrer">
            別のタブで開く
          </a>
        </div>
        <PlayFrame
          gameId={game.id}
          gameUrl={game.url}
          gameOrigin={new URL(game.url).origin}
        />
      </main>,
    );
  },
} satisfies Action<typeof routes.play>;
