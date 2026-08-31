/**
 * GET /dev — the developer dashboard.
 *
 * The shell is server-rendered; everything that depends on who is signed in —
 * the {@link PromptCard} with your own author id in it, and the
 * {@link DevConsole} — is a clientEntry, because an SSR request carries no DPoP
 * proof.
 *
 * Registering a game lives here and only here. `/me` is a player's page, and a
 * player who never publishes anything should not have to scroll past a
 * developer's tools to reach their own record.
 *
 * The {@link PromptCard} comes first because it is the only thing on the page
 * that knows something the reader does not: their own author id. Everything
 * below it is a worked example, and its examples name nobody — a real handle in
 * a sample manifest reads as if it were the reader's.
 */

import type { Action } from "@remix-run/fetch-router";

import { DevConsole } from "../../client/dev_console.tsx";
import { PromptCard } from "../../client/prompt_card.tsx";
import type { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

// The author id is a placeholder, matching docs/protocol.md. Putting a real
// handle here reads as if it were the reader's own, and it is the one field
// nobody can guess — `PromptCard` above hands out the actual value.
const SNIPPET = `<script type="application/gamecenter+json">
{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",
  "author": "<あなたの作者 ID>",
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

        <PromptCard />

        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">マニフェストの置き場所</h2>
            <p>
              ゲームのページに、ブラウザが無視する script
              として埋め込みます。実績を実装したコードと同じファイルに乗るので、
              片方だけ古くなることがありません。
            </p>
            <p class="text-sm opacity-70">
              <code>author</code>{" "}
              はあなたの作者 ID
              です。サインインしていれば上のカードに出ているので、
              手で書き写さずにそこからコピーしてください。
            </p>
            <p class="text-sm opacity-70">
              <code>id</code>{" "}
              はあなたのゲームの中で一意ならよく、ハブ全体での名前は「作者 ID +
              スラッシュ + この id」になります。 他の作者が同じ{" "}
              <code>my-puzzle</code>{" "}
              を使っていても衝突しないので、空いているかどうかを気にする必要はありません。
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
