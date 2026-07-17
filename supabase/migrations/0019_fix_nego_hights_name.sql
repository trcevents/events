-- The flyer, and the TikTok/YouTube/Instagram/website handles already on
-- file, all confirm "Nego Hights" -- not "Nego Heights." Fixing everywhere
-- it was seeded, per Stephen (2026-07-17).
update schedule_acts
set act_name = 'Nego Hights w/ Matches'
where act_name = 'Nego Heights w/ Matches';

update contract_invites
set act_name = 'Nego Hights', act_slug = 'nego-hights'
where act_slug = 'nego-heights';
