# Community shows: Supabase setup

The app hides the community features until it is built with a Supabase project address and key.
Nothing else in the app depends on this.

1. **Create the project.** supabase.com → New project (free plan). Choose a region near most users
   and save the database password somewhere safe. Pull Up never uses it.
2. **Create the tables.** SQL Editor → New query → paste all of `supabase/schema.sql` → Run.
   Running it twice is harmless.
3. **Make the email contain the code.** Authentication → Emails → Templates. Edit both **Confirm signup**
   (new people) and **Magic Link** (returning people) so the body shows `{{ .Token }}`, for example:

   ```html
   <h2>Your Pull Up code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   ```
4. **Add the address and key to the build.** Project Settings → API: copy the Project URL and the
   `anon` (or "publishable") key. In GitHub: repo → Settings → Secrets and variables → Actions →
   **Variables** tab → New repository variable, twice:
   `SUPABASE_URL` and `SUPABASE_ANON_KEY`. These two values are public by design (they end up inside
   the app); the rules in `schema.sql` are what protect the data. **Never** put the `service_role`
   key anywhere in this repo or in the app.
5. **Run the build** (push to main, or Actions → Android APK → Run workflow) and install it.
6. **Email sending limit.** The built-in sender is limited to a handful of emails per hour for the
   whole project. That is enough for you and one test account. Before inviting other people, add a
   custom SMTP sender (Authentication → Emails → SMTP Settings; Resend and Brevo both have free tiers).

## Running it

- Trusted people skip the confirmation wait: Authentication → Users → copy the user's ID → Table Editor →
  `trusted_users` → insert row. Do this for yourself first.
- Block someone who posts spam: same, in `banned_users`.
- Remove a bad show: Table Editor → `submissions` → set `status` to `removed`.
- A person can post 5 shows per 24 hours (30 if trusted). Three different people reporting a show removes it.
- The free plan pauses a project after a week with no activity; open the dashboard to resume it.

## What the rules do not stop

- One person with two email addresses can confirm their own submission. Trusted/banned lists and the
  report threshold are the defenses; if abuse shows up, require confirmations from accounts that are
  more than a few days old.
- The share button on Instagram only passes a link. Pull Up cannot read the post's caption or flyer, so
  the person types in the details and the link is kept as the source.
