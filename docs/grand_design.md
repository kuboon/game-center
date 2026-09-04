# game-center グランドデザイン

status: draft (2026-08-16)

## 何を作るか

**game-center** は、Apple の Game Center のように、ユーザが様々なミニゲームで獲得した実績(achievement)を一元管理するサービスである。
ゲーム本体はこのリポジトリには実装しない。
ゲームは第三者(主に LLM によるバイブコーディング)が開発し、GitHub Pages や Claude Artifacts のようなサーバレスの静的ホスティングで公開されることを想定する。

このリポジトリが提供するものは次の4つである。

- **ハブサイト**：サインアップとサインイン、ゲームカタログ、実績一覧を提供する Web アプリ
- **通信プロトコル**：ゲームと game-center の間で実績解除をやり取りする仕様
- **開発者向け提供物**：プロトコル文書、LLM 用テキスト(llms.txt)、Claude 用 skill、貼り付け用 SDK
- **GitHub Action**：ゲームリポジトリから game-center へゲームを自動登録する仕組み

ハブサイトのドメインは `ga-cen.kbn.one` とする。

## 設計を規定する2つの制約

設計全体は、次の2つの制約から導かれる。

1つ目は、ゲームがサーバも秘密情報も持てないことである。
静的ホスティングのゲームには API シークレットを隠す場所がなく、コードは誰でも読める。
したがって実績解除は本質的に自己申告であり、サーバ側でできる検証は「登録済みのゲームの登録済みの実績か」「認証済みのユーザか」「異常な頻度でないか」までである。
この信頼モデルを最初から受け入れる。
何を導くかは次節に書く。

2つ目は、Claude Artifacts の CSP である。
Artifact 上のページは外部ホストへの fetch/XHR が遮断されるため、ゲームから game-center の API を直接呼べない。
一方、外部サイトへの通常のリンク遷移(新しいタブで開く)はできる。
そこで、API を呼ばずリンク遷移だけで実績を解除できる経路をプロトコルの最下層に置き、fetch が使える環境(GitHub Pages など)では、より滑らかな経路を重ねる。

## 偽装は防がない、代わりに誰を見るかを選ばせる

ブラウザの中で動くゲームである以上、実績の偽装は原理的に防げない。
コードは誰でも読めるし、書き換えられるし、API は手で叩ける。
検証を足しても、足した分だけ手間が増えるだけで、防げるようにはならない。

そこで防ごうとしない。
代わりに二つを置く。

一つは認証である。
パスキーと DPoP でユーザ認証だけはしっかりやる。
**誰の申告かは確かで、何を申告したかは確かでない**、という状態をはっきり作る。
偽装した記録には、必ず偽装した本人の名前が付く。

もう一つはフォローである。
記録を見る相手をユーザ自身が選ぶ。
チートの疑われるユーザはフォローしない、という自己防衛に期待する。
偽装のコストが低いままでも、偽装して得られるものが「フォローを外される」だけなら、割に合わなくなる。

ここから一つの方針が出る。
**全ユーザを横断するランキングは作らない。**
順位が付く場所を用意した瞬間、偽装の得が偽装のコストを上回るからである。
数字が並ぶのはフォロー関係の中だけとし、比べる相手は自分が選んだ相手に限る。

これは機能が揃うまでの制限ではなく、方針である。
「まずフォロー内で、いずれ全体で」という段階論は取らない。

## ランディングページ

`/` はカタログの一覧ではなく**筐体**である。
ここに来るのは遊びに来た人であって、公開しに来た人ではない。
開発者向けの導線はヒーローの第2ボタンだけに置く。

見た目は CSS だけで作る(CRT のスキャンライン、走査バンド、点滅する電球、`DotGothic16`)。
イラストは使わない。
**ランディングだけは light/dark どちらでも常に暗い。**
筐体は暗いから光る。
カタログ詳細やマイページは道具なので daisyUI テーマのままにする。

`DotGothic16` は筐体の文字(ロゴ・CTA・スコア・ラベル)だけに使う。
日本語の本文はシステムフォントのままにする。そちらのほうがはるかに読みやすい。

`prefers-reduced-motion: reduce` で点滅と走査を止める。

### HIGH SCORE 表は置かない

アーケードなら高得点表を置く場所には、何も置かない。

全ユーザを並べた表は、偽装が割に合いはじめるまさにその場所である。
「偽装は防がない、代わりに誰を見るかを選ばせる」に書いたとおり、それは作らない。
段階的に入れることもしない。

訪問者自身のスコアを出す枠を一度は置いたが、それも外した。
自分の点数は自分に対して嘘をつく理由が誰にも無い数字なので害は無いが、
サインアウトの訪問者には空の枠しか出ず、筐体の一角を占めるには弱かった。
数字は `/@{handle}` にある。そこは人が他人に見せるために貼るページで、
点数・実績数・ゲーム数はまさにその場で読まれるものである。

残るのはカタログだけになる。SSR と CSS だけで出るので、JS を切っても読める。

## コンポーネント全体像

```
ゲーム開発者(LLM)                     プレイヤー
  │ llms.txt / skill を読んで実装        │ サインイン(id.kbn.one)
  │ gamecenter.json を書く               │ カタログからゲームを起動
  ▼                                      ▼
ゲームリポジトリ ──GitHub Action──▶ game-center ハブ (ga-cen.kbn.one)
  │  (登録 API を呼ぶ)                   │ Deno + Remix v3
  ▼                                      │ Turso (libsql)
GitHub Pages / Claude Artifacts ◀───────┘
  (SDK 経由で実績解除: REST / claim URL)
```

登場人物は3者である。

- **プレイヤー**：id.kbn.one のアカウントでサインインし、ゲームを遊び、実績を集めるユーザ
- **ゲーム開発者**：ゲームを作って game-center に登録する第三者。多くは LLM に実装させる
- **game-center 運営**：ハブサイトとプロトコルを保守する(= このリポジトリ)

## 技術スタック

