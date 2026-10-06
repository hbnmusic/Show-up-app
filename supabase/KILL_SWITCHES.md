# Kill switches (internal; for the project owner)

Seven on/off switches let you stop one part of Come Thru from your Supabase dashboard, without a new app release. They are
for emergencies: a provider asks you to stop, a bill or quota problem, abuse, a bug that is hurting people.

Everything is ON by default. A switch you never touch does nothing.

## How to flip a switch

1. Open the Supabase dashboard, pick the project, click **SQL Editor** in the left menu, click **New query**.
2. Paste ONE line from the tables below and press **Run**. It should answer "Success. No rows returned".
3. To check the current state at any time, run: `select key, enabled, message, updated_at from public.app_flags order by key;`

Only you can change the switches (they are in a locked table; the app can only read them). The optional `message` is stored with the switch for your own records.
The app shows its own fixed wording and does not display it.

## The seven switches

Copy the lines exactly; nothing needs replacing.

### 1. JamBase listings (`jambase_enabled`)

| | |
|---|---|
| Turn OFF | `update public.app_flags set enabled = false where key = 'jambase_enabled';` |
| Turn ON | `update public.app_flags set enabled = true where key = 'jambase_enabled';` |

**What changes:** the daily listings refresh makes zero JamBase calls. The published city feeds are rebuilt without JamBase shows and without the JamBase credit line, so only shows from venues' own sites, flyers and the community remain. The app hides the JamBase credit on the About screen and drops the JamBase shows it had saved.

**How long:** the next time the refresh job runs (daily at 09:17 UTC, or press **Run workflow** on "Refresh listings" in GitHub to do it now; the run itself takes a few minutes). Phones pick up the change within 15 minutes of opening the app, and drop saved JamBase shows at that moment.

**Purge (delete everything JamBase-derived, for when the provider asks you to):**
1. Turn the switch OFF (line above).
2. In GitHub: **Actions → Purge licensed data → Run workflow** (source: jambase). It removes JamBase shows from the published feeds and clears the stored JamBase ids in Supabase.
3. Or only the Supabase part, in the SQL editor: `select fp.purge_licensed('jambase');`

Turning the switch ON again does not bring the data back by itself; run **Refresh listings** once and the feeds fill again (this uses JamBase calls from your monthly allowance of 1,000).

### 2. Deezer previews and artist photos (`deezer_enabled`)

| | |
|---|---|
| Turn OFF | `update public.app_flags set enabled = false where key = 'deezer_enabled';` |
| Turn ON | `update public.app_flags set enabled = true where key = 'deezer_enabled';` |

**What changes:** the app makes no Deezer requests. Cards show no audio bar and no error text, and the picture falls through to the generated poster. The Deezer credit is hidden. The app empties its saved previews and its picture cache once.

**How long:** up to 15 minutes after a phone opens the app (the switch is read at launch and when the app comes to the front). Nothing runs on the server for this one.

### 3. AI reading (`ai_extraction_enabled`)

| | |
|---|---|
| Turn OFF | `update public.app_flags set enabled = false where key = 'ai_extraction_enabled';` |
| Turn ON | `update public.app_flags set enabled = true where key = 'ai_extraction_enabled';` |

**What changes:** no request is sent to Gemini anywhere (flyers or venue pages). When someone shares a flyer, the app says it was received and is in line; the flyer waits in the queue and is read automatically after you turn the switch back ON (usually within a minute). Venue pages that only the AI can read are skipped and read again later. Venues that publish structured data (JSON-LD, calendar files, feeds, widgets) keep being read as normal.

**How long:** immediately for new requests (the server checks at every request); the scheduled jobs check at the start and every 10 venues.

### 4. Flyer sharing (`flyer_intake_enabled`)

| | |
|---|---|
| Turn OFF | `update public.app_flags set enabled = false where key = 'flyer_intake_enabled';` |
| Turn ON | `update public.app_flags set enabled = true where key = 'flyer_intake_enabled';` |

**What changes:** the share target shows "Flyer sharing is paused right now. Nothing was sent." The phone does not read the flyer and does not contact the server. Flyers already received are not affected (turn off AI reading too if you want those to wait).

**How long:** up to 15 minutes after a phone opens the app. Older app versions that skip the check are also refused by the server immediately.

### 5. Venue scanning (`venue_scan_enabled`)

| | |
|---|---|
| Turn OFF | `update public.app_flags set enabled = false where key = 'venue_scan_enabled';` |
| Turn ON | `update public.app_flags set enabled = true where key = 'venue_scan_enabled';` |

**What changes:** the scheduled "Venue scan" job reads the switch first and exits cleanly (the run shows a green tick and says it is switched off). Shows already collected stay in the app. A run that is already in progress stops within about 10 venues.

