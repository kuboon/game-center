-- The schema, as seven migrations left it.
--
-- Those seven were written before anything shipped, and several of them undid
-- each other: ownership moved from an account to a URL and back, ids grew a
-- namespace, handles arrived and then stopped being chosen. Reading them in
-- order taught nobody anything except the order. So they are one file now, and
-- the production database was rebuilt from it.
--
-- This is the last time that is affordable. Once anyone is playing, a migration
-- is a record of something that happened to a database that still exists, and
-- rewriting history stops being a tidying exercise.
--
-- Timestamps are ISO-8601 text in UTC, the SQLite convention `datetime('now')`
-- produces. Booleans are 0/1 integers.

-- Players. `external_id` is the userId issued by id.kbn.one; every other table
-- keys off the local integer id so the IdP identifier appears in one place.
--
-- `handle` is the public name, seeded from `external_id` at first sign-in
-- rather than chosen. It is a column of its own precisely because a game's id
-- is built from it once and then stored: handing someone a shorter name later
-- changes what their next game is called and leaves published claim URLs
-- pointing at something that still exists.
create table users (
  id           integer primary key autoincrement,
  external_id  text not null unique,
  display_name text not null,
  avatar_url   text,
  handle       text,
  created_at   text not null default (datetime('now'))
);

create unique index users_handle on users (handle);

-- Registered games.
--
-- `id` is `{author handle}/{slug}`, so a slug only has to be free among one
-- author's games — two people can both have a `tetris`, and nobody can take a
-- name out from under anybody.
--
-- `owner_id` and `manifest_url` answer different questions. The owner is who
-- made it, established by that account approving the registration. The manifest
-- URL is where updates may come from, which is what lets CI push the same
-- document on every commit without anyone approving again. A game pasted into
-- the dashboard has no such URL and is only ever edited there.
create table games (
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

create index games_owner_id on games (owner_id);

-- Achievement definitions, reconciled against the manifest on every upsert.
--
-- A definition the manifest drops is retired rather than deleted: players who
-- already unlocked it keep their row, and `user_achievements` keeps pointing at
-- something real. A retired achievement cannot be unlocked again.
create table achievements (
  id          integer primary key autoincrement,
  game_id     text not null references games(id),
  key         text not null,
  title       text not null,
  description text,
  points      integer not null default 0,
  hidden      integer not null default 0,
  sort_order  integer not null default 0,
  retired     integer not null default 0,
  unique (game_id, key)
);

-- One row per unlocked achievement. Unlocking is idempotent: a game may report
-- the same achievement on every load, and the second report moves neither
-- `unlocked_at` nor `via`. Only `score` moves, and only upward — the record is
-- a personal best rather than a last-seen value.
create table user_achievements (
  user_id        integer not null references users(id),
  achievement_id integer not null references achievements(id),
  unlocked_at    text not null default (datetime('now')),
  via            text not null check (via in ('claim', 'rest', 'postmessage')),
  score          integer,
  primary key (user_id, achievement_id)
);

create index user_achievements_achievement_id on user_achievements (achievement_id);

-- Registrations waiting for the author a manifest names to approve them.
--
-- A pending row holds a slug rather than a game id, and nothing unique on it:
-- it has claimed nothing. Reserving here would let anyone park an author's good
-- names behind approvals that never arrive. The id is built and taken at
-- approval.
create table game_registrations (
  id           integer primary key autoincrement,
  slug         text not null,
  manifest_url text not null,
  game_url     text not null,
  author_id    integer not null references users(id),
  manifest     text not null,
  submitted_at text not null default (datetime('now')),
  unique (manifest_url, author_id)
);

create index game_registrations_author_id on game_registrations (author_id);

-- Generic key/value store, matching @kuboon/kv's TursoKvRepo DDL exactly. DPoP
-- sessions live here; this is what replaces Deno KV.
create table kv (
  key        text primary key,
  value      text not null,
  expires_at integer,
  version    integer not null default 0
);
