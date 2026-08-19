# game-center

ミニゲームの実績を集約するハブ。 設計の全体像は
[docs/grand_design.md](docs/grand_design.md) にある。
ゲーム本体はこのリポジトリでは実装しない。

## 構成

Deno workspace。

- `server/` — Remix v3 fetch-router のハブサーバ。`routes.ts`
  にルート定義、`controllers/` に各ページと API、`ui/document.tsx`
  がシェル、`utils/render.tsx` が shell/frame の描画分岐、`config.ts`
  が環境変数、`db/client.ts` が Turso 接続
- `db/migrations/` — マイグレーション。`YYYYMMDDHHmmss_name/up.sql` と
  `down.sql`
- `client/` — ブラウザエントリ。`@remix-run/ui` の `run()` が clientEntry を
  hydrate し、`<Frame name="content">` のナビゲーションを担う
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

## 規約

- Deno ファースト(Web API 優先、Node.js API は必要最小限)
- TypeScript strict mode
- テストは `Deno.test()` + `@std/assert`
- ファイル名はスネークケース
- JSX の属性は `class`(`className` ではない)
- `docs/` は `deno fmt` の対象外。日本語の文書は一文一行で書く
