-- Email verification (one-time code, not a link -- links get silently
-- eaten by mail scanners, see the earlier admin sign-in fix) for the
-- public self-serve form. Admin-logged requests (Log a Request) skip
-- this since a trusted reviewer already vouches for the person directly.

create extension if not exists pgcrypto;

create table if not exists comp_verifications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  verified boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Plain (not expression-based) unique constraint -- PostgREST's upsert
-- ON CONFLICT target needs to match a real constraint, not an index on
-- lower(email). The application layer always lowercases email before
-- writing here, so this is equivalent in practice.
alter table comp_verifications add constraint comp_verifications_email_key unique (email);

alter table comp_verifications enable row level security;
-- No policies at all -- nobody gets direct API access, including
-- authenticated admins. Only the two Edge Functions (service_role) and
-- the SECURITY DEFINER helper below ever touch this table.

create or replace function email_is_verified(check_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.comp_verifications
    where lower(email) = lower(check_email)
    and verified = true
    and expires_at > now()
  );
$$;

-- Split the old single "anon or authenticated, check(true)" policy so
-- the public form must prove email ownership, while admin-side
-- Log a Request submissions (already a trusted human) don't need to.
drop policy if exists "public can submit a comp request" on comp_requests;

create policy "public can submit a verified comp request"
  on comp_requests for insert
  to anon
  with check (email_is_verified(email));

create policy "admins can submit a comp request"
  on comp_requests for insert
  to authenticated
  with check (true);

-- Social media becomes required (at least one real handle, not just a
-- checkbox) so TRC can actually go follow the requester. Stored as a
-- jsonb array of {platform, handle} objects.
alter table comp_requests
  add constraint social_media_required
  check (social_media is not null and jsonb_typeof(social_media) = 'array' and jsonb_array_length(social_media) > 0);
