-- Talent/opening-act/DJ/host contract signing flow on trcevent.com:
-- Stephen issues a per-performer invite code (not one shared password),
-- the performer verifies their email, fills in their info, types their
-- name as a signature, and a PDF gets emailed to stephen@selassiefest.com.
-- The contract is between the signer and Ras Tafari Inc. See
-- supabase/functions/submit-talent-contract for the actual contract
-- text/PDF generation -- this migration is just the data model.

create extension if not exists pgcrypto;

-- One row per performer invited to sign. Created via the
-- create-contract-invite Edge Function (Stephen calls it himself, see that
-- function's header for how) -- only the sha256 hash of the access code is
-- ever stored, same reasoning as contract_verifications below.
create table if not exists contract_invites (
  id uuid primary key default gen_random_uuid(),
  access_code_hash text not null unique,
  act_name text not null,
  role text not null check (role in ('Opening Act', 'DJ', 'Host', 'Performer')),
  event_name text not null,
  -- Set per-invite so each performer's contract states real pay terms
  -- instead of generic boilerplate. Stephen provides this when he creates
  -- the invite (see create-contract-invite) -- the default only covers the
  -- case where he forgets to.
  compensation_terms text not null default 'To be provided separately in writing by Presenter.',
  status text not null default 'pending' check (status in ('pending', 'signed', 'revoked')),
  created_at timestamptz not null default now(),
  signed_at timestamptz
);

alter table contract_invites enable row level security;
-- No public policies at all -- only the Edge Functions (service_role)
-- ever touch this table, same reasoning as comp_verifications.

-- Email verification for the contract flow -- identical mechanism to
-- comp_verifications (6-digit code, not a link -- see that table for why)
-- but kept as its own table rather than shared, since the two features are
-- otherwise unrelated and shouldn't be coupled.
create table if not exists contract_verifications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  verified boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table contract_verifications add constraint contract_verifications_email_key unique (email);
alter table contract_verifications enable row level security;
-- No policies -- only the Edge Functions (service_role) touch this.

create or replace function contract_email_is_verified(check_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.contract_verifications
    where lower(email) = lower(check_email)
    and verified = true
    and expires_at > now()
  );
$$;

-- The signed contract itself. Written only by submit-talent-contract
-- (service_role) after it has independently re-verified the access code
-- and the email itself -- there is deliberately no anon insert policy
-- (unlike comp_requests' email_is_verified()-gated one), since signing
-- also has to flip the invite to 'signed' and generate/store a PDF
-- atomically, which belongs inside one trusted function rather than RLS.
create table if not exists talent_contracts (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references contract_invites(id),
  act_name text not null,
  role text not null,
  event_name text not null,
  compensation_terms text not null,
  signer_full_legal_name text not null,
  signer_address text not null,
  signer_email text not null,
  signer_phone text not null,
  signature_typed_name text not null,
  contract_version text not null default 'v1',
  pdf_storage_path text,
  signed_at timestamptz not null default now()
);

alter table talent_contracts enable row level security;

-- Stephen can review signed contracts from the Supabase dashboard/SQL
-- editor -- no dedicated admin page yet; add one later if the dashboard
-- isn't a nice enough review flow.
create policy "stephen can read talent contracts"
  on talent_contracts for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'stephen@selassiefest.com');

-- Private bucket -- these PDFs contain a home address, phone number, and
-- signature; unlike game-submissions media this must never be public.
insert into storage.buckets (id, name, public)
values ('talent-contracts', 'talent-contracts', false)
on conflict (id) do nothing;

-- No storage RLS policies at all -- only the service role (used inside
-- submit-talent-contract) can read or write these objects.
