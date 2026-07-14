-- Charly Black comp/sellable ticket intake — schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) after creating the project.

create extension if not exists pgcrypto;

-- Organizers allowed to vouch for someone getting a comp/sellable allocation.
-- Extensible: add rows here as TRC adds organizers; set active = false to retire one
-- without breaking historical requests that reference it.
create table if not exists approvers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into approvers (name) values
  ('Marlon'),
  ('Kirk'),
  ('Dougie'),
  ('Bobby'),
  ('Dwight')
on conflict (name) do nothing;

-- One row per person/crew asking for a comp allocation.
create table if not exists comp_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  crew_or_org text,
  email text not null,
  phone text,
  tickets_requested integer not null check (tickets_requested > 0),
  approver_name text not null,
  approver_listed boolean not null default true,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  tt_access_info text,
  reviewed_by text,
  reviewed_at timestamptz,
  access_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table approvers enable row level security;
alter table comp_requests enable row level security;

-- Public intake form needs to read the approver dropdown and insert a request.
create policy "public can read active approvers"
  on approvers for select
  to anon, authenticated
  using (active = true);

create policy "public can submit a comp request"
  on comp_requests for insert
  to anon, authenticated
  with check (true);

-- Only Stephen (the admin reviewer) can see or update submitted requests.
create policy "stephen can read comp requests"
  on comp_requests for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'stephen@selassiefest.com');

create policy "stephen can update comp requests"
  on comp_requests for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'stephen@selassiefest.com')
  with check ((auth.jwt() ->> 'email') = 'stephen@selassiefest.com');

-- This project already has a generic notify_submission_webhook() trigger
-- function (used by raffle_entries, camp_registrations, etc.) that posts
-- {table, record} to the shared notify-submission Edge Function. Reuse it
-- instead of standing up a parallel notification path.
create trigger comp_requests_notify
  after insert on comp_requests
  for each row execute function notify_submission_webhook();
