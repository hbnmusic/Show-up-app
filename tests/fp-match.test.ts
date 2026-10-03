import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applySwitches, DEFAULT_SWITCHES, imageChain } from '../supabase/functions/_shared/licensed.ts';
import { cluster, mergeAll, nightOf, sameShow, sourcesLine } from '../supabase/functions/_shared/match.ts';
import { canSpend, backoffSeconds, planRetry, quotaDay, submitLimit } from '../supabase/functions/_shared/quota.ts';
import { cleanActName, similarity } from '../supabase/functions/_shared/text.ts';
import { licenceFor, type Candidate, type SourceType } from '../supabase/functions/_shared/types.ts';

const cand = (sourceType: SourceType, o: Partial<Candidate> = {}): Candidate => ({
  sourceType,
  licence: licenceFor(sourceType),
  fetchedAt: '2026-10-03T12:00:00Z',
  metro: 'nyc',
  venueId: 'v-parkside',
  venueName: 'Parkside Hall',
  localDate: '2026-10-16',
  headliner: 'Velvet Automaton',
  supports: [],
  genres: [],
  addressMode: 'registry',
  ...o,
});

describe('matching', () => {
  it('matches the same venue, night and headliner across sources', () => {
    assert.equal(sameShow(cand('flyer'), cand('jambase', { headliner: 'VELVET AUTOMATON' })), true);
    assert.equal(sameShow(cand('flyer'), cand('jambase', { localDate: '2026-10-17' })), false);
    assert.equal(sameShow(cand('flyer'), cand('jambase', { venueId: 'v-other', venueName: 'Other Room' })), false);
  });

  it('matches when sources list the support acts in a different order', () => {
    const a = cand('flyer', { headliner: 'Gentle Moth', supports: ['Velvet Automaton', 'Tin Orchard'] });
    const b = cand('venue_site', { headliner: 'Velvet Automaton', supports: ['Tin Orchard', 'Gentle Moth'] });
    assert.equal(sameShow(a, b), true);
    const merged = mergeAll([a, b]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].headliner, 'Velvet Automaton'); // the venue site's order wins
    assert.deepEqual(merged[0].supports, ['Tin Orchard', 'Gentle Moth']);
  });

  it('treats "X presents" and tour suffixes as the same act', () => {
    assert.equal(cleanActName('Parkside Hall presents: Velvet Automaton'), 'Velvet Automaton');
    assert.equal(cleanActName('Velvet Automaton Live'), 'Velvet Automaton');
    assert.equal(sameShow(cand('venue_site', { headliner: 'Parkside Hall presents: Velvet Automaton' }), cand('ticketmaster')), true);
    assert.equal(similarity('Velvet Automaton', 'Velvet Orchestra') < 0.8, true);
  });

  it('keeps early and late shows separate and matches each to its own records', () => {
    const early = cand('venue_site', { startLocal: '18:00' });
    const late = cand('venue_site', { startLocal: '22:00' });
    assert.equal(sameShow(early, late), false);
    const groups = cluster([early, late, cand('ticketmaster', { startLocal: '22:00' }), cand('jambase', { startLocal: '18:00' })]);
    assert.equal(groups.length, 2);
    const merged = mergeAll([early, late, cand('ticketmaster', { startLocal: '22:00' }), cand('jambase', { startLocal: '18:00' })]);
    assert.deepEqual(merged.map((m) => [m.startLocal, m.sources.length]).sort(), [['18:00', 2], ['22:00', 2]]);
  });

  it('keeps nights of a multi-night run as separate shows', () => {
    const nights = ['2026-10-16', '2026-10-17', '2026-10-18'].map((d) => cand('venue_site', { localDate: d, startLocal: '20:00' }));
    const m = mergeAll([...nights, cand('jambase', { localDate: '2026-10-17', startLocal: '20:00' })]);
    assert.equal(m.length, 3);
    assert.equal(m.find((x) => x.localDate === '2026-10-17')!.sources.length, 2);
  });

  it('counts a show starting after midnight as the previous night', () => {
    assert.equal(nightOf('2026-10-17', '00:30'), '2026-10-16');
    assert.equal(nightOf('2026-10-17', '20:00'), '2026-10-17');
    assert.equal(sameShow(cand('venue_site', { localDate: '2026-10-16', startLocal: '23:00' }), cand('jambase', { localDate: '2026-10-17', startLocal: '01:00' })), false); // 2 h apart is still two start times
    assert.equal(sameShow(cand('flyer', { localDate: '2026-10-16' }), cand('jambase', { localDate: '2026-10-17', startLocal: '00:30' })), true);
  });
});

