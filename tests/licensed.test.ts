import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { enrichShow, type TmEvent } from '../src/lib/listings/ticketmaster';
import { cleanShow } from '../src/lib/listings/validate';
import { applySwitches, applySwitchesToAll, DEFAULT_LICENSED, parseSwitches, purgeLicensed } from '../src/lib/licensed';
import type { Show } from '../src/lib/types';

const base: Show = {
  id: 'jb-1', startsAt: '2026-10-16T20:00:00-04:00', venue: { name: 'Parkside Hall', neighborhood: '', area: 'Brooklyn', metro: 'nyc', city: 'Brooklyn, NY', addressVisibility: 'public' },
  acts: [{ name: 'Velvet Automaton', order: 0 }], genres: [], price: {}, status: 'scheduled', source: { provider: 'jambase', url: 'https://jb.example/1', fetchedAt: '2026-10-03T00:00:00Z' }, updatedAt: '2026-10-03T00:00:00Z',
};
const tmEvent = { price: { min: 25, max: 25 }, image: 'https://tm.example/p.jpg', url: 'https://www.ticketmaster.com/e/1' } as unknown as TmEvent;

describe('licensed layer', () => {
  it('Ticketmaster enrichment stamps which fields it supplied', () => {
    const { show } = enrichShow(base, tmEvent);
    assert.deepEqual(show.fieldSources, { price: 'ticketmaster', image: 'ticketmaster', ticketUrl: 'ticketmaster' });
    assert.equal(cleanShow(JSON.parse(JSON.stringify(show)))!.fieldSources?.price, 'ticketmaster');
    assert.equal(cleanShow(JSON.parse(JSON.stringify(base)))!.fieldSources, undefined);
  });

  it('does not stamp fields JamBase already had', () => {
    const { show } = enrichShow({ ...base, price: { min: 20, max: 20 }, flyerImages: ['https://jb.example/p.jpg'], ticketUrl: 'https://venue.example/t' }, tmEvent);
    assert.equal(show.fieldSources, undefined);
  });

  it('defaults keep everything; each switch turns off only its own family', () => {
    const { show } = enrichShow({ ...base, price: {} }, tmEvent);
    assert.equal(applySwitches(show, DEFAULT_LICENSED), show);
    const noPrice = applySwitches(show, { ...DEFAULT_LICENSED, ticketmaster_price: false })!;
    assert.deepEqual(noPrice.price, {});
    assert.equal(noPrice.flyerImages?.length, 1);
    const noPhoto = applySwitches(show, { ...DEFAULT_LICENSED, ticketmaster_photo: false })!;
    assert.equal(noPhoto.flyerImages, undefined);
    assert.deepEqual(noPhoto.price, { min: 25, max: 25 });
    const noLink = applySwitches(show, { ...DEFAULT_LICENSED, ticketmaster_link: false })!;
    assert.equal(noLink.ticketUrl, undefined);
    assert.equal(applySwitches(show, { ...DEFAULT_LICENSED, jambase_listings: false }), null);
  });

  it('recognises Ticketmaster photos and links on feeds written before stamping', () => {
    const old: Show = { ...base, flyerImages: ['https://tm.example/p.jpg'], flyerCredit: 'TICKETMASTER', ticketUrl: 'https://www.ticketmaster.com/e/9' };
    const r = applySwitches(old, { ...DEFAULT_LICENSED, ticketmaster_photo: false, ticketmaster_link: false })!;
    assert.equal(r.flyerImages, undefined);
    assert.equal(r.ticketUrl, undefined);
    const own: Show = { ...base, ticketUrl: 'https://venue.example/t', flyerImages: ['https://jb.example/p.jpg'] };
    assert.equal(applySwitches(own, { ...DEFAULT_LICENSED, ticketmaster_link: false, ticketmaster_photo: false })!.ticketUrl, 'https://venue.example/t');
  });

  it('purge removes a source from feed data: Ticketmaster fields, or JamBase listings', () => {
    const tm = enrichShow({ ...base, id: 'jb-2' }, tmEvent).show;
    const community: Show = { ...base, id: 'c-1', source: { provider: 'community', url: '', fetchedAt: '' } };
    const r = purgeLicensed([tm, base, community], 'ticketmaster');
    assert.equal(r.changed, 1);
    assert.equal(r.shows[0].fieldSources, undefined);
    assert.equal(r.shows[0].flyerImages, undefined);
    assert.equal(r.shows[0].ticketUrl, undefined);
    const jb = purgeLicensed([tm, base, community], 'jambase');
    assert.deepEqual(jb.shows.map((s) => s.id), ['c-1']);
    assert.equal(jb.changed, 2);
    assert.equal(applySwitchesToAll([tm, base, community], { ...DEFAULT_LICENSED, jambase_listings: false }).length, 1);
  });

  it('reads switch values from the server, treating anything missing as on', () => {
    assert.deepEqual(parseSwitches({ ticketmaster_photo: false }), { ...DEFAULT_LICENSED, ticketmaster_photo: false });
    assert.deepEqual(parseSwitches(null), DEFAULT_LICENSED);
    assert.deepEqual(parseSwitches({ jambase_listings: 'no' }), DEFAULT_LICENSED);
  });
});
