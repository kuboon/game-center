-- A definition dropped from a manifest has to stop being offered without
-- taking the unlocks with it: `user_achievements` points at these rows, and a
-- player who earned something should keep it even after the game stops
-- listing it. `retired` is that state.
alter table achievements add column retired integer not null default 0;