**How long:** the next scheduled run (daily at 06:41 UTC), or within minutes for a run in progress.

### 6. Retention notifications (`notifications_enabled`)

| | |
|---|---|
| Turn OFF | `update public.app_flags set enabled = false where key = 'notifications_enabled';` |
| Turn ON | `update public.app_flags set enabled = true where key = 'notifications_enabled';` |

**What changes:** no "new shows" or "tonight" notification is scheduled or shown, and any already scheduled are cancelled the next time the app runs. Show reminders for shows people marked Going are a different feature and are not affected.

**How long:** the next time a phone opens the app and reads the switch (within 15 minutes of opening). A notification that was already scheduled on a phone that has not opened the app yet can still appear until then; notifications are only scheduled a few hours ahead.

To turn notifications off for one city only (not the whole app), change the city's setting in `src/lib/metros.ts` (`notificationsEnabled: false`) and release an app update.

### 7. "N going" counts (`going_counts_enabled`)

Needs migrations 021 and 022 run once (see `supabase/SETUP.md`); until then there is no such row and the check on `app_flags.key` refuses it.

| | |
|---|---|
| Turn OFF | `update public.app_flags set enabled = false where key = 'going_counts_enabled';` |
| Turn ON | `update public.app_flags set enabled = true where key = 'going_counts_enabled';` |
| Purge (delete every going row, count and daily counter) | `select going.purge_all();` |

**What changes (OFF):** the server ignores `set_going` and `get_going_counts` returns nothing. The app sends no going updates and shows no "N going" anywhere (the chip disappears and the saved numbers are not shown). `forget_my_going` still works so a person can always delete their rows. Going itself, the swipe and the Going list are not affected.

**Turn OFF and delete everything:** run the two lines together:
`update public.app_flags set enabled = false where key = 'going_counts_enabled'; select going.purge_all();`

**Turning ON again:** phones send their current Going list again the next time they read the switch (within 15 minutes of opening the app), so counts rebuild by themselves.

**How long:** the server acts at once; phones read the switch at most every 15 minutes.

#### Going counts: other SQL you may need

Settings that live in `going.config`: `going_count_min_display` = 16 (a count is shown only when it is at least this, i.e. more than 15), `max_changes_per_day` = 200, `purge_after_days` = 7. Change one with `update going.config set value = '21' where key = 'going_count_min_display';`.

- **Spoofing.** Counts are social proof, not security. A person can make many installs (each with its own random id) and push a show over 15; the 200 changes per day limit only stops one id from flooding. If a count looks wrong, hide it: `insert into going.excluded (show_id) values ('jb-12345') on conflict do nothing;` (the show is never returned again; undo with `delete from going.excluded where show_id = 'jb-12345';`), or zero it and remove the rows behind it: `delete from going.rows where show_id = 'jb-12345'; delete from going.counts where show_id = 'jb-12345';`.
- **Top shows by going count** (these numbers include counts at or below 15, which the app never sees; only you can run this): `select show_id, n, show_date from going.counts order by n desc limit 20;`
- **How many shows would display a count right now:** `select count(*) from going.counts c where c.n >= (select value::int from going.config where key = 'going_count_min_display') and not exists (select 1 from going.excluded e where e.show_id = c.show_id);`
- **Run the clean-up by hand** (it normally runs daily at 08:37 UTC through pg_cron): `select going.purge_old();`
- **A show's id changed after a merge.** When a venue-page show (`fp:<uuid>`) is matched to a JamBase listing, the card keeps the JamBase id (`jb-<id>`). The refresh job calls `going.rekey_show('fp:<uuid>', 'jb-<id>')` for each new match, which moves the rows and count to the new id (a phone that already had the new id keeps one row, and an exclusion carries over). By hand: `select going.rekey_show('fp:...', 'jb-...');`.

## Other emergency tools (not switches)

- Hide one show everywhere: `select fp.takedown_show('<show id>', 'reason');`
- Block a picture: `select fp.takedown_image('<image URL>', 'reason');`
- Stop reading one venue: `select fp.takedown_venue('<venue id>', 'reason');`
- Ban an account: `select fp.ban_user('<user id>', 'reason');`

More in `supabase/MODERATION.md`.

## If a switch seems to do nothing

- Check you changed the right key: `select key, enabled from public.app_flags order by key;`
- Phones read switches at most every 15 minutes; force-close and reopen the app, then wait a moment.
- The scheduled jobs need the repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions → Variables) to read the JamBase switch; the venue scan reads it through the job address you already set.
- If the switch values cannot be read at all, every part keeps running as if everything were ON.
