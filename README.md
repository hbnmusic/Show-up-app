# Pull Up

Swipe through upcoming shows in about 45 US and Canadian metro areas, hear a 30-second preview of
the bands on each flyer, and keep the ones you're going to in one list with
calendar export and reminders.

This is the v1 prototype from the *Show Discovery Deck — Spec v2*: the social
layer (people, matching, crews) is deliberately left out. Listings come only
from the JamBase feed described below; there is no bundled sample data.

## Install on an Android phone

Every push to `main` builds an APK with GitHub Actions and attaches it to a
release named `build-N`.

1. On the phone, open **Releases** on this repo's GitHub page and pick the
   newest `build-N`.
2. Tap the `.apk` under **Assets** to download it.
3. Open the download. If Android asks, allow installs from your browser.

The APK is signed with a shared debug key, so each new build installs over the
previous one and keeps your Going list.

## What's in v1

- **Deck** — swipe right for Going, left to pass, spread two fingers (or tap the show info) for details. Tap the right
  or left half of a flyer to move between the poster and the info slide. Undo
  brings back the last card.
- **Previews** — the top card autoplays a 30-second preview of the headliner
  and steps through the bill; the next card's preview is preloaded. Long-press
  the audio bar (or tap *Possible match*) to report a wrong artist.
- **Filters** — when, where, genre and price, with quick chips
  above the deck. Changing filters never swaps the card you're listening to.
- **Going** — upcoming shows grouped Tonight / This week / Later, past shows
  with Went / Didn't go, and passed shows you can put back. Swipe a row left to
  drop it (with Undo).
- **Calendar** — opens the phone's own new-event form, pre-filled. No calendar
  permission needed.
- **Reminders** — local notifications at noon on show day and an hour before
  doors (day-before is optional). Rebuilt on every change and every app open,
  for the next 14 days.

## Listings

The app downloads one file per city (`shows-<city>.json`, cities listed in
`src/lib/metros.ts`) from the `listings` release of this repo, only for the city
it is centered on, and keeps a saved copy of each for offline use. On a first launch with no connection the deck
says it couldn't load shows and offers a retry.

The **Refresh listings** workflow builds that file every day from the
[JamBase Data API](https://data.jambase.com/):

1. Create a free Developer key at data.jambase.com.
2. In this repo: Settings > Secrets and variables > Actions > New repository
   secret, name `JAMBASE_API_KEY`.
3. Actions > Refresh listings > Run workflow > `full`.

The free plan allows 1,000 calls a month and requires attribution (the app
shows it in Settings and on each listing). Each run refreshes only the cities
that are due, most overdue first: large markets every two days, others weekly.
A new city is read in full, then again every 42 days to extend the date window;
in between it only asks for shows changed since its last sync. `state.json` in
the release keeps a running monthly call count, and the job stops at 900. Every
venue size is kept, and the script refuses to publish an empty or much smaller
feed for a city that already had listings. Run it by hand with
`JAMBASE_API_KEY=... npm run listings -- --metros nyc,la`.

`listings/manual.json` holds listings you add yourself (DIY nights JamBase
won't carry), in the same shape as `src/lib/types.ts` `Show`; they are merged
into every refresh.

Bandsintown and Last.fm are not wired in: Bandsintown's API only returns one
artist's own dates unless Bandsintown approves a partnership, and Last.fm's API
no longer has event methods.

## Known limits

- **Listings come from JamBase**, whose free plan is non-commercial. It has
  only broad genres, and it may not carry basement or house shows. The app no
  longer shows or filters by age policy or venue type. Flyers are generated placeholders.
- **Previews use Deezer's public API**, whose terms allow non-commercial use
  only. Fine for a private prototype; replace before any public release (see
  the spec's audio section). Common band names can match the wrong artist.
- **No server yet**, so a moved or cancelled show can't push an alert, and the
  Going list lives only on the phone.

## Develop

```bash
npm install
npm test          # filters, reminders, preview matching, listings pipeline, store
npm run typecheck
npm run lint
npx expo start    # needs a development build: npx expo run:android
```

Code layout: routes in `src/app`, UI in `src/components`, logic in `src/lib`,
listings pipeline in `src/lib/listings` and `scripts/fetch-listings.ts`, test
fixtures in `tests/fixtures`.


## Community shows (optional)

People can add shows the listings missed: from the + button, or by sharing an Instagram post or link to
Pull Up. A new show is visible only to its author until a second person confirms it (or someone else submits
the same show). Backed by Supabase; setup is in `supabase/SETUP.md`, the database in `supabase/schema.sql`.
Without `SUPABASE_URL` / `SUPABASE_ANON_KEY` build variables the feature is hidden.

## Google Play

The Play submission material is in `docs/`: public pages for GitHub Pages (`index.html`, `privacy.html`, `terms.html`,
`delete-account.html`), and `docs/play/` for the Data safety answers, content rating draft, store listing text and the release
guide (`RELEASING.md`, which also lists every placeholder to fill in). The signed bundle is built by the manual
**Android release (Play AAB)** workflow; the per-push APK workflow is unchanged. Moderation: `supabase/MODERATION.md`.
