# Analytics and feedback: how to read them

Both live in the `ops` schema of your Supabase project. That schema is not exposed through the API, and the tables have no policies
and no grants for the app's `anon` or `authenticated` roles, so only people who can sign in to your Supabase dashboard can read them.
The app can do exactly three things: `log_events` (add events), `submit_feedback` (add a feedback message) and `forget_install`
(delete one install's events). It cannot read anything back.

Protect the one door that remains: turn on multi-factor sign-in for your Supabase account (Account → Security) and your GitHub account,
and do not invite anyone to the project that should not see feedback emails.

## Set up

Run `supabase/migrations/003_analytics_feedback.sql` once in the SQL editor (already applied to project `ytybkywyygorfvflbxzk`).
The app only sends events when the build has `SUPABASE_URL` and `SUPABASE_ANON_KEY` set, the same as Community.

## See the numbers

Dashboard → **Table Editor** → choose schema `ops` (top left), or **SQL Editor** and run any of these. Days are New York time.

```sql
select * from ops.daily_active limit 30;      -- people (installs) and events per day
select * from ops.new_installs limit 30;      -- first time each install was seen
select * from ops.retention limit 30;         -- per first-seen day: installs, and how many came back on day 1, 7, 30
select * from ops.decisions_daily limit 30;   -- Going vs Pass swipes per day
select * from ops.top_cities;                 -- cities people choose
select * from ops.screens;                    -- screens opened
select * from ops.community_actions;          -- submits, confirms, reports, blocks, deletions
select * from ops.versions;                   -- installs per app version
```

Some one-off questions:

```sql
-- Weekly active installs
select date_trunc('week', at at time zone 'America/New_York')::date as week, count(distinct install_id)
from ops.events group by 1 order by 1 desc;

-- Share of installs that ever swiped Going
select round(100.0 * count(distinct install_id) filter (where props ->> 'd' = 'going')
       / nullif(count(distinct install_id), 0), 1) as pct
from ops.events where name = 'decision';

-- Permission answers
select props ->> 'kind' as kind, props ->> 'result' as result, count(*) from ops.events
where name = 'permission' group by 1, 2 order by 1, 3 desc;
```

An "install" is a random id made when the app first runs. Reinstalling, clearing app data, or turning analytics off and on creates a
new one, so counts are installs, not people.

## Feedback

```sql
-- Newest first
select created_at, kind, status, message, contact_email, app_version, os_version, device_model
from ops.feedback order by created_at desc limit 50;

-- Mark handled
update ops.feedback set status = 'done' where id = '<id>';

-- Delete one message (for example on request)
delete from ops.feedback where id = '<id>';
```

New messages do not email you. To get an alert, open the Table Editor on `ops.feedback` now and then, or add a Database Webhook
(Dashboard → Database → Webhooks) on inserts to `ops.feedback` that calls a service such as Resend or Zapier [inference: webhooks can
target tables in non-public schemas; test it]. That would put message text into a third-party service, so add it to the privacy policy first.

## What the app sends

Event names are fixed in `src/lib/analyticsCore.ts` and in `log_events`: `app_open`, `session_start`, `screen_view`, `decision`,
`show_opened`, `filter_changed`, `city_changed`, `calendar_added`, `community_action`, `share_received`, `permission`, `feedback_sent`, plus the flyer events `flyer_shared`, `flyer_ocr`, `flyer_result`, `link_fetch`, `ai_quota` (counts, result codes and durations only; no text, names or links).
Properties are short scalars (for example `d = going`, `metro = nyc`, `screen = /settings`). Each batch also carries the install id, a
session id, the app version and the Android version. The server drops unknown event names and any oversized or non-scalar property,
accepts at most 50 events per call and 2,000 events per install per day.

To add an event: add its name to `EVENT_NAMES` and to the `allowed` list in `log_events` (new migration), keep properties free of
personal data, and update the privacy policy and `docs/play/play-data-safety.md` if it collects a new kind of data.

## Retention and opt-out

- A daily job (`pg_cron`, 08:17 UTC) deletes events older than 14 months and feedback older than 24 months. Check Dashboard → Database →
  Cron if you want to confirm it is there; run `select ops.purge_old();` by hand if not.
- When someone turns off "Share anonymous usage data" the app deletes that install's events (`forget_install`) and starts a new random id
  if they turn it back on. If the phone is offline at that moment the deletion is retried on the next launch.
- Account deletion does not touch analytics or feedback, because neither is linked to the account. The privacy policy and the deletion page say so.
