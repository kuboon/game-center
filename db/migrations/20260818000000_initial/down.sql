-- Reverses 20260818000000_initial. Dropped in reverse dependency order so the
-- foreign keys libSQL enforces never point at a missing table.
drop table dpop_sessions;
drop table api_tokens;
drop table user_achievements;
drop table achievements;
drop table games;
drop table users;
