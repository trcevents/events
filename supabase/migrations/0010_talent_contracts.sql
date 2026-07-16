-- Talent/opening-act/DJ/host contract signing flow on trcevent.com:
-- Stephen issues a per-performer invite code (not one shared password),
-- the performer verifies their email, fills in their info, types their
-- name as a signature, and a PDF gets emailed to stephen@selassiefest.com.
-- The contract is between the signer and Ras Tafari Inc. See
-- supabase/functions/submit-talent-contract for the actual contract
-- text/PDF generation -- this migration is just the data model.
--
-- Deliberately NOT collected anywhere in this schema: SSN/EIN or any other
-- tax ID number. tax_form_required/tax_form_acknowledged below only track
-- whether Talent has agreed to provide a W-9 separately -- actual tax ID
-- collection needs a properly compliant channel, not a general web form.

create extension if not exists pgcrypto;

-- One row per performer invited to sign. Created via the
-- create-contract-invite Edge Function (Stephen calls it himself, see that
-- function's header for how) -- only the sha256 hash of the access code is
-- ever stored, same reasoning as contract_verifications below.
--
-- All these columns are deal terms Stephen sets when he creates the
-- invite -- they end up baked into that performer's contract PDF.
create table if not exists contract_invites (
  id uuid primary key default gen_random_uuid(),
  access_code_hash text not null unique,
  act_name text not null,
  role text not null check (role in ('Opening Act', 'DJ', 'Host', 'Performer')),
  performance_type text not null default 'DJ Set'
    check (performance_type in ('DJ Set', 'Host/MC', 'Solo Vocalist', 'Group Performance', 'Live Band with Tracks', 'Other')),
  event_name text not null,
  venue_name text not null default '',
  venue_address text not null default '',
  performance_date date,
  arrival_time text not null default '',
  soundcheck_time text not null default '',
  set_time text not null default '',
  set_length_minutes integer,
  -- Free-text on purpose: fee + deposit + balance timing + any conditions
  -- read more naturally as one clause than five separate numeric columns
  -- for a low-volume, per-deal admin workflow. Include payment amounts
  -- and timing here, e.g. "$300 total: $100 deposit via Zelle upon
  -- signing, $200 balance in cash day-of."
  compensation_terms text not null default 'To be provided separately in writing by Presenter.',
  tax_form_required boolean not null default true,
  cancellation_notice_days integer not null default 14,
  merch_rights_allowed boolean not null default true,
  radius_clause_enabled boolean not null default false,
  radius_miles integer,
  radius_days integer,
  guest_list_allowance integer not null default 0,
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
--
-- Deal-term columns (act_name .. guest_list_allowance) are denormalized
-- copies of the invite at signing time, so a later edit to contract_invites
-- can never retroactively change what a already-signed contract says.
create table if not exists talent_contracts (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references contract_invites(id),
  act_name text not null,
  role text not null,
  performance_type text not null,
  event_name text not null,
  venue_name text not null,
  venue_address text not null,
  performance_date date,
  arrival_time text not null,
  soundcheck_time text not null,
  set_time text not null,
  set_length_minutes integer,
  compensation_terms text not null,
  tax_form_required boolean not null,
  cancellation_notice_days integer not null,
  merch_rights_allowed boolean not null,
  radius_clause_enabled boolean not null,
  radius_miles integer,
  radius_days integer,
  guest_list_allowance integer not null,
  -- Signer-provided
  signer_full_legal_name text not null,
  signer_business_name text,
  signer_address text not null,
  signer_email text not null,
  signer_phone text not null,
  emergency_contact_name text not null,
  emergency_contact_phone text not null,
  government_id_name text not null,
  payment_method text not null
    check (payment_method in ('Zelle', 'Cash App', 'Check', 'Cash', 'Bank Transfer', 'Other')),
  payee_entity text not null
    check (payee_entity in ('Artist directly', 'Manager', 'Company/LLC')),
  payee_details text,
  tax_form_acknowledged boolean not null default false,
  additional_people_count integer not null default 0,
  additional_people_notes text,
  guest_list_names text,
  signature_typed_name text not null,
  contract_version text not null default 'v2',
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

-- Separate, non-legal technical rider + hospitality + promo intake --
-- deliberately NOT part of the signed contract (no e-signature, no email
-- verification): it's operational data, not a legal term, and bundling 20+
-- fields into a document someone has to e-sign is bad UX. Gated by the same
-- access code as the contract (see submit-tech-rider) so only an invited
-- performer can submit one, but doesn't require the invite to be signed
-- first -- some performers may fill this in before signing.
--
-- DJ-specific and opening-act-specific columns are both nullable on every
-- row; which half is populated depends on contract_invites.role.
create table if not exists tech_rider_submissions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references contract_invites(id),
  act_name text not null,
  role text not null,
  social_media jsonb, -- [{platform, handle}, ...]
  press_photo_url text,
  short_bio text,
  promo_commitment_ack boolean not null default false,
  -- DJ-specific
  dj_format text,
  dj_equipment_needed jsonb, -- ["CDJs", "Mixer", "Controller", ...]
  dj_brings_own_gear boolean,
  dj_needs_table_booth boolean,
  dj_needs_mc_mic boolean,
  dj_set_style text,
  dj_special_intro text,
  dj_preferred_genre text,
  dj_no_play_list text,
  -- Opening-act-specific
  oa_performer_count integer,
  oa_uses_backing_tracks boolean,
  oa_mic_count integer,
  oa_backing_track_format text,
  oa_traveling_dj boolean,
  oa_input_list text,
  oa_stage_plot_notes text,
  oa_special_props text,
  oa_walk_on_cue text,
  created_at timestamptz not null default now()
);

alter table tech_rider_submissions enable row level security;
-- No public policies -- only the Edge Function (service_role) touches this.

create policy "stephen can read tech rider submissions"
  on tech_rider_submissions for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'stephen@selassiefest.com');
