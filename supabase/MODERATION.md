# Moderation runbook

Run these in Supabase → SQL Editor (they run as the database owner, so the app's row rules do not apply).
Check reports at least every few days, and within 24 hours of any email to the support address about abuse.

## Where reports land

| What was reported | Table | Columns |
| --- | --- | --- |
| A show ("Not right", "Report this show") | `reports` | `submission_id`, `user_id` (reporter), `reason`, `created_at`. Three different reporters set the show's `status` to `removed` automatically (the counter is `submissions.report_count`). |
| A person ("Report the person who added it") | `user_reports` | `target` (reported account), `reporter`, `submission_id`, `reason`, `created_at`. Three different reporters remove that person's waiting (pending) shows automatically. |

Nobody can read these tables through the app; only you can.

```sql
-- Newest show reports, with the show
select r.created_at, r.reason, s.id, s.status, s.venue_name, s.acts, s.created_by
from reports r join submissions s on s.id = r.submission_id
order by r.created_at desc limit 50;

-- People reported, most reports first
select target, count(*) as reports, max(created_at) as latest, array_agg(reason) as reasons
from user_reports group by target order by reports desc, latest desc;

-- Who is this account?
select id, email, created_at, last_sign_in_at from auth.users where id = '<user id>';
```

## Hide or remove content

```sql
-- Hide one show for everyone (reversible: set status back to 'live' or 'pending')
update submissions set status = 'removed' where id = '<submission id>';

-- Hide everything one person added
update submissions set status = 'removed' where created_by = '<user id>' and status <> 'removed';

-- Permanently delete one show (also deletes its confirmations and reports)
delete from submissions where id = '<submission id>';
```

## Ban and trust

```sql
-- Ban: the account can no longer add or confirm shows
insert into banned_users (user_id) values ('<user id>') on conflict do nothing;
-- Lift a ban
delete from banned_users where user_id = '<user id>';

-- Trusted: shows go live without a second confirmation, 30 shows a day instead of 5
insert into trusted_users (user_id) values ('<user id>') on conflict do nothing;
delete from trusted_users where user_id = '<user id>';
```

Limit to know about: a banned person can delete their own account (which deletes the ban row) and sign up again with the same
email. If that becomes a problem, keep a list of banned email addresses and delete matching new accounts with `admin_delete_user`.

## First-party listings (flyers and venue pages): takedowns, bans, purges

Everything runs in the `fp` schema, which is not exposed to the app; use the SQL editor. Public shows are `fp.shows` with `visibility = 'public'`.

```sql
select fp.takedown_show('<show id>', 'DMCA notice 2026-10-05');      -- hide one show and block its source key/URL
select fp.takedown_image('<image URL>', 'DMCA notice');             -- block that image URL everywhere
select fp.takedown_venue('<venue id>', 'venue owner request');       -- disable a venue, hide its shows, stop scanning
select fp.ban_user('<user id>', 'repeat infringer');                  -- bans the account and hides its flyer shows
select fp.purge_licensed('ticketmaster');                            -- clears Ticketmaster link rows (also run the Purge licensed data workflow)
```

Every takedown is recorded in `fp.takedowns`. DMCA notices go to the agent address on `docs/dmca.html`; act on a complete notice promptly, tell the
person who added the show, and ban after repeated notices (repeat-infringer clause in the Terms). Counter-notices: restore with
`update fp.shows set visibility = 'public' where id = '<id>'` after the waiting period in the DMCA page.
Switch licensed data off without deleting anything: `update fp.licensed_switches set enabled = false where family = 'ticketmaster_photo';`
(families: jambase_listings, ticketmaster_price, ticketmaster_photo, ticketmaster_link). Flyer shows waiting for a second person appear in the app's confirm queue.

## Deletion requests that arrive by email or from the web page

Confirm the request came from the address on the account, then:

```sql
select id, email from auth.users where lower(email) = lower('person@example.com');
select public.admin_delete_user('<user id>');
```

This is the same routine the in-app button runs: it deletes the person's shows that no one else confirmed, keeps shows another
person confirmed (author removed), and deletes the sign-in plus confirmations, reports, blocks and terms records.
Reply to the person when it is done (the page promises 30 days).
To also remove a confirmed show they asked about: `delete from submissions where id = '<submission id>';`.

## Terms changes

When the Terms change in a way people must accept again: change `pu_terms_version()` (SQL) and `TERMS_VERSION` in
`src/lib/legal.ts` to the same new value, update the version on `docs/terms.html`, and ship the app update. People are asked
to accept before they next add or confirm a show. Until the app update ships, the server rejects the new version string, so
change the SQL last.

```sql
create or replace function public.pu_terms_version() returns text
language sql immutable set search_path = public as $$ select '2027-01-01'::text $$;
```

## Reporting back to a reporter

The app tells reporters their report was received; it does not send follow-ups. Reply by email only if the reporter wrote to you.
