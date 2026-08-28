/**
 * GET / — the landing page.
 *
 * A cabinet rather than a list. The people this page is for came to play, not
 * to publish, so the developer path is the second button and nothing else.
 *
 * Still server-rendered from the game list: the catalog is the same for
 * everyone and should be readable, and indexable, with JavaScript switched
 * off. The cabinet is markup and CSS only, so none of it waits on the bundle.
 * The one thing that depends on who is looking — the sections built from who
 * the visitor follows — arrives from the browser and is absent until it does.
 * Their own record is not here at all: it lives on their profile, which is the
 * page they would send someone to anyway.
 *
 * This page is dark in both themes. Everything else follows the visitor's
 * daisyUI preference, because everything else is a tool; a cabinet is dark so
 * that it can glow.
 */

import type { Action } from "@remix-run/fetch-router";

import { CatalogSections } from "../../client/catalog_sections.tsx";
import { getDb } from "../db/client.ts";
import { type CatalogGame, listCatalogGames } from "../db/games.ts";
import { routes } from "../routes.ts";
import { SITE_NAME } from "../ui/page_meta.ts";
import { renderPage } from "../utils/render.tsx";

export const homeAction = {
  async handler(context) {
    const client = getDb();
    const games = client ? await listCatalogGames(client) : [];

    // PRESS START goes to the newest game rather than to a menu: the visitor
    // asked to play, and the catalog is right below the fold anyway.
    const newest = games[0];

    return renderPage(
      context,
      <main class="bg-arcade-screen text-arcade-ink">
        <section class="from-arcade-shell to-arcade-screen bg-linear-to-b px-4 pt-10 pb-8 sm:px-8 sm:pt-14">
          <div class="mx-auto w-full max-w-5xl">
            <div class="mb-4 flex items-center justify-center gap-3 sm:gap-4">
              <span class="animate-bulb bg-arcade-amber size-3 rounded-full shadow-[0_0_14px_currentColor]" />
              <span class="animate-bulb bg-arcade-pink size-3 rounded-full shadow-[0_0_14px_currentColor] [animation-delay:0.3s]" />
              <span class="animate-bulb bg-arcade-pink size-3 rounded-full shadow-[0_0_14px_currentColor] [animation-delay:0.6s]" />
              <span class="animate-bulb bg-arcade-amber size-3 rounded-full shadow-[0_0_14px_currentColor] [animation-delay:0.9s]" />
            </div>

            <div class="crt-lines border-arcade-edge bg-arcade-screen relative overflow-hidden rounded-3xl border-4 px-6 py-12 shadow-[inset_0_0_90px_rgba(126,231,255,0.14)] sm:px-12 sm:py-14">
              <div class="animate-scan from-arcade-cyan/15 pointer-events-none absolute inset-x-0 top-0 h-16 bg-linear-to-b to-transparent" />

              <div class="relative flex flex-col items-center gap-6 text-center">
                <h1 class="text-4xl leading-tight font-black text-pretty sm:text-6xl">
                  パパッと作って
                  <br />
                  <span class="text-arcade-amber drop-shadow-[0_0_24px_rgba(255,217,61,0.55)]">
                    みんなで遊ぼう！
                  </span>
                </h1>
                <p class="text-arcade-dim max-w-[34em] text-sm leading-relaxed text-pretty sm:text-base">
                  ミニゲームの実績が集まるハブです。誰かが作ったゲームを遊ぶたびに、
                  バッジとポイントがあなたのアカウントに積まれていきます。
                </p>

                <div class="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
                  <a
                    class="font-dot bg-arcade-pink w-full rounded-xl px-10 py-4 text-center text-xl tracking-wider text-white shadow-[0_0_30px_rgba(255,93,143,0.5)] transition hover:brightness-110 sm:w-auto"
                    href={newest
                      ? routes.game.href({
                        handle: newest.authorHandle ?? "",
                        slug: newest.slug,
                      })
                      : routes.dev.href()}
                    rmx-target="content"
                  >
                    PRESS START
                  </a>
                  <a
                    class="font-dot text-arcade-ink hover:border-arcade-cyan hover:text-arcade-cyan w-full rounded-xl border-2 border-white/20 px-7 py-4 text-center text-lg transition sm:w-auto"
                    href={routes.dev.href()}
                    rmx-target="content"
                  >
                    ゲームを登録
                  </a>
                </div>

                <span class="animate-attract font-dot text-arcade-cyan text-xs sm:text-sm">
                  ▼ {games.length} GAMES AVAILABLE
                </span>
              </div>
            </div>
          </div>
        </section>

        <div class="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-8">
          <CatalogSections />
        </div>

        <section class="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-8">
          <h2 class="font-dot text-arcade-amber mb-4 text-lg tracking-[0.12em]">
            SELECT GAME
          </h2>
          {games.length === 0
            ? emptyCatalog()
            : (
              <ul class="grid gap-3 sm:grid-cols-2">
                {games.map(gameCard)}
              </ul>
            )}
        </section>
      </main>,
      {
        title: SITE_NAME,
        description:
          "いろんなミニゲームの実績を集めて管理するハブです。ゲームは第三者が作り、" +
          "GitHub Pages や Claude Artifacts など、サーバのない場所で動きます。",
      },
    );
  },
} satisfies Action<typeof routes.home>;

/**
 * One cabinet in the row.
 *
 * A plain function rather than a component: `@remix-run/ui` components take a
 * handle and return a render function, which is more machinery than a piece of
 * static markup needs.
 */
function gameCard(game: CatalogGame) {
  const handle = game.authorHandle;
  return (
    <li
      key={game.id}
      class="border-arcade-edge bg-arcade-panel hover:border-arcade-cyan rounded-xl border-2 transition"
    >
      <a
        class="flex gap-4 p-4"
        href={routes.game.href({ handle: handle ?? "", slug: game.slug })}
        rmx-target="content"
      >
        {game.iconUrl
          ? (
            <img
              class="size-14 shrink-0 rounded-lg object-cover"
              src={game.iconUrl}
              alt=""
            />
          )
          : (
            <span class="font-dot from-arcade-cyan text-arcade-screen grid size-14 shrink-0 place-items-center rounded-lg bg-linear-to-br to-primary text-xl">
              {game.title.slice(0, 1)}
            </span>
          )}
        <span class="flex min-w-0 flex-col gap-1">
          <span class="truncate font-bold">{game.title}</span>
          <span class="text-arcade-dim truncate text-xs">
            {game.authorName}
          </span>
          {game.description
            ? (
              <span class="text-arcade-dim line-clamp-2 text-xs">
                {game.description}
              </span>
            )
            : null}
          <span class="font-dot text-arcade-amber text-xs">
            {game.totalPoints} PT / 実績 {game.achievementCount}
          </span>
        </span>
      </a>
    </li>
  );
}

/** No games yet — the one case where the developer path is the main way on. */
function emptyCatalog() {
  return (
    <div class="border-arcade-edge rounded-xl border-2 border-dashed p-6">
      <h3 class="font-dot text-arcade-cyan mb-2 text-base">
        INSERT FIRST GAME
      </h3>
      <p class="text-arcade-dim text-sm leading-relaxed">
        まだゲームがありません。最初の一本を登録してみませんか。{" "}
        <a
          class="text-arcade-amber underline"
          href={routes.dev.href()}
          rmx-target="content"
        >
          開発者向けページ
        </a>{" "}
        から <code>gamecenter.json</code> を送るだけです。
      </p>
    </div>
  );
}
