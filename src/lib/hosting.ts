/**
 * Every address that depends on where the documentation site and the listings feed live.
 * The documentation pages are published on Google Sites (the repository's docs/ folder is the source copy).
 * Nothing else in the app hard-codes these addresses.
 */

/** Where the documentation pages are published, no trailing slash. Page addresses have no .html. */
export const DOCS_BASE_URL = 'https://sites.google.com/view/setnik';

/** The link shared with friends. Until there is a Play listing it is the site's home page. */
export const SHARE_URL = DOCS_BASE_URL;

// remove after repo move
/** Where the listings refresh job publishes each city's feed (a GitHub release); {metro} is the city id. */
export const LISTINGS_FEED_URL_TEMPLATE = 'https://github.com/hbnmusic/Show-up-app/releases/download/listings/shows-{metro}.json';
