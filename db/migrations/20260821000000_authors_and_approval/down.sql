-- Back to globally unique ids owned by a URL or an account, with no authors.

drop index if exists game_registrations_author_id;
drop table game_registrations;

pragma foreign_keys = off;

create table games_old (
  id           text primary key,
  owner_id     integer references users(id),
  manifest_url text unique,
  title        text not null,
  description  text,
  url          text not null,
  icon_url     text,
  status       text not null default 'active' check (status in ('active', 'hidden')),
  created_at   text not null default (datetime('now')),
  updated_at   text not null default (datetime('now')),
  check ((owner_id is null) <> (manifest_url is null))
);

-- Unqualifying the ids can collide, since two authors may share a slug, and the
-- old shape allows only one of owner or URL. Rather than guess which game keeps
-- a name, this drops them all — the same trade the forward migration makes.
delete from user_achievements;
delete from achievements;
drop table games;
alter table games_old rename to games;

create index games_owner_id on games (owner_id);

pragma foreign_keys = on;

drop index if exists users_handle;
alter table users drop column handle;
