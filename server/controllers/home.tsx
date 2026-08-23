/**
 * GET / — the catalog.
 *
 * Server-rendered from the game list, because a catalog is the same for
 * everyone and should be readable (and indexable) without JavaScript. Only the
 * 遊ぶ button on a game's page needs to know who is looking.
 */

import type { Action } from "@remix-run/fetch-router";

import { getDb } from "../db/client.ts";
import { type GameWithAuthor, listGamesWithAuthors } from "../db/games.ts";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const homeAction = {
  async handler(context) {
    const client = getDb();
    const games = client ? await listGamesWithAuthors(client) : [];

    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <h1 class="text-3xl font-bold">game-center</h1>
        <p>
          いろんなミニゲームの実績を集めて管理するハブです。
          ゲームは第三者が作り、GitHub Pages や Claude Artifacts
          など、サーバのない場所で動きます。
        </p>

        {games.length === 0
          ? (
            <div class="card card-border bg-base-100">
              <div class="card-body">
                <h2 class="card-title">まだゲームがありません</h2>
                <p>
                  最初の一本を登録してみませんか。{" "}
                  <a class="link" href={routes.dev.href()} rmx-target="content">
                    開発者向けページ
                  </a>{" "}
                  から <code>gamecenter.json</code> を送るだけです。
                </p>
              </div>
            </div>
          )
          : (
            <ul class="grid gap-4 sm:grid-cols-2">
              {games.map(gameCard)}
            </ul>
          )}
      </main>,
    );
  },
} satisfies Action<typeof routes.home>;

/**
 * One card in the catalog grid.
 *
 * A plain function rather than a component: `@remix-run/ui` components take a
 * handle and return a render function, which is more machinery than a piece of
 * static markup needs.
 */
function gameCard(game: GameWithAuthor) {
  return (
    <li key={game.id} class="card card-border bg-base-100">
      <div class="card-body">
        <h2 class="card-title">
          <a
            class="link link-hover"
            href={routes.game.href({
              handle: game.authorHandle ?? "",
              slug: game.slug,
            })}
            rmx-target="content"
          >
            {game.title}
          </a>
        </h2>
        {game.description ? <p class="text-sm">{game.description}</p> : null}
        <p class="text-sm opacity-70">
          {game.authorHandle
            ? (
              <a
                class="link"
                href={routes.author.href({ handle: game.authorHandle })}
                rmx-target="content"
              >
                @{game.authorHandle}
              </a>
            )
            : game.authorName}
        </p>
      </div>
    </li>
  );
}
