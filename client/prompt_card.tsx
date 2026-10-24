/**
 * The instruction an AI needs to add GameCenter support, ready to paste, and
 * the button that copies it.
 *
 * A manifest has to name its author, and that name is the identifier the IdP
 * issued: unique, stable, and not something anyone should be transcribing by
 * hand. So the hub writes the whole instruction — the id already filled in, the
 * script tag, the schema, what to do next — and the author copies it into
 * whatever is building their game.
 *
 * Rendered by {@link DevConsole}, which already knows the author id: it is in
 * the same answer as the games and the queue.
 */

import { on } from "@remix-run/component";

/** The instruction, with the player's own handle already in it. */
export function prompt(handle: string): string {
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

不具合・要望の送り先として、タイトル画面などに次のリンクを置いてください
(SDK なら gc.feedbackLink())。送信は GameCenter 側で行い、作者が /dev で読むので、
フォームは不要です。

https://ga-cen.kbn.one/feedback/@${handle}/<id>

ステージやエラー内容は下書きとして渡せます。プレイヤーに貼り付けを頼まないでください。
gc.feedbackLink({ kind: "bug", message }) (SDK なしなら URL に
#kind=bug&message=<encodeURIComponent した本文> を付ける)。message は 4000 文字まで、
超えると feedbackLink() が RangeError を投げます。

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

/**
 * Copy the instruction for `handle`.
 *
 * @returns Whether the clipboard took it. When it refuses (insecure context,
 * denied permission) the text is on screen and selectable, so there is still a
 * way through.
 */
export async function copyPrompt(handle: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(prompt(handle));
    return true;
  } catch {
    return false;
  }
}

/** The copy button, with the instruction itself folded underneath. */
export function promptCopy(
  handle: string,
  copied: boolean,
  onCopy: () => void | Promise<void>,
) {
  return (
    <div class="space-y-2">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        mix={[on("click", onCopy)]}
      >
        {copied ? "コピーしました" : "プロンプトをコピー"}
      </button>
      <details>
        <summary class="cursor-pointer text-sm opacity-70">中身を見る</summary>
        <pre class="bg-base-200 mt-2 overflow-x-auto rounded-box p-4 text-xs whitespace-pre-wrap"><code>{prompt(handle)}</code></pre>
      </details>
    </div>
  );
}
