/**
 * GET /me — the player's own page.
 *
 * Mostly a timeline: what the people you follow have unlocked and registered,
 * newest first, every row one click from the game. Your own record is the
 * second thing here, because you already know what you did — and the page that
 * shows it to other people is `/@{handle}`, not this one.
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
import { AchievementList } from "../../client/achievement_list.tsx";
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
          <h2 class="text-xl font-bold">フォロー中のうごき</h2>
          <Timeline />
        </section>

        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">自分の実績</h2>
            <AchievementList />
          </div>
        </div>

        <AccountCard returnTo="/me" />

        <p class="text-sm opacity-70">
          ゲームを登録するには{" "}
          <a class="link" href={routes.dev.href()} rmx-target="content">
            開発者向けページ
          </a>
          へ。
        </p>
      </main>,
    );
  },
} satisfies Action<typeof routes.me>;
