-- Back to ownership by URL or account, with no authors and no approval step.

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

-- The old shape allows only one of the two, so a game that has both keeps the
-- URL: that is what may write to it.
insert into games_old
  (id, owner_id, manifest_url, title, description, url, icon_url, status, created_at, updated_at)
  select id,
         case when manifest_url is null then owner_id end,
         manifest_url,
         title, description, url, icon_url, status, created_at, updated_at
    from games;

drop table games;
alter table games_old rename to games;

create index games_owner_id on games (owner_id);

pragma foreign_keys = on;

drop index if exists users_handle;
alter table users drop column handle;
