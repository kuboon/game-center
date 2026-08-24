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
この信頼モデルを最初から受け入れ、競争的な要素(ランキングや対戦)は当面スコープ外とする。

2つ目は、Claude Artifacts の CSP である。
Artifact 上のページは外部ホストへの fetch/XHR が遮断されるため、ゲームから game-center の API を直接呼べない。
一方、外部サイトへの通常のリンク遷移(新しいタブで開く)はできる。
そこで、API を呼ばずリンク遷移だけで実績を解除できる経路をプロトコルの最下層に置き、fetch が使える環境(GitHub Pages など)では、より滑らかな経路を重ねる。

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
  (SDK 経由で実績解除: claim URL / REST / postMessage)
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
| postMessage | iframe 親子間の postMessage | game-center 内に埋め込まれたゲーム | ページ遷移なしで即時反映 |
| REST | fetch + Bearer トークン | 外部 fetch が可能なホスティング(GitHub Pages 等) | ページ遷移なしで即時反映 |
| claim URL | リンク遷移(新規タブ) | すべて(Claude Artifacts を含む) | game-center のタブが開き、確認後に解除 |

**claim URL モード** は最下層の共通経路である。
ゲームは次の URL を新規タブで開くだけでよい。

```
https://ga-cen.kbn.one/claim/@{author}/{slug}/{achievement_key}
```

遷移先でプレイヤーは(未サインインなら)サインインし、「実績を解除する」を確認して解除が記録される。
スコアを付けたい場合はクエリ `?score=1200` を足す。
トークンも fetch も不要なので、Artifacts のような制約環境でも、SDK を使わない手書きゲームでも動く。

**REST モード** は、後述の起動トークンを Bearer に付けて `POST /api/game/v1/unlock` を呼ぶ。
ゲーム用 API は CORS をすべてのオリジンに開放する(トークン認証であり、Cookie を使わないため開放してよい)。

**postMessage モード** は、game-center のプレイページ(`/play/{game_id}`)がゲームを iframe で埋め込んだ場合に使う。
SDK は `window.parent !== window` を検出し、`{ type: "gc:unlock", achievement: key, score? }` を親に postMessage する。
親側は iframe の origin が登録済みゲームの URL と一致することを検証してから解除を記録する。
Claude Artifacts は claude.ai 側の制約で iframe 埋め込みできない見込みのため、このモードは GitHub Pages 等のゲーム向けである。

どのモードでも、解除には任意で **score**(整数)を添えられる。
解除は冪等であり、解除済みの実績への再報告は、score が保存済みの値より高い場合だけ更新する(ハイスコアのみ保持。`unlocked_at` は初回のまま)。
score のない再報告は何もしない。

### 起動フローと起動トークン

プレイヤーが game-center のカタログからゲームを起動するとき、game-center は **起動トークン** (launch token)を発行し、URL フラグメントでゲームに渡す。

```
https://example.github.io/my-puzzle/#gctoken=<JWT>
```

起動トークンは game-center が署名する短命(2時間)の JWT で、claims は `sub`(ユーザ ID)、`aud`(`{author}/{slug}`)、`iss`、`exp` のみとする。
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

不透明な識別子を手で書き写させるのは筋が悪いので、`/me` に **AI へ渡す手順一式** をクリップボードにコピーするボタンを置く。
作者 ID を埋め込んだうえで、script の埋め込み方、実績の書き方、claim URL の作り方までを一つの文章にしてある。

### Claude Artifacts の扱い

Artifacts のゲームは 3(貼り付け)で登録する。
公開 URL(`https://claude.ai/code/artifact/{uuid}`)を fetch しても、返ってくるのは著者の HTML ではなく、`<div id="frame-slot">` だけを持つ殻だからである。
実体は artifact ごとのサブドメイン `{uuid}.frame.claudeusercontent.com` にあり、これをクライアント側の JavaScript が iframe として差し込む。
サーバから取得できるのはその差し込みが起きる前の状態なので、script を埋め込んでもハブの取得は届かない。

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
| `/@{handle}/{slug}` | ゲーム詳細。実績一覧と「遊ぶ」ボタン |
| `/play/{handle}/{slug}` | iframe 埋め込みプレイページ(postMessage モードの親) |
| `/claim/@{handle}/{slug}/{key}` | claim URL の受け口。確認して解除 |
| `/me` | 自分の実績一覧とポイント合計、AI に渡すプロンプト |
| `/@{handle}` | 作者ページ。その作者のゲーム一覧 |
| `/dev` | 開発者ダッシュボード(ゲーム登録、API トークン発行) |
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

