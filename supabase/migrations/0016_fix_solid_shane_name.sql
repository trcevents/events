-- The flyer confirms "Solid Shane," not "Solid Chain" -- fixing the name
-- everywhere it was seeded, per Stephen (2026-07-17).
update schedule_acts
set act_name = 'Solid Shane w/ Matches'
where act_name = 'Solid Chain w/ Matches';
