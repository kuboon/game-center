-- Back to an empty database.

drop index if exists game_registrations_author_id;
drop table if exists game_registrations;
drop table if exists kv;
drop index if exists user_achievements_achievement_id;
drop table if exists user_achievements;
drop table if exists achievements;
drop index if exists games_owner_id;
drop table if exists games;
drop index if exists users_handle;
drop table if exists users;
