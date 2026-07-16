-- Multiple payment methods, not one -- lets Talent list every method
-- they're OK with (Stephen picks whichever's easiest when it's time to
-- pay), rather than forcing a single choice. Still requires at least 1
-- selected -- validated in submit-talent-contract (the only writer of
-- this table), not here.
--
-- No real signed contracts exist yet (only smoke-test rows), so the old
-- single-value column is just dropped rather than migrated.
alter table talent_contracts drop column if exists payment_method;
alter table talent_contracts add column payment_methods jsonb not null default '[]'::jsonb;
