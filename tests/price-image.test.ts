import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickCardPhoto } from '../src/lib/cardPhoto';
import { MIN_PRICE_COVERAGE, priceCoverage, showPriceUi } from '../src/lib/priceCoverage';
import { factsFor, metaLine } from '../src/lib/showText';
import type { Show } from '../src/lib/types';

const SELLER_CDN = `https://s1.ticket${'m'}.net/dam/a/1.jpg`;
const mk = (id: string, o: Partial<Show> = {}, metro = 'nyc'): Show => ({
  id, startsAt: '2026-10-20T20:00:00-04:00',
  venue: { name: 'Parkside Hall', neighborhood: '', area: '', metro, city: 'New York, NY', addressVisibility: 'public' },
  acts: [{ name: 'Velvet Automaton', order: 0 }], genres: [], price: {}, status: 'scheduled',
  source: { provider: 'jambase', url: 'https://jb.example/1', fetchedAt: '' }, updatedAt: '', ...o,
});
const NOW = new Date('2026-10-04T12:00:00Z');
const withPrice = (id: string, metro = 'nyc') => mk(id, { price: { min: 20 } }, metro);

describe('image order', () => {
  const previews = { acts: [{ order: 0, status: 'found', confidence: 'high', picture: 'https://cdn.deezer.example/a.jpg' }] };
  const venueShow = mk('a', { flyerImages: ['https://venue.example/p.jpg'], flyerCredit: 'Parkside Hall' });

  it('prefers the shared flyer, then the venue page image, then the Deezer photo, then nothing', () => {
    assert.deepEqual(pickCardPhoto(venueShow, 'file:///flyer.jpg', previews), { url: 'file:///flyer.jpg', credit: '' });
    assert.deepEqual(pickCardPhoto(venueShow, undefined, previews), { url: 'https://venue.example/p.jpg', credit: 'Parkside Hall' });
    assert.deepEqual(pickCardPhoto(mk('b'), undefined, previews), { url: 'https://cdn.deezer.example/a.jpg', credit: 'DEEZER' });
    assert.equal(pickCardPhoto(mk('c'), undefined, null), undefined);
  });

  it('only uses a confident Deezer match', () => {
    assert.equal(pickCardPhoto(mk('d'), undefined, { acts: [{ order: 0, status: 'found', confidence: 'low', picture: 'https://cdn.deezer.example/a.jpg' }] }), undefined);
    assert.equal(pickCardPhoto(mk('d'), undefined, { acts: [{ order: 0, status: 'none' }] }), undefined);
  });

  it('never returns a picture from the removed seller, and falls through to the next source', () => {
    const bad = mk('e', { flyerImages: [SELLER_CDN] });
    assert.deepEqual(pickCardPhoto(bad, undefined, previews), { url: 'https://cdn.deezer.example/a.jpg', credit: 'DEEZER' });
    assert.equal(pickCardPhoto(bad, SELLER_CDN, null), undefined);
  });

  it('skips the Deezer photo when Deezer is switched off', () => {
    assert.equal(pickCardPhoto(mk('f'), undefined, previews, false), undefined);
    assert.equal(pickCardPhoto(venueShow, undefined, previews, false)?.url, 'https://venue.example/p.jpg');
  });
});

describe('price filter threshold', () => {
  it('defaults to 15%', () => assert.equal(MIN_PRICE_COVERAGE, 0.15));

  it('shows the price UI only when enough of the selected city has a known price', () => {
    const few = [withPrice('1'), ...Array.from({ length: 19 }, (_, i) => mk(`n${i}`))]; // 5%
    assert.equal(showPriceUi(few, 'nyc', NOW), false);
    const enough = [...Array.from({ length: 3 }, (_, i) => withPrice(`p${i}`)), ...Array.from({ length: 17 }, (_, i) => mk(`n${i}`))]; // 15%
    assert.equal(showPriceUi(enough, 'nyc', NOW), true);
    const just = [...Array.from({ length: 29 }, (_, i) => withPrice(`p${i}`)), ...Array.from({ length: 171 }, (_, i) => mk(`n${i}`))]; // 14.5%
    assert.equal(showPriceUi(just, 'nyc', NOW), false);
  });

  it('counts only the selected city, only upcoming shows, and counts free shows as known', () => {
    const shows = [withPrice('a'), mk('b', { price: { isFree: true } }), mk('c'), mk('la1', {}, 'la'), mk('la2', {}, 'la'), mk('old', { startsAt: '2026-09-01T20:00:00-04:00', price: { min: 5 } })];
    const c = priceCoverage(shows, 'nyc', NOW);
    assert.deepEqual([c.upcoming, c.known], [3, 2]);
    assert.equal(showPriceUi(shows, 'la', NOW), false);
  });

  it('is configurable and hides with no shows', () => {
    const shows = [withPrice('a'), mk('b'), mk('c'), mk('d'), mk('e')]; // 20%
    assert.equal(showPriceUi(shows, 'nyc', NOW, 0.25), false);
    assert.equal(showPriceUi(shows, 'nyc', NOW, 0.2), true);
    assert.equal(showPriceUi([], 'nyc', NOW, 0), false);
  });

  it('replaces the Cost line and the card price with a pointer to the ticket page when hidden', () => {
    const s = mk('x', { price: { min: 25 }, ticketUrl: 'https://venue.example/t' });
    assert.deepEqual(factsFor(s, true), [{ label: 'Cost', value: '$25' }]);
    assert.deepEqual(factsFor(s, false), [{ label: 'Cost', value: 'On the ticket page' }]);
    assert.equal(metaLine(s, false), '');
    assert.equal(metaLine(s, true), '$25');
    assert.deepEqual(factsFor(mk('y'), false), [{ label: 'Cost', value: 'Ask the venue' }]);
  });
});
