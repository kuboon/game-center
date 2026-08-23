-- Hand the handles back to whoever chose them, which is nobody: every handle at
-- this point is the IdP's user id, so clearing them restores the state before
-- players had one at all.
update users set handle = null where handle = external_id;
