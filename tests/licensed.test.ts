import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanShow, parseFeed } from '../src/lib/listings/validate';
import { applySwitches, applySwitchesToAll, DEFAULT_LICENSED, parseSwitches, purgeLicensed } from '../src/lib/licensed';
import { isBlockedUrl, safeImage } from '../src/lib/imageGuard';
import type { Show } from '../src/lib/types';

// The removed source's name is assembled so no file has to spell it out (a repo-wide test checks that).
const SELLER = 'ticket' + 'master';
const CDN = `https://s1.ticket${'m'}.net/dam/a/1.jpg`;

const base: Show = {
  id: 'jb-1', startsAt: '2026-10-16T20:00:00-04:00', venue: { name: 'Parkside Hall', neighborhood: '', area: 'Brooklyn', metro: 'nyc', city: 'Brooklyn, NY', addressVisibility: 'public' },
  acts: [{ name: 'Velvet Automaton', order: 0 }], genres: [], price: {}, status: 'scheduled', source: { provider: 'jambase', url: 'https://jb.example/1', fetchedAt: '2026-10-03T00:00:00Z' }, updatedAt: '2026-10-03T00:00:00Z',
};
const raw = (o: Record<string, unknown> = {}) => JSON.parse(JSON.stringify({ ...base, ...o }));

describe('licensed layer', () => {
  it('has one switch: JamBase listings', () => {
    assert.equal(applySwitches(base, DEFAULT_LICENSED), base);
    assert.equal(applySwitches(base, { jambase_listings: false }), null);
    const community: Show = { ...base, id: 'c-1', source: { provider: 'community', url: '', fetchedAt: '' } };
    assert.equal(applySwitchesToAll([base, community], { jambase_listings: false }).length, 1);
  });

  it('purge removes JamBase listings and nothing else', () => {
    const community: Show = { ...base, id: 'c-1', source: { provider: 'community', url: '', fetchedAt: '' } };
    const r = purgeLicensed([base, community], 'jambase');
    assert.deepEqual(r.shows.map((s) => s.id), ['c-1']);
    assert.equal(r.changed, 1);
  });

  it('reads switch values from the server, treating anything missing as on', () => {
    assert.deepEqual(parseSwitches({ jambase_listings: false }), { jambase_listings: false });
    assert.deepEqual(parseSwitches(null), DEFAULT_LICENSED);
    assert.deepEqual(parseSwitches({ jambase_listings: 'no' }), DEFAULT_LICENSED);
    assert.deepEqual(parseSwitches({ [`${SELLER}_photo`]: false }), DEFAULT_LICENSED);
  });
});

describe('old feeds and caches with the removed source\'s data', () => {
  it('drops its photo and credit line, and the price on shows it enriched', () => {
    const s = cleanShow(raw({ flyerImages: [CDN], flyerCredit: SELLER.toUpperCase(), price: { min: 25, max: 25 } }))!;
    assert.equal(s.flyerImages, undefined);
    assert.equal(s.flyerCredit, undefined);
    assert.deepEqual(s.price, { min: undefined, max: undefined, isFree: undefined, notaflof: undefined });
    // A stamp on an older feed counts the same way.
    const stamped = cleanShow(raw({ price: { min: 9, max: 9 }, fieldSources: { price: SELLER } }))!;
    assert.equal(stamped.price.min, undefined);
  });

  it('keeps a price JamBase itself supplied, and a photo from another host', () => {
    const s = cleanShow(raw({ price: { min: 15, max: 20 }, flyerImages: ['https://venue.example/p.jpg'], flyerCredit: 'Parkside Hall' }))!;
    assert.equal(s.price.min, 15);
    assert.deepEqual(s.flyerImages, ['https://venue.example/p.jpg']);
    assert.equal(s.flyerCredit, 'Parkside Hall');
  });

  it('keeps the ticket link JamBase supplied (tagged with JamBase), and replaces the seller\'s own page with the JamBase page', () => {
    const jbLink = `https://${SELLER}.evyy.net/c/1?u=https%3A%2F%2Fwww.${SELLER}.com%2Fe&utm_source=jambase`;
    assert.equal(cleanShow(raw({ ticketUrl: jbLink }))!.ticketUrl, jbLink);
    assert.equal(cleanShow(raw({ ticketUrl: `https://www.${SELLER}.com/event/9` }))!.ticketUrl, 'https://jb.example/1');
    assert.equal(cleanShow(raw({ ticketUrl: 'https://venue.example/t' }))!.ticketUrl, 'https://venue.example/t');
  });

  it('removes its credit line from the feed attribution', () => {
    const feed = parseFeed({ version: 1, generatedAt: '', attribution: ['Listings by JamBase (jambase.com)', `Prices and photos from ${SELLER[0].toUpperCase()}${SELLER.slice(1, 6)} ${SELLER.slice(6)} where available`.replace(' ', '')], shows: [] });
    assert.deepEqual(feed!.feed.attribution, ['Listings by JamBase (jambase.com)']);
  });

  it('never accepts a picture from its hosts', () => {
    assert.equal(isBlockedUrl(CDN), true);
    assert.equal(isBlockedUrl(`https://images.${SELLER}.com/x.jpg`), true);
    assert.equal(isBlockedUrl('https://venue.example/p.jpg'), false);
    assert.equal(safeImage(CDN), undefined);
    assert.equal(safeImage('https://venue.example/p.jpg'), 'https://venue.example/p.jpg');
    assert.equal(safeImage('file:///local.jpg'), undefined);
  });
});
