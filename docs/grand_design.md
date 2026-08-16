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

以下、ハブサイトのドメインは `games.kbn.one` (仮)と表記する。

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
ゲームリポジトリ ──GitHub Action──▶ game-center ハブ (games.kbn.one)
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
| DB | Turso (`npm:@libsql/client`) | HTTP 経由なのでホスティングを選ばない |
| 認証 | id.kbn.one 連携 + `@remix-run/session` の Cookie セッション | 連携方式は要確認(後述) |
| ホスティング | Deno Deploy (推奨) | Deno ネイティブで Turso と相性がよい。Cloudflare Workers は代替案 |
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
https://games.kbn.one/claim/{game_id}/{achievement_key}
```

遷移先でプレイヤーは(未サインインなら)サインインし、「実績を解除する」を確認して解除が記録される。
トークンも fetch も不要なので、Artifacts のような制約環境でも、SDK を使わない手書きゲームでも動く。

**REST モード** は、後述の起動トークンを Bearer に付けて `POST /api/v1/unlock` を呼ぶ。
API は CORS をすべてのオリジンに開放する(トークン認証であり、Cookie を使わないため開放してよい)。

**postMessage モード** は、game-center のプレイページ(`/play/{game_id}`)がゲームを iframe で埋め込んだ場合に使う。
SDK は `window.parent !== window` を検出し、`{ type: "gc:unlock", achievement: key }` を親に postMessage する。
親側は iframe の origin が登録済みゲームの URL と一致することを検証してから解除を記録する。
Claude Artifacts は claude.ai 側の制約で iframe 埋め込みできない見込みのため、このモードは GitHub Pages 等のゲーム向けである。

### 起動フローと起動トークン

プレイヤーが game-center のカタログからゲームを起動するとき、game-center は **起動トークン** (launch token)を発行し、URL フラグメントでゲームに渡す。

```
https://example.github.io/my-puzzle/#gctoken=<JWT>
```

起動トークンは game-center が署名する短命(2時間程度)の JWT で、claims は `sub`(ユーザ ID)、`aud`(game_id)、`exp` のみとする。
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
  "$schema": "https://games.kbn.one/schema/gamecenter.json",
  "id": "my-puzzle",              // 全体で一意な slug。初回登録時に所有者が確定する
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

スキーマは `packages/protocol` に JSON Schema として置き、ハブサイトからも配信する。
登録はマニフェスト全体の upsert とし、実績の削除は「非表示化」として扱う(解除済みユーザの記録を壊さないため)。

## 認証とアカウント

プレイヤーは game-center から id.kbn.one でサインアップとサインインを行う。
game-center は id.kbn.one の発行するユーザ識別子を `users.external_id` に保存し、自前のセッション(`@remix-run/session` の Cookie)を張る。

id.kbn.one との連携方式(OIDC か、独自のトークン + JWKS か、パスキー連携か)は現時点で未確認である。
公開されている discovery エンドポイントは見つからなかったため、実装前に仕様を確認する(未決事項に記載)。
連携部分は `server/auth/` に隔離し、方式が確定しても他へ影響しないようにする。

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
```

マイグレーションは `server/db/migrations/` に連番 SQL で置き、起動時に適用する軽量な仕組みを自作する(この規模で外部ツールは要らない)。

## API 一覧

すべて `/api/v1` 配下。認証方式は3種で、表の「認証」列に示す。

| メソッドとパス | 認証 | 役割 |
|---|---|---|
| `POST /api/v1/games` | API トークン | gamecenter.json を upsert(初回は所有権確定) |
| `GET /api/v1/games` | 不要 | 公開ゲーム一覧 |
| `GET /api/v1/games/{id}` | 不要 | ゲーム詳細と実績定義 |
| `POST /api/v1/unlock` | 起動トークン | 実績解除 `{ achievement: key }`。`aud` の game_id に閉じる |
| `GET /api/v1/me` | 起動トークン | プレイヤーの表示名と、そのゲームでの解除済み実績 |

Web UI 側の主なルートは次のとおり。

