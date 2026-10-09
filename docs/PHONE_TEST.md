# First phone test (Setnik)

Run this once on a real Android phone before the Play closed beta, and again after any change to the backend. Each step says what to tap,
what you should see, and a query to paste into the Supabase SQL Editor (project `ytybkywyygorfvflbxzk`) that proves the step reached the
server. A step passes only when **both** the screen and the query match. If a query returns nothing, wait one minute (the app batches
what it sends) and run it again before you call it a failure.

Use one phone and one test email you control. Statements about how long things take are [inference] from the code (`src/lib/analytics.ts`
sends every 30 seconds and when the app goes to the background; `src/lib/going/service.ts` sends within a few seconds of a change).

## Before you start

1. Install the newest `.apk` from GitHub → Releases (the top `build-N`, for example `setnik-build-44.apk`). Uninstall any build made
   before the rename first: the package id changed, so the old app is a separate app.
2. Paste this in the SQL Editor and write down the numbers (the "before" values):

```sql
select
  (select count(*) from ops.events)                         as events,
  (select count(*) from ops.feedback)                       as feedback,
  (select count(*) from fp.flyer_jobs)                      as flyer_jobs,
  (select count(*) from going.rows)                         as going_rows,
  (select count(*) from auth.users)                         as auth_users,
  (select count(*) from public.submissions)                 as submissions,
  (select count(*) from public.terms_acceptances)           as terms_accepted;
```

Expected now (2026-10-06): all zeros.

3. Check the kill switches are all ON (a switch that is off hides a feature and makes a test look broken):

```sql
select key, enabled, message, updated_at from public.app_flags order by key;
```

Expected: 7 rows, `enabled = true` on every one: `ai_extraction_enabled`, `deezer_enabled`, `flyer_intake_enabled`, `going_counts_enabled`,
`jambase_enabled`, `notifications_enabled`, `venue_scan_enabled`.

## Steps

### 1. Open the app, then check Settings for the "not set up" message

- **Tap:** open Setnik. Allow or skip any permission prompt. Tap the gear icon (top right of the Shows tab) to open Settings. Scroll to
  **PRIVACY AND FEEDBACK**.
- **Expect:** a switch **Share anonymous usage data** and a row **Send feedback or report a bug**. You must **not** see the line
  **"Usage data and feedback are not set up in this build."** Also confirm that **COMMUNITY** (with **Add or confirm shows** and **My flyers**)
  is listed.
