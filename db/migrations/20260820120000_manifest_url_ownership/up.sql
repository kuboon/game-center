-- Ownership of a game moves from an account to the URL its manifest sits at.
--
-- Whoever can put a file at a URL controls the game there, which is a stronger
-- claim than "registered first" and needs no credential to prove. That is what
-- lets the registry API drop its tokens: a caller only asks the hub to re-read
-- a document, and the document's location vouches for it.
--
-- Games pasted into the dashboard have no such URL, so `owner_id` stays for
-- them and `manifest_url` is null. Exactly one of the two is set.

pragma foreign_keys = off;

create table games_new (
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

insert into games_new
  (id, owner_id, title, description, url, icon_url, status, created_at, updated_at)
  select id, owner_id, title, description, url, icon_url, status, created_at, updated_at
    from games;

drop table games;
alter table games_new rename to games;

create index games_owner_id on games (owner_id);

pragma foreign_keys = on;

-- The registry no longer authenticates anyone, so there is nothing to
-- authenticate with. Dropping the table rather than leaving it unused, so the
-- schema does not imply a credential that no longer exists.
drop index if exists api_tokens_user_id;
drop table api_tokens;
