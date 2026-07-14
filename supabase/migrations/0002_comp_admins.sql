-- Multiple people can now review comp requests, not just Stephen.
-- Extensible the same way approvers is: add/deactivate rows as the team changes.
create table if not exists comp_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into comp_admins (email, name) values
  ('stephen@selassiefest.com', 'Stephen'),
  ('chicagotacticalmedic@icloud.com', 'Field Marshall'),
  ('douglas.allen@afccchicago.com', 'Dougie'),
  ('prestigesoundkirk@gmail.com', 'Kirk'),
  ('marlontrc@gmail.com', 'Marlon'),
  ('paksipras@gmail.com', 'Bobby'),
  ('smittyinnovation@gmail.com', 'Dwight')
on conflict (email) do nothing;

alter table comp_admins enable row level security;
-- No public policies on comp_admins at all -- nobody can read this list over
-- the API, including the admins themselves. It's only ever consulted from
-- inside is_comp_admin() below, which runs as the function owner.

-- SECURITY DEFINER so RLS policies on comp_requests can check admin status
-- without granting anyone direct SELECT on comp_admins.
create or replace function is_comp_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.comp_admins
    where email = (auth.jwt() ->> 'email')
    and active = true
  );
$$;

drop policy if exists "stephen can read comp requests" on comp_requests;
drop policy if exists "stephen can update comp requests" on comp_requests;

create policy "comp admins can read comp requests"
  on comp_requests for select
  to authenticated
  using (is_comp_admin());

create policy "comp admins can update comp requests"
  on comp_requests for update
  to authenticated
  using (is_comp_admin())
  with check (is_comp_admin());
