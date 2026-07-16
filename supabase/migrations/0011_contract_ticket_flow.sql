-- Follow-up to 0010, per Stephen (2026-07-16):
-- 1. Guest access is handled entirely by the existing comp_requests
--    ticketing flow now (see submit-performer-ticket-request) -- the
--    contract's own guest-list concept is redundant and removed.
-- 2. Pay structure is fixed by role, not deal-specific: DJs are
--    guaranteed $200 regardless of ticket sales; opening acts have no
--    guarantee and are paid based on tickets they sell. See
--    create-contract-invite for where this becomes the compensationTerms
--    default.
--
-- No real signed contracts exist yet (only a smoke-test row), so these
-- columns can just be dropped rather than migrated/preserved.

alter table contract_invites drop column if exists guest_list_allowance;
alter table talent_contracts drop column if exists guest_list_allowance;
alter table talent_contracts drop column if exists guest_list_names;
