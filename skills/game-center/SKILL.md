---
name: game-center
description: >-
  ゲームに game-center (https://ga-cen.kbn.one) の実績を組み込む。ユーザが
  「game-center に対応させたい」「実績を付けたい」「achievements を追加して」と
  言ったとき、あるいは gamecenter.json / claim URL / 起動トークン (gctoken) /
  @kuboon/game-center-sdk が出てきたときに使う。HTML 一枚のミニゲーム、GitHub
  Pages のゲーム、Claude Artifacts のゲームのいずれにも使える。ビルドもサーバも
  秘密鍵も要らない。
---

# game-center に対応させる

ゲームが実績を記録できるようにする。 必要なのは二つだけ —
マニフェストをページに埋め込むことと、実績を達成したときに解除を呼ぶこと。

**最初に作者 ID をユーザに聞くこと。** ハブにサインインして
https://ga-cen.kbn.one/me を開くと表示され、そこから手順一式をコピーもできる。
不透明な識別子なので、推測してはいけない。

完全な仕様と SDK 全文は https://ga-cen.kbn.one/llms.txt にある。
迷ったらそれを読む。

## 1. マニフェストを埋め込む

ゲームの HTML に、次の `<script>` をそのまま足す。 `type`
がブラウザの知らない値なので、ゲームの動作には影響しない。

```html
<script type="application/gamecenter+json">
{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",
  "author": "<ユーザに聞いた作者 ID>",
  "title": "My Puzzle",
  "description": "3分で遊べるパズル",
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
```

- `id`
  は作者の中で一意ならよい。**他の人と重複しても構わないので、空きを気にしなくてよい**
- `author` は変えない。これが作者の識別子
- `url` は書かない。マニフェストが置かれている場所がゲームの場所
- `hidden: true` の実績は、解除まで題名も説明も伏せられる
- ゲームの実際の達成条件に合った実績を作る。汎用的な「クリア」だけで済ませない

## 2. 実績を解除する

### 外部スクリプトを読み込める場合

```ts
import { GameCenter } from "https://esm.sh/jsr/@kuboon/game-center-sdk";

const gc = GameCenter.init({ gameId: "<author>/my-puzzle" });

await gc.unlock("first_clear");

// 送れなかったぶんは溜まっている。リンク一本で全部記録できる。
const link = gc.claimLink();
if (link) document.body.appendChild(link);
```

スコアを付けるなら `gc.unlock("high_score", { score: 1200 })`。
最高値だけが保存される。

### 読み込めない場合 (Claude Artifacts など)

リンクを一つ出すだけでよい。

```ts
const a = document.createElement("a");
a.href = `https://ga-cen.kbn.one/claim/@${AUTHOR}/my-puzzle#gc=first_clear,high_score:1200`;
a.textContent = "実績を記録する";
container.replaceChildren(a);
```

フラグメントに `key` をカンマ区切りで並べ、スコアは `:` で足す。
遷移先で一覧を確認してから、まとめて記録される。

**どちらの場合も `window.open` を勝手に呼ばないこと。**
ポップアップブロックに食われるし、記録される前にプレイヤーが中身を見るべきである。

解除は冪等なので、ロードのたびに同じ実績を報告してよい。

## 3. 登録

ゲームを公開したら、その URL をユーザに登録してもらう。

```bash
curl -X POST https://ga-cen.kbn.one/api/registry/v1/games \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.github.io/my-puzzle/"}'
```

初回は `202` が返る。 作者が https://ga-cen.kbn.one/dev
で承認すると完了し、以後は同じコマンドで更新できる。

GitHub のリポジトリなら、push のたびに自動で登録できる。

```yaml
on:
  push: { branches: [main] }
jobs:
  register:
    runs-on: ubuntu-latest
    steps:
      - uses: kuboon/game-center/action@v1
        with:
          url: https://example.github.io/my-puzzle/
```

**Claude Artifacts は URL 登録できない。** 公開 URL を開いても著者の HTML
ではなく殻が返るため、ハブが読みに行けない。 その場合はユーザに
https://ga-cen.kbn.one/dev でマニフェストを貼り付けてもらう。 貼り付けのときだけ
`url` フィールドが必須になる。

## 確認すること

- `author` はユーザに聞いた値そのままか（推測していないか）
- 実績の `key` がゲームの中で一意か
- `window.open` を勝手に呼んでいないか
- 実績がゲームの実際の達成条件に対応しているか
