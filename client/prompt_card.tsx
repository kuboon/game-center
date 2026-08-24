/**
 * PromptCard — everything an AI needs to add game-center support, ready to
 * paste.
 *
 * A manifest has to name its author, and that name is the identifier the IdP
 * issued: unique, stable, and not something anyone should be transcribing by
 * hand. So the hub writes the whole instruction — the id already filled in, the
 * script tag, the schema, what to do next — and the player copies it into
 * whatever is building their game.
 *
 * A `clientEntry` because the identifier is the signed-in player's, and a
 * server-rendered page carries no DPoP proof to learn who that is.
 */

import { clientEntry, type Handle, on } from "@remix-run/ui";

import { sessionStore } from "./session.ts";

/** The instruction, with the player's own handle already in it. */
function prompt(handle: string): string {
  return `このゲームを game-center (https://ga-cen.kbn.one) に対応させてください。

## 1. マニフェストをページに埋め込む

ゲームの HTML の <head> に、次の script をそのまま足します。
type がブラウザの知らない値なので、ゲームの動作には影響しません。

<script type="application/gamecenter+json">
{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "<このゲームの短い名前。英小文字・数字・ハイフン>",
  "author": "${handle}",
  "title": "<ゲームのタイトル>",
  "description": "<一行の説明>",
  "achievements": [
    {
      "key": "first_clear",
      "title": "はじめてのクリア",
      "description": "ステージ1をクリアする",
      "points": 10,
      "hidden": false
    }
  ]
}
</script>

- "author" は上の値のまま変えないでください。これが作者の識別子です
- "id" は作者ごとに一意であればよく、他の人と重複しても構いません
- "url" は書きません。マニフェストが置かれている場所がゲームの場所です
- 実績は好きなだけ足せます。"hidden": true にすると解除まで内容が伏せられます

## 2. 実績を解除する

SDK を使う場合 (推奨。ハブ経由で起動されたときは自動で即時記録になります):

import { GameCenter } from "https://esm.sh/jsr/@kuboon/game-center-sdk";

const gc = GameCenter.init({ gameId: "${handle}/<id>" });

const result = await gc.unlock("first_clear");
if (!result.recorded) {
  // 記録にはプレイヤーの確認が要る。リンクを画面に出す
  document.body.appendChild(gc.claimLink("first_clear"));
}

外部スクリプトを読み込めない場合 (Claude Artifacts など) は、SDK を使わずに
次の URL を開くリンクを出すだけでも動きます。

https://ga-cen.kbn.one/claim/@${handle}/<id>/<achievement key>

スコアを付けるなら ?score=1200 を足します。

どちらの場合も、**勝手に window.open しないでください。**
押せるリンクとして出すこと (ポップアップブロック対策と、プレイヤーの意思確認)。

## 3. 登録

ゲームを公開したら、その URL を私に教えてください。
ハブに登録します。CI から自動登録することもできます。`;
}

export const PromptCard = clientEntry(
  "/prompt_card.js#PromptCard",
  function PromptCard(handle: Handle) {
    let myHandle: string | null = null;
    let loaded = false;
    let copied = false;

    if (typeof document !== "undefined") {
      sessionStore.addEventListener("change", () => {
        void load();
      }, { signal: handle.signal });
      void sessionStore.load().then(load);
    }

    async function load(): Promise<void> {
      const { fetchDpop, userId } = sessionStore;
      if (!userId || !fetchDpop) {
        loaded = sessionStore.ready;
        handle.update();
        return;
      }
      try {
        const response = await fetchDpop("/api/internal/games");
        if (response.ok) {
          myHandle =
            ((await response.json()) as { handle: string | null }).handle;
        }
      } catch {
        // Leave it unknown rather than showing an instruction with a hole in it.
      } finally {
        loaded = true;
        handle.update();
      }
    }

    const onCopyClick = async () => {
      if (!myHandle) return;
      try {
        await navigator.clipboard.writeText(prompt(myHandle));
        copied = true;
        handle.update();
      } catch {
        // Clipboard refused (insecure context, denied permission). The text is
        // on screen and selectable, so there is still a way through.
        copied = false;
        handle.update();
      }
    };

    return () => {
      if (!sessionStore.ready || !sessionStore.userId) return null;
      if (!loaded) return <p>読み込み中…</p>;
      if (!myHandle) return null;

      return (
        <div class="card card-border bg-base-100">
          <div class="card-body">
            <h2 class="card-title">ゲームを作る AI に渡す</h2>
            <p>
              あなたの作者 ID は <code class="break-all">{myHandle}</code>{" "}
              です。 これを含んだ手順一式を用意したので、ゲームを作っている AI
              にそのまま貼ってください。
            </p>
            <div class="card-actions">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                mix={[on("click", onCopyClick)]}
              >
                {copied ? "コピーしました" : "プロンプトをコピー"}
              </button>
            </div>
            <details>
              <summary class="cursor-pointer text-sm opacity-70">
                中身を見る
              </summary>
              <pre class="bg-base-200 mt-2 overflow-x-auto rounded-box p-4 text-xs whitespace-pre-wrap"><code>{prompt(myHandle)}</code></pre>
            </details>
          </div>
        </div>
      );
    };
  },
);
