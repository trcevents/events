-- Roster management (add/deactivate approvers and admins) needs to be
-- restricted to Stephen, not all 7 reviewers -- add a super-admin flag
-- and a matching SECURITY DEFINER check, same pattern as is_comp_admin().
alter table comp_admins add column if not exists is_super_admin boolean not null default false;
update comp_admins set is_super_admin = true where email = 'stephen@selassiefest.com';

create or replace function is_comp_super_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.comp_admins
    where email = (auth.jwt() ->> 'email')
    and is_super_admin = true
    and active = true
  );
$$;

-- Lets a signed-in admin look up their OWN name (used to decide whether
-- they get a personal referral link) without needing broad read access
-- to the whole comp_admins roster.
create or replace function my_admin_name()
returns text
language sql
security definer
set search_path = ''
as $$
  select name from public.comp_admins
  where email = (auth.jwt() ->> 'email')
  and active = true
  limit 1;
$$;

-- Roster management: only Stephen (or whoever holds is_super_admin) can
-- see or edit the admin/approver lists. Deactivate rather than delete so
-- reviewed_by/approver_name references on past requests stay meaningful.
create policy "super admin can read comp_admins"
  on comp_admins for select
  to authenticated
  using (is_comp_super_admin());

create policy "super admin can insert comp_admins"
  on comp_admins for insert
  to authenticated
  with check (is_comp_super_admin());

create policy "super admin can update comp_admins"
  on comp_admins for update
  to authenticated
  using (is_comp_super_admin())
  with check (is_comp_super_admin());

create policy "super admin can read all approvers"
  on approvers for select
  to authenticated
  using (is_comp_super_admin());

create policy "super admin can insert approvers"
  on approvers for insert
  to authenticated
  with check (is_comp_super_admin());

create policy "super admin can update approvers"
  on approvers for update
  to authenticated
  using (is_comp_super_admin())
  with check (is_comp_super_admin());

-- Self-service password reset -- a code typed back in, not a clickable
-- link (same reasoning as comp request email verification: mail
-- scanners silently consume links before a human clicks them).
create table if not exists admin_password_resets (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table admin_password_resets add constraint admin_password_resets_email_key unique (email);
alter table admin_password_resets enable row level security;
-- No policies -- only the two Edge Functions (service_role) touch this.
