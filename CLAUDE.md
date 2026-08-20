# game-center

ミニゲームの実績を集約するハブ。 設計の全体像は
[docs/grand_design.md](docs/grand_design.md) にある。
ゲーム本体はこのリポジトリでは実装しない。

## 構成

Deno workspace。

- `server/` — Remix v3 fetch-router のハブサーバ。`routes.ts`
  にルート定義、`controllers/` に各ページと API、`ui/document.tsx`
  がシェル、`utils/render.tsx` が shell/frame の描画分岐、`config.ts`
  が環境変数、`db/` が Turso 接続とクエリ、`lib/idp_token.ts` が IdP
  トークン検証、`middleware/dpop.ts` が DPoP セッション
- `db/migrations/` — マイグレーション。`YYYYMMDDHHmmss_name/up.sql` と
  `down.sql`
- `client/` — ブラウザエントリ。`@remix-run/ui` の `run()` が clientEntry を
  hydrate し、`<Frame name="content">` のナビゲーションを担う。`session.ts` が
  DPoP セッションの共有ストア
- `packages/` — ワークスペース内のライブラリ。`protocol` が `gamecenter.json`
  の型・検証・JSON Schema。`session_storage_kv`(KvRepo → SessionStorage)と
  `dpop_session_middleware`(DPoP セッション)は未公開のため id.kbn.one /
  deno-remix-reference から vendoring している
- `bundler/` — `Deno.bundle` による JS ビルドと Tailwind CSS ビルド。出力は
  `bundled/`(git 管理外)
- `assets/style.css` — Tailwind v4 + daisyUI の入力 CSS
- `tests/` — FFI 権限が要るテスト(ローカル SQLite
  に対するマイグレーション検証)。詳細は [tests/README.md](tests/README.md)

## 開発

```bash
deno task dev     # bundle してから開発サーバ起動 (http://localhost:8000)
deno task test    # テスト (-P の単体テスト + tests/ の -A テスト)
deno task check   # deno check + lint + fmt --check
deno task migrate # 未適用のマイグレーションを Turso に適用
deno task db …   # migrate / rollback / status / seed / reset / wipe
```

`bundled/` は `deno task bundle` で生成する。 サーバは起動時にこれを
`staticFiles` で配信するため、`deno task serve` の前にビルドが要る。

## データベース

Turso (libSQL)。 `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN`
で接続する。未設定でもサーバは起動し、`getDb()` が `null` を返す。

- サーバ本体は `@libsql/client/web`(fetch
  ベース)を使う。ネイティブアドオンを読み込まないので Deno Deploy で動く
- マイグレーションは
  [remix-db-migrations-deno](https://github.com/kuboon/kuboon-remix-utils/tree/main/plugins/remix-db-migrations-deno)
  の規約に従う。`remix db` は remix.json が Turso
  アダプタを表現できないため使えず、 代わりに
  `@kuboon/remix-data-table-sqlite-turso/cli` を `deno task db` で叩く
- スキーマ変更は `db/migrations/` に `YYYYMMDDHHmmss_name/` ディレクトリを作り、
  `up.sql` と(戻せる変更なら)`down.sql` を置く。名前は14桁の数字 + `_` +
  名前で、 外れると全体がエラーになる
- 適用状況は `data_table_migrations` テーブルが持つ。テーブル名を変えると
  適用済みのマイグレーションが再実行される
- マイグレーションはデプロイ手順の一段として `deno task migrate`
  で適用する。起動時には適用しない(Deno Deploy では isolate ごとに競合するため)
- libSQL は外部キーを既定で有効にする。参照先を作り直すマイグレーションでは
  自分で無効化する必要がある

## 認証

プレイヤーは id.kbn.one でサインインする。 OIDC ではなく DPoP (RFC 9449)
で、Cookie を使わない。

- ブラウザが DPoP 鍵を持ち、`/authorize?dpop_jkt=…&redirect_uri=…`
  でパスキー認証する。以後 `GET {IdP}/session` が `{ userId, jws }` を返す
- `jws` は IdP が署名した JWT で、`cnf.jkt` にブラウザの鍵 thumbprint
  が入る。サーバはこれを IdP の JWKS で検証し、`cnf.jkt` がリクエストの DPoP
  鍵と一致することを確認して初めて userId を信じる(`server/lib/idp_token.ts`)
- セッションは thumbprint をキーに `kv` テーブルへ入る。DB
  未設定ならミドルウェアごと外れ、サインアウト状態で動く
- SSR には DPoP 証明を付けられないため、サインイン依存の UI は clientEntry
  にしてブラウザ側で埋める(`NavAuth` / `AccountCard`)

## ゲーム登録

ゲームは `gamecenter.json` ひとつを送って登録する。マニフェスト全体の upsert
なので、同じ内容を何度送っても結果は変わらない。

- 検証は `packages/protocol` の `parseManifest()`
  だけが行う。エラーは最初の一件で止めず全部返す。JSON Schema は
  `GET /schema/gamecenter.json` で配信し、`$schema` に書けばエディタが効く
- 登録の口は二つあって、認証だけが違う。CI は API トークンで
  `POST /api/registry/v1/games`、ダッシュボードは DPoP セッションで
  `POST /api/internal/games`。処理は `server/lib/game_registration.ts`
  を共有する
- `id` は先着で所有者が決まり、以後その所有者しか書き換えられない
  (`GameOwnershipError` → 403)
- マニフェストから消えた実績は削除せず `achievements.retired = 1`
  にする。解除済みのプレイヤーの記録を残すため
- API トークンは SHA-256 ハッシュだけを保存し、平文は発行時のレスポンスにしか
  現れない

## 実績解除

解除は3モードあるが、サーバ側の入口は2つ。ゲームからの REST
(`POST /api/game/v1/unlock`、起動トークン)と、ハブ自身からの claim
(`POST /api/internal/claim`、DPoP)。postMessage モードは M5 で `/play/{id}`
の親ページが claim と同じ処理を呼ぶ。

- 解除は冪等。2回目以降は `unlocked_at` も `via` も動かず、`score`
  が保存済みより高いときだけ更新する(`server/db/unlocks.ts`)
- `retired = 1` の実績は解除できない(`UnknownAchievementError` → 404)。
  ただし解除済みの記録は `/me` に残り続ける
- 起動トークンは `RP_SIGNING_KEY_JWK` で署名する短命 JWT。`sub` がローカル user
  id、`aud` が game_id で、ゲームは自分の `aud` の範囲しか触れない。
  鍵が未設定ならトークンは発行も検証もせず 503 を返す(isolate
  ごとに鍵を生成すると検証が通らなくなるため)。鍵は `deno task keygen` で作る
- トークンは URL のフラグメント(`#gctoken=…`)で渡す。ゲームのホスティングの
  アクセスログに残さないため
- `/api/game/v1/*` だけ CORS を全開放する(`server/middleware/game_cors.ts`)。
  Cookie を使わずヘッダのトークンで認証するので開放してよい。エラー応答にも
  ヘッダを付ける。付けないとゲームが 401 を読めず claim URL に落ちられない

## 規約

- Deno ファースト(Web API 優先、Node.js API は必要最小限)
- TypeScript strict mode
- テストは `Deno.test()` + `@std/assert`
- ファイル名はスネークケース
- JSX の属性は `class`(`className` ではない)
- `docs/` は `deno fmt` の対象外。日本語の文書は一文一行で書く
