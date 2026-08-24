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

## テスト

`tests/` のテストは `deno task db` を実際に起動して、使い捨ての file DB
にマイグレーションを当てる。 検証対象はランナーではなくこのリポジトリの SQL —
当たること、戻せること、設計が頼っている制約が実際に効いていること。 詳細は
[tests/README.md](../tests/README.md)。
