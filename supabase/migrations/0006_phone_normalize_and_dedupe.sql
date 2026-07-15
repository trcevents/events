-- Phone uniqueness previously compared the raw string, so "414-555-0102"
-- and "4145550102" weren't caught as the same number. Compare digits only.
drop index if exists comp_requests_phone_unique;

create unique index comp_requests_phone_digits_unique
  on comp_requests (regexp_replace(phone, '\D', '', 'g'))
  where phone is not null and regexp_replace(phone, '\D', '', 'g') <> '';
