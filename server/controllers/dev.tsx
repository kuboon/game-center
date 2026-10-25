/**
 * GET /dev — the developer dashboard.
 *
 * The shell is server-rendered; everything that depends on who is signed in is
 * the {@link DevConsole}, a clientEntry, because an SSR request carries no DPoP
 * proof. It comes first: what is waiting on you, your games, and the tools for
 * adding one, starting with the prompt that carries your own author id.
 *
 * Below it, the same ground for someone wiring a game up by hand. Rendered
 * here rather than in the console so that it reads with JavaScript off and
 * signed out — a visitor deciding whether to make a game for the hub has not
 * signed in yet. Its examples name nobody: a real handle in a sample manifest
 * reads as if it were the reader's.
 *
 * Registering a game lives here and only here. `/me` is a player's page, and a
 * player who never publishes anything should not have to scroll past a
 * developer's tools to reach their own record.
 */

import type { Action } from "@remix-run/fetch-router";

import { DevConsole } from "../../client/dev_console.tsx";
import type { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

// The author id is a placeholder, matching docs/protocol.md. Putting a real
// handle here reads as if it were the reader's own, and it is the one field
// nobody can guess — the console's prompt hands out the actual value.
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

const WORKFLOW = `# .github/workflows/register.yaml
on:
  push: { branches: [main] }
jobs:
  register:
    runs-on: ubuntu-latest
    steps:
      - uses: kuboon/game-center/action@v1
        with:
          url: https://example.github.io/my-puzzle/`;

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
          ゲームを GameCenter に登録すると、プレイヤーの実績がここに集まります。
          登録の単位は <code>gamecenter.json</code> ひとつです。
        </p>

        <DevConsole returnTo="/dev" />

        <div class="card card-border bg-base-100">
          <div class="card-body gap-4">
            <h2 class="card-title">手で組み込む場合</h2>
            <p class="text-sm opacity-70">
              AI に任せるなら、上のプロンプトだけで足ります。 仕様と SDK
              の全文は <a class="link" href="/llms.txt">/llms.txt</a>{" "}
              に一つにまとめてあります。
            </p>

            <section class="space-y-2">
              <h3 class="font-bold">マニフェストを埋め込む</h3>
              <p>
                {"ゲームのページに、ブラウザが無視する script として埋め込みます。"}
                {"実績を実装したコードと同じファイルに乗るので、"}
                {"片方だけ古くなることがありません。"}
              </p>
              <pre class="bg-base-200 overflow-x-auto rounded-box p-4 text-sm"><code>{SNIPPET}</code></pre>
              <ul class="list-disc space-y-1 pl-5 text-sm opacity-70">
                <li>
                  <code>author</code>{" "}
                  はあなたの作者 ID
                  です。手で書き写さず、サインインして上からコピーしてください。
                </li>
                <li>
                  <code>id</code>{" "}
                  はあなたのゲームの中で一意ならよく、ハブ全体での名前は「作者
                  ID + スラッシュ + この
                  id」になります。他の作者と重なっても衝突しません。
                </li>
                <li>
                  HTML に混ぜたくなければ、ページの隣に{" "}
                  <code>gamecenter.json</code>{" "}
                  を置いても構いません。ハブは埋め込みを先に探し、無ければそちらを見ます。
                </li>
                <li>
                  スキーマは{" "}
                  <a class="link" href="/schema/gamecenter.json">
                    /schema/gamecenter.json
                  </a>
                  。<code>$schema</code> に書けばエディタが補完します。
                </li>
              </ul>
            </section>

            <section class="space-y-2">
              <h3 class="font-bold">CI から登録する</h3>
              <p>
                登録に認証は要りません。ハブがマニフェストを読みに行くだけなので、
                secret を発行して CI に渡す手順もありません。
              </p>
              <pre class="bg-base-200 overflow-x-auto rounded-box p-4 text-sm"><code>{WORKFLOW}</code></pre>
              <p class="text-sm opacity-70">
                CI が無ければ、同じことを一度だけ curl で送ります。
              </p>
              <pre class="bg-base-200 overflow-x-auto rounded-box p-4 text-sm"><code>{CURL}</code></pre>
              <p class="text-sm opacity-70">
                初回だけは、名指しされた作者がこのページで承認するまで完了しません
                (202 が返ります)。 承認は一度きりで、以後その URL
                からの更新はそのまま通ります。
              </p>
            </section>
          </div>
        </div>
      </main>,
    );
  },
} satisfies Action<typeof routes.dev>;