| 領域 | 選定 | 補足 |
|---|---|---|
| ランタイム | Deno (workspace 構成) | package.json は置かない |
| Web フレームワーク | Remix v3 (`@remix-run/fetch-router` + `@remix-run/ui`) | [deno-remix-reference](https://github.com/kuboon/deno-remix-reference) の構成に従う |
| スタイル | Tailwind CSS v4 + daisyUI v5 | bundler パッケージでビルド |
| DB | Turso (`npm:@libsql/client/web` + `@kuboon/remix-data-table-sqlite-turso`) | セッション等の揮発データも Turso に置く。Deno KV は使わない |
| 認証 | id.kbn.one 連携 (DPoP、パスキー) | deno-remix-reference の実装を踏襲(後述) |
| ホスティング | Deno Deploy | `@libsql/client/web` は fetch ベースでネイティブアドオン不要のため edge で動く |
| SDK 配布 | JSR (`@kuboon` スコープ) + コピペ用単一ファイル | Artifacts は外部スクリプトを読み込めないため、コピペ配布が主 |
| CI | GitHub Actions (`actions/checkout@v7`, `denoland/setup-deno@v2`) | `deno task check` と `deno task test` |

## 通信プロトコル

### 実績解除の3モード

実績解除には3つのモードを定義する。
下にあるものほど動作環境の制約が緩く、上にあるものほど体験が滑らかである。
SDK は利用可能なモードを自動選択する。

| モード | 通信手段 | 動く環境 | 体験 |
|---|---|---|---|
| REST | fetch + Bearer トークン | 外部 fetch が可能なホスティング(GitHub Pages 等) | ページ遷移なしで即時反映 |
| claim リンク | リンク遷移 | すべて(Claude Artifacts を含む) | ハブで一覧を確認して、まとめて解除 |

**claim リンク** は最下層の共通経路である。
送れなかった解除は SDK が `localStorage` のキューに溜め、リンク一本で全部を渡す。

```
https://ga-cen.kbn.one/claim/@{author}/{slug}#gc=first_clear,high_score:1200
```

遷移先でプレイヤーは(未サインインなら)サインインし、「新しく記録します」「スコアを更新します」「記録済み」の並んだ一覧を見て、ボタンを押して確定する。
トークンも fetch も不要なので、Artifacts のような制約環境でも、SDK を使わない手書きゲームでも動く。

**一覧をフラグメントに載せるのは、POST 遷移より強いからである。**
SSR に DPoP 証明は付けられないので、サーバに送ったところで「登録済みか」の判別はできず、どのみちブラウザ側の仕事になる。
つまりペイロードをサーバに渡す理由が無い。
渡さなければ、プレイヤーが同意する前にゲームの自己申告が記録もログもされず、戻る・リロードで再送信も起きず、素のリンクのままなのでサンドボックスされたページからも動く。

記録が済んだら、実際に書けたキーを `#gcclaimed=…` としてゲームの URL に付けて戻す。
ハブはゲームの `localStorage` に手を入れられないので、消し込みはこれと、次にトークン付きで起動したときの `/api/game/v1/me` との突き合わせの二本で行う。
どちらも落としたところで、解除は冪等なので二重に出るだけである。

**REST モード** は、後述の起動トークンを Bearer に付けて `POST /api/game/v1/unlock` を呼ぶ。
ゲーム用 API は CORS をすべてのオリジンに開放する(トークン認証であり、Cookie を使わないため開放してよい)。

**iframe に埋め込む postMessage モードは作ったうえで廃止した。**
経緯は「iframe をやめた理由」にある。

どのモードでも、解除には任意で **score**(整数)を添えられる。
解除は冪等であり、解除済みの実績への再報告は、score が保存済みの値より高い場合だけ更新する(ハイスコアのみ保持。`unlocked_at` は初回のまま)。
score のない再報告は何もしない。

### 起動フローと起動トークン

プレイヤーが game-center のカタログからゲームを起動するとき、game-center は **起動トークン** (launch token)を発行し、URL フラグメントでゲームに渡す。

```
https://example.github.io/my-puzzle/#gctoken=<JWT>
```

起動トークンは game-center が署名する JWT で、claims は `sub`(ユーザ ID)、`aud`(`{author}/{slug}`)、`iss`、`exp` のみとする。
有効期限は 7 日。
これはゲームのホスト上の `localStorage` に残るので、ブックマークから翌日開いた人もその場で記録できる。
数時間で切ると、その訪問は黙って記録されなくなり、手で確認する claim に落ちる。
長くしても失うものは小さい。`aud` がゲームを、`sub` がプレイヤーを縛るので、この token にできるのは「そのプレイヤーがそのゲームの実績を解除する」ことだけであり、それは claim 画面でプレイヤー自身がいつでもできることである。
セッションではない。
署名鍵は `RP_SIGNING_KEY_JWK`(ES256 の private JWK)で与える。
未設定なら起動トークンは発行も検証もせず 503 を返す。
isolate ごとに鍵を生成すると、発行した isolate 以外では検証が通らないためである。
鍵の生成は `deno task keygen` で行う。
フラグメントで渡すのは、ホスティング側のアクセスログに残さないためである。
SDK はフラグメントからトークンを読み取って保存し、URL から除去したうえで REST モードに使う。

プレイヤーがカタログを経由せずゲーム URL を直接開いた場合、トークンは存在しない。
このとき SDK は claim URL モードに落ちる。
つまり「game-center 経由で起動すると体験が良くなるが、直接開いても壊れない」という段階的な設計にする。

### ゲームマニフェスト

ゲームは自身のメタデータと実績定義を **gamecenter.json** に記述する。
これが登録 API、GitHub Action、SDK に共通の語彙となる。

```jsonc
{
  "$schema": "https://ga-cen.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",              // 作者の中で一意な slug。全体では kuboon/my-puzzle
  "author": "kuboon",             // 作者の game-center ハンドル (IdP の userId)
  "title": "My Puzzle",
  "description": "3分で遊べるパズル",
  "url": "https://example.github.io/my-puzzle/",
  "icon": "https://example.github.io/my-puzzle/icon.png",
  "achievements": [
    {
      "key": "first_clear",       // ゲーム内で一意
      "title": "はじめてのクリア",
      "description": "ステージ1をクリアする",
      "points": 10,
      "hidden": false             // true なら解除まで内容を隠す
    }
  ]
}
```

`url` は任意である。
ハブが取得したマニフェストは、すでにゲーム自身の URL に置かれているので、そこで改めて宣言しても食い違いを生む余地が増えるだけだからである。
必須になるのは、取得元を持たないマニフェスト、つまりダッシュボードに貼り付けられた場合だけである。
`icon` は相対パスでよく、マニフェストの取得元を基準に解決する。

スキーマは `packages/protocol` に JSON Schema として置き、ハブサイトからも配信する。
登録はマニフェスト全体の upsert とし、実績の削除は「非表示化」として扱う(解除済みユーザの記録を壊さないため)。

### マニフェストの置き場所と所有権

マニフェストは3つの場所のいずれかに置く。
ハブはこの順に探す。

1. **ゲームのページに埋め込む**。`<script type="application/gamecenter+json">` の中に書く。ブラウザが解釈しない type なので、ゲーム自身の JavaScript から見えることもない。JSON-LD が `application/ld+json` でやっているのと同じ仕掛けである
2. **ページの隣に `gamecenter.json` を置く**。HTML に混ぜたくない場合に使う
3. **ダッシュボードに貼り付ける**。公開 URL から取得できないゲーム向けの逃げ道である

1 を主とするのは、バイブコーディングで作られるゲームが HTML 一枚で完結する形をしているからである。
実績を実装したコードとマニフェストが同じファイルに乗るので、片方だけ古くなるということが起きない。
ビルドも配置手順もない環境に「隣にもう一枚置け」と要求するのは、一番制約の厳しい相手に一番余計な手間を課すことになる。

### ゲームの名前は作者の中で一意

ゲームの id は作者のハンドルで修飾する。
`kuboon/my-puzzle` が全体での名前であり、マニフェストに書く `id` はその後半だけである。

こうすると、名前の衝突が起きるのは自分のゲーム同士だけになる。
他人に名前を取られることがないので、マニフェストを書く LLM が「この名前は空いているか」を気にする必要もない。
二人の作者がどちらも `tetris` を持てる。

URL もこの形になる。

| パス | 役割 |
|---|---|
| `/@kuboon` | 作者ページ |
| `/@kuboon/my-puzzle` | ゲーム詳細 |
| `/claim/@kuboon/my-puzzle/first_clear` | claim URL |

ハンドルを主キーの一部に含めるのは、**ハンドルを変更せず、ゲームを譲渡しない**ことを前提としているからである。
どちらかを認めると、ゲームの中に埋め込まれた claim URL が指す先を失う。
将来それが必要になったときは、旧 `@handle/slug` からのリダイレクトを持つことになる。

### 登録は二者の合意で成立する

すべてのゲームは作者を持つ。
カタログに「誰が作ったか」を出し、作者をフォローできるようにするためであり、作者のいないゲームはそもそも帰属を表示できない。

登録は次の二つが揃って初めて成立する。

1. **マニフェストが作者を名指しする**(`author` にハンドルを書く)
2. **名指しされたアカウントがその URL を承認する**

片方だけでは何も証明しない。
ファイルに他人の名前を書くのは誰にでもできるし、書いてもいないゲームを自分のものだと言うのも誰にでもできる。
両方が揃うと、URL の管理権と作者本人の同意が同時に確かめられる。
両者の間を秘密が一度も移動しないのは、鍵の代わりに双方向の合意を証拠にしているからである。

これは IndieAuth の `rel="me"` と同じ形である。

登録を投稿した人が、すでにサインインしていて、しかもマニフェストが名指ししている本人であれば、2 は済んでいるので即座に登録が完了する。
承認待ちのキューが要るのは、誰もその場にいない CI 経路だけである。

一度成立すると、以後 **同じ URL からの更新は素通しになる**。
CI が毎 push 叩けるという性質はここで保たれる。

**保留中の投稿は slug を確保しない。**
確保してしまうと、承認の来ない投稿で作者の良い名前を占拠できてしまう。
id は承認の瞬間に組み立てて取り、同じ slug を狙う複数の投稿は先に承認した者が取る。
名前空間が作者ごとに閉じているので、ここで争うのは同じ作者宛の投稿同士だけである。

承認は誤って押しうる行為でもある。
攻撃者が自分のサイトに他人を作者と書いたマニフェストを置き、名指しされた人が中身を見ずに承認すると、その人の名義で攻撃者が内容を差し替えられるゲームができる。
仕組みとしては両者が同意しているので正しいが、承認画面には**取得元の URL を必ず大きく出す**。

保留キューは唯一の攻撃面なので、作者あたりの保留件数に上限を設ける。
同じ URL の再投稿は行を増やさず内容を差し替える。

**貼り付け登録は本人しかできない。**
URL の裏付けがないので、他人の名義で貼れてしまうと 1 だけで登録が成立してしまう。

### ハンドルは選ばせない

作者を指す名前(ハンドル)は、初回サインイン時に id.kbn.one の userId をそのまま入れる。
名前を選ぶという行為は、公開より前に置かれた関門であり、しかもまだ何も気にしていない人に取り消せない決定を迫る。
すでに持っている識別子は一意で安定していて本人のものなので、それで足りる。

ただし `users.handle` は `external_id` とは別の列として持つ。
ゲームの id はハンドルから組み立てて登録時に保存するので、後から短い名前を配っても、変わるのは次に登録するゲームの名前だけで、公開済みの claim URL は指す先を失わない。
有償枠やキャンペーンで短い英字名を出すなら、この列を書き換えるだけでよい。

識別子が URL とマニフェストに出る以上、大文字小文字は畳まない。
他人の識別子の表記を勝手に変えると、二人が一人になりうる。

不透明な識別子を手で書き写させるのは筋が悪いので、`/dev` に **AI へ渡す手順一式** をクリップボードにコピーするボタンを置く。
作者 ID を埋め込んだうえで、script の埋め込み方、実績の書き方、claim URL の作り方までを一つの文章にしてある。

### Claude Artifacts の扱い

Artifacts のゲームは 3(貼り付け)で登録する。
公開 URL(`https://claude.ai/code/artifact/{uuid}`)を fetch しても、返ってくるのは著者の HTML ではなく、`<div id="frame-slot">` だけを持つ殻だからである。
実体は artifact ごとのサブドメイン `{uuid}.frame.claudeusercontent.com` にあり、これをクライアント側の JavaScript が iframe として差し込む。
サーバから取得できるのはその差し込みが起きる前の状態なので、script を埋め込んでもハブの取得は届かない。

実体のサブドメインを自分で叩けばよいのでは、と考えたくなるが、**そちらも塞がっている**。
2026-08-28 に実測した結果を残す。

| 叩いた先 | 返り |
| --- | --- |
| `claude.ai/code/artifact/{uuid}` | 200、殻のみ。manifest は入っていない |
| `{uuid}.frame.claudeusercontent.com/` | 404 |
| `{uuid}.frame.claudeusercontent.com/_f/{version}/` | 403 `Couldn't load this Artifact` |
| `{uuid}-top.frame.claudeusercontent.com/` | 404 |
| `claude.ai/api/frame/{uuid}` | 403(Cloudflare のチャレンジ) |
| `claude.ai/api/artifacts/{uuid}` | 403 |
| `claude.ai/public/artifacts/{uuid}` | 200、SPA の殻。manifest は入っていない |

フレームホストの 403 は `<script>parent.postMessage({__frame_denied:true},"*")</script>` を返し、
`content-security-policy: frame-ancestors 'self' https://claude.ai https://*.claude.ai` が付く。
**セッションを持たない相手には中身を出さない**設計である。

殻のローダも読んだ。
org(クッキー `lastActiveOrg` か `?org=`)が無ければ `if(!r)return` でフェッチ自体を始めず、
実際の取得は `/api/frame/{uuid}` への same-origin + credentials である。
共有キー `sk` を受け取る口はあるが、公開 URL には付かない。

したがって **`data-frame-uchost` を読んで iframe を追う実装を書いても、本番では必ず 403 になる。**
書けば動くコードではなく、書いても動かないコードなので、書かない。

一つだけ未検証なのは `claude.site/artifacts/{uuid}` で、
調査したコンテナのプロキシがそのホストを塞いでいたため叩けていない。

なお、貼り付けるときは `url` を自分で足す必要がある。
取得元が無い以上ゲームの場所を誰も知らないので、`registerFromPaste` がそこだけ必須にしている。

登録は開発時の一度きりの行為なので、貼り付けで足りる。
解除は claim URL で動くため、実行時に困ることはない。

## 認証とアカウント

プレイヤーは game-center から id.kbn.one でサインアップとサインインを行う。
id.kbn.one は OIDC ではなく、**DPoP** (RFC 9449)によるパスキー認証 + Cookie レスのセッション共有を提供する。
実装は [deno-remix-reference](https://github.com/kuboon/deno-remix-reference) にあるものを踏襲する。

サインインの流れは次のとおり。

1. ブラウザが DPoP 鍵ペアを生成し(`@kuboon/dpop` の `init()`、IndexedDB に保存)、JWK thumbprint (RFC 7638)を計算する
2. `https://id.kbn.one/authorize?dpop_jkt={thumbprint}&redirect_uri={戻り先}` へ遷移し、IdP でパスキー認証する
3. IdP がその thumbprint に userId をバインドし、ブラウザを戻り先へリダイレクトする
4. 以後、ブラウザは DPoP 証明付き fetch で `GET https://id.kbn.one/session` から `{ userId, jws, nickname }` を得る(サインアウトは `POST /session/logout`)

game-center サーバ側は、reference の `remix-dpop-session-middleware` パターンで受ける。
ブラウザからの認証付きリクエストは DPoP 証明を伴い、ミドルウェアが証明を検証して thumbprint をセッション ID とするサーバセッションを開く。
セッションストレージは reference の Deno KV 実装を Turso に差し替える。
`@kuboon/kv` の `TursoKvRepo` が汎用の `kv` テーブルを提供するので、その上に `SessionStorage` アダプタ(`packages/session_storage_kv`)を薄く重ねる。
アダプタとミドルウェアはどちらも未公開のため、id.kbn.one と deno-remix-reference と同じくワークスペース内に持つ。

game-center サーバが userId を信頼する根拠は、`/session` 応答の **jws** である。
これは IdP が ES256 署名した JWT で、`sub`(userId)、`iss`、`nbf` / `exp`(1時間)、`jti` に加え、`cnf.jkt` にブラウザの DPoP 鍵 thumbprint が入る(RFC 9449 の鍵バインド)。
ブラウザは jws を DPoP 証明付きで `POST /api/internal/session` に送り、サーバは IdP の JWKS(`https://id.kbn.one/.well-known/jwks.json`)で署名と `iss` / `exp` / `nbf` を検証し、`cnf.jkt` がその DPoP セッションの thumbprint と一致することを確認してから、userId をセッションに書き込み `users` 行を upsert する。
`nickname` クレームは `display_name` の初期値に使う。

SSR ページ(document GET)には DPoP 証明を付けられないため、ページはサインイン状態に依存しない形でレンダリングし、ナビバーや実績表示などの認証依存部分は clientEntry の hydration でクライアント側から埋める(reference の NavAuth / SignInCard と同じ構成)。

server-to-server 連携(IdP 経由のプッシュ通知 `POST /rp/notifications`。実績解除の通知に使える)には、相互 JWKS パターンを使う。
game-center は `/.well-known/jwks.json` で自身の ES256 署名鍵を公開し、IdP への要求には `private_key_jwt` の client assertion を付ける。
clientId は RP の origin そのもので、IdP 側での事前登録は不要である(`AUTHORIZE_WHITELIST` のホストとそのサブドメインが許可される)。

ゲーム開発者の認証は2系統ある。

- **Web UI から**：プレイヤーと同じサインインで、自分のゲームをフォームから登録・編集できる(Artifacts のような repo なしのゲーム向け)
- **API から**：ダッシュボードで発行する **登録用 API トークン** を Bearer に付ける。GitHub Action はこれを repo secret として使う

## DB スキーマ (Turso)

```sql
create table users (
  id            integer primary key,
  external_id   text not null unique,     -- id.kbn.one のユーザ識別子
  display_name  text not null,
  avatar_url    text,
  created_at    text not null default (datetime('now'))
);

create table games (
  id            text primary key,         -- slug (gamecenter.json の id)
  owner_id      integer not null references users(id),
  title         text not null,
  description   text,
  url           text not null,            -- 起動 URL。origin 検証にも使う
  icon_url      text,
  status        text not null default 'active',  -- active | hidden
  created_at    text not null default (datetime('now')),
  updated_at    text not null default (datetime('now'))
);

create table achievements (
  id            integer primary key,
  game_id       text not null references games(id),
  key           text not null,
  title         text not null,
  description   text,
  points        integer not null default 0,
  hidden        integer not null default 0,
  sort_order    integer not null default 0,
  unique (game_id, key)
);

create table user_achievements (
  user_id        integer not null references users(id),
  achievement_id integer not null references achievements(id),
  unlocked_at    text not null default (datetime('now')),
  via            text not null,           -- claim | rest | postmessage
  score          integer,                 -- 任意。ゲームが報告するスコア
  primary key (user_id, achievement_id)
);

create table api_tokens (
  id            integer primary key,
  user_id       integer not null references users(id),
  token_hash    text not null unique,     -- 平文は発行時のみ表示
  name          text not null,
  created_at    text not null default (datetime('now')),
  last_used_at  text
);

-- DPoP セッションを含む揮発データは、`@kuboon/kv` の TursoKvRepo が使う
-- 汎用の kv テーブルに入る(セッションのキーは DPoP 鍵の JWK thumbprint)。
create table kv (
  key           text primary key,
  value         text not null,
  expires_at    integer,
  version       integer not null default 0
);
```

マイグレーションは [remix-db-migrations-deno](https://github.com/kuboon/kuboon-remix-utils/tree/main/plugins/remix-db-migrations-deno) の規約に従う。
`db/migrations/` に `YYYYMMDDHHmmss_name/` ディレクトリを作り、`up.sql` と `down.sql` を置く。
Remix CLI の `remix db` は remix.json が sqlite / postgres / mysql しか受け付けず Turso を表現できないため、同じ規約を実装した `@kuboon/remix-data-table-sqlite-turso` の CLI を使う。
こちらは `remix db` にない rollback も持つ。
適用はサーバ起動時ではなく、デプロイ手順の一段(`deno task migrate`)として行う。
Deno Deploy ではリクエストごとに isolate が起動するため、起動時適用にすると各 isolate がマイグレーションを競って実行することになる。

運用上の制約は二つあり、どちらも実際に踏んだ。
ランナーは適用時に内容のチェックサムを journal に記録するので、**適用済みのマイグレーションを書き換えると以後の適用が止まる**。
テストは毎回まっさらな DB を作るため気づけず、CI が緑のままデプロイだけが赤くなる。
CI に専用のジョブを置いて、base ブランチに既にあるマイグレーションへの変更を落とすようにした。
もう一つは、ランナーが各マイグレーションをトランザクションで包むため、**その中では外部キーを切れない**ことである。
`pragma foreign_keys` も `defer_foreign_keys` も効かないので、行の入ったテーブルは作り直せない。
主キーの値を振り直すような変更は、子テーブルごと消すか、作り直しを避けるかのどちらかになる。
詳細は [db/README.md](../db/README.md)。

## API 一覧

API は呼び出し元ごとにパスを分け、CORS と認証をパス単位で固定する。

| 面 | パス | 呼び出し元 | 認証 | CORS |
|---|---|---|---|---|
| ゲーム用 | `/api/game/v1/*` | 各ゲームのページ(任意オリジン) | 起動トークン | すべてのオリジンに開放 |
| 内部用 | `/api/internal/*` | ハブ自身のフロントエンド | DPoP | CORS ヘッダなし(同一オリジンのみ) |
| 登録用 | `/api/registry/v1/*` | GitHub Action 等のサーバ・CI | なし | 不要(ブラウザから呼ばない) |

**ゲーム用 API** は、起動トークンの `aud` に入っている game_id の範囲に閉じる。
どのエンドポイントも他のゲームの情報には読み書きできず、プレイヤーについても「そのゲームでの実績」しか見えない。

| メソッドとパス | 役割 |
|---|---|
| `POST /api/game/v1/unlock` | 実績解除 `{ achievement: key, score? }` |
| `GET /api/game/v1/me` | プレイヤーの表示名と、そのゲームでの解除済み実績 |
| `GET /api/game/v1/achievements` | そのゲームの実績定義(ゲーム内の進捗表示用) |

**内部用 API** は、ハブの clientEntry(ナビバー、claim ページ、ダッシュボード)が DPoP 証明付き fetch で呼ぶ。
CORS ヘッダを返さないため、他オリジンのページからは呼べない。

| メソッドとパス | 役割 |
|---|---|
| `POST /api/internal/session` | IdP の jws を検証して userId をセッションに確定 |
| `GET /api/internal/me/achievements` | 全ゲーム横断の自分の実績一覧 |
| `GET /api/internal/timeline` | フォロー中の人の実績解除とゲーム登録を新しい順に |
| `GET /api/internal/followers` | 自分のフォロワーと、前回見たあとに増えた数。副作用なし |
| `POST /api/internal/followers/seen` | フォロワー一覧を見たことを記録する |
| `POST /api/internal/claim` | claim ページの確認ボタンから実績解除 |
| `POST /api/internal/launch` | 起動トークンを発行し、フラグメント付きの起動 URL を返す |
| `GET`/`POST` `/api/internal/games` | 自分のゲームと承認待ちの一覧、URL 登録または貼り付け登録 |
| `POST`/`DELETE` `/api/internal/registrations/{id}` | 承認待ちの承認 / 却下 |

登録は POST だけで足り、PATCH は用意しない。
マニフェスト全体の upsert が登録と編集を兼ねるので、部分更新の口があるとゲーム側の文書とハブの状態が食い違いうる。

**登録用 API** はブラウザ外(CI やサーバ)から呼ぶ前提で、CORS は設定しない。

| メソッドとパス | 役割 |
|---|---|
| `POST /api/registry/v1/games` | `{ url }` を受け取り、そこからマニフェストを読んで upsert する。初回は 202 を返して作者の承認を待つ |

**登録用 API は認証しない。**
この API がすることは「すでに公開されている文書をハブに読み直させる」ことだけであり、書き換えてよいかどうかを決めるのはその文書の置き場所だからである。
資格情報を足しても守るものが増えず、しかもその資格情報の受け渡しは、ゲームの作者(多くは LLM)が自力で通せない唯一の手順になる。
GitHub Action に secret が要らないのはこのためである。

無認証なので、レート制限は必要である。
ただし悪用の余地は狭い。できることは、誰かが公開済みのマニフェストをハブに読ませることだけで、それはそのマニフェストの作者が望んだことである。

内部用と登録用は同じ登録処理を共有する。
GitHub Action が出すエラーと、ダッシュボードで出るエラーが一致していないと、開発者はどちらを信じてよいか分からなくなる。

マニフェストの JSON Schema は `GET /schema/gamecenter.json` で配信する。
`$schema` にこの URL を書けばエディタが補完でき、CORS は全開放にしてある。

公開ゲーム一覧とゲーム詳細はハブのページ(SSR)として提供し、匿名向けの公開 JSON API は当面設けない。

Web UI 側の主なルートは次のとおり。

| パス | 役割 |
|---|---|
| `/` | カタログ(ゲーム一覧) |
| `/@{handle}/{slug}` | ゲーム詳細。実績一覧と「遊ぶ」ボタン(未サインインなら「サインインしてプレイ」) |
| `/claim/@{handle}/{slug}` | claim リンクの受け口。フラグメントの一覧を確認してまとめて解除 |
| `/claim/@{handle}/{slug}/{key}` | 一つ前の形式。配布済みの SDK コピーのために残す |
| `/me` | フォロー中の人の実績解除とゲーム登録のタイムライン。自分の実績一覧 |
| `/@{handle}` | 作者でありプレイヤーのページ。点数・実績・ゲーム数、登録したゲーム、解除した実績 |
| `/dev` | 開発者ダッシュボード(ゲーム登録、AI に渡すプロンプト)。登録まわりはここに集約する |
| `/docs`, `/llms.txt`, `/schema/gamecenter.json` | 開発者向け提供物の配信 |

## SDK

SDK は依存ゼロの TypeScript 単一ファイルとして書く。
Artifacts は外部スクリプトを読み込めないため、**コピペできる大きさに保つこと自体を仕様とする**(目安 150 行以内)。
GitHub Pages のゲームは JSR / esm.sh から import してもよい。

公開 API は最小にする。

```ts
import { GameCenter } from "@kuboon/game-center-sdk"; // またはファイル同梱

const gc = GameCenter.init({ gameId: "kuboon/my-puzzle" });
gc.unlock("first_clear");                  // モードを自動選択して解除
gc.unlock("high_score", { score: 1200 });  // スコア付き。ハイスコアのみ保持
gc.player;                  // { name } | null (起動トークンがある場合のみ)
```

`unlock()` は起動トークンがあれば REST で送り、無ければ `localStorage` のキューに積む。
**例外を投げず、勝手に遷移もしない。**
戻り値は `{ recorded, pending }` で、`pending` が 0 でなければ `claimLink()` がその件数ぶんの `<a>` を作る(0 件なら `null`)。
新規タブを勝手に開かないのは、ポップアップブロック対策であり、プレイヤーの意思確認でもある。

キューがあることで、claim 画面は「サインアウトで遊んだ人の逃げ道」に縮む。
あとからハブ経由で起動すれば、SDK が黙ってキューをまとめて送るからである。

起動トークンはハブが URL のフラグメントに置く。
SDK はそれを読んで localStorage に保存し、アドレスバーから消す。
URL ごとチャットに貼られてもトークンが一緒に流れないようにするためである。
ハブが 401 を返したらトークンを捨てる。
そうしないと、以後の解除がすべて成功しえないリクエストを待つことになる。

パッケージは `lib` をブラウザのものだけに絞ってある。
ゲームの中に同梱されるファイルに Deno の API が紛れ込まないようにするためで、テストファイルだけが `deno.ns` を参照する。

### iframe をやめた理由

`/play/@{author}/{slug}` はゲームを iframe で埋め込み、`gc:unlock` を親のセッションで記録するページだった。
一度作ってから廃止した。

**理由はまず体験である。**
ハブの枠が付くぶんゲーム画面が狭くなる。
狭いと遊びづらく、没入感も減る。
枠の中で遊んでもらう見返りが、枠のぶんの損失に見合わなかった。

**そして、モードが一つ丸ごと消える。**
埋め込みが無ければ SDK に親フレームを探す経路は要らず、`unlock()` は REST と claim の2つになる。
実績一覧のような後から足す API も、postMessage 版を用意するかトークンを渡すかという分岐を持たずに済む。
SDK は「コピペできる大きさに保つこと自体が仕様」なので、経路が減ることに独立した価値がある。

そもそも Claude Artifacts は `frame-ancestors 'self'` を返すので埋め込めず、主要なホスティングの片方では最初から動いていなかった。

`user_achievements.via` の check 制約に残る `'postmessage'` はそのままにする。
その値で記録された行は実際にあり、制約から値を落とすにはテーブルを作り直すことになる。
行の入ったテーブルは作り直せない(「マイグレーション」節)。
書くのをやめるだけで、読める状態は保つ。

## GitHub Action

ゲームリポジトリに次を書くだけで、push のたびにマニフェストが登録・更新されるようにする。

```yaml
# ゲームリポジトリ側 .github/workflows/register.yaml
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

secret はない。
checkout も要らない。
Action がすることは「この URL を読み直せ」とハブに伝えることだけで、検証も帰属の判定もハブ側で行われる。
検証エラーはレスポンスに全件返るので、Action はそれを表示して CI を落とす。

初回の push では 202 が返る。
作者がまだ承認していないという意味なので、Action はこれを失敗とはせず、承認 URL を出して成功で終える。

## LLM 向け提供物

ゲーム開発者の多くは LLM なので、「LLM が一度読めば正しく組み込める」文書を成果物として扱う。

- **`docs/protocol.md`**：正式仕様。これが正本である
- **`/llms.txt`**：`docs/protocol.md` と `packages/sdk/mod.ts` から `bundler/llms.ts` が生成する。仕様全文、SDK 全文、最小の実例が一つに入る。ビルド成果物なので `bundled/` に出て、`staticFiles` がそのまま配信する
- **Claude skill**：`skills/game-center/SKILL.md`。トリガー条件と手順、そして「まず作者 ID をユーザに聞く」

生成にするのは、仕様を書き写したファイルがいずれ仕様と食い違うからである。
一つに収めるのは、四つのページを取りに行かせるとどれかを読み落とすからである。

## ディレクトリ構成

deno-remix-reference に倣った Deno workspace とする。

```
deno.json                    # workspace ルート: members, tasks, unstable flags
README.md
LICENSE
docs/
  grand_design.md            # 本文書
  protocol.md                # プロトコル正式仕様(llms.txt の生成元)
server/                      # Remix v3 アプリ (ハブ + API)
  deno.json
  routes.ts                  # ルート宣言
  router.ts                  # ルータ組み立て (export default)
  controllers/               # ページ・API のコントローラ
  middleware/                # DPoP セッションミドルウェア(id.kbn.one 連携)
  db/
    client.ts                # Turso クライアント
    migrations/              # 連番 SQL
  tests/
client/                      # ブラウザエントリ、@remix-run/ui の run() で hydrate
bundler/                     # Deno.bundle + Tailwind ビルド → bundled/
packages/
  protocol/                  # gamecenter.json の JSON Schema と共有型、検証関数
  sdk/                       # @kuboon/game-center-sdk (単一ファイル、JSR 公開)
  session_storage_kv/        # KvRepo を SessionStorage に橋渡しする
  dpop_session_middleware/   # DPoP セッションミドルウェア
action/                      # ゲーム登録用 composite action (action.yml)
skills/
  game-center/SKILL.md       # ゲーム開発者(LLM)向け Claude skill
.github/workflows/
  ci.yaml                    # deno task check / test
.claude/
  settings.json              # SessionStart hook (リモートセッションで Deno を導入)
  hooks/session_start.sh
```

## フォロー

一方向。
承認は要らない。
作者としてのフォローとプレイヤーとしてのフォローは分けない。
`/@{handle}` が作者ページでありプレイヤーページであるのと同じ理由で、フォローも一種類でよい。

```sql
create table follows (
  follower_id integer not null references users(id),
  followee_id integer not null references users(id),
  created_at  text not null default (datetime('now')),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee on follows (followee_id);
```

主キーが二者の組なので二重フォローは起きない。
自分をフォローできないことは制約が保証する。

### 見え方

**プレイ履歴とスコアは全公開**とする。
プロフィールページは SNS に貼ってもらう前提であり、フォローされる前に中身が見えなければフォローする理由が生まれない。

ただし `hidden = 1` の実績は、他人には題名を伏せたまま「解除した」事実だけを出す。
自分には見えていて他人には伏せる、という非対称を実績表示に持ち込む。

### `/@{handle}`

作者ページに足す。

- フォロワー数とフォロー中の数
- フォローボタン。サインイン中で、かつ本人でないときだけ出す
- 解除した実績を新しい順に。ゲーム名、実績名、`score`

SSR に DPoP 証明を付けられないため、フォローボタンは clientEntry である(`NavAuth` と同じ)。

### `/me` — フォローの見返り

フォローしたことが何かに変わる場所が無ければ、フォローボタンは押されない。
それが `/me` である。

フォロー中の人の **実績解除** と **ゲーム登録** を新しい順に混ぜて出し、各行からそのゲームへ飛ばす。
記録を眺めるページではなく、次に何を遊ぶかを決めるページとして作る。

イベント表は作らない。
`user_achievements.unlocked_at` と `games.created_at` の union で足りるし、
ログを別に書けば、それが記述している行といずれずれる(`server/db/timeline.ts`)。

`hidden` の題名は SQL を出る前に伏せる。
ブラウザで隠すのは、送ってしまってから隠すことである。

自分の行は出さない。
自分が何をしたかは知っているし、それを他人に見せるページは `/@{handle}` のほうである。

ここにも全体のフィードは無い。
「偽装は防がない、代わりに誰を見るかを選ばせる」の帰結であり、見えるのは選んだ相手だけである。

### 共有されたときの見え方

このページは SNS に貼られる前提なので、貼った先で何と表示されるかが最初の接点になる。
`og:title` / `og:description` / `og:url` と `rel=canonical` を出す。

**画像は生成しない。**
プロフィールは IdP のアバター、ゲームはマニフェストの `icon_url` を使い、
どちらも無ければ画像なしのカードを出す。
中身のないプレースホルダを置いたカードより、小さくても収まっているカードのほうが良い。
`twitter:card` も、画像があるときだけ `summary_large_image` にする。

`og:url` はハブ自身の origin から組み立てる。
プロキシの内側ではリクエストのホストが内部名になりうるので、
それを指す canonical は無いよりも悪い。

カードの中身を作るのは `server/ui/share_cards.ts` の純関数である。
サーバは fetch ベースの libSQL を使っていて `file:` を開けないため、
データの入ったページを描画するテストが書けない。
そこで内容だけを切り出して直接試している。

### サインアウトの訪問者が主役である

**人が game-center に来る一番多い経路は、作者がこの URL を SNS に貼り、それを見た人がリンクを踏むことである。**
つまりこのページに来るサインアウトの訪問者は、迷い込んだ人ではなく本命である。

そこでサインアウトなら「サインインしてフォロー」を出す。
押すと、誰をフォローするつもりだったかを覚えてから IdP へ送り、
戻ってきた時点でフォローを実行して「〇〇さんをフォローしました」と出す。
サインインしてから、もう一度ボタンを探させない。

意図の受け渡しは `sessionStorage` で行う(`client/follow_intent.ts`)。
**戻り先 URL に載せない。**
URL は共有できてしまうので、開いた人が黙って誰かをフォローするリンクを配れることになる。
`sessionStorage` はそのタブのその訪問に閉じていて、他人が送ったものが入る余地がない。

読み出しは一度きりで、使えるかどうかに関わらず消す。
前のページで押した意図が残っていて、後から無関係なプロフィールで発火するのを防ぐため。

ストレージが使えなくても例外にしない。
プライベートウィンドウなどで失敗しても、サインインはできてボタンをもう一度押せばよい。

### カタログ

サインイン中は三段。

1. フォロー中の作者のゲーム
2. フォロー中の人が遊んでいるゲーム(1 に出たものを除く)
3. すべてのゲーム(新しい順)

1 と 2 はフォロー関係から作るので DPoP 証明が要り、SSR では出せない。
ブラウザから取って 3 の上に足す形にする(`CatalogSections`)。
3 は誰にとっても同じなので SSR のまま残す。
JavaScript 無しでも、検索エンジンから見ても、カタログは読める。

サインアウトなら 3 だけ。
**中身が空の段は見出しごと出さない。**
フォローを始めたばかりだと 1 も 2 も空になるため、空欄が並ぶのを避ける。

3 から 1 や 2 の分を差し引くことはしない。
カタログは全部あるから見に行く場所であって、上の段に出たものが消えるほうが困る。

### ゲームページの比較

自分とフォロー中の人の解除を、実績ごとに並べる。
**自分を必ず含める。**
自分が入っていない比較は、ただの他人の一覧である。

並び順はマニフェストの実績順、次にスコアの高い順、同点なら早く取ったほうが先。
スコアの無い解除はスコアのある解除の後ろに置く。
スコアが無いことは 0 点ではない。

ゲームページ本体は SSR のままとする。
誰をフォローしているかは SSR の時点で分からないので、比較は下に別の節として足す
(`PeerScores`)。SSR された実績一覧に後から差し込むことはしない。

`hidden` の実績の題名は**サーバ側で伏せてから返す**。
クライアントに渡らない題名は、クライアントが何をしても漏れない。

全ユーザのランキングにはしない。
広げるためのパラメータも置かない。
理由は「偽装は防がない、代わりに誰を見るかを選ばせる」に書いたとおりである。

### API

```
POST   /api/internal/follows          { handle }   → 201 / 200 (冪等)
DELETE /api/internal/follows/:handle               → 204 (フォローしていなくても 204)
GET    /api/internal/follows/:handle               → { following, followers, followees }
GET    /api/internal/games/@:handle/:slug/peers    → フォロー中の人の解除
```

DPoP 認証、CORS なし。
`GET` はボタンの初期状態を埋めるためにある。

### 通知

新作の通知は id.kbn.one 側の実装を使う。
接続は後回しとし、当面はカタログの一段目が「気づく」を担う。

ただし **フォローされたことだけは別**である。
プレイヤーがこのハブで見るものはほぼ全部、自分がやったことの結果であり、自分の足取りを辿れば出てくる。
フォローされたことだけがそうではない。
自分は何もしていないのだから、思い出して見に行くきっかけがない。
外部の通知を繋ぐ前に、ハブの中で気づけるようにする。

`/me` の「フォロワー」に誰がいつフォローしたかを新しい順に出し、前回見たあとに来た人に `new` を付ける。
そのうえで、全ページに出ているナビバーの自分の名前にバッジを出す。
「気づく」を担うのは後者で、一覧は気づいたあとに開く場所である。

既読は `users.followers_seen_at` の一本の時刻で持つ。
何が新しいかは `follows.created_at > users.followers_seen_at` であり、行ごとに既読フラグを持てば `follows` が既に持っている事実の二重管理になる。

**読み出しは既読にしない。**
ナビバーが全ページでこの数を読むので、読んだ時点で既読にすると、誰も名前を見ないうちにバッジが消える。
既読にするのは、一覧を実際に描いた `/me` が投げる別の呼び出しである。
そこで送る時刻は「今」ではなく**画面に出した最新の行**で、読み出しと書き込みの間に来たフォローを黙って既読にしないためである。
通知は二度出すより落とすほうが高くつく。

フォロワーの一覧は本人にしか見せない。
`/@{handle}` が公開しているのは人数であって、誰がフォローしているかを名指しするのはそれとは別の問いであり、まだ誰も問うていない。

## マイルストーン

各マイルストーンは独立にマージ可能な単位とし、この順で進める。

1. **M0 足場**：workspace 雛形、CI、SessionStart hook、Hello World が `deno task dev` で立つ
2. **M1 データ層**：Turso 接続、マイグレーション、スキーマ一式
3. **M2 認証**：id.kbn.one との DPoP 連携(reference 踏襲)、Turso セッションストレージ、`/me` の骨格
4. **M3 ゲーム登録**：packages/protocol のスキーマ、`POST /api/registry/v1/games`、開発者ダッシュボード、API トークン
5. **M4 実績解除**：claim URL モードと REST モード、起動トークン、カタログとゲーム詳細ページ
6. **M5 SDK と埋め込み**：SDK 単一ファイル、`/play/{id}` の postMessage モード、JSR 公開
7. **M6 自動登録と LLM 提供物**：GitHub Action、protocol.md、llms.txt 生成、Claude skill
8. **M7 フォロー**：`follows`、フォローボタン、プロフィールの実績一覧、カタログの並び、ゲームページの比較
9. **M8 磨き込み**：ポイント集計、OGP、レートリミット、却下した URL の再投稿遮断

M2 の実装手本は deno-remix-reference(RP 側)と id.kbn.one 本体(IdP 側)の両方が手元にあるため、外部依存はない。

## 未決事項

実装前に確認・決定が要るものを挙げる。

- **AUTHORIZE_WHITELIST**:本番の id.kbn.one の許可リストに `ga-cen.kbn.one` が含まれること(`kbn.one` が登録済みならサブドメインとして許可される)の確認
- **短いハンドル**:有償またはキャンペーンの枠で短い英字名を配る案。`users.handle` を書き換えるだけで足りる設計にしてあるが、作者ページの旧 URL をどう扱うかは未定

決着したもの。

- **登録 API のレート制限**:同一アドレスあたり毎分 30 件。`kv` テーブルの固定窓カウンタ(`server/lib/rate_limit.ts`)。上限を掛ける対象は保留キューではなく**外向きの fetch** である。キューは作者ごとに既に頭打ちだが、フェッチは無認証で誰でも好きなだけ起こせる
- **却下した URL の再投稿**:却下を `registration_refusals` に残し、無認証の経路からの再投稿を 409 で拒む。作者自身が貼り付けで登録する経路は塞がない。気が変わることは許すが、しつこくされることは許さない
- **実績の改竄耐性**:防がない。認証だけを固め、誰を見るかはフォローでユーザに選ばせる。全ユーザ横断のランキングは作らない。段階論も取らない
- **フォロー**:一方向、作者とプレイヤーで分けない、プレイ履歴は全公開。仕様は「フォロー」節にある。通知は id.kbn.one の実装を使い、接続は後回し
- **game id の予約と移譲**:id は作者ごとの名前空間に閉じるので、他人による横取りは起きない。確定するのは作者が承認した瞬間であり、承認待ちの投稿は何も確保しない。譲渡は行わない
- **iframe 埋め込み**:行わない。ゲーム画面が狭くなるのが第一の理由で、モードが一つ減るのが第二。Artifacts はそもそも `content-security-policy: frame-ancestors 'self'` を返すので埋め込めない