- **If you see "not set up in this build":** the APK was built without `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Stop. Fix the two repository
  variables (GitHub → Settings → Secrets and variables → Actions → Variables), run the **Release preflight** workflow, then push or re-run
  the build and install the new APK. Nothing below can pass until this is fixed.
- **Proof query** (after 1 minute; keep the app open for 30 seconds or press Home and reopen):

```sql
select at, name, props, app_version, os_version, install_id
from ops.events order by at desc limit 10;
```

Expect `app_open` and `session_start` (and `screen_view` with `screen` = `/settings`). Copy the `install_id` of the newest row: that is your
phone. Use it below as `:install`.

### 2. Deck, previews and a swipe

- **Tap:** go to **Shows**. Wait for cards. Tap the play control on a card to hear a preview. Swipe a card **left** (pass) and another
  **right** (Going), or use the **Going** button.
- **Expect:** cards load for your city; preview audio plays (Deezer); right swipe moves the show to the **Going** tab.
- **Proof:**

```sql
select at, name, props from ops.events
where install_id = ':install' and name in ('decision','screen_view','show_opened','city_changed') order by at desc limit 15;
```

(Replace `:install` with your id.) Expect `decision` rows with `props` `{"d":"going"}` and `{"d":"passed"}`.

### 3. Details, calendar and reminders

- **Tap:** tap a card to open the details. Tap **Add to calendar** (allow the calendar prompt if asked). On the **Going** tab, open a show
  and check the reminder rows. Allow notifications when asked (this appears right after the first Going swipe).
- **Expect:** the show opens; the calendar app receives the event; **Settings → REMINDERS** shows the toggles on.
- **Proof:** `ops.events` has `show_opened`, `calendar_added`, `permission` (query as in step 2, add those names).

### 4. Going counts: the phone sends, the chip stays hidden below 16

- **Tap:** swipe 2–3 more shows to Going. Look for the one-time inline note about anonymous counts. Do not expect a number on any show: the app
  shows "N going" only when 16 or more phones are going.
- **Expect:** the note appears once; no "N going" chip anywhere (that is correct).
- **Proof:** the rows exist on the server but the count stays hidden:

```sql
select show_id, show_date, created_at from going.rows order by created_at desc limit 10;
select * from going.counts order by n desc limit 10;
```

Expect one `going.rows` row per Going swipe made after the switch was on (same random `going_id` on every row; it is separate from the
analytics install id) and matching `going.counts` rows with `n = 1`.

**Optional: see the chip once** (owner only; restore afterwards):

```sql
update going.config set value = '1' where key = 'going_count_min_display';
-- on the phone: pull to refresh the Going tab, or close and reopen the app (the app caches counts for 15 minutes)
update going.config set value = '16' where key = 'going_count_min_display';   -- RESTORE THIS
select key, value from going.config where key = 'going_count_min_display';    -- must show 16
```

### 5. Going switch off and on

- **Tap:** Settings → **Include my Going in public counts** → off.
- **Expect:** within a few seconds this phone's rows are removed on the server.
- **Proof:** `select count(*) from going.rows;` returns 0. Then switch it **on** again: the phone re-sends its Going list and
  the count returns to the number of Going shows.

### 6. Share to a friend

- **Tap:** open a show → **Send to a friend**. Pick Messages or Notes.
- **Expect:** a plain-text message with the show details; no link to a server.
- **Proof:** `ops.events` has `show_shared` with `props` `{"surface":"details"}` (Android never reports completion, so no `completed`).

### 7. Sign in (Community)

- **Tap:** Settings → **COMMUNITY → Add or confirm shows**. Enter your test email, tap **Sign in**, enter the 6-digit code from the email,
  accept the Terms.
- **Expect:** the email arrives within a minute and contains a 6-digit code (see `supabase/SETUP.md`, items 3 and 6). If you get no email, or
  an error "Email address not authorized", see "If the email does not arrive" below.
- **Proof:**

```sql
select id, email, created_at, last_sign_in_at, is_anonymous from auth.users order by created_at desc limit 3;
select user_id, version, accepted_at from public.terms_acceptances order by accepted_at desc limit 3;
```

Expect one `auth.users` row for your email with `is_anonymous = false`, and a `terms_acceptances` row with `version = '2026-10-09'`.

### 8. Add, confirm, report and block

- **Tap:** **Add a show** → fill in a headliner, venue, date → submit. Open **My flyers / Community** and find it. Use a second account or a
  show added by someone else to try **Confirm** and **Report / block** (with one account you can only add and withdraw).
- **Expect:** your show appears as pending or live under your city.
- **Proof:**

```sql
select id, created_by, status, title, venue_name, starts_at, confirm_count, report_count from public.submissions order by created_at desc limit 5;
select * from fp.shows where submitter is not null order by created_at desc limit 5;
```

### 9. Share a flyer (image path)

- **Tap:** in your gallery open a flyer image → **Share** → **Setnik**. Choose the city if asked, and send.
- **Expect:** the app reads the text on the phone, then shows the flyer in **My flyers** with a status (processing, then ready or needs a look).
- **Proof:**

```sql
select id, created_at, anonymous, origin, metro_hint, status, result, reason, attempts, array_length(show_ids,1) as shows, finished_at
from fp.flyer_jobs order by created_at desc limit 5;
select day, kind, requests, throttled from fp.ai_usage order by day desc, kind limit 5;
```

Expect one `fp.flyer_jobs` row; `status` moves from `queued`/`processing` to `done` within a few minutes (the retry job runs every minute) and
`fp.ai_usage` shows today's `requests` increase by 1 and `throttled = 0`. Event proof: `ops.events` has `flyer_shared`, `flyer_ocr`,
`flyer_result` rows.

### 10. Share a link

- **Tap:** in a browser or Instagram, share a venue event page link → **Setnik**.
- **Expect:** a second job in **My flyers**.
- **Proof:** the query from step 9 shows a second row; `ops.events` has `link_fetch`.

### 11. Feedback form

- **Tap:** Settings → **Send feedback or report a bug**. Choose a kind, type a message, leave the email blank or add yours, send.
- **Expect:** a "thanks" confirmation.
- **Proof:**

```sql
select created_at, kind, message, contact_email, app_version, device_model, status from ops.feedback order by created_at desc limit 3;
```

### 12. Retention notifications

- **Tap:** Settings → **NOTIFICATIONS** → check both switches are on. Close the app and leave the phone for several hours (Android runs the
  background check every few hours at best, only when the system allows it) [inference]. Tonight's shows or "new shows" can notify.
- **Expect:** a local notification; tapping it opens the app.
- **Proof:** `select at, name, props from ops.events where name like 'notif_%' order by at desc limit 10;` shows `notif_scheduled` and, after you tap
  one, `notif_opened`. This is the least reliable step: record what happened and when.

### 13. Analytics opt-out

- **Tap:** Settings → **Share anonymous usage data** → off. Use the app for a minute. Then switch it on again.
- **Expect:** while off, no new events leave the phone, and the events already sent for this phone are deleted.
- **Proof:** `select count(*) from ops.events where install_id = ':install';` drops to 0 (turning it off deletes them); after you turn it back on and
  use the app, new rows appear.

### 14. Delete account

- **Tap:** Community screen → **Delete my account** → confirm.
- **Expect:** you are signed out and the account is gone.
- **Proof:**

```sql
select count(*) from auth.users where email = 'YOUR TEST EMAIL';                 -- 0
select count(*) from public.submissions where created_by is not null and created_by not in (select id from auth.users);  -- 0
select count(*) from fp.flyer_jobs where submitter not in (select id from auth.users);                                   -- 0
```

### 15. Reset all data

- **Tap:** Settings → **Reset all data on this phone**.
- **Proof:** `going.rows` has no rows for this phone and the app starts like a new install.

### 16. Switch a kill switch (optional, owner only)

- **Tap:** none on the phone. Run `update public.app_flags set enabled = false where key = 'deezer_enabled';`, then reopen the app
  after 15 minutes or force-stop it.
- **Expect:** previews stop with the message. **Restore:** `update public.app_flags set enabled = true where key = 'deezer_enabled';`

## If the email does not arrive (step 7)

Supabase's built-in email sender only delivers to addresses of members of your Supabase organization, and is rate-limited; every other
address fails with "Email address not authorized". Sign-in will therefore work for you but not for testers until you add your own SMTP
server (Dashboard → Authentication → Emails → SMTP Settings). See `supabase/SETUP.md`, items 3 and 6.

## Result

| Step | Screen OK | Query OK | Notes |
| --- | --- | --- | --- |
| 1 Settings, no "not set up" | | | |
| 2 Deck and previews | | | |
| 3 Details, calendar, reminders | | | |
| 4 Going rows | | | |
| 5 Going switch | | | |
| 6 Share to a friend | | | |
| 7 Sign in | | | |
| 8 Community | | | |
| 9 Flyer image | | | |
| 10 Flyer link | | | |
| 11 Feedback | | | |
| 12 Notifications | | | |
| 13 Analytics opt-out | | | |
| 14 Delete account | | | |
| 15 Reset | | | |
