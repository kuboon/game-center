-- Development seed: enough of a catalog to look at.
--
-- `deno task db seed` runs this against whatever database the CLI is pointed
-- at, which is `$TURSO_DATABASE_URL` when that is set. There is nothing in the
-- tool that distinguishes production from a laptop, so check what the variable
-- says before running this or `reset`.
--
-- Written to be harmless twice: every insert ignores a row that is already
-- there, so re-seeding neither duplicates nor fails.

insert or ignore into users (external_id, display_name, handle)
  values ('seed-kuboon', 'kuboon', 'seed-kuboon');

insert or ignore into games (id, owner_id, slug, manifest_url, title, description, url)
  select 'seed-kuboon/sample-puzzle', users.id, 'sample-puzzle',
         'https://example.github.io/sample-puzzle/',
         'Sample Puzzle', '開発用のサンプル。実際には登録されていません。',
         'https://example.github.io/sample-puzzle/'
    from users where users.external_id = 'seed-kuboon';

insert or ignore into achievements (game_id, key, title, description, points, hidden, sort_order)
  values
    ('seed-kuboon/sample-puzzle', 'first_clear', 'はじめてのクリア',
     'ステージ1をクリアする', 10, 0, 0),
    ('seed-kuboon/sample-puzzle', 'no_hints', 'ノーヒント', null, 30, 1, 1);
