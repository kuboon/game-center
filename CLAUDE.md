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
- `packages/sdk` — ゲームに同梱する SDK。単一ファイル、依存ゼロ
- `action/` — ゲーム登録用の composite action。secret を取らない
- `skills/game-center/SKILL.md` — ゲームを作る LLM 向けの skill
- `tests/` — FFI 権限が要るテスト(ローカル SQLite
  に対するマイグレーション検証)。詳細は [tests/README.md](tests/README.md)

## 開発

```bash
deno task dev     # bundle してから開発サーバ起動 (http://localhost:8000)
deno task test    # テスト (-P の単体テスト + tests/ の -A テスト)
deno task check   # deno check + lint + fmt --check
deno task migrate # 未適用のマイグレーションを Turso に適用
deno task db …    # migrate / rollback / status / seed / reset / wipe
```

`bundled/` は `deno task bundle` で生成する。 サーバは起動時にこれを
`staticFiles` で配信するため、`deno task serve` の前にビルドが要る。

## データベース

Turso (libSQL)。 `TURSO_DATABASE_URL` と `TURSO_AUTH_TOKEN`
で接続する。未設定でもサーバは起動し、`getDb()` が `null` を返す。

- サーバ本体は `@libsql/client/web`(fetch
  ベース)を使う。ネイティブアドオンを読み込まないので Deno Deploy で動く
- マイグレーションの手順・規約・踏んだ罠は [db/README.md](db/README.md)
  にまとめてある。スキーマを触る前に読むこと
- **適用済みのマイグレーションは書き換えない**。ランナーがチェックサムを
  持っているので `drifted` で止まる。テストは毎回まっさらな DB を作るので
  気づけず、デプロイだけが赤くなる。CI の `migrations` ジョブが見張っている
- **マイグレーションの中で外部キーは切れない**。ランナーがトランザクションで
  包むため `pragma foreign_keys` も `defer_foreign_keys` も効かない。行の入った
  テーブルは作り直せないので、主キーを振り直す変更は子ごと消すことになる
- マイグレーションはデプロイ手順の一段として `deno task migrate`
  で適用する。起動時には適用しない(Deno Deploy では isolate ごとに競合するため)
- **pre-deploy はプレビューでも走るが、読めるのは Build コンテキストだけ**。
  コンテキストは名前ごとに値を一つしか持てないので、向き先は `DENO_TIMELINE`
  で決める。本番なら `TURSO_DATABASE_URL`、それ以外なら `PREVIEW_DATABASE_URL`。
  破壊経路は後者しか読まないので、本番の URL を書き間違えても届かない
- **プレビューでは migrate の前に本番から branch
  し直す**(`db/preview_branch.ts`)。
  マイグレーションが本番の実データに耐えるかを試している場所が他に無いため。 CI
  も `reset` も空のテーブルにしか当てない。未マージのマイグレーションを
  直したときの drift も、DB が毎回新しいので起きなくなる
- 破壊的な経路は `DENO_TIMELINE != production` かつ `PREVIEW_DATABASE_URL`
  が設定されているときだけ動き、**`TURSO_DATABASE_URL` を一度も読まない**。
  プレビュー DB の名前は `PREVIEW_DATABASE_URL` から導出し、二つの URL
  が一致するか複製元と一致したら設定ミスとして止まる
- CLI のバージョンは `deno.json` の `imports` で一度だけ固定する。
  `tests/support/db.ts` は `deno task db` を起動するので、そこには書かない

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

ゲームは `gamecenter.json` ひとつで自分を宣言する。マニフェスト全体の upsert
なので、同じ内容を何度登録しても結果は変わらない。

- **id は作者のハンドルで修飾する**(`kuboon/my-puzzle`)。マニフェストの `id`
  は後半の slug だけで、作者の中で一意ならよい。他人に名前を取られないし、
  マニフェストを書く LLM が空きを気にしなくてよい。URL は `/@kuboon/my-puzzle`
  と `/claim/@kuboon/my-puzzle/{key}`。ハンドルを主キーに含められるのは、
  ハンドルを変更せずゲームも譲渡しないため

- マニフェストの置き場所は3つで、ハブはこの順に探す。ゲームのページに
  `<script type="application/gamecenter+json">` で埋め込む(主)、ページの隣に
  `gamecenter.json` を置く、ダッシュボードに貼り付ける
- **登録は二者の合意で成立する**。マニフェストが `author` にハンドルを書き、
  名指しされたアカウントがその URL を承認する。片方だけでは何も証明しない。
  両方揃うと URL の管理権と作者本人の同意が同時に確かめられ、秘密が両者の間を
  一度も移動しない(IndieAuth の `rel="me"` と同じ形)
- 投稿者がサインイン済みで、しかも名指しされた本人なら即座に登録が完了する。
  承認キューが要るのは誰もいない CI 経路だけ
- 一度成立すれば **同じ URL からの更新は素通し**。CI が毎 push 叩ける
- **保留中の投稿は slug を確保しない**(`game_registrations` は `game_id` を
  持つが一意制約はない)。確保すると承認の来ない投稿で id を占拠できてしまう。
  slug は承認の瞬間に取る
