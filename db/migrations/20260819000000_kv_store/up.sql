-- Sessions move from a bespoke table to the generic key-value store that
-- `@kuboon/kv`'s TursoKvRepo drives, so the DPoP session storage is the
-- maintained implementation rather than one of ours.
--
-- The DDL matches TursoKvRepo's own `CREATE TABLE IF NOT EXISTS` exactly. It is
-- declared here as well so a freshly migrated database is complete before the
-- first request, instead of the table appearing on first use.
create table if not exists kv (
  key        text primary key,
  value      text not null,
  expires_at integer,
  version    integer not null default 0
);

drop table dpop_sessions;