describe('merge priorities and provenance', () => {
  const venue = cand('venue_site', { startLocal: '20:00', doorsLocal: '19:00', price: { min: 20, max: 20 }, ticketUrl: 'https://venue.example/t', sourceUrl: 'https://venue.example/e/1', imageUrl: 'https://venue.example/p.jpg' });
  const tm = cand('ticketmaster', { startLocal: '20:00', doorsLocal: '19:30', price: { min: 25, max: 25 }, ticketUrl: 'https://tm.example/t', imageUrl: 'https://tm.example/p.jpg' });
  const jb = cand('jambase', { startLocal: '20:30', doorsLocal: '19:30', ticketUrl: 'https://jb.example/t', status: 'scheduled' });
  const flyer = cand('flyer', { startLocal: '21:00', doorsLocal: '19:00', price: { min: 15, max: 15 }, ticketUrl: 'https://flyer.example/t' });

  it('times and doors: venue site > Ticketmaster > JamBase > flyer', () => {
    const m = mergeAll([flyer, jb, tm, venue])[0];
    assert.equal(m.startLocal, '20:00');
    assert.equal(m.doorsLocal, '19:00');
    assert.equal(m.fieldSource.start, 'venue_site');
    assert.equal(mergeAll([flyer, jb, tm])[0].startLocal, '20:00');
    assert.equal(mergeAll([flyer, jb, tm])[0].fieldSource.start, 'ticketmaster');
    assert.equal(mergeAll([flyer, jb])[0].startLocal, '20:30');
    assert.equal(mergeAll([flyer])[0].startLocal, '21:00');
  });

  it('price and ticket link: Ticketmaster > venue site > flyer', () => {
    const m = mergeAll([flyer, venue, tm])[0];
    assert.deepEqual(m.price, { min: 25, max: 25 });
    assert.equal(m.ticketUrl, 'https://tm.example/t');
    assert.equal(m.fieldSource.price, 'ticketmaster');
    const m2 = mergeAll([flyer, venue])[0];
    assert.deepEqual(m2.price, { min: 20, max: 20 });
    assert.equal(m2.fieldSource.ticketUrl, 'venue_site');
  });

  it('flags conflicts and records every value instead of resolving silently', () => {
    const m = mergeAll([flyer, jb, tm, venue])[0];
    const start = m.conflicts.find((c) => c.field === 'start')!;
    assert.deepEqual(start.values.map((v) => [v.source, v.value]), [['venue_site', '20:00'], ['jambase', '20:30'], ['flyer', '21:00']]);
    assert.ok(m.conflicts.some((c) => c.field === 'price'));
  });

  it('status: a JamBase or Ticketmaster cancel flag beats the venue site, and the disagreement is flagged', () => {
    const m = mergeAll([cand('venue_site', { status: 'scheduled' }), cand('ticketmaster', { status: 'cancelled' })])[0];
    assert.equal(m.status, 'cancelled');
    assert.equal(m.fieldSource.status, 'ticketmaster');
    assert.ok(m.conflicts.some((c) => c.field === 'status'));
    assert.equal(mergeAll([cand('venue_site', { status: 'moved' }), cand('jambase', { status: 'scheduled' })])[0].status, 'moved');
  });

  it('lineup: union ordered by the highest-priority source', () => {
    const m = mergeAll([cand('flyer', { supports: ['Tin Orchard'] }), cand('jambase', { supports: ['Gentle Moth', 'Tin Orchard'] })])[0];
    assert.deepEqual([m.headliner, ...m.supports], ['Velvet Automaton', 'Gentle Moth', 'Tin Orchard']);
  });

  it('lists the sources shown in the details line', () => {
    assert.equal(sourcesLine(mergeAll([flyer, tm, venue])[0]), "Venue's website, Ticketmaster, Shared flyer");
  });

  it('never overwrites a source record: merging leaves the inputs unchanged', () => {
    const before = JSON.stringify([flyer, jb, tm, venue]);
    mergeAll([flyer, jb, tm, venue]);
    assert.equal(JSON.stringify([flyer, jb, tm, venue]), before);
  });
});

