-- Split the old single "how many tickets" ask into a free/sell breakdown,
-- plus optional social media so TRC knows where a seller plans to post.
-- tickets_requested stays as the total (free + sell) so existing displays,
-- emails, and Ticket Tailor allocation math keep working unchanged.

alter table comp_requests
  add column if not exists wants_free boolean not null default false,
  add column if not exists free_tickets_requested integer not null default 0,
  add column if not exists wants_to_sell boolean not null default false,
  add column if not exists sell_tickets_requested integer not null default 0,
  add column if not exists social_media jsonb;

alter table comp_requests
  add constraint free_tickets_in_range check (free_tickets_requested >= 0 and free_tickets_requested <= 2),
  add constraint sell_tickets_in_range check (sell_tickets_requested >= 0 and sell_tickets_requested <= 10),
  add constraint tickets_requested_is_the_sum check (tickets_requested = free_tickets_requested + sell_tickets_requested);
