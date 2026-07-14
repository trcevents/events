# Charly Black Comp/Sellable Ticket System — Status & Runbook

## What this is
- Public intake form: `/charly-black/comp/` — organizers (Marlon, Kirk, Dougie, Bobby, Dwight — extensible via the `approvers` Supabase table) hand this link out to whoever they've told can get a comp/sellable allocation. No personalized link needed — anyone can arrive and fill in their own info.
- Admin review page: `/charly-black/comp-admin/` — restricted to stephen@selassiefest.com via magic-link sign-in. Approve/reject requests, paste in the Ticket Tailor access code once set up, and send it to the recipient.
- Backend: the existing shared TRC Events / SelassieFest Supabase project (`xdjbgcqaynnzykrglgnf`) — same project already running raffle entries, camp registrations, Dancehall 101, Oscars night, and Stripe donations. No new Supabase or Resend account was needed; `selassiefest.com` is already a verified Resend sending domain there.

## Status: live as of 2026-07-14
- `supabase/migrations/0001_comp_requests.sql` applied — `comp_requests` + `approvers` tables, RLS, and a `comp_requests_notify` trigger that reuses the project's existing generic `notify_submission_webhook()` function.
- `supabase/functions/notify-submission/index.ts` — extended (not replaced) with a `comp_requests` case, so a submission emails stephen@selassiefest.com automatically, same as every other form on this backend.
- `supabase/functions/send-access-info/index.ts` — deployed. Called from the admin page after Stephen approves + pastes in a Ticket Tailor code; emails the recipient their allocation and access info.
- `assets/supabase-config.js` — has the real project URL + anon key (safe client-side; everything is gated by RLS).
- Auth `site_url`/`uri_allow_list` configured so the admin page's magic-link sign-in redirects correctly.
- End-to-end tested: a test submission was inserted through the real public REST path, confirmed the trigger fired and the notification email actually sent, then the test row was deleted.

**Not yet tested by a human:** signing into `/charly-black/comp-admin/` via the magic link and clicking Approve → Send Access Info. That leg needs a real browser + inbox, so give it one test run yourself before relying on it for a real request.

## Per-recipient Ticket Tailor setup (after you approve a request in the admin page)
For a request approved for, say, 5 tickets:
1. In Ticket Tailor, create a **Group** with shared capacity = 5.
2. Inside that group, create two ticket types drawing from the same pool:
   - `<Name> – Free (Comp)` — $0, hidden/unlisted
   - `<Name> – Paid` — priced at whatever tier is currently live (check the live site — Early Bird is $20 as of writing)
3. Create a unique **Access Code** for that recipient and attach it to both ticket types in the group.
4. Grab the direct checkout link (with the access code baked in, if Ticket Tailor supports it) or the code itself.
5. Paste that into the request's row in the admin page ("Paste Ticket Tailor access code/link here"), hit **Save Code**, then **Send Access Info** — this emails the recipient their allocation + access details and timestamps it.

Because both ticket types share one Group's inventory, the recipient can't accidentally claim more than their approved allocation, no matter how they split comp vs. sell.

## End-to-end flow recap
1. Someone asks an organizer for tickets → organizer hands them the `/charly-black/comp/` link.
2. They submit the form (name, email, phone, tickets requested, who approved them, notes).
3. Stephen gets an automatic email → reviews in `/charly-black/comp-admin/`.
4. Stephen approves (or rejects) the request.
5. Stephen manually builds that recipient's Group + ticket type pair + access code in Ticket Tailor, pastes the result into the admin page, and sends it.
6. Ticket Tailor's own attendee-details-at-checkout data becomes the audit trail: filter/export by ticket type — rows under "– Free (Comp)" are the comp audit, rows under "– Paid" are the sold audit.

## Housekeeping
The Supabase Personal Access Token and the Resend API key used to set this up were both pasted directly in chat during setup. Once you've confirmed everything works, rotate/revoke both:
- Supabase: Account → Access Tokens → revoke the token used for this setup, generate a fresh one if you need one later.
- Resend: API Keys → revoke and regenerate if you want a clean key going forward.
