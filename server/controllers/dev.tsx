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

const SNIPPET = `<script type="application/gamecenter+json">
{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",
  "author": "kuboon",
  "title": "My Puzzle",
  "achievements": [
    { "key": "first_clear", "title": "はじめてのクリア", "points": 10 }
  ]
}
</script>`;

const CURL = `curl -X POST https://ga-cen.kbn.one/api/registry/v1/games \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://example.github.io/my-puzzle/"}'`;

export const devAction = {
  handler(context) {
    return renderPage(
      context,
      <main class="mx-auto w-full max-w-3xl space-y-6 p-8">
        <h1 class="text-3xl font-bold">開発者向け</h1>
        <p>
          ゲームを game-center
          に登録すると、プレイヤーの実績がハブに集まります。 登録の単位は{" "}
          <code>gamecenter.json</code> ひとつです。
        </p>

        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">マニフェストの置き場所</h2>
            <p>
              ゲームのページに、ブラウザが無視する script
              として埋め込みます。実績を実装したコードと同じファイルに乗るので、
              片方だけ古くなることがありません。 <code>author</code>{" "}
              にはあなたのハンドルを書きます。
            </p>
            <pre class="bg-base-200 overflow-x-auto rounded-box p-4 text-sm"><code>{SNIPPET}</code></pre>
            <p>
              HTML に混ぜたくなければ、ページの隣に <code>gamecenter.json</code>
              {" "}
              を置いても構いません。ハブは埋め込みを先に探し、無ければそちらを見ます。
            </p>
            <p>
              スキーマは{" "}
              <a class="link" href="/schema/gamecenter.json">
                /schema/gamecenter.json
              </a>{" "}
              にあります。<code>$schema</code> に書けばエディタが補完します。
            </p>
          </div>
        </div>

        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">CI から登録する</h2>
            <p>
              登録に認証は要りません。ハブがマニフェストを読みに行くだけだからです。
              secret を発行して CI に渡す手順はありません。
            </p>
            <pre class="bg-base-200 overflow-x-auto rounded-box p-4 text-sm"><code>{CURL}</code></pre>
            <p>
              初回だけは、名指しされた作者がこのページで承認するまで完了しません
              (202 が返ります)。 承認は一度きりで、以後その URL
              からの更新はそのまま通ります。
            </p>
          </div>
        </div>

        <DevConsole returnTo="/dev" />
      </main>,
    );
  },
} satisfies Action<typeof routes.dev>;
