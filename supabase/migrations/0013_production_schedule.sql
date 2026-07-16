-- Live-editable master production schedule for trcevent.com, per Stephen
-- (2026-07-16): needs to be editable by the team as the show night evolves,
-- not just something Claude republishes. Single free-text content field
-- (not structured rows) since a live event night needs fast, unstructured
-- edits more than rigid schema -- see update-production-schedule.
--
-- One fixed row (id below), not one-per-event, since there's only one
-- production happening at a time right now. If that stops being true,
-- this will need a real per-event key.
create table if not exists production_schedule (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  content text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table production_schedule enable row level security;

-- Public read -- this is show-night logistics, not sensitive data. Roadies,
-- security, photographers, everyone benefits from being able to check it
-- without any login.
create policy "anyone can read the production schedule"
  on production_schedule for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policies -- only update-production-schedule
-- (service_role, gated by a shared PRODUCTION_SCHEDULE_PASSWORD secret,
-- not per-member accounts) can write.

insert into production_schedule (id, event_name, content, updated_by) values (
  '00000000-0000-0000-0000-000000000001',
  'Charly Black — Good Times',
  E'PRE-SHOW\n3:00 PM — Load-in\n5:00 PM — Soundcheck\n\nDOORS\n8:00 PM — Doors open\n\nSHOW\n8:00–8:30 PM — Chargie\n8:30–9:00 PM — DJ Poyo\n9:00–9:30 PM — Boise (Ghetto Story)\n\nARTIST SETS (Matches is the DJ for all performing artists)\n9:30–10:00 PM — Jay Rebel w/ Matches\n10:00–10:10 PM — Krabbit w/ Matches\n10:10–10:20 PM — Honezty w/ Matches\n10:20–10:30 PM — Solid Chain w/ Matches\n10:30–10:40 PM — Nego Heights w/ Matches\n\nHEADLINE\n10:40–11:40 PM — Charly Black\n\nAFTER\n11:40 PM–1:00 AM — Matches & Boise\n1:00–2:00 AM — TBD\n\nMC: Katty',
  'Stephen (initial)'
)
on conflict (id) do update set
  content = excluded.content,
  updated_by = excluded.updated_by,
  updated_at = now();
