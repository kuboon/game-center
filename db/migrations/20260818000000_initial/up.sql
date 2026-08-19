-- Initial schema for the game-center hub. See docs/grand_design.md.
--
-- Timestamps are ISO-8601 text in UTC, the SQLite convention `datetime('now')`
-- produces. Booleans are 0/1 integers.

-- Players. `external_id` is the userId issued by id.kbn.one; every other table
-- keys off the local integer id so the IdP identifier appears in one place.
create table users (
  id           integer primary key autoincrement,
  external_id  text not null unique,
  display_name text not null,
  avatar_url   text,
  created_at   text not null default (datetime('now'))
);

-- Registered games. The id is the slug from gamecenter.json, claimed by its
-- first registrant; `url` doubles as the origin checked in postMessage mode.
create table games (
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

create index games_owner_id on games (owner_id);

-- Achievement definitions, replaced wholesale on every manifest upsert.
-- Removing one from the manifest hides it rather than deleting the row, so
-- players who already unlocked it keep their record.
create table achievements (
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

-- One row per unlocked achievement. Unlocking is idempotent; `score` keeps the
-- highest value ever reported and `unlocked_at` stays at the first unlock.
create table user_achievements (
  user_id        integer not null references users(id),
  achievement_id integer not null references achievements(id),
  unlocked_at    text not null default (datetime('now')),
  via            text not null check (via in ('claim', 'rest', 'postmessage')),
  score          integer,
  primary key (user_id, achievement_id)
);

create index user_achievements_achievement_id on user_achievements (achievement_id);

-- Registration tokens for the GitHub Action and other server-side callers.
-- Only the hash is stored; the plaintext is shown once at creation.
create table api_tokens (
  id           integer primary key autoincrement,
  user_id      integer not null references users(id),
  token_hash   text not null unique,
  name         text not null,
  created_at   text not null default (datetime('now')),
  last_used_at text
);

create index api_tokens_user_id on api_tokens (user_id);

-- Server-side DPoP sessions, keyed by the JWK thumbprint of the browser's DPoP
-- key. This is what replaces Deno KV.
create table dpop_sessions (
  thumbprint text primary key,
  data       text not null,
  expires_at text not null
);

create index dpop_sessions_expires_at on dpop_sessions (expires_at);
