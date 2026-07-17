-- Structured Show/Artist Sets table for /run-of-show, per Stephen
-- (2026-07-17): the free-text production_schedule content works for
-- pre-show/doors/headline/after, but Show + Artist Sets need per-act
-- status tracking (promo, social handles, contract, tickets), which a
-- text blob can't represent. Public read like production_schedule;
-- writes go through update-schedule-act, gated by the same shared
-- PRODUCTION_SCHEDULE_PASSWORD, not per-member accounts.
create table if not exists schedule_acts (
  id uuid primary key default gen_random_uuid(),
  position integer not null,
  time_slot text not null,
  act_name text not null,
  online_promo boolean not null default false,
  social_media_received boolean not null default false,
  contract_signed boolean not null default false,
  tickets_ordered boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table schedule_acts enable row level security;

create policy "anyone can read schedule acts"
  on schedule_acts for select
  to anon, authenticated
  using (true);

-- No write policies -- only update-schedule-act (service_role) touches this.

insert into schedule_acts (position, time_slot, act_name)
select * from (values
  (1, '8:00–8:30 PM', 'Chargie'),
  (2, '8:30–9:00 PM', 'DJ Poyo'),
  (3, '9:00–9:30 PM', 'Boise (Ghetto Story)'),
  (4, '9:30–10:00 PM', 'Jay Rebel w/ Matches'),
  (5, '10:00–10:10 PM', 'Krabbit w/ Matches'),
  (6, '10:10–10:20 PM', 'Honezty w/ Matches'),
  (7, '10:20–10:30 PM', 'Solid Chain w/ Matches'),
  (8, '10:30–10:40 PM', 'Nego Heights w/ Matches')
) as v(position, time_slot, act_name)
where not exists (select 1 from schedule_acts);

-- The free-text schedule's old line-by-line Show/Artist Sets breakdown is
-- now redundant with (and could drift out of sync with) this table --
-- replace it with a pointer instead of leaving two sources of truth.
update production_schedule
set content = E'PRE-SHOW\n3:00 PM — Load-in\n5:00 PM — Soundcheck\n\nDOORS\n8:00 PM — Doors open\n\nSHOW & ARTIST SETS\nSee the lineup table below for set times and status tracking.\n\nHEADLINE\n10:40–11:40 PM — Charly Black\n\nAFTER\n11:40 PM–1:00 AM — Matches & Boise\n1:00–2:00 AM — TBD\n\nMC: Katty',
    updated_by = 'migration (structured table added)',
    updated_at = now()
where id = '00000000-0000-0000-0000-000000000001';
