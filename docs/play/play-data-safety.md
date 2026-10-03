# Play Console: Data safety answers (draft)

Fill in Play Console → App content → Data safety. These answers come from an audit of the code in this repo on 2026-10-02.
Re-check them whenever the app gains a new network call, SDK or permission. Statements about how Google's form is interpreted are
[inference] from Google's published guidance as remembered; confirm against the form's help text as you fill it in.

## Top-level questions

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (HTTPS to Supabase, GitHub, Deezer, image hosts) |
| Do you provide a way for users to request that their data is deleted? | Yes |
| Account creation methods | Email with a one-time code (optional; only for Community) |
| Delete account URL | `https://hbnmusic.github.io/Show-up-app/delete-account.html` (after enabling GitHub Pages) |
| Data deletion: can users request deletion of some data without deleting the account? | No (they can remove their own shows from the Community screen; that is optional to mention) |
| Independent security review | No |

## Data types

| Play category → type | Collected? | Shared? | Purpose | Required or optional | Encrypted in transit | Deletable by user |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info → Email address | Yes, only if the person signs in | No | Account management | Optional (needed only to add or confirm community shows) | Yes | Yes (in-app or web) |
| App activity → Other user-generated content (shows people submit: bands, venue, date, price, links, genres) | Yes | No (see note 1) | App functionality | Optional | Yes | Yes for shows no one else confirmed; shows another person confirmed stay without the author (stated in the privacy policy and on the deletion page) |
| App activity → Other actions (confirmations, reports, blocks, Terms acceptance with version and time) | Yes | No | App functionality; fraud prevention, security and compliance | Optional | Yes | Yes |
| Location → Approximate location | **No** (note 2) | No | n/a | n/a | n/a | n/a |
| Location → Precise location | No (permission removed from the app) | No | n/a | n/a | n/a | n/a |
| Device or other IDs | No | No | n/a | n/a | n/a | n/a |
| Messages, photos, videos, audio, files, contacts, calendar, health, financial info | No | No | n/a | n/a | n/a | n/a |
| App info and performance (crash logs, diagnostics) | No (no crash reporting or analytics) | No | n/a | n/a | n/a | n/a |
| Web browsing, search history, installed apps | No | No | n/a | n/a | n/a | n/a |

## Notes behind the answers

1. **Shown to other users is not "sharing" in the form.** Submitted shows are displayed to other people in the app, without the
   author's name or email. Google's definition of "sharing" is transfer to a third party; display inside the app to other users is
   generally not counted [inference]. Supabase hosts the data as our service provider, which Google treats as processing on our behalf,
   not sharing [inference].
2. **Location is read on the device and never leaves it.** The app asks for approximate location (permission `ACCESS_COARSE_LOCATION`),
   reads one position, maps it to the nearest covered city on the phone, and stores only the resulting city/coordinates in local app
   storage. Nothing is sent to a server. Google's form says data processed only on the device and not sent off it is not "collected"
   [inference]; if you prefer to be conservative, declare Approximate location as collected, not shared, purpose App functionality,
   optional, and note the privacy policy says it stays on the phone.
3. **Third-party requests.** The app sends artist names (and the phone's IP address, as any web request does) to Deezer to fetch previews
   and photos, and loads listings from GitHub and images from JamBase, Ticketmaster and Deezer servers. No account data goes to them.
   Artist names from public listings are not personal data. IP addresses seen by these servers are the ordinary web-request exchange;
   Google's help text says to declare data a third party receives through the app's code unless an exception applies [inference]. The
   conservative answer is to leave Device or other IDs as "No" because the app collects no identifier, and rely on the privacy policy
   (which discloses it). Re-read the form's exceptions before submitting.
4. **No ads, no analytics, no tracking SDKs.** Confirmed in `package.json` and the source tree; keep it that way or update this file.
5. **Data on the device** (Going list, passes, filters, saved listings, session token) is stored in app storage, and `allowBackup` is
   false, so it is not copied to Google Drive backups.

## Other declarations to make in Play Console

- **App access:** Community features need an email sign-in code. Give reviewers a way in (see `store-listing.md` → Reviewer access).
- **Ads:** No ads.
- **Target audience and content:** see `content-rating.md`.
- **News app, COVID-19, government, financial, health:** none apply.
- **User-generated content:** the app has in-app reporting (show and person), blocking, Terms acceptance before posting, and a moderation
  runbook (`supabase/MODERATION.md`); these meet Google's UGC requirements as written in the policy [inference].
- **Permissions:** the final manifest permissions are `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `INTERNET`, `ACCESS_NETWORK_STATE`,
  `VIBRATE`, `MODIFY_AUDIO_SETTINGS`, `RECEIVE_BOOT_COMPLETED` (reminders survive a restart). None need a Play permission declaration form.
