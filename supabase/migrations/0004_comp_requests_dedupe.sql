-- Stop the same person from submitting more than one comp request --
-- e.g. asking Marlon, getting a small allocation, then asking Kirk too.
-- Enforced at the database level (not an email-link/verification flow --
-- those get silently eaten by mail scanners, see comp-admin's switch away
-- from magic links) so it can't be bypassed by a slow client or a retry.

create unique index if not exists comp_requests_email_unique
  on comp_requests (lower(email));

-- Phone is optional, so only enforce uniqueness when it's actually provided.
create unique index if not exists comp_requests_phone_unique
  on comp_requests (phone)
  where phone is not null and phone <> '';
