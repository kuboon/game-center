-- Every game has an author, agrees to have one, and is named within them.
--
-- A manifest names its author by handle, and the named account approves the URL
-- on the hub. Neither half proves anything alone: the document says who wrote
-- it, and the person says which document is theirs. Together they establish
-- both control of the URL and consent of the author, with no credential passing
-- between them.
--
-- The id is qualified by that handle — `kuboon/my-puzzle` — so a slug only has
-- to be unique among one author's games. Two people can both call theirs
-- `tetris`, and nobody can take a name out from under anybody. The handle is
-- part of the key because handles are never changed and games are never
-- transferred; if either of those ever stops being true, published claim URLs
-- break and this is where the fix goes.

-- Public name, chosen once by the player. It goes into manifests, into game
-- ids, and into author pages, so it is theirs to pick rather than derived from
-- the IdP.
alter table users add column handle text;
create unique index users_handle on users (handle);

pragma foreign_keys = off;

create table games_new (
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

-- Nothing is carried over. An id is now qualified by its author's handle, and
-- no player has a handle until the column above exists — so anything registered
-- before authors did has no name it could be given. It has to be registered
-- again, which for a URL-registered game is one unauthenticated POST.
delete from user_achievements;
delete from achievements;
drop table games;
alter table games_new rename to games;

create index games_owner_id on games (owner_id);

pragma foreign_keys = on;

-- Submitted, waiting for the named author to approve.
--
-- A pending row holds a slug rather than a game id, and no unique constraint on
-- it: it has claimed nothing. The id is built and taken at approval, and two
-- submissions racing for one slug are settled by whoever approves first.
create table game_registrations (
  id             integer primary key autoincrement,
  slug           text not null,
  manifest_url   text not null,
  game_url       text not null,
  author_id      integer not null references users(id),
  manifest       text not null,
  submitted_at   text not null default (datetime('now')),
  unique (manifest_url, author_id)
);

create index game_registrations_author_id on game_registrations (author_id);
