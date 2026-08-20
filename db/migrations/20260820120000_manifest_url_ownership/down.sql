-- Back to account-owned games and API tokens.
--
-- Games registered by URL have no account to belong to, so they cannot come
-- back: this drops them rather than inventing an owner for them.

pragma foreign_keys = off;

create table games_old (
  id          text primary key,
  owner_id    integer not null references users(id),
  title       text not null,
  description text,
  url         text not null,
  icon_url    text,
  status      text not null default 'active' check (status in ('active', 'hidden')),
  created_at  text not null default (datetime('now')),
  updated_at  text not null default (datetime('now'))
);

insert into games_old
  (id, owner_id, title, description, url, icon_url, status, created_at, updated_at)
  select id, owner_id, title, description, url, icon_url, status, created_at, updated_at
    from games where owner_id is not null;

delete from user_achievements
  where achievement_id in (
    select id from achievements
     where game_id not in (select id from games_old)
  );
delete from achievements where game_id not in (select id from games_old);

drop table games;
alter table games_old rename to games;

create index games_owner_id on games (owner_id);

pragma foreign_keys = on;

create table api_tokens (
  id           integer primary key autoincrement,
  user_id      integer not null references users(id),
  token_hash   text not null unique,
  name         text not null,
  created_at   text not null default (datetime('now')),
  last_used_at text
);

create index api_tokens_user_id on api_tokens (user_id);
