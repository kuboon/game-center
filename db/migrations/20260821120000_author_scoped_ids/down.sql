-- Back to globally unique ids.
--
-- Unqualifying can collide, since two authors may share a slug, and the ids
-- cannot be renumbered in place any more than they could going forward. So this
-- drops games too rather than guessing which one keeps a name.

alter table game_registrations rename column slug to game_id;

delete from user_achievements;
delete from achievements;
delete from games;

create table games_flat (
  id           text primary key,
  owner_id     integer not null references users(id),
  manifest_url text unique,
  title        text not null,
  description  text,
  url          text not null,
  icon_url     text,
  status       text not null default 'active' check (status in ('active', 'hidden')),
  created_at   text not null default (datetime('now')),
  updated_at   text not null default (datetime('now'))
);

drop table games;
alter table games_flat rename to games;

create index games_owner_id on games (owner_id);