`unlock()` の内部は、postMessage → REST → claim URL の順に利用可能なモードへフォールバックする。
**例外を投げず、勝手に遷移もしない。**
戻り値の `recorded` が false のとき `claimUrl` が入っているので、呼び出し側はそれをリンクとして画面に出す。
`claimLink()` がその `<a>` を作る。
新規タブを勝手に開かないのは、ポップアップブロック対策であり、プレイヤーの意思確認でもある。

起動トークンはハブが URL のフラグメントに置く。
SDK はそれを読んで localStorage に保存し、アドレスバーから消す。
URL ごとチャットに貼られてもトークンが一緒に流れないようにするためである。
ハブが 401 を返したらトークンを捨てる。
そうしないと、以後の解除がすべて成功しえないリクエストを待つことになる。

パッケージは `lib` をブラウザのものだけに絞ってある。
ゲームの中に同梱されるファイルに Deno の API が紛れ込まないようにするためで、テストファイルだけが `deno.ns` を参照する。

### /play/@{author}/{slug}

postMessage モードの親側。
ゲームを iframe で埋め込み、`gc:unlock` を受けてプレイヤー自身のセッションで記録する。
ゲームは資格情報を一切持たない。

**安全性はひとつの検査に懸かっている。**
`message` イベントは任意のフレームから届くので、`event.origin` が登録済みゲームの URL の origin と一致することを確かめてから他の何もしない。
その origin はメッセージからではなく、サーバがレンダリングした登録内容から来る。

Artifacts は `frame-ancestors 'self'` を返すのでここには埋め込めない。
それらのゲームは claim URL を使う。

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

- **`/llms.txt`**：プロトコル全体、SDK 全文(コピペ用)、gamecenter.json の例、登録手順を1ファイルに収めたもの。docs から生成してハブサイトで配信する
- **Claude skill**：`skills/game-center/SKILL.md`。トリガー条件(「game-center に対応させたい」等)と、llms.txt と同内容の手順を含む
- **`docs/protocol.md`**：人間の開発者向けの正式仕様。llms.txt はここから生成し、二重管理しない

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

## マイルストーン

各マイルストーンは独立にマージ可能な単位とし、この順で進める。

1. **M0 足場**：workspace 雛形、CI、SessionStart hook、Hello World が `deno task dev` で立つ
2. **M1 データ層**：Turso 接続、マイグレーション、スキーマ一式
3. **M2 認証**：id.kbn.one との DPoP 連携(reference 踏襲)、Turso セッションストレージ、`/me` の骨格
4. **M3 ゲーム登録**：packages/protocol のスキーマ、`POST /api/registry/v1/games`、開発者ダッシュボード、API トークン
5. **M4 実績解除**：claim URL モードと REST モード、起動トークン、カタログとゲーム詳細ページ
6. **M5 SDK と埋め込み**：SDK 単一ファイル、`/play/{id}` の postMessage モード、JSR 公開
7. **M6 自動登録と LLM 提供物**：GitHub Action、protocol.md、llms.txt 生成、Claude skill
8. **M7 磨き込み**：プロフィール公開ページ、ポイント集計、OGP、レートリミット

M2 の実装手本は deno-remix-reference(RP 側)と id.kbn.one 本体(IdP 側)の両方が手元にあるため、外部依存はない。

## 未決事項

実装前に確認・決定が要るものを挙げる。

- **AUTHORIZE_WHITELIST**:本番の id.kbn.one の許可リストに `ga-cen.kbn.one` が含まれること(`kbn.one` が登録済みならサブドメインとして許可される)の確認
- **登録 API のレート制限**:無認証なので、同一 IP / 同一 URL の頻度に上限が要る。保留件数の上限は実装したが、投稿そのものの頻度制限は未実装
- **フォロー**:作者をフォローして新作に気づく機能。`/@{handle}` は用意したが、フォロー自体とその通知手段は未設計
- **却下した URL の再投稿**:今は却下しても同じ URL をまた投稿できる。繰り返されるなら遮断が要る
- **短いハンドル**:有償またはキャンペーンの枠で短い英字名を配る案。`users.handle` を書き換えるだけで足りる設計にしてあるが、作者ページの旧 URL をどう扱うかは未定
- **実績の改竄耐性**:自己申告モデルで開始する方針の最終確認(ランキング等を将来入れる場合は別途設計)

決着したもの。

- **game id の予約と移譲**:id は作者ごとの名前空間に閉じるので、他人による横取りは起きない。確定するのは作者が承認した瞬間であり、承認待ちの投稿は何も確保しない。譲渡は行わない
- **Artifacts の iframe 可否**:不可。実測したところ `content-security-policy: frame-ancestors 'self'` が返る。postMessage モードの対象外とする
