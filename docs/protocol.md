# game-center プロトコル

ゲームを game-center に対応させるために知る必要があることの全部。
実装は HTML 一枚から始められる。
ビルドも、サーバも、秘密鍵も要らない。

この文書が正本で、[llms.txt](https://ga-cen.kbn.one/llms.txt) はここから生成される。

## 三行でいうと

1. ゲームのページに `gamecenter.json` を埋め込む
2. その URL をハブに登録し、作者が一度だけ承認する
3. 実績を達成したら SDK の `unlock()` を呼ぶか、claim リンクを出す

## 1. マニフェスト

ゲームは自分と実績を `gamecenter.json` で宣言する。
ブラウザが解釈しない `type` の `<script>` に入れるので、ゲームの動作には影響しない。
JSON-LD が `application/ld+json` でやっているのと同じ仕掛けである。

```html
<script type="application/gamecenter+json">
{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",
  "author": "<あなたの作者 ID>",
  "title": "My Puzzle",
  "description": "3分で遊べるパズル",
  "icon": "icon.png",
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

| フィールド | 必須 | 意味 |
|---|---|---|
| `id` | ○ | ゲームの slug。**作者の中で一意ならよい**。全体での名前は `{author}/{id}` |
| `author` | ○ | 作者の ID。ハブの `/me` からコピーできる |
| `title` | ○ | 100文字まで |
| `description` | | 500文字まで |
| `url` | | 書かない。マニフェストが置かれている場所がゲームの場所である。貼り付け登録のときだけ必須 |
| `icon` | | 相対パス可。マニフェストの取得元を基準に解決する |
| `achievements` | ○ | 200件まで |

実績の `key` はゲームの中で一意。
`points` は省略時 0、`hidden` は省略時 false。
`hidden: true` の実績は、解除されるまで題名も説明も伏せられる。

HTML に混ぜたくなければ、ページの隣に `gamecenter.json` という名前で置いてもよい。
ハブは埋め込みを先に探し、無ければそちらを見る。

### 実績を消すとどうなるか

消えない。
マニフェストから消えた実績は retire 扱いになり、以後は解除できなくなるが、すでに解除したプレイヤーの記録は残り続ける。
戻せば retire も解ける。

## 2. 登録

```bash
curl -X POST https://ga-cen.kbn.one/api/registry/v1/games \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.github.io/my-puzzle/"}'
```

**認証は無い。**
この API がすることは「すでに公開されている文書をハブに読み直させる」ことだけで、書き換えてよいかどうかを決めるのはその文書の置き場所だからである。
CI に渡す secret は存在しない。

登録が成立するには二つが揃う必要がある。

1. マニフェストが `author` で作者を名指しする
2. 名指しされたアカウントがハブでその URL を承認する

片方だけでは何も証明しない。
ファイルに他人の名前を書くのは誰にでもできるし、書いてもいないゲームを自分のものだと言うのも誰にでもできる。
両方揃うと、URL の管理権と作者本人の同意が同時に確かめられる。
両者の間を秘密が一度も移動しないのが、この形の利点である。

初回は `202` が返り、作者が `/dev` で承認するまで登録は完了しない。
**一度承認されれば、以後は同じ URL からの更新が素通しになる。**
CI が毎 push 叩いてよい。

応答は3通り。

| 状態 | 意味 |
|---|---|
| `200` / `201` | 登録・更新された |
| `202` | 作者の承認待ち |
| `400` | マニフェストが不正。`issues` に全件、`message` に整形済みの文字列 |
| `404` | `author` に対応するアカウントが無い |
| `409` | その slug は同じ作者の別の URL のもの |

検証エラーは最初の一件で止めず全部返る。
一度の CI で直すべき箇所が全部分かるようにするためである。

### fetch されない場所のゲーム

Claude Artifacts の公開 URL は、著者の HTML ではなく殻を返す。
実体は artifact ごとのサブドメインにあり、それをクライアント側の JavaScript が iframe として差し込むので、サーバからは届かない。

この場合はハブの `/dev` にマニフェストを貼り付けて登録する。
貼り付けのときは `url` が必須で、`author` は自分自身でなければならない（URL の裏付けが無いため）。

## 3. 実績の解除

### SDK を使う

```ts
import { GameCenter } from "https://esm.sh/jsr/@kuboon/game-center-sdk";

const gc = GameCenter.init({ gameId: "kuboon/my-puzzle" });

const result = await gc.unlock("first_clear");
if (!result.recorded) {
  document.body.appendChild(gc.claimLink("first_clear"));
}
```

`unlock()` は2つの経路を順に試し、最初に通ったものを使う。

| モード | 条件 | 体験 |
|---|---|---|
| REST | 起動トークンがある（ハブ経由で起動された） | 即時、ページ遷移なし |
| claim URL | いつでも | 別タブで確認してから記録 |

**例外を投げず、勝手に遷移もしない。**
`recorded` が false のとき `claimUrl` が入っているので、呼び出し側がそれをリンクとして画面に出す。
`claimLink()` がその `<a>` を作る。

**勝手に `window.open` しないこと。**
ポップアップブロックに食われるし、記録される前にプレイヤーが中身を見るべきである。

スコアを付けるなら `gc.unlock("high_score", { score: 1200 })`。
保存されるのは最高値だけで、低い報告は無視される。

解除は冪等である。
ロードのたびに同じ実績を報告してよい。
2回目以降は解除日時も経路も動かない。

### SDK を使わない

リンクを一つ出すだけでも動く。

```html
<a href="https://ga-cen.kbn.one/claim/@kuboon/my-puzzle/first_clear" target="_blank">
  実績を記録する
</a>
```

スコアは `?score=1200`。
外部スクリプトを読み込めない環境ではこれが唯一の手段であり、同時に一番確実な手段でもある。

### 起動トークン

プレイヤーがハブのカタログからゲームを起動すると、ハブが有効期限 7 日の JWT を発行し、**URL のフラグメント**で渡す。

```
https://example.github.io/my-puzzle/#gctoken=<JWT>
```

フラグメントなので、ゲームのホスティングのアクセスログにも Referer にも残らない。
SDK はこれを読んで保存し、アドレスバーから消す。
URL ごとチャットに貼られてもトークンが流れないようにするためである。

`aud` にゲームの名前が入っているので、**あるゲームのトークンで別のゲームの実績は触れない。**

カタログを経由せずゲームの URL を直接開いた場合、トークンは無い。
そのとき SDK は claim URL に落ちる。
ハブ経由で起動すると体験が良くなるが、直接開いても壊れない。

## 4. ゲーム用 API

起動トークンを `Authorization: Bearer` に付けて呼ぶ。
CORS は全オリジンに開いている（Cookie を使わずヘッダのトークンで認証するため）。
エラー応答にも CORS ヘッダが付く。付けないと、トークンの切れたゲームが自分の 401 を読めず、claim URL に落ちる判断ができない。

| メソッドとパス | 役割 |
|---|---|
| `POST /api/game/v1/unlock` | `{ achievement, score? }` |
| `GET /api/game/v1/me` | プレイヤーの表示名と、このゲームでの解除済み実績 |
| `GET /api/game/v1/achievements` | このゲームの実績定義。未解除の隠し実績は題名も説明も null |

どのエンドポイントも、トークンの `aud` にあるゲームの範囲に閉じている。
プレイヤーについても「このゲームでの実績」しか見えない。

## 5. ハブ側の URL

| パス | 役割 |
|---|---|
| `/@{author}` | 作者ページ |
| `/@{author}/{slug}` | ゲーム詳細 |
| `/claim/@{author}/{slug}/{key}` | claim URL の受け口 |
| `/schema/gamecenter.json` | マニフェストの JSON Schema |
| `/llms.txt` | この文書と SDK 全文を1ファイルにしたもの |
