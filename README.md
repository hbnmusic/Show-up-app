# Show Up

Swipe through upcoming NYC and North Jersey shows, hear a 30-second preview of
the bands on each flyer, and keep the ones you're going to in one list with
calendar export and reminders.

This is the v1 prototype from the *Show Discovery Deck — Spec v2*: the social
layer (people, matching, crews) is deliberately left out, and listings come
from a bundled sample file until a real source is chosen.

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

- **Deck** — swipe right for Going, left to pass, up for details. Tap the right
  or left half of a flyer to move between the poster and the info slide. Undo
  brings back the last card.
- **Previews** — the top card autoplays a 30-second preview of the headliner
  and steps through the bill; the next card's preview is preloaded. Long-press
  the audio bar (or tap *Possible match*) to report a wrong artist.
- **Filters** — when, where, venue type, genre, price and age, with quick chips
  above the deck. Changing filters never swaps the card you're listening to.
- **Going** — upcoming shows grouped Tonight / This week / Later, past shows
  with Went / Didn't go, and passed shows you can put back. Swipe a row left to
  drop it (with Undo).
- **Calendar** — opens the phone's own new-event form, pre-filled. No calendar
  permission needed.
- **Reminders** — local notifications at noon on show day and an hour before
  doors (day-before is optional). Rebuilt on every change and every app open,
  for the next 14 days.

## Known limits

- **Sample data.** 93 listings gathered on Sep 29, 2026 from public calendars
  (NYC Noise, DoNYC venue pages, JamBase). Genre tags are approximate; flyers
  are generated placeholders. Edit `src/data/shows.ts` to add shows.
- **Previews use Deezer's public API**, whose terms allow non-commercial use
  only. Fine for a private prototype; replace before any public release (see
  the spec's audio section). Common band names can match the wrong artist.
- **No server yet**, so a moved or cancelled show can't push an alert, and the
  Going list lives only on the phone.

## Develop

```bash
npm install
npm test          # logic tests (filters, reminders, preview matching)
npm run typecheck
npm run lint
npx expo start    # needs a development build: npx expo run:android
```

Code layout: routes in `src/app`, UI in `src/components`, logic in `src/lib`,
sample listings in `src/data/shows.ts`.