| パス | 役割 |
|---|---|
| `/` | カタログ(ゲーム一覧) |
| `/games/{id}` | ゲーム詳細。実績一覧と「遊ぶ」ボタン |
| `/play/{id}` | iframe 埋め込みプレイページ(postMessage モードの親) |
| `/claim/{game_id}/{key}` | claim URL の受け口。確認して解除 |
| `/me` | 自分の実績一覧とポイント合計 |
| `/dev` | 開発者ダッシュボード(ゲーム登録、API トークン発行) |
| `/docs`, `/llms.txt`, `/schema/gamecenter.json` | 開発者向け提供物の配信 |

## SDK

SDK は依存ゼロの TypeScript 単一ファイルとして書く。
Artifacts は外部スクリプトを読み込めないため、**コピペできる大きさに保つこと自体を仕様とする**(目安 150 行以内)。
GitHub Pages のゲームは JSR / esm.sh から import してもよい。

公開 API は最小にする。

```ts
import { GameCenter } from "@kuboon/game-center-sdk"; // またはファイル同梱

const gc = GameCenter.init({ gameId: "my-puzzle" });
gc.unlock("first_clear");   // モードを自動選択して解除
gc.player;                  // { name } | null (起動トークンがある場合のみ)
```

`unlock()` の内部は、postMessage → REST → claim URL の順に利用可能なモードへフォールバックする。
claim URL モードでは新規タブを勝手に開かず、「実績を解除」ボタン(リンク)を画面に出すユーティリティを提供する(ポップアップブロック対策と、プレイヤーの意思確認を兼ねる)。

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
      - uses: actions/checkout@v7
      - uses: kuboon/game-center/action@v1
        with:
          token: ${{ secrets.GAME_CENTER_TOKEN }}
          # manifest: gamecenter.json  (省略時デフォルト)
```

Action の実体は `action/` に置く composite action で、マニフェストをスキーマ検証してから `POST /api/v1/games` を呼ぶ。
検証エラーはその場で CI を落とし、LLM が自力で直せるメッセージを返す。

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
  auth/                      # id.kbn.one 連携(方式確定まで隔離)
  db/
    client.ts                # Turso クライアント
    migrations/              # 連番 SQL
  tests/
client/                      # ブラウザエントリ、@remix-run/ui の run() で hydrate
bundler/                     # Deno.bundle + Tailwind ビルド → bundled/
packages/
  protocol/                  # gamecenter.json の JSON Schema と共有型、検証関数
  sdk/                       # @kuboon/game-center-sdk (単一ファイル、JSR 公開)
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
3. **M2 認証**：id.kbn.one 連携(方式確認後)、セッション、`/me` の骨格
4. **M3 ゲーム登録**：packages/protocol のスキーマ、`POST /api/v1/games`、開発者ダッシュボード、API トークン
5. **M4 実績解除**：claim URL モードと REST モード、起動トークン、カタログとゲーム詳細ページ
6. **M5 SDK と埋め込み**：SDK 単一ファイル、`/play/{id}` の postMessage モード、JSR 公開
7. **M6 自動登録と LLM 提供物**：GitHub Action、protocol.md、llms.txt 生成、Claude skill
8. **M7 磨き込み**：プロフィール公開ページ、ポイント集計、OGP、レートリミット

M2 だけは外部(id.kbn.one の仕様確認)に依存するため、確認が遅れる場合は M3 以降を先行し、認証をダミー実装で差し替えておく。

## 未決事項

実装前に確認・決定が要るものを挙げる。

- **id.kbn.one の連携方式**:OIDC discovery が見つからなかったため、プロトコル(OIDC / 独自 JWT / パスキー)、エンドポイント、クライアント登録手順の確認が要る
- **ドメイン**:`games.kbn.one` は仮。決定後に llms.txt、スキーマ URL、SDK 既定値へ反映する
- **ホスティング**:Deno Deploy を推奨としたが、Cloudflare Workers 運用に寄せるなら bundler 構成の調整が要る
- **game id の予約と移譲**:slug の初回取得を先着とするか、審査を挟むか
- **Artifacts の iframe 可否**:claude.ai 側の X-Frame-Options / CSP を実測し、postMessage モードの対象外と確定させる
- **実績の改竄耐性**:自己申告モデルで開始する方針の最終確認(ランキング等を将来入れる場合は別途設計)
