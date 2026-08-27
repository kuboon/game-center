-- URLs an author has already refused.
--
-- `POST /api/registry/v1/games` takes no credential: anyone may point the hub
-- at a URL, and if the manifest there names an author, that author gets a
-- submission to approve. Dismissing one used to just delete the row, so the
-- same URL could be posted again a second later, and again, and the queue was
-- a place a stranger could keep tapping somebody on the shoulder.
--
-- A refusal is remembered instead. It is scoped to the pair, because refusing
-- a URL is a statement about that author's name being on it and says nothing
-- about anyone else's.
--
-- Not a dead end: the author can still register the URL themselves by pasting
-- the manifest, which is authenticated and is them acting rather than being
-- asked. Changing your mind stays possible; being pestered does not.
create table registration_refusals (
  manifest_url text not null,
  author_id    integer not null references users(id),
  refused_at   text not null default (datetime('now')),
  primary key (manifest_url, author_id)
);
