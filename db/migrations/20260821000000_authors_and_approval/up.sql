-- Every game has an author, and the author has to agree to be one.
--
-- A manifest names its author by handle, and the named account approves the URL
-- on the hub. Neither half proves anything alone: the document says who wrote
-- it, and the person says which document is theirs. Together they establish
-- both control of the URL and consent of the author, with no credential passing
-- between them.
--
-- So `owner_id` comes back as required. `manifest_url` stays, but now as the
-- write authority rather than the identity: it says which URL may update this
-- game without asking again.

-- Public name, chosen once by the player. It goes into manifests and into
-- author pages, so it is theirs to pick rather than derived from the IdP.
alter table users add column handle text;
create unique index users_handle on users (handle);

pragma foreign_keys = off;

create table games_new (
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

insert into games_new
  (id, owner_id, manifest_url, title, description, url, icon_url, status, created_at, updated_at)
  select id, owner_id, manifest_url, title, description, url, icon_url, status, created_at, updated_at
    from games where owner_id is not null;

-- Games registered by URL before authors existed have nobody to belong to, and
-- nothing can invent one for them. They go, along with what hangs off them.
delete from user_achievements
  where achievement_id in (
    select id from achievements where game_id not in (select id from games_new)
  );
delete from achievements where game_id not in (select id from games_new);

drop table games;
alter table games_new rename to games;

create index games_owner_id on games (owner_id);

pragma foreign_keys = on;

-- Submitted, waiting for the named author to approve.
--
-- A pending row deliberately does NOT hold the game id. Reserving it here would
-- make squatting trivial: anyone could park the good slugs behind approvals
-- that never come. The id is claimed at approval, and two pending rows racing
-- for one id is resolved by whoever approves first.
create table game_registrations (
  id             integer primary key autoincrement,
  game_id        text not null,
  manifest_url   text not null,
  game_url       text not null,
  author_id      integer not null references users(id),
  manifest       text not null,
  submitted_at   text not null default (datetime('now')),
  unique (manifest_url, author_id)
);

create index game_registrations_author_id on game_registrations (author_id);
