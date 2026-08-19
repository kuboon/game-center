/**
 * GET /me — the player's own page.
 *
 * Rendered without knowing who the visitor is: an SSR document carries no DPoP
 * proof, so the signed-in parts are `clientEntry` components that fill
 * themselves in after hydration. The achievement list arrives with M4; for now
 * the page is the account card plus a note about what will live here.
 */

import type { Action } from "@remix-run/fetch-router";

import { AccountCard } from "../../client/account_card.tsx";
import type { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const meAction = {
  handler(context) {
    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <h1 class="text-3xl font-bold">マイページ</h1>
        <AccountCard returnTo="/me" />
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">実績</h2>
            <p>
              解除した実績の一覧はこれから実装します。
              サインインしておくと、ゲーム側から解除された実績がこのアカウントに記録されます。
            </p>
          </div>
        </div>
      </main>,
    );
  },
} satisfies Action<typeof routes.me>;
