/**
 * GET /@{handle} — an author and what they have made.
 *
 * The public face of a handle. A manifest names one, the catalog links to one,
 * and this is where that link lands. Server-rendered: an author's games are the
 * same for everyone looking.
 */

import type { Action } from "@remix-run/fetch-router";

import { getDb } from "../db/client.ts";
import { listGamesOwnedBy } from "../db/games.ts";
import { findUserByHandle } from "../db/users.ts";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

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
            <a class="link" href={routes.home.href()} rmx-target="content">
              カタログに戻る
            </a>
            。
          </p>
        </main>,
      );
    }

    const games = (await listGamesOwnedBy(client, author.id))
      .filter((game) => game.status === "active");

    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <div>
          <h1 class="text-3xl font-bold">{author.displayName}</h1>
          <p class="opacity-70">@{author.handle}</p>
        </div>

        {games.length === 0
          ? <p>公開しているゲームはまだありません。</p>
          : (
            <ul class="space-y-3">
              {games.map((game) => (
                <li key={game.id} class="border-base-300 border-t pt-3">
                  <a
                    class="link link-hover font-bold"
                    href={routes.game.href({ id: game.id })}
                    rmx-target="content"
                  >
                    {game.title}
                  </a>
                  {game.description
                    ? <p class="text-sm opacity-70">{game.description}</p>
                    : null}
                </li>
              ))}
            </ul>
          )}
      </main>,
    );
  },
} satisfies Action<typeof routes.author>;
