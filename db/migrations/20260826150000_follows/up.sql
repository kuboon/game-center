-- Following, in one direction.
--
-- No approval and no reciprocal row: a follow says "show me this person's
-- records", and the person being followed does not have to agree, because
-- there is nothing private to agree to. Play history is public.
--
-- One kind of follow, not two. An author and a player are the same account
-- reached at the same `/@{handle}`, so splitting "follow their games" from
-- "follow their scores" would be two switches for one intent.
--
-- Why anyone follows at all: forgery cannot be prevented in a game that runs
-- in a browser, so the hub does not try. Authentication is certain about who
-- claimed something and silent about whether it happened. Choosing whose
-- records to believe is the player's, and this table is that choice. See
-- docs/grand_design.md, "偽装は防がない、代わりに誰を見るかを選ばせる".
create table follows (
  follower_id integer not null references users(id),
  followee_id integer not null references users(id),
  created_at  text not null default (datetime('now')),
  -- The pair is the key, so following twice is the same as following once and
  -- the API can be idempotent without reading first.
  primary key (follower_id, followee_id),
  -- Following yourself would put you in your own catalog and your own score
  -- comparisons. Refused here rather than in a controller that could be
  -- bypassed by the next caller.
  check (follower_id <> followee_id)
);

-- The primary key already serves "who does this person follow". This serves
-- the other direction: a follower count on every profile page.
create index follows_followee on follows (followee_id);
