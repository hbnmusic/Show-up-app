# Changelog

## 2026-10-09: renamed to Setnik

- New name, package id `com.setnik.app`, link scheme `setnik://`, bot user agent `SetnikBot`, storage keys `setnik-*`. This is a new app on the phone: nothing carries over from earlier builds.
- Database functions renamed with the `setnik_` prefix (migration 024, run by the owner). Terms version is now 2026-10-09.
- Hosting addresses are in `src/lib/hosting.ts` and `supabase/functions/_shared/hosting.ts` (the only places that change when the repository moves).
- Placeholder launcher, splash, notification and favicon images; Play icon and feature graphic drafts in `docs/play/assets/`.

## 2026-10-04: the Ticketmaster data source is removed

- Removed the Ticketmaster enrichment step, code, configuration, types, fixtures, tests and workflow references, including the `TICKETMASTER_API_KEY` secret name.
- Removed Ticketmaster-derived fields from the data model and the app: photo, price, age and ticket-link enrichment, the credit line, and the "Sources" mention.
- Licence layer now has one switch (`jambase_listings`). Migrations 016 and 017 retire the other switch rows and scrub stored photos and source links.
- The app never renders an image from a Ticketmaster domain, and feeds from older app versions are cleaned on load.
- Image order is now: shared flyer, the venue's own event image, Deezer artist photo, generated poster.
- The price filter and the "Cost" line show only where enough of the city's shows have a known price.
