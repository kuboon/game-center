/**
 * GET /me — the player's own page.
 *
 * First, who followed you — the one thing here that happened *to* the player
 * rather than because of them, and so the one thing they would never think to
 * go and check. Then a timeline: what the people you follow have unlocked and
 * registered, newest first, every row one click from the game.
 *
 * Your own record comes after, summed up per game, because you already know
 * what you did. Each game links to its page, which is where single
 * achievements are read; the page that shows your record to other people is
 * `/@{handle}`, and the record links there too.
 *
 * Installing, notifications and the account sit folded at the bottom. They are
 * set up once and then left alone, and every visit after that would otherwise
 * scroll past three cards to reach nothing.
 *
 * Registering a game is not here. That belongs on `/dev` with the rest of the
 * developer path; a player who never publishes anything should not have to
 * scroll past it.
 *
 * Rendered without knowing who the visitor is: an SSR document carries no DPoP
 * proof, so the signed-in parts are `clientEntry` components that fill
 * themselves in after hydration.
 */

import type { Action } from "@remix-run/fetch-router";

import { AccountCard } from "../../client/account_card.tsx";
import { Followers } from "../../client/followers.tsx";
import { InstallCard } from "../../client/install_card.tsx";
import { MyRecord } from "../../client/my_record.tsx";
import { NotifyCard } from "../../client/notify_card.tsx";
import { Timeline } from "../../client/timeline.tsx";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const meAction = {
  handler(context) {
    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <h1 class="text-3xl font-bold">マイページ</h1>

        <section class="space-y-3">
          <h2 class="text-xl font-bold">フォロワー</h2>
          <Followers />
        </section>

        <section class="space-y-3">
          <h2 class="text-xl font-bold">フォロー中のうごき</h2>
          <Timeline />
        </section>

        <section class="space-y-3">
          <h2 class="text-xl font-bold">自分の記録</h2>
          <MyRecord />
        </section>

        <details class="collapse-arrow border-base-300 collapse border">
          <summary class="collapse-title font-bold">
            設定
            <span class="ml-2 text-sm font-normal opacity-70">
              ホーム画面に追加・通知・アカウント
            </span>
          </summary>
          <div class="collapse-content space-y-4">
            <InstallCard />
            <NotifyCard />
            <AccountCard returnTo="/me" />
          </div>
        </details>

        <p class="text-sm opacity-70">
          ゲームを登録するには{" "}
          <a class="link" href={routes.dev.href()} data-rmx-target="content">
            開発者向けページ
          </a>
          へ。
        </p>
      </main>,
    );
  },
} satisfies Action<typeof routes.me>;
