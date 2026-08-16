/**
 * GET / — the catalog page.
 *
 * M0 renders a placeholder; the real catalog (game list from Turso) arrives
 * with M4.
 */

import type { Action } from "@remix-run/fetch-router";

import type { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const homeAction = {
  handler(context) {
    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <h1 class="text-3xl font-bold">game-center</h1>
        <p>
          いろんなミニゲームの実績を集めて管理するハブです。
          ゲームは第三者が作り、GitHub Pages や Claude Artifacts
          など、サーバのない場所で動きます。
        </p>
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">準備中</h2>
            <p>
              ゲームカタログと実績一覧はこれから実装します。 プロトコルの仕様は
              {" "}
              <code>docs/grand_design.md</code> にまとまっています。
            </p>
          </div>
        </div>
      </main>,
    );
  },
} satisfies Action<typeof routes.home>;
