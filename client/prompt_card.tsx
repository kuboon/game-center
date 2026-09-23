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

import { mountSession, sessionStore } from "./session.ts";

/** The instruction, with the player's own handle already in it. */
function prompt(handle: string): string {
  return `このゲームを GameCenter (https://ga-cen.kbn.one) に対応させてください。

## 1. マニフェストをページに埋め込む

ゲームの HTML の <head> に、次の script をそのまま足します。

<script type="application/gamecenter+json">
{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "<このゲームの短い名前。英小文字・数字・ハイフン>",
  "author": "${handle}",
  "title": "<ゲームのタイトル>",
  "description": "<一行の説明>",
  "icon": "favicon.svg",
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
- "icon" はカタログとゲームページに出ます。ゲームの URL を基準に解決するので、
  相対で書きます ("/favicon.svg" と書くと origin の直下を指してしまいます)。
  単一の HTML しか置けない場合 (Claude Artifacts など) は省いてください
- 実績は好きなだけ足せます。"hidden": true にすると解除まで内容が伏せられます

## 2. 実績を解除する

SDK を使う場合 (推奨。GameCenter 経由で起動されたときは自動で即時記録になります):

import { GameCenter } from "https://esm.sh/jsr/@kuboon/game-center-sdk";

const gc = GameCenter.init({ gameId: "${handle}/<id>" });

await gc.unlock("first_clear");
await gc.unlock("high_score", { score: 1200 });

// unlock() は例外を投げず、送れなければ localStorage に溜めます
// (返り値は { recorded, pending })。claimLink() は溜まっていなければ null
const link = gc.claimLink();
if (link) container.replaceChildren(link);

外部スクリプトを読み込めない場合 (Claude Artifacts など) は、SDK を使わずに
次の URL を開くリンクを出すだけでも動きます。

https://ga-cen.kbn.one/claim/@${handle}/<id>#gc=first_clear,high_score:1200

フラグメントに key をカンマで並べ、スコアは : で足します。
遷移先で一覧を確認してから、まとめて記録されます。

どちらの場合も、**勝手に window.open しないでください。**
押せるリンクとして出すこと (ポップアップブロック対策と、プレイヤーの意思確認)。

## 3. 登録

公開したあとに一度だけ必要です。公開先で二通りに分かれます。

### GameCenter が URL を読める場合 (GitHub Pages など)

CI があるなら次を置きます (secret も checkout も不要。GameCenter が
その URL を読みに行きます)。

# .github/workflows/register.yaml
on:
  push: { branches: [main] }
jobs:
  register:
    runs-on: ubuntu-latest
    steps:
      - uses: kuboon/game-center/action@v1
        with:
          url: <公開したゲームのページ URL>

CI が無ければ同じことを curl で一度だけ実行します。

curl -X POST https://ga-cen.kbn.one/api/registry/v1/games \\
  -H 'content-type: application/json' \\
  -d '{"url":"<公開したゲームのページ URL>"}'

初回は 202 (承認待ち) が返ります。そうしたら作者に
「https://ga-cen.kbn.one/dev で承認してください」と伝えてください。
承認は最初の一度だけで、以後その URL からの push は素通しです (200)。

### GameCenter が読めない場合 (Claude Artifacts など)

上のマニフェストに "url": "<公開 URL>" を足したものを作者に渡し、
https://ga-cen.kbn.one/dev の「貼り付けて登録」に貼ってもらってください。`;
}

export const PromptCard = clientEntry(
  "/prompt_card.js#PromptCard",
  function PromptCard(handle: Handle) {
    let myHandle: string | null = null;
    let loaded = false;
    let copied = false;

    const session = mountSession(handle, load);

    async function load(): Promise<void> {
      const { fetchDpop, userId } = sessionStore;
      if (!userId || !fetchDpop) {
        loaded = session.ready;
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
      if (!session.ready || !sessionStore.userId) return null;
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
