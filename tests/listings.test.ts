/// <reference types="node" />
/**
 * Listings pipeline tests. The JamBase records below are built from JamBase's
 * published schema, not captured from the live API, so they prove the mapper
 * follows the documented shape; the first real fetch is what proves the shape.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { areaFor, mapGenres, mapJamBaseEvent } from '../src/lib/listings/jambase';
import { dedupeKey, dedupeShows, mergeFeed, withRetained } from '../src/lib/listings/merge';
import { buildFeed, collect, sanityProblem } from '../src/lib/listings/pipeline';
import { localToIso } from '../src/lib/listings/tz';
import { cleanShow, parseFeed } from '../src/lib/listings/validate';
import type { Show } from '../src/lib/types';

const OPTS = { fetchedAt: '2026-09-30T02:00:00.000Z', maxCapacity: 1500 };

function concert(over: Record<string, unknown> = {}) {
  return {
    '@type': 'Concert',
    identifier: 'jambase:1001',
    name: 'Krallice at Saint Vitus',
    url: 'https://www.jambase.com/show/krallice-1001',
    eventStatus: 'scheduled',
    startDate: '2026-10-05T19:00:00',
    doorTime: '2026-10-05T18:00:00',
    dateModified: '2026-09-29T12:00:00',
    location: {
      name: 'Saint Vitus',
      maximumAttendeeCapacity: 250,
      address: {
        streetAddress: '1120 Manhattan Ave',
        addressLocality: 'Brooklyn',
        addressRegion: { '@type': 'State', name: 'New York', alternateName: 'NY' },
        'x-timezone': 'America/New_York',
      },
      geo: { latitude: 40.73, longitude: -73.95 },
    },
    performer: [
      { name: 'Heathen Rite', 'x-isHeadliner': false, 'x-performanceRank': 2, genre: [{ identifier: 'metal' }] },
      { name: 'Krallice', 'x-isHeadliner': true, 'x-performanceRank': 1, genre: [{ identifier: 'metal' }, { identifier: 'rock' }] },
    ],
    offers: [{ url: 'https://tickets.example/1001', priceSpecification: { minPrice: 18, maxPrice: 22, price: 18, priceCurrency: 'USD' } }],
    ...over,
  };
}

const mapped = (ev: unknown) => {
  const r = mapJamBaseEvent(ev, OPTS);
  if (!('show' in r)) throw new Error(`skipped: ${r.skip}`);
  return r.show;
};
const skipped = (ev: unknown) => {
  const r = mapJamBaseEvent(ev, OPTS);
  return 'skip' in r ? r.skip : 'mapped';
};

describe('time zones', () => {
  it('applies the right New York offset either side of the clock change', () => {
    assert.equal(localToIso('2026-10-05T19:00:00', 'America/New_York'), '2026-10-05T19:00:00-04:00');
    assert.equal(localToIso('2026-11-05T19:00:00', 'America/New_York'), '2026-11-05T19:00:00-05:00');
  });
  it('keeps an offset that is already there and rejects junk', () => {
    assert.equal(localToIso('2026-10-05T19:00:00Z', 'America/New_York'), '2026-10-05T19:00:00+00:00');
    assert.equal(localToIso('not a date', 'America/New_York'), null);
    assert.equal(localToIso('2026-10-05T19:00:00', 'Nowhere/Land'), null);
  });
});

describe('JamBase mapper', () => {
  it('maps a concert to a Show', () => {
    const s = mapped(concert());
    assert.equal(s.id, 'jb-1001');
    assert.equal(s.startsAt, '2026-10-05T19:00:00-04:00');
    assert.equal(s.doorsAt, '2026-10-05T18:00:00-04:00');
    assert.equal(s.venue.area, 'Brooklyn');
    assert.equal(s.venue.address, '1120 Manhattan Ave');
    assert.deepEqual(s.genres, ['Metal']);
    assert.deepEqual(s.price, { min: 18, max: 22 });
    assert.equal(s.ticketUrl, 'https://tickets.example/1001');
    assert.equal(s.source.provider, 'jambase');
    assert.equal(s.agePolicy, 'unknown');
  });

  it('puts the headliner first regardless of API order', () => {
    const s = mapped(concert());
    assert.deepEqual(s.acts.map((a) => a.name), ['Krallice', 'Heathen Rite']);
    assert.deepEqual(s.acts.map((a) => a.order), [0, 1]);
  });

  it('a date with no time becomes a time-TBA show', () => {
    const s = mapped(concert({ startDate: '2026-10-05', doorTime: undefined }));
    assert.equal(s.timeTba, true);
    assert.ok(s.startsAt.startsWith('2026-10-05T20:00:00'));
  });

  it('maps statuses', () => {
    assert.equal(mapped(concert({ eventStatus: 'cancelled' })).status, 'cancelled');
    assert.equal(mapped(concert({ eventStatus: 'postponed' })).status, 'moved');
    assert.equal(mapped(concert({ eventStatus: 'rescheduled' })).status, 'moved');
  });

  it('free shows and missing prices', () => {
    assert.deepEqual(mapped(concert({ isAccessibleForFree: true })).price, { isFree: true, min: 0, max: 0 });
    assert.deepEqual(mapped(concert({ offers: [] })).price, {});
  });

  it('skips what the app does not cover', () => {
    assert.equal(skipped(concert({ '@type': 'Festival' })), 'not-a-concert');
    assert.equal(skipped(concert({ deletedAt: '2026-09-01' })), 'deleted');
    assert.equal(skipped(concert({ identifier: undefined })), 'no-id');
    assert.equal(skipped(concert({ startDate: undefined })), 'no-date');
    assert.equal(skipped(concert({ startDate: 'soon' })), 'bad-date');
    assert.equal(skipped(concert({ performer: [] })), 'no-performers');
    assert.equal(skipped(concert({ location: undefined })), 'no-venue');
  });

  it('skips arenas but keeps venues with unknown capacity', () => {
    const big = concert();
    (big.location as Record<string, unknown>).maximumAttendeeCapacity = 19000;
    assert.equal(skipped(big), 'large-venue');
    const unknown = concert();
    delete (unknown.location as Record<string, unknown>).maximumAttendeeCapacity;
    assert.equal(skipped(unknown), 'mapped');
  });

  it('keeps a named night with no performers', () => {
    assert.equal(mapped(concert({ performer: [], 'x-customTitle': 'Avant Radio Festival' })).title, 'Avant Radio Festival');
  });

  it('assigns areas', () => {
    assert.equal(areaFor('Brooklyn', 'NY', 40.7), 'Brooklyn');
    assert.equal(areaFor('Ridgewood', 'NY', 40.7), 'Queens');
    assert.equal(areaFor('New York', 'NY', 40.7), 'Manhattan');
    assert.equal(areaFor('Hoboken', 'NJ', 40.74), 'North Jersey');
    assert.equal(areaFor('Asbury Park', 'NJ', 40.22), null);
    assert.equal(areaFor('Bronx', 'NY', 40.85), null);
    assert.equal(areaFor('Philadelphia', 'PA', 39.95), null);
  });

  it('accepts a plain string region', () => {
    const ev = concert();
    (ev.location.address as Record<string, unknown>).addressRegion = 'NY';
    assert.equal(mapped(ev).venue.area, 'Brooklyn');
  });

  it('keeps only genres that map cleanly', () => {
    assert.deepEqual(mapGenres(['punk', 'rock', 'jamband', 'metal', 'punk']), ['Punk', 'Metal']);
  });
});

describe('dedupe and merge', () => {
  const base = mapped(concert());
  const twin: Show = { ...base, id: 'other-9', acts: [base.acts[0]], doorsAt: undefined, source: { ...base.source, provider: 'bandsintown' } };

  it('collapses the same night from two providers, keeping the richer record', () => {
    const out = dedupeShows([twin, base]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, base.id);
  });

  it('keeps an early and a late show at one venue', () => {
    const late: Show = { ...base, id: 'late', startsAt: '2026-10-05T22:30:00-04:00' };
    assert.equal(dedupeShows([base, late]).length, 2);
  });

  it('a cancellation is never hidden', () => {
    const cancelled: Show = { ...twin, status: 'cancelled' };
    assert.equal(dedupeShows([base, cancelled])[0].status, 'cancelled');
    assert.equal(dedupeShows([cancelled, base])[0].status, 'cancelled');
  });

  it('ignores case, accents and "the" in names', () => {
    const a: Show = { ...base, venue: { ...base.venue, name: 'Café Bar' }, acts: [{ name: 'The Serfs', order: 0 }] };
    const b: Show = { ...base, venue: { ...base.venue, name: 'CAFE BAR' }, acts: [{ name: 'Serfs', order: 0 }] };
    assert.equal(dedupeKey(a), dedupeKey(b));
  });

  const now = new Date('2026-10-01T12:00:00-04:00');
  const past: Show = { ...base, id: 'past', startsAt: '2026-09-20T19:00:00-04:00' };

  it('full mode replaces the list; incremental lays changes over it', () => {
    const changed: Show = { ...base, status: 'cancelled' };
    const fresh: Show = { ...base, id: 'new-1', startsAt: '2026-10-07T20:00:00-04:00', acts: [{ name: 'Other', order: 0 }] };
    const full = mergeFeed([base], [fresh], 'full', now);
    assert.deepEqual(full.map((s) => s.id), ['new-1']);
    const inc = mergeFeed([base], [changed, fresh], 'incremental', now);
    assert.deepEqual(inc.map((s) => s.id), [base.id, 'new-1']);
    assert.equal(inc[0].status, 'cancelled');
  });

  it('drops shows that ended more than three hours ago', () => {
    assert.equal(mergeFeed([past], [], 'incremental', now).length, 0);
  });

  it('retains shows the user decided on after they leave the feed', () => {
    const kept = withRetained([twin], [base, past], [base.id, 'unknown-id']);
    assert.deepEqual(kept.map((s) => s.id).sort(), [base.id, twin.id].sort());
  });
});

describe('pipeline', () => {
  it('reads pages until the last one', async () => {
    const seen: number[] = [];
    const r = await collect(async (p) => (seen.push(p), { events: [p], totalPages: 3 }), 10);
    assert.deepEqual(seen, [1, 2, 3]);
    assert.equal(r.calls, 3);
    assert.equal(r.truncated, false);
  });

  it('stops at the call budget and says so', async () => {
    const r = await collect(async () => ({ events: [1], totalPages: 50 }), 4);
    assert.equal(r.calls, 4);
    assert.equal(r.truncated, true);
  });

  const now = new Date('2026-10-01T12:00:00-04:00');
  it('builds a feed with a report of what was skipped', () => {
    const { feed, report } = buildFeed([concert(), concert({ '@type': 'Festival', identifier: 'jambase:2' }), 'junk'], { mode: 'full', now });
    assert.equal(feed.shows.length, 1);
    assert.equal(report.seen, 3);
    assert.equal(report.mapped, 1);
    assert.equal(report.skipped['not-a-concert'], 2);
    assert.match(feed.attribution[0], /JamBase/);
  });

  it('merges hand-kept listings and marks their provider', () => {
    const manual = [{ ...mapped(concert({ identifier: 'jambase:77', performer: [{ name: 'Basement Band', 'x-isHeadliner': true }] })), venue: { ...mapped(concert()).venue, name: 'Some Basement', type: 'basement' } }];
    const { feed } = buildFeed([concert()], { mode: 'full', now, manual });
    const m = feed.shows.find((s) => s.venue.name === 'Some Basement')!;
    assert.ok(m.id.startsWith('manual-'));
    assert.equal(m.source.provider, 'manual');
    assert.equal(feed.shows.length, 2);
  });

  it('refuses to replace a good feed with an empty or shrunken one', () => {
    const rep = { seen: 0, mapped: 0, skipped: {}, manual: 0, total: 0, previousTotal: 300 };
    assert.match(sanityProblem(rep, 'full', false)!, /no events/);
    assert.match(sanityProblem({ ...rep, seen: 40 }, 'full', false)!, /none could be mapped/);
    assert.match(sanityProblem({ ...rep, seen: 40, mapped: 5, total: 5 }, 'full', false)!, /not replacing/);
    assert.match(sanityProblem({ ...rep, seen: 40, mapped: 30, total: 200 }, 'incremental', true)!, /budget/);
    assert.equal(sanityProblem({ ...rep, seen: 40, mapped: 30, total: 200 }, 'full', false), null);
    assert.equal(sanityProblem({ ...rep, seen: 0, mapped: 0, total: 300 }, 'incremental', false), null);
  });
});

describe('feed validation', () => {
  const good = mapped(concert());
  it('drops malformed and duplicate records instead of failing', () => {
    const res = parseFeed({
      version: 1,
      generatedAt: '2026-09-30T00:00:00Z',
      attribution: ['x'],
      shows: [good, { ...good }, { id: 'bad' }, null, { ...good, id: 'b2', startsAt: 'nope' }, { ...good, id: 'b3', venue: { ...good.venue, area: 'Mars' } }],
    })!;
    assert.equal(res.feed.shows.length, 1);
    assert.equal(res.dropped, 5);
  });
  it('rejects things that are not a feed', () => {
    assert.equal(parseFeed(null), null);
    assert.equal(parseFeed({ version: 2, shows: [] }), null);
    assert.equal(parseFeed({ version: 1 }), null);
  });
  it('removes unknown genres and fills missing optional fields', () => {
    const s = cleanShow({ ...good, genres: ['Metal', 'Vaporwave'], agePolicy: 'whatever', price: undefined, status: 'weird' })!;
    assert.deepEqual(s.genres, ['Metal']);
    assert.equal(s.agePolicy, 'unknown');
    assert.equal(s.status, 'scheduled');
  });
  it('survives a round trip through JSON', () => {
    const again = parseFeed(JSON.parse(JSON.stringify({ version: 1, generatedAt: '', attribution: [], shows: [good] })))!;
    assert.deepEqual(again.feed.shows[0].acts, good.acts);
  });
});
