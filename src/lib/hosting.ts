/**
 * Every address that depends on where the repository and its GitHub Pages site live.
 * After the repository is moved to a new organization (or a custom domain is set up), change ONLY the three
 * constants below. Nothing else in the app hard-codes these addresses.
 */

// remove after repo move
/** Where docs/ is published (GitHub Pages), no trailing slash. */
export const DOCS_BASE_URL = 'https://hbnmusic.github.io/Show-up-app';

// remove after repo move
/** The link shared with friends. Until there is a Play listing it is the docs home page. */
export const SHARE_URL = DOCS_BASE_URL;

// remove after repo move
/** Where the listings refresh job publishes each city's feed (a GitHub release); {metro} is the city id. */
export const LISTINGS_FEED_URL_TEMPLATE = 'https://github.com/hbnmusic/Show-up-app/releases/download/listings/shows-{metro}.json';