describe('licensed switches', () => {
  const all = [cand('venue_site', { imageUrl: 'https://venue.example/p.jpg' }), cand('ticketmaster', { price: { min: 25, max: 25 }, ticketUrl: 'https://tm.example/t', imageUrl: 'https://tm.example/p.jpg' }), cand('jambase')];

  it('defaults keep everything on', () => {
    assert.equal(applySwitches(all, DEFAULT_SWITCHES).length, 3);
    assert.deepEqual(imageChain(all, DEFAULT_SWITCHES).map((i) => i.kind), ['venue', 'ticketmaster']);
  });

  it('turns off each family on its own', () => {
    assert.equal(applySwitches(all, { ...DEFAULT_SWITCHES, jambaseListings: false }).some((c) => c.sourceType === 'jambase'), false);
    const noPrice = applySwitches(all, { ...DEFAULT_SWITCHES, ticketmasterPrice: false }).find((c) => c.sourceType === 'ticketmaster')!;
    assert.equal(noPrice.price, undefined);
    assert.equal(noPrice.ticketUrl, 'https://tm.example/t');
    const noLink = applySwitches(all, { ...DEFAULT_SWITCHES, ticketmasterLink: false }).find((c) => c.sourceType === 'ticketmaster')!;
    assert.equal(noLink.ticketUrl, undefined);
    assert.deepEqual(imageChain(all, { ...DEFAULT_SWITCHES, ticketmasterPhoto: false }).map((i) => i.kind), ['venue']);
    const merged = mergeAll(applySwitches(all, { ...DEFAULT_SWITCHES, ticketmasterPrice: false, ticketmasterLink: false, ticketmasterPhoto: false }))[0];
    assert.equal(merged.price, undefined);
    assert.equal(merged.imageUrl, 'https://venue.example/p.jpg');
  });
});

describe('quota and queue', () => {
  it('keeps part of the daily cap for flyers', () => {
    const cfg = { dailyCap: 100, flyerReserveShare: 0.3 };
    assert.equal(canSpend('venue', { flyer: 0, venue: 69 }, cfg), true);
    assert.equal(canSpend('venue', { flyer: 0, venue: 70 }, cfg), false); // the last 30 are for flyers
    assert.equal(canSpend('flyer', { flyer: 0, venue: 70 }, cfg), true);
    assert.equal(canSpend('venue', { flyer: 30, venue: 70 }, cfg), false); // cap reached
    assert.equal(canSpend('venue', { flyer: 10, venue: 60 }, cfg), true); // 20 of the reserve still unused
    assert.equal(canSpend('flyer', { flyer: 40, venue: 60 }, cfg), false);
  });

  it('backs off on 429 and gives up after the attempt limit with a clear result', () => {
    assert.equal(backoffSeconds(1), 30);
    assert.equal(backoffSeconds(3), 120);
    assert.equal(backoffSeconds(20), 3600);
    assert.equal(backoffSeconds(1, 600), 600);
    const now = new Date('2026-10-03T12:00:00Z');
    assert.deepEqual(planRetry(2, now), { next: 'retry', atMs: now.getTime() + 60_000 });
    assert.deepEqual(planRetry(8, now), { next: 'give_up' });
  });

  it('resets the quota day at midnight Pacific', () => {
    assert.equal(quotaDay(new Date('2026-10-03T06:59:00Z')), '2026-10-02');
    assert.equal(quotaDay(new Date('2026-10-03T07:01:00Z')), '2026-10-03');
  });

  it('gives anonymous installs a lower daily limit', () => {
    assert.ok(submitLimit(true) < submitLimit(false));
  });
});
