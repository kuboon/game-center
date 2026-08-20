-- SQLite before 3.35 cannot drop a column, and libSQL's `alter table drop
-- column` refuses while an index or view references the table, so rebuild it.
-- Foreign keys are on by default in libSQL, unlike stock SQLite, so they are
-- switched off here or the rename would repoint `user_achievements` at the
-- temporary table.
pragma foreign_keys = off;

create table achievements_without_retired (
  id          integer primary key autoincrement,
  game_id     text not null references games(id),
  key         text not null,
  title       text not null,
  description text,
  points      integer not null default 0,
  hidden      integer not null default 0,
  sort_order  integer not null default 0,
  unique (game_id, key)
);

insert into achievements_without_retired
  (id, game_id, key, title, description, points, hidden, sort_order)
  select id, game_id, key, title, description, points, hidden, sort_order
    from achievements;

drop table achievements;
alter table achievements_without_retired rename to achievements;

pragma foreign_keys = on;