- 保留キューが唯一の攻撃面。作者あたり `MAX_PENDING_PER_AUTHOR` 件で頭打ちにし、
  同じ URL の再投稿は行を増やさず内容を差し替える。承認画面は取得元 URL を
  必ず大きく出す(中身を見ずに承認すると他人に名義を使われる)
- 貼り付け登録は本人しかできない。URL の裏付けがないので、他人の名義で貼れると
  合意の片側だけで登録が成立してしまう
- `games.owner_id` は作者(NOT NULL)、`games.manifest_url` は書き込みを
  受け付ける URL。役割が違う。URL 登録のゲームはその URL からしか更新できず、
  作者自身が貼り付けで上書きすることもできない
- **`POST /api/registry/v1/games` は無認証**。`{ url }`
  を受けてハブが読みに行く。初回は 202 を返して承認を待つ
- ハブが他人の URL を fetch するので `server/lib/manifest_fetch.ts` で囲う。
  https のみ、private ホスト拒否、リダイレクトは毎ホップ検査、サイズ上限、
  タイムアウト。応答の中身は呼び出し元に一切返らない(検証エラーは値ではなく
  フィールド名を返す)ので、残る露出は blind に留まる
- Claude Artifacts は公開 URL を fetch しても著者の HTML ではなく殻が返るため、
  貼り付け登録を使う
- 検証は `packages/protocol` の `parseManifest()` だけが行う。エラーは最初の
  一件で止めず全部返す。JSON Schema は `GET /schema/gamecenter.json` で配信する
- マニフェストの `url`
  は任意。取得元がゲームの場所だから。貼り付けのときだけ必須
- マニフェストから消えた実績は削除せず `achievements.retired = 1`
  にする。解除済みのプレイヤーの記録を残すため

## ハンドル

`users.handle` は公開の名前で、初回サインイン時に **IdP の userId をそのまま**
入れる(`upsertUser`)。本人に選ばせない。

- マニフェストの `author` に書かれ、`/@{handle}` が作者ページ、ゲームの id は
  `{handle}/{slug}`
- 選ばせないのは、公開する前に取り消せない決定を迫ることになるから。すでに
  持っている識別子で足りる
- **`external_id` を直接読まずに列を分けてある**。ゲームの id
  は登録時に組み立てて
  保存するので、後から短い名前を配っても、変わるのは次に登録するゲームの名前
  だけで、公開済みの claim URL は指す先を失わない。将来の有償・キャンペーン枠は
  この列を書き換えるだけで足りる
- 大文字小文字は畳まない。IdP の識別子の表記を勝手に変えると別人になりうる
- 検証パターン(`HANDLE_PATTERN`)は URL の unreserved 文字に限るだけの緩いもの。
  UUID でも不透明トークンでも数値でも通る

`/me` の「ゲームを作る AI に渡す」は、作者 ID を埋め込んだ手順一式を
クリップボードに入れる。識別子を手で写させないため

## SDK

`packages/sdk`
は依存ゼロの単一ファイル。**コピペできる大きさに保つこと自体が仕様** (Artifacts
は外部スクリプトを読めない)。

- `unlock()` は postMessage → REST → claim URL の順に落ちる。**例外を投げず、
  勝手に遷移しない**。`recorded` が false なら `claimUrl` を返すので、
  呼び出し側が `claimLink()` でリンクを出す
- 起動トークンはフラグメントから読んで localStorage に入れ、アドレスバーから
  消す。401 が返ったら捨てる(以後成功しえないリクエストを待たないため)
- `lib` はブラウザのものだけ。ゲームに同梱されるファイルに Deno の API が
  紛れないようにする。`deno.ns` を参照するのはテストだけ
- `/play/@{author}/{slug}` が postMessage の親。**`event.origin` が登録済み
  ゲームの origin と一致することを確かめてから他の何もしない**。その origin は
  メッセージではなく SSR された登録内容から来る

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

## LLM 向け提供物

ゲームを作るのはたいてい LLM
なので、**一度読めば正しく組み込める**ことを成果物の 条件にする。

- `docs/protocol.md` が正本。`/llms.txt` は `bundler/llms.ts` がそこと
  `packages/sdk/mod.ts` から**生成**する。仕様を書き写したファイルは、いずれ
  仕様と食い違う
- `/llms.txt` は仕様・SDK 全文・最小の実例を一つに収める。四つのページを取りに
  行かせると、どれかを読み落とす
- `skills/game-center/SKILL.md` は「まず作者 ID をユーザに聞く」から始まる。
  不透明な識別子なので推測させない
- `skills/` は `docs/` と同じく `deno fmt` の対象外(一文一行を保つため)

## 規約

- Deno ファースト(Web API 優先、Node.js API は必要最小限)
- TypeScript strict mode
- テストは `Deno.test()` + `@std/assert`
- ファイル名はスネークケース
- JSX の属性は `class`(`className` ではない)
- `docs/` は `deno fmt` の対象外。日本語の文書は一文一行で書く
