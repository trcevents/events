-- Confirmed against the actual site source (repomix export) that
-- dh101_door_checkin and dh101_ambassador_leaderboard are a deliberate,
-- documented security pattern: dh101_signups has NO select/update
-- policy for anon or authenticated on purpose ("every read/write beyond
-- the initial insert goes through the security-definer functions/view
-- instead"), and these two views are the intended, narrow, PII-stripped
-- way through. Do NOT set security_invoker on either -- that would
-- break them exactly as documented for game_submissions_public.
--
-- The actual bug the Security Advisor caught: Postgres's default
-- privileges gave anon/authenticated far more than the source's single
-- explicit `grant select` statement for each view -- including INSERT/
-- UPDATE/DELETE, and for door_checkin, anon read access to attendee
-- names + redemption codes despite the view's own comment saying it's
-- "for door staff" (authenticated) only, and the source granting only
-- to authenticated. This closes that drift without touching the
-- intended read access.

-- dh101_door_checkin: authenticated (door staff) read-only; zero anon access.
revoke all on dh101_door_checkin from anon;
revoke insert, update, delete, truncate, references, trigger on dh101_door_checkin from authenticated;

-- dh101_ambassador_leaderboard: read-only for both roles (leave existing
-- read access alone -- it's aggregate counts only, "zero signup PII" by
-- the view's own design), just close the accidental write grants.
revoke insert, update, delete, truncate, references, trigger on dh101_ambassador_leaderboard from anon, authenticated;

-- dh101_school_ticket_counters: only ever touched via dh101_next_ticket_id(),
-- a SECURITY DEFINER function -- "never by a read-then-write from the
-- client" per the original design comment. No client code anywhere
-- queries this table directly, so RLS with zero policies is safe.
alter table dh101_school_ticket_counters enable row level security;
