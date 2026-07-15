-- Supabase Security Advisor error: game_submissions_public is a
-- "security definer" view (runs as its owner, bypassing RLS on the
-- underlying game_submissions table) with full anon/authenticated
-- grants including INSERT/UPDATE/DELETE, which a simple single-table
-- view like this can actually pass through to the base table.
--
-- Confirmed safe to fix: the view already deliberately omits
-- submitter_email from its column list, so exposing approved rows via
-- proper RLS instead of an owner-bypass view doesn't change what's
-- visible -- it just stops it from being writable and makes the
-- approved-only filter enforced by policy instead of by view owner.
create policy "public can read approved game submissions"
  on game_submissions for select
  to anon, authenticated
  using (status = 'approved');

alter view game_submissions_public set (security_invoker = true);

revoke insert, update, delete, truncate, references, trigger
  on game_submissions_public from anon, authenticated;
