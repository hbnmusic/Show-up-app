# Community shows: Supabase setup

The app hides the community features until it is built with a Supabase project address and key.
Nothing else in the app depends on this.

1. **Create the project.** supabase.com → New project (free plan). Choose a region near most users
   and save the database password somewhere safe. Setnik never uses it.
2. **Create the tables.** SQL Editor → New query → paste all of `supabase/schema.sql` → Run.
   Running it twice is harmless. (If the project already ran an older `schema.sql`, paste
   `supabase/migrations/002_compliance.sql` instead; it adds terms acceptance, blocking, user reports, field
   validation and account deletion, and is also safe to run twice.)
3. **Make the email contain the code, and name the app.** Authentication → Emails → Templates. Edit both **Confirm signup**
   (new people) and **Magic Link** (returning people; the app signs in with a 6-digit code). For each one set the **Subject** to
   `Your Setnik code` and make the body show `{{ .Token }}`, for example:

   ```html
   <h2>Your Setnik code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   ```

   Replace any wording that still uses the app's earlier names or says "Supabase" in the other templates too (Change Email Address, Reset Password, Invite,
   Reauthentication). The app does not send those, but they exist. The project name itself (Project Settings → General) is not shown to users.
4. **Add the address and key to the build.** Project Settings → API: copy the Project URL and the
   `anon` (or "publishable") key. In GitHub: repo → Settings → Secrets and variables → Actions →
   **Variables** tab → New repository variable, twice:
   `SUPABASE_URL` and `SUPABASE_ANON_KEY`. These two values are public by design (they end up inside
   the app); the rules in `schema.sql` are what protect the data. **Never** put the `service_role`
   key anywhere in this repo or in the app.
5. **Run the build** (push to main, or Actions → Android APK → Run workflow) and install it.
6. **Email sending: set up your own SMTP sender before any tester signs in.** Supabase's built-in sender only delivers to
   addresses that belong to members of your Supabase organization (anyone else gets "Email address not authorized") and is rate-limited
   to a handful of emails per hour for the whole project. It also shows the sender "Supabase Auth", which cannot be renamed. So: Authentication →
   Emails → SMTP Settings → enable custom SMTP (Resend and Brevo both have free tiers; the sending domain must be verified with the
   provider) and set **Sender name** to `Setnik` and **Sender email** to an address on your domain (for example `login@yourdomain`).
   Then Authentication → Rate Limits: raise "emails per hour" above the default 30 if you expect more than that.

## Running it

- Trusted people skip the confirmation wait: Authentication → Users → copy the user's ID → Table Editor →
  `trusted_users` → insert row. Do this for yourself first.
- Block someone who posts spam: same, in `banned_users`.
- Remove a bad show: Table Editor → `submissions` → set `status` to `removed`. More in `supabase/MODERATION.md`
  (reports, bans, deletion requests, SQL to copy).
- A person can post 5 shows per 24 hours (30 if trusted). Three different people reporting a show removes it.
- The free plan pauses a project after a week with no activity; open the dashboard to resume it.

## First-party listings (flyers and venue pages): one-time setup

Do these once; the migrations 005-020 are already applied to the project (016-017 retire the old seller schema and scrub its data, 018 adds the `app_flags` kill switches, 019 allows the notification analytics events, 020 marks the soft-launch cities). A fresh project gets all of them by running `schema.sql`.
1. Authentication → Sign In / Providers → turn on **Allow anonymous sign-ins** (needed so a first-time user can share a flyer).
2. Google AI Studio: create an API key in a project where **billing was never enabled** (the free tier is the only allowed one). Read the model's
   free limits at aistudio.google.com/rate-limit and set `update fp.ai_config set value = '<requests per day>' where key = 'daily_cap';`.
3. Supabase → Edge Functions → Secrets: `GEMINI_API_KEY` and `JOB_TOKEN` (any long random string).
4. Supabase → Vault: create a secret named `fp_job_token` with the same value as `JOB_TOKEN` (pg_cron uses it for flyer retries).
5. GitHub → Settings → Secrets and variables → Actions: secret `JOB_TOKEN` (same value), secret `SUPABASE_ACCESS_TOKEN`, variables `FP_JOB_URL`
   (`https://<project ref>.supabase.co/functions/v1/fp-job`) and `SUPABASE_PROJECT_REF` (and `SUPABASE_ANON_KEY` if not already set).
6. Run the Actions workflow **Deploy Supabase functions**, then **Seed venues** (dry run first), then **Venue scan**.
7. Optional: run the Actions workflow **Readiness report** to see, for New York and Los Angeles, upcoming shows, share by source, approved venues, rejection reasons, shows per genre and whether the notification minimums are met.

**"N going" counts (migrations 021 and 022): not applied yet.** The tool used for earlier migrations refuses SQL that contains delete statements, and 021's clean-up functions contain them, so you apply these two by hand: open `supabase/migrations/021_going_counts.sql`, paste the whole file into Dashboard → SQL Editor → New query, Run; then do the same with `022_going_flag_row.sql` (it adds `going_counts_enabled` to the kill-switch table). Both can be run twice safely. Until they are run, the app's sends and fetches fail quietly and no count is shown. pg_cron schedules `going.purge_old()` daily at 08:37 UTC; if the extension is off, run `select going.purge_old();` yourself now and then. What the app can do is limited to three functions (`set_going`, `forget_my_going`, `get_going_counts`); it cannot read or write the tables. See `supabase/KILL_SWITCHES.md` (item 7) for the switch, purge and spoofing SQL. Meaning of the number: app installs currently Going, not people.

Soft launch: New York and Los Angeles have `soft_launch = true` in `fp.metro_config` (and a daily model-request budget of 40, others 10). They are scanned first and get more candidate trials per run; other cities are scanned after them. Every city still shows its JamBase listings. To change which cities are soft launch: `update fp.metro_config set soft_launch = true where metro = '<id>';`. Which cities get notifications is set separately, in `src/lib/metros.ts` (`notificationsEnabled`).

## What the rules do not stop

- One person with two email addresses can confirm their own submission. Trusted/banned lists and the
  report threshold are the defenses; if abuse shows up, require confirmations from accounts that are
  more than a few days old.
- The share button on Instagram only passes a link. Setnik cannot read the post's caption or flyer, so
  the person types in the details and the link is kept as the source.
