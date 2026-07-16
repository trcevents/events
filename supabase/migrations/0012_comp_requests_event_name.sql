-- comp_requests had no event reference at all -- fine while Charly Black
-- was the only ticketed show, but submit-performer-ticket-request now
-- feeds this table from ANY signed contract, and future ticketed events
-- (beyond Charly Black) would otherwise land here indistinguishably.
--
-- Defaults to the one event this table has ever actually served, so every
-- existing row (and the still-untouched public /charly-black/comp/ form,
-- which doesn't send this field) keeps behaving exactly as before.
alter table comp_requests
  add column if not exists event_name text not null default 'Charly Black — Good Times';
