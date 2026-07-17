-- Supports a public "click your photo to get started" gallery page, per
-- Stephen (2026-07-17): performers click their own promo image, which
-- emails them their access code (to a known email on file if we already
-- have one -- no re-entering it -- otherwise they type it in once).
--
-- act_slug is a public-safe identifier (e.g. "nego-heights") the gallery
-- page can reference without ever exposing the real access code or its
-- hash -- distinct from access_code_hash, which stays the actual secret.
--
-- known_email lets Stephen attach a performer's email when he already has
-- it (set via create-contract-invite's knownEmail param) so clicking their
-- photo emails the code with no form at all.
--
-- access_code_plain is a deliberate exception to the "only the hash is
-- ever stored" pattern used everywhere else in this schema (comp_
-- verifications, contract_verifications) -- those are short-lived OTPs
-- that only ever need checking once. This code needs to be re-sendable
-- for the invite's whole lifecycle (same code is reused for /tech-rider
-- even after the contract is signed), so rotating it on every resend
-- would break that. Safe because contract_invites has zero read policies
-- for anon/authenticated -- only service-role Edge Functions ever touch
-- this table, so this column is never reachable from a direct client read.
alter table contract_invites
  add column if not exists act_slug text unique,
  add column if not exists known_email text,
  add column if not exists access_code_plain text;
