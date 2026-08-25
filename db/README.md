# マイグレーション

Turso (libSQL) を
[`@kuboon/remix-data-table-sqlite-turso`](https://jsr.io/@kuboon/remix-data-table-sqlite-turso)
の CLI で操作する。 Remix の `remix db` は `remix.json` が sqlite / postgres /
mysql しか表現できないため使えない。 このパッケージの CLI は同じ `runRemixDb()`
を呼ぶので、マイグレーションのディレクトリ構成も `data_table_migrations` という
journal テーブルも出力も `remix db` と同じで、そのうえ `rollback` がある。

```bash
deno task db migrate                      # 未適用を適用
deno task db migrate --to 20260818000000  # ここまでで止める
deno task db rollback --step 1            # down.sql を実行
deno task db status                       # applied | pending | drifted | missing
deno task db seed                         # db/seed.sql
deno task db reset --force                # wipe + migrate + seed
deno task db wipe --force                 # 全テーブルを落とす
deno task migrate                         # `db migrate` の別名
```

接続先は `--url`、既定では `$TURSO_DATABASE_URL`、それも無ければ
`file:data/app.db`。 `remix.json` は読まれない。 CLI のバージョンは `deno.json`
の `imports` で一度だけ固定してある。

## 書き方

`db/migrations/YYYYMMDDHHmmss_name/up.sql`、戻せる変更なら隣に `down.sql`。
14桁の数字 + `_` +
名前という形から外れると、そのディレクトリだけでなくコマンド全体が落ちる。
ジェネレータは無い。ディレクトリを作って SQL を手で書く。

## 踏んだ罠

### 適用済みのマイグレーションを書き換えない

CLI は適用時に内容のチェックサムを journal に記録する。 後からファイルを変えると
`status` が `drifted` を返し、`migrate` は次のように止まる。

```
Migration checksum drift detected for "20260821000000"
  (journal=5e694ec2…, current=74f293d9…)
```

これは実際にデプロイを落とした。 テストは毎回まっさらな DB
を作るので気づけず、CI は緑のままデプロイだけが赤くなる。

**マージ済みのマイグレーションは、たとえ内容が間違っていても直さない。**
新しいマイグレーションを足して打ち消す。 CI にこれを見張るジョブがある
(`.github/workflows/ci.yaml` の `migrations` )。

### 外部キーはマイグレーションの中で切れない

ランナーは各マイグレーションをトランザクションで包む。 SQLite は
`pragma foreign_keys` をトランザクションの中では無視し、`defer_foreign_keys`
も同様に効かない。 つまり
**行が入っているテーブルは作り直せない**。子テーブルが参照している親を drop
した時点で外部キー違反になる。

主キーの値そのものを変えるような変更は、結局のところ次のどちらかになる。

- 子ごと消してから作り直す(既存のマイグレーションはこれを選んでいる。理由と代償は各ファイルのコメントにある)
- 作り直しを避けて `alter table add column` と index だけで済ませる

libSQL は素の SQLite と違って外部キーを既定で有効にする。
参照先を作り直すマイグレーションでは、そのことが常に効いてくる。

### journal テーブル名を変えない

`data_table_migrations` が「適用済み」の唯一の記録なので、名前を変えると全部が
`pending` に戻り、次の `migrate` が既にあるテーブルを作り直そうとして落ちる。

## デプロイと環境

Deno Deploy の pre-deploy が `deno task migrate` を走らせる。
これは**プレビューを含む全デプロイで走る**ので、そのコンテキストの
`TURSO_DATABASE_URL` が指す DB に適用される。
環境変数はコンテキストごとに分かれ、ビルド用はランタイムとも別に持てる。

| コンテキスト | `TURSO_DATABASE_URL` | `PREVIEW_DATABASE` |
| ------------ | -------------------- | ------------------ |
| Build        | プレビュー DB        | `1`                |
| Development  | プレビュー DB        | `1`                |
| Production   | 本番                 | 設定しない         |

`TURSO_AUTH_TOKEN` は同じグループならグループトークン一つで両方に通る。

`deno task db` は薄い包み(`db/cli.ts`)を通る。 足しているのは「どの DB
に対して何をするか」を実行前に一行出すことだけ。 どの DB
を触ったのか誰も言わないまま事故が起きたので付けた。

### プレビュー DB は本番から切り直す

マイグレーションについて本当に知りたいのは「**本番の実データに耐えるか**」である。
そしてそれを試している場所が他に無い。 CI は毎回まっさらな DB
を作るので、空のテーブルに対して当てているだけで、`reset --force`
で建て直しても同じことしか分からない。

これは机上の話ではない。 このリポジトリの `20260821120000`
はテストを全部通したうえで、行が一つ入ったテーブルに対して外部キーで落ちた。
主キーは、行が参照している間は振り直せないからである。

そこで `deno task migrate`(`db/migrate.ts`)は、プレビューのとき
**本番から切り直した DB** に対して migrate する。

```
delete  https://api.turso.tech/v1/organizations/{org}/databases/{preview}
create  https://api.turso.tech/v1/organizations/{org}/databases
        { name, group, seed: { type: "database", name: "{source}" } }
```

未マージのマイグレーションを直したときの drift も、これで自然に消える。 DB
が毎回新しいので、drift のしようがない。

必要な環境変数(Build コンテキスト)。

| 変数                    | 内容                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `TURSO_PLATFORM_TOKEN`  | Platform API のトークン。**DB を削除できる**ので範囲を絞ること |
| `TURSO_ORG`             | 組織スラッグ                                                   |
| `TURSO_SOURCE_DATABASE` | 複製元、つまり本番の DB 名                                     |
| `TURSO_GROUP`           | 省略時 `default`                                               |

プレビュー DB の**名前は指定しない**。`TURSO_DATABASE_URL` から導出する。 一つの
DB に二つの名前を持たせることが、間違ったほうを消す原因になる。

### 壊してよい条件

破壊的な経路(切り直しと
`reset --force`)は、独立した二つの条件が揃ったときだけ動く。

- `DENO_TIMELINE` が `production` でない
- `PREVIEW_DATABASE=1` が設定されている

後者を URL と同じコンテキストに置くのは、**URL
の配線ミスだけがこれらを致命的にする**からである。 加えて、導出したプレビュー DB
名が `TURSO_SOURCE_DATABASE` と一致したら設定ミスとして停止する。

`PREVIEW_DATABASE` が無ければ `deno task migrate` は `db migrate`
そのもので、何も壊さない。 切り直しの設定が無いプレビューでは、migrate
に失敗したときだけ `reset --force` で建て直す。

切り直しそのものに失敗したとき(Turso に届かない、トークンの権限が足りない)は、
ログに理由を出して先へ進む。 プレビューは本番の行を載せられなかった分だけ
証明することが減るが、それでプレビュー全部を止めるほどではない。 停止するのは
プレビュー DB 名が `TURSO_SOURCE_DATABASE` と一致したときだけで、そこから先は
本番を migrate して本番を reset する経路になるため、続けようがない。

DB を消して作り直すので、**`TURSO_AUTH_TOKEN` はグループのトークンでなければ
ならない**(`turso group tokens create <group>`)。 DB 単位のトークンは、その DB
と一緒に消える。

## テスト

`tests/` のテストは `deno task db` を実際に起動して、使い捨ての file DB
にマイグレーションを当てる。 検証対象はランナーではなくこのリポジトリの SQL —
当たること、戻せること、設計が頼っている制約が実際に効いていること。 詳細は
[tests/README.md](../tests/README.md)。
