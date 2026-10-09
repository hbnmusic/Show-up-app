# Play Console: Data safety answers (draft)

Fill in Play Console → App content → Data safety. These answers come from an audit of the code in this repo on 2026-10-02, corrected on 2026-10-06 (Device or other IDs and User IDs rows).
Re-check them whenever the app gains a new network call, SDK or permission. Statements about how Google's form is interpreted are
[inference] from Google's published guidance as remembered; confirm against the form's help text as you fill it in.

## Top-level questions

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (HTTPS to Supabase, GitHub, Deezer, image hosts) |
| Do you provide a way for users to request that their data is deleted? | Yes |
| Account creation methods | Email with a one-time code (optional; only for Community) |
| Delete account URL | `https://sites.google.com/view/setnik/delete-account` |
| Data deletion: can users request deletion of some data without deleting the account? | No (they can remove their own shows from the Community screen; that is optional to mention) |
| Independent security review | No |

## Data types

| Play category → type | Collected? | Shared? | Purpose | Required or optional | Encrypted in transit | Deletable by user |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info → Email address | Yes: the sign-in email (Community), and the optional contact email typed into the feedback form | No | Account management; Developer communications (feedback reply) | Optional | Yes | Sign-in email: yes, in-app or web. Feedback contact email: on request by email |
| Personal info → User IDs (the Supabase user id of a signed-in account, and of the anonymous account created when someone shares a flyer without signing in; no email on an anonymous account) | Yes, only after sign-in or a flyer share | No | App functionality; Account management; fraud prevention, security and compliance | Optional (Community and flyer sharing only) | Yes | Yes: delete account removes the account and its flyer jobs |
| App activity → Other user-generated content (shows people submit: bands, venue, date, price, links, genres) | Yes | No (see note 1) | App functionality | Optional | Yes | Yes for shows no one else confirmed; shows another person confirmed stay without the author (stated in the privacy policy and on the deletion page) |
| App activity → Other actions (confirmations, reports, blocks, Terms acceptance with version and time) | Yes | No | App functionality; fraud prevention, security and compliance | Optional | Yes | Yes |
| App activity → Other user-generated content (flyer text and shared links) | Yes, only when someone shares a flyer | **Yes: recognised text only, to Google (Gemini API free tier)** (note 6) | App functionality | Optional | Yes | Yes: deleting the account deletes flyer jobs; OCR text is cleared 14 days after processing |
| Location → Approximate location | **No** (note 2) | No | n/a | n/a | n/a | n/a |
| Location → Precise location | No (permission removed from the app) | No | n/a | n/a | n/a | n/a |
| Device or other IDs | **Yes**: the random install id and the random going id (the two "Other identifier" rows below). Not an advertising id, not a hardware id (IMEI, serial, Android id). Tick the category and fill in those two rows | No | see rows below | | | |
| Messages, photos, videos, audio, files, contacts, calendar, health, financial info | No | No | n/a | n/a | n/a | n/a |
| App activity → App interactions (screens viewed, swipes, filters, feature use; see `src/lib/analyticsCore.ts`) | Yes | No | Analytics | Optional (Settings switch; on by default) | Yes | Yes: turning the switch off deletes the events already sent |
| Device or other IDs → Other identifier (random install id made by the app; not an advertising id, not a device id, not linked to the account) | Yes | No | Analytics; App functionality (rate limiting feedback) | Optional | Yes | Yes (same switch deletes the events; feedback rows keep it until deleted on request) |
| App activity → Other actions (Going list entries: random going id + show id + show date, for the anonymous "N going" counts) | Yes | No (note 10) | App functionality | Optional (Settings switch "Include my Going in public counts"; on by default) | Yes | Yes: the switch off, or Reset all data, deletes this phone's rows; otherwise deleted 7 days after the show |
| Device or other IDs → Other identifier (the random going id; separate from the analytics install id; not an advertising id, not linked to the account) | Yes | No | App functionality | Optional | Yes | Same as the row above |
| Messages → Other in-app messages (feedback and bug reports) | Yes, only if the person sends feedback | No | App functionality (developer communications) | Optional | Yes | On request by email; kept up to 24 months |
| App info and performance → Diagnostics (app version, Android version, device model, attached to feedback; app and Android version also sent with usage events) | Yes | No | Analytics; App functionality | Optional | Yes | Same as above |
| App info and performance → Crash logs | No (no crash reporting SDK) | No | n/a | n/a | n/a | n/a |
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
   and photos, and loads listings from GitHub and images from venue websites and Deezer servers. No account data goes to them.
   Artist names from public listings are not personal data. IP addresses seen by these servers are the ordinary web-request exchange;
   Google's help text says to declare data a third party receives through the app's code unless an exception applies [inference]. The
   app also sends its own random install id and going id (declared under Device or other IDs above), so that category is **Yes**. The IP
   address that Deezer, GitHub and image hosts see is the ordinary web-request exchange; the conservative course is to rely on the
   Privacy Policy, which discloses it. Re-read the form's exceptions before submitting.
