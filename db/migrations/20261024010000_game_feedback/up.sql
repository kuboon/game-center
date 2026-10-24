-- Bug reports and requests from players, addressed to a game's author.
--
-- The hub keeps these itself rather than handing them to the IdP's feedback
-- inbox, because the person who can act on "stage 3 lets the ball through" is
-- whoever made stage 3, and the hub is the only party that knows who that is.
--
-- The sender is always a signed-in player, so every report carries a name. That
-- is the same bargain as the rest of the hub: who said it is certain, what they
-- said is not.
--
-- Removed with the game. `retireGame` deletes a game outright only when nobody
-- ever played it — almost always a mistaken registration — and reports about a
-- game that no longer exists have nobody left to read them.
create table game_feedback (
  id         integer primary key,
  game_id    text not null references games(id) on delete cascade,
  sender_id  integer not null references users(id),
  kind       text not null check (kind in ('bug', 'request', 'other')),
  -- The same ceiling the form enforces, so a caller that skips the form gets
  -- the same answer.
  message    text not null check (length(message) between 1 and 4000),
  created_at text not null default (datetime('now'))
);

-- The author's inbox reads by game, newest first.
create index game_feedback_by_game on game_feedback (game_id, created_at);
