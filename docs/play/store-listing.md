# Play Console: store listing

## Text

**App name** (max 30): `Come Thru`
Alternative if the name is taken: `Come Thru: Live Music Finder`

**Short description** (max 80; this one is 66):
```
Swipe through local shows, hear previews, and keep a list of gigs.
```

**Full description** (max 4000):
```
Find your next show without scrolling through listings.

Come Thru turns upcoming concerts in about 45 US and Canadian metro areas into a deck of cards. Swipe right on shows you want to go to, swipe left to pass, and spread two fingers (or tap the info) for the details.

HEAR WHO'S PLAYING
The top card plays a 30-second preview of the headliner and steps through the rest of the bill, so you can tell in a few seconds whether a show is for you.

FILTER THE WAY YOU THINK
Pick a city or use your approximate location, set how far you will travel, and filter by when, genre and price.

KEEP YOUR LIST
Shows you swipe right on go to your Going list, grouped by tonight, this week and later. Add a show to your calendar with one tap, and get reminders the day before, the day of, and an hour before doors.

ADD SHOWS WE MISSED
Know about a gig that is not listed? Sign in with your email (no password) and add it. A second person confirms it before it appears for everyone. You can report a show or a person, block people whose shows you do not want to see, and delete your account at any time.

PRIVATE BY DEFAULT
No account is needed to browse. Your location, Going list and filters stay on your phone. No ads. Optional anonymous usage statistics can be switched off in Settings.

For ages 18 and up. Listings come from JamBase, venue websites and people like you. Times, prices and lineups can change, so check the ticket page before you go. Previews come from Deezer and may not match when band names are common.
```
Review this before publishing: the "about 45 metro areas" figure comes from `src/lib/metros.ts`; confirm it is still accurate.

**Category:** Events (alternative: Music & Audio). **Tags:** concerts, live music, events.

**Contact details** (required): email `[CONTACT_EMAIL]`; website `https://hbnmusic.github.io/Show-up-app/`;
**Privacy policy URL:** `https://hbnmusic.github.io/Show-up-app/privacy.html`

## Reviewer access (App access section)

Browsing needs no sign-in. Community features need a one-time code sent by email, which reviewers cannot receive. Provide one of:
1. A dedicated mailbox (for example a new Gmail address used only for review) and its password in the "App access" instructions,
   with the steps: Settings → Add or confirm shows → enter that email → read the code from the inbox. Create the account once yourself
   and accept the Terms so the Community screens are reachable. Remember the sign-in email expires codes quickly; tell reviewers to
   request a fresh one.
2. Or state that all non-community functionality works without sign-in, and describe the Community flow in the instructions.
   Option 1 avoids rejection for "app functionality not accessible" [inference].

## Graphics and screenshot checklist

Specs are Google's published ones as I remember them [inference]; confirm in Play Console when uploading.

- [ ] **App icon** 512×512 PNG, 32-bit, up to 1 MB (use `assets/images/icon.png` if it is 1024×1024, export 512). No badges or "free" text.
- [ ] **Feature graphic** 1024×500 PNG or JPEG, no transparency. Keep key text away from the edges.
- [ ] **Phone screenshots**: at least 2, up to 8. 9:16 portrait, each side 320–3840 px. Suggested set, taken on a real phone with real listings:
  1. The deck on a card with the audio bar visible.
  2. A card's details (lineup, price, venue, "Report or block" row if you capture a community show).
  3. Filters (city, distance, genre, price).
  4. Going list grouped by Tonight / This week / Later.
  5. Add a show (Community) form.
  6. Settings → reminders.
- [ ] Screenshots must not show real people's emails, a stranger's account, or any third-party logo beyond what is on the listing.
- [ ] Optional: 7-inch and 10-inch tablet screenshots (only if you want the listing to show on tablets; the app is phone-oriented).
- [ ] Optional: promo video (YouTube URL).
- [ ] **Release notes** for the first release: "First release."
- [ ] **Privacy policy** page live and the placeholders filled in (see the README list in `docs/play/RELEASING.md`).
- [ ] **Data safety**, **content rating**, **target audience**, **ads**, **app access** forms completed (`play-data-safety.md`, `content-rating.md`).
- [ ] **Account deletion URL** entered in the Data safety form.
- [ ] Brand check: do not use JamBase or Deezer logos in the icon, feature graphic or screenshots' captions.
