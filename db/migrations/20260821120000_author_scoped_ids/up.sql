-- A game's id becomes its author's handle plus the slug: `kuboon/my-puzzle`.
--
-- Scoping the slug to its author means a name only has to be free among one
-- author's games. Two people can both have a `tetris`, nobody can take a name
-- out from under anybody, and a manifest can be written without first checking
-- whether a name is taken.
--
-- The handle is part of the key rather than joined in, so rendering
-- `/@kuboon/my-puzzle` needs no lookup and a launch token's `aud` stays
-- readable. That holds only because handles are never changed and games are
-- never transferred; if either ever bends, published claim URLs lose what they
-- point at, and the fix belongs here.
--
-- Every game's primary key moves, and a primary key cannot be renumbered while
-- rows point at it: the runner wraps each migration in a transaction, and
-- SQLite honours neither `foreign_keys = off` nor `defer_foreign_keys` inside
-- one. So this drops what it cannot carry, the same trade the migration before
-- it makes. Re-registering a game is one unauthenticated POST; unlocks recorded
-- in between are lost, which is affordable now and would not be later.
delete from user_achievements;
delete from achievements;
delete from games;

create table games_scoped (
  id           text primary key,
  owner_id     integer not null references users(id),
  slug         text not null,
  manifest_url text unique,
  title        text not null,
  description  text,
  url          text not null,
  icon_url     text,
  status       text not null default 'active' check (status in ('active', 'hidden')),
  created_at   text not null default (datetime('now')),
  updated_at   text not null default (datetime('now')),
  unique (owner_id, slug)
);

drop table games;
alter table games_scoped rename to games;

create index games_owner_id on games (owner_id);

-- A pending row asks for a slug. It cannot hold an id, because it has not been
-- given one: the id is built and taken at approval.
alter table game_registrations rename column game_id to slug;
