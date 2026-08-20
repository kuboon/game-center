/**
 * GET /dev — the developer dashboard.
 *
 * The shell is server-rendered; everything that depends on who is signed in is
 * the {@link DevConsole} clientEntry, because an SSR request carries no DPoP
 * proof.
 */

import type { Action } from "@remix-run/fetch-router";

import { DevConsole } from "../../client/dev_console.tsx";
import type { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const devAction = {
  handler(context) {
    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <h1 class="text-3xl font-bold">開発者向け</h1>
        <p>
          ゲームを game-center
          に登録すると、プレイヤーの実績がハブに集まります。 登録の単位は{" "}
          <code>gamecenter.json</code>{" "}
          ひとつで、CI から送っても、このページから貼り付けてもかまいません。
          スキーマは{" "}
          <a class="link" href="/schema/gamecenter.json">
            /schema/gamecenter.json
          </a>{" "}
          にあります。
        </p>
        <DevConsole returnTo="/dev" />
      </main>,
    );
  },
} satisfies Action<typeof routes.dev>;