4. **No ads and no third-party analytics or tracking SDKs.** Usage statistics are first-party: the app calls `log_events` on your own Supabase project (readable only by you). The event list is `EVENT_NAMES` in `src/lib/analyticsCore.ts`, and the server rejects any other name. Add a new data type here before adding events that carry anything new.
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
  `VIBRATE`, `MODIFY_AUDIO_SETTINGS`, `RECEIVE_BOOT_COMPLETED` (reminders survive a restart). The background task library (WorkManager) may merge in `WAKE_LOCK` [inference; check the final manifest of the built APK]. None need a Play permission declaration form.

6. **Flyer sharing and Gemini.** Flyer images are read by ML Kit text recognition on the phone and never leave it. The app removes emails,
   phone numbers, social handles and social links from the recognised text, then sends the rest to our Supabase Edge Function, which
   sends it (not the image) to the Gemini API on the free tier. The free-tier terms allow Google to use inputs and outputs to improve
   its products and human reviewers to read them [inference from Google's published terms; re-read before submitting]. Because the text
   goes to a third party for a purpose beyond pure service processing, the conservative form answer is "shared" for that row. Billing on
   the Google project must stay disabled; if it is ever enabled the terms change. Retention: OCR text cleared 14 days after the job
   finishes; job records deleted after 90 days. Anonymous submissions use a Supabase anonymous account (no email; counts as an account
   identifier). Venue pages are read server-side and contain no personal data.
7. **New analytics events** `flyer_shared`, `flyer_ocr`, `flyer_result`, `link_fetch`, `ai_quota` carry only counts, result codes and
   durations: no flyer text, names or links.
8. **Gemini free-tier terms checked on 2026-10-03** (ai.google.dev/gemini-api/terms): Google uses content submitted to the unpaid services and the
   responses to improve its products; human reviewers may read, annotate and process input and output (disconnected from the account, key and
   project); the terms say not to submit sensitive, confidential or personal information; and the unpaid services may not be used in an
   application "directed towards or likely to be accessed by individuals under the age of 18". Setnik is 18+ (Terms, store rating, sign-in
   text), but a public app can still be reached by minors, so the owner must decide whether that risk is acceptable. The only way out is a
   paid service, which this project does not use (stop and decide before enabling billing).
9. **Local retention notifications ("new shows", "shows tonight").** Created on the phone by a background task (Expo background task on
   Android WorkManager, best effort, at most every couple of hours and only when the system allows). The task reads the saved listings,
   downloads the selected city's public listing file if it is due (the same file the app downloads when opened), and schedules a local
   notification. No new data is collected or sent: no push service, no FCM, no server-side targeting. The genre and counts are worked out on the
   phone; Going swipes stay on the phone. Each kind has its own Android channel and its own switch in Settings; both stay off until the person
   allows notifications (asked right after the first Going swipe, as before). The three analytics events `notif_scheduled`,
   `notif_opened` and `notif_setting_changed` carry only the kind (`A` or `B`, or `on`/`off`), no show, city, genre or count, and fall under
   the existing "app activity" answer for anonymous usage events: no change to the form answers.

10. **Going counts ("N going").** The app sends a random going id (made on the phone, stored only there, separate from the analytics install id and
    from any account), the show id, and the show's date to `set_going`; Supabase stores one row per going id per show. Clients cannot read the
    tables; only the three functions exist (`set_going`, `forget_my_going`, `get_going_counts`). Counts are shown only when 16 or more; rows are
    deleted 7 days after the show; the Settings switch deletes this phone's rows. The count is of installs, not people. Recommended answers, assuming the Going switch
    stays **default ON** with the one-time inline note (decided 2026-10-06; wording of Google's form is [inference] from memory, confirm in the form):

    | Question | Recommended answer | Reason and residual risk |
    | --- | --- | --- |
    | Is the going id under Device or other IDs? | Yes, declare it (as the table above does), together with the analytics install id | It identifies one install and is stored on the server; not an advertising id, not linked to the account. Declaring it costs nothing and avoids a mismatch. |
    | Collected or only counted? | **Collected** | It is stored on our server (one row per going id per show), so the form treats it as collected. |
    | Shared with third parties? | **No** | Supabase is our processor; no one else receives it. |
    | Required or optional? | **Optional (users can choose)** | The Settings switch "Include my Going in public counts" turns it off and deletes this phone's rows. Residual risk: with default ON the first Going is sent before the person has used the switch. The inline note (shown once, at the first Going, with a link to Settings) and the Privacy Policy are the disclosure; Google may judge that disclosure should come before collection. If a review objects, the fix is a Play-build default of OFF, a one-line change. |
    | Purpose | App functionality | Used only to show "N going". Not analytics, not advertising, not personalization. |
    | Deletable by the user? | **Yes** | Switch off or Reset all data deletes this phone's rows; otherwise rows are deleted 7 days after the show. Account deletion does not touch them (not linked to the account); the Privacy Policy and deletion page say so. |
    | Encrypted in transit? | Yes | HTTPS to Supabase. |
    | Does a share-to-friend action collect anything? | No | The text goes through the Android share sheet; nothing is sent to us. The analytics event `show_shared` (surface and completed only) falls under "App interactions". |
