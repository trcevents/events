-- Three invites created via a shell command that mangled the em-dash in
-- "Charly Black — Good Times" (Windows/Git-Bash inline-string encoding
-- issue, not a real data entry) -- fixing the value directly.
update contract_invites
set event_name = 'Charly Black — Good Times'
where act_slug in ('bad-chargie', 'dj-poyo', 'ghetto-story');
