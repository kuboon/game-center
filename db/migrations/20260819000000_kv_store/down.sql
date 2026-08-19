create table dpop_sessions (
  thumbprint text primary key,
  data       text not null,
  expires_at text not null
);

create index dpop_sessions_expires_at on dpop_sessions (expires_at);

drop table kv;
