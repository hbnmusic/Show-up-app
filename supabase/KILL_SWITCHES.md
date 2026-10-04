# Kill switches (internal; for the project owner)

Six on/off switches let you stop one part of Pull Up from your Supabase dashboard, without a new app release. They are
for emergencies: a provider asks you to stop, a bill or quota problem, abuse, a bug that is hurting people.

Everything is ON by default. A switch you never touch does nothing.

## How to flip a switch

1. Open the Supabase dashboard, pick the project, click **SQL Editor** in the left menu, click **New query**.
2. Paste ONE line from the tables below and press **Run**. It should answer "Success. No rows returned".
3. To check the current state at any time, run: `select key, enabled, message, updated_at from public.app_flags order by key;`

Only you can change the switches (they are in a locked table; the app can only read them). The optional `message` is stored with the switch for your own records.
The app shows its own fixed wording and does not display it.

## The six switches

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

To turn notifications off for one city only (not the whole app), change the city's setting in `src/lib/metros.ts` (`notifications: false`) and release an app update.

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
