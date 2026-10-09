/// <reference types="node" />
/**
 * State tests: the Going list actions and the listings refresh behaviour.
 * AsyncStorage is a native module, so it is replaced with an in-memory copy.
 */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { beforeEach, describe, it } from 'node:test';

const memory = new Map<string, string>();
const fake = {
  getItem: async (k: string) => memory.get(k) ?? null,
  setItem: async (k: string, v: string) => void memory.set(k, v),
  removeItem: async (k: string) => void memory.delete(k),
};
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === '@react-native-async-storage/async-storage') return { __esModule: true, default: fake };
  return realLoad.call(this, request, ...rest);
};

import type { Show } from '../src/lib/types';

const mk = (id: string, day: string, name = id): Show => ({
  id,
  startsAt: `${day}T20:00:00-04:00`,
  venue: { name: 'Room', neighborhood: 'Greenpoint', area: 'Brooklyn', metro: 'nyc', city: 'Brooklyn, NY', addressVisibility: 'public' },
  acts: [{ name, order: 0 }],
  genres: [],
  price: {},
  status: 'scheduled',
  source: { provider: 'jambase', url: 'https://www.jambase.com', fetchedAt: '2026-09-30' },
  updatedAt: '2026-09-30T00:00:00Z',
});

function feedResponse(shows: Show[], generatedAt: string, ok = true, status = 200) {
  return async () =>
    ({
      ok,
      status,
      json: async () => ({ version: 1, generatedAt, attribution: ['Listings by JamBase (jambase.com)'], shows }),
    }) as unknown as Response;
}

describe('saved filters from older versions', () => {
  it('drops the removed venue-type and age filters and keeps the rest', async () => {
    const { useApp } = await import('../src/lib/store');
    const merge = useApp.persist.getOptions().merge!;
    const saved = { filters: { when: 'month', radiusMi: 15, venueTypes: ['diy'], age: 'all_ages', genres: ['Club & Techno'], price: 'free' } };
    const next = merge(saved, useApp.getState()) as ReturnType<typeof useApp.getState>;
    assert.equal(next.filters.when, 'month');
    assert.equal(next.filters.price, 'free');
    assert.deepEqual(next.filters.genres, ['Electronic']);
    assert.ok(!('venueTypes' in next.filters));
    assert.ok(!('age' in next.filters));
  });
});

describe('going list actions', () => {
  it('records, removes and undoes decisions in order', async () => {
    const { useApp } = await import('../src/lib/store');
    useApp.getState().resetAll();
    const s = useApp.getState();
    s.decide('a', 'going');
    s.decide('b', 'passed');
    s.decide('c', 'going');
    assert.deepEqual(useApp.getState().history, ['a', 'b', 'c']);
    assert.equal(useApp.getState().undo(), 'c');
    assert.equal(useApp.getState().decisions.c, undefined);
    assert.equal(useApp.getState().undo(), 'b');
    assert.deepEqual(Object.keys(useApp.getState().decisions), ['a']);
    assert.equal(useApp.getState().undo(), 'a');
    assert.equal(useApp.getState().undo(), null);
  });

  it('changing your mind moves the show to the end of the undo history', async () => {
    const { useApp } = await import('../src/lib/store');
    useApp.getState().resetAll();
    useApp.getState().decide('a', 'passed');
    useApp.getState().decide('b', 'going');
    useApp.getState().decide('a', 'going');
    assert.deepEqual(useApp.getState().history, ['b', 'a']);
    assert.equal(useApp.getState().decisions.a.decision, 'going');
  });

  it('clearing a decision also clears it from history', async () => {
    const { useApp } = await import('../src/lib/store');
    useApp.getState().resetAll();
    useApp.getState().decide('a', 'going');
    useApp.getState().clearDecision('a');
    assert.deepEqual(useApp.getState().history, []);
    assert.deepEqual(useApp.getState().decisions, {});
  });

  it('keeps only the last 50 swipes for undo', async () => {
    const { useApp } = await import('../src/lib/store');
    useApp.getState().resetAll();
    for (let i = 0; i < 60; i++) useApp.getState().decide(`s${i}`, 'passed');
    assert.equal(useApp.getState().history.length, 50);
    assert.equal(useApp.getState().history[0], 's10');
  });

  it('per-show reminders default on and can be switched off and on', async () => {
    const { useApp } = await import('../src/lib/store');
    useApp.getState().resetAll();
    useApp.getState().setShowReminders('a', false);
    assert.equal(useApp.getState().reminderOff.a, true);
    useApp.getState().setShowReminders('a', true);
    assert.equal(useApp.getState().reminderOff.a, undefined);
  });

  it('attendance can be set and cleared', async () => {
    const { useApp } = await import('../src/lib/store');
    useApp.getState().resetAll();
    useApp.getState().setAttendance('a', 'went');
    assert.equal(useApp.getState().attendance.a, 'went');
    useApp.getState().setAttendance('a', null);
    assert.equal('a' in useApp.getState().attendance, false);
  });

  it('wrong-artist reports are per act name, case-insensitive, without repeats', async () => {
    const { useApp } = await import('../src/lib/store');
    useApp.getState().resetAll();
    useApp.getState().flagWrongArtist('SPY', 10);
    useApp.getState().flagWrongArtist('spy', 10);
    useApp.getState().flagWrongArtist('Spy', 11);
    assert.deepEqual(useApp.getState().wrongArtist.spy, [10, 11]);
  });

  it('reset clears everything the user did', async () => {
    const { useApp } = await import('../src/lib/store');
    useApp.getState().decide('a', 'going');
    useApp.getState().setAutoplay(false);
    useApp.getState().resetAll();
    assert.deepEqual(useApp.getState().decisions, {});
    assert.equal(useApp.getState().autoplay, true);
  });
});

describe('listings refresh', () => {
  const realFetch = globalThis.fetch;
  beforeEach(async () => {
    memory.clear();
    globalThis.fetch = realFetch;
    const { useApp } = await import('../src/lib/store');
    const { useListings } = await import('../src/lib/listingsStore');
    useApp.getState().resetAll();
    useListings.setState({ shows: [], byId: {}, feeds: {}, source: 'none', generatedAt: null, checkedAt: {}, refreshing: false, error: null, ready: false });
  });

  it('starts empty: there is no bundled sample data', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    assert.equal(useListings.getState().source, 'none');
    assert.equal(useListings.getState().shows.length, 0);
  });

  it('a good download fills the list and is saved for next launch', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    globalThis.fetch = feedResponse([mk('x1', '2026-10-05'), mk('x2', '2026-10-06')], '2026-09-30T08:00:00Z');
    assert.equal(await useListings.getState().refresh({ force: true }), true);
    const st = useListings.getState();
    assert.equal(st.source, 'live');
    assert.deepEqual(st.shows.map((s) => s.id), ['x1', 'x2']);
    assert.match(st.attribution[0], /JamBase/);
    assert.ok(memory.get('setnik-listings-v2:nyc'));

    // A later launch with no network starts from the saved copy.
    useListings.setState({ shows: [], byId: {}, feeds: {}, source: 'none', generatedAt: null });
    await useListings.getState().loadCache();
    assert.equal(useListings.getState().source, 'cache');
    assert.equal(useListings.getState().shows.length, 2);
    assert.equal(useListings.getState().ready, true);
  });

  it('a failed download keeps what is already showing and records why', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    globalThis.fetch = feedResponse([mk('x1', '2026-10-05'), mk('x2', '2026-10-06')], '2026-09-30T08:00:00Z');
    await useListings.getState().refresh({ force: true });
    const before = useListings.getState().shows.length;
    globalThis.fetch = feedResponse([], '', false, 503);
    assert.equal(await useListings.getState().refresh({ force: true }), false);
    assert.equal(useListings.getState().shows.length, before);
    assert.match(useListings.getState().error ?? '', /503/);
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    await useListings.getState().refresh({ force: true });
    assert.equal(useListings.getState().error, 'offline');
    assert.equal(useListings.getState().source, 'live');
    assert.equal(useListings.getState().shows.length, before);
  });

  it('an unrecognised feed is not accepted', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) })) as unknown as typeof fetch;
    assert.equal(await useListings.getState().refresh({ force: true }), false);
    assert.equal(useListings.getState().source, 'none');
    assert.equal(useListings.getState().shows.length, 0);
  });

  it('shows you already decided on survive a refresh that no longer lists them', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    const { useApp } = await import('../src/lib/store');
    globalThis.fetch = feedResponse([mk('keep', '2026-10-05'), mk('drop', '2026-10-06')], '2026-09-30T08:00:00Z');
    await useListings.getState().refresh({ force: true });
    useApp.getState().decide('keep', 'going');
    useApp.getState().decide('drop', 'passed');
    globalThis.fetch = feedResponse([mk('fresh', '2026-10-07')], '2026-10-01T08:00:00Z');
    await useListings.getState().refresh({ force: true });
    const ids = useListings.getState().shows.map((s) => s.id).sort();
    assert.deepEqual(ids, ['drop', 'fresh', 'keep']);
    assert.ok(useListings.getState().byId.keep);
  });

  it('an older feed than the one already loaded is ignored', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    globalThis.fetch = feedResponse([mk('new', '2026-10-05')], '2026-10-02T08:00:00Z');
    await useListings.getState().refresh({ force: true });
    globalThis.fetch = feedResponse([mk('old', '2026-10-05')], '2026-10-01T08:00:00Z');
    assert.equal(await useListings.getState().refresh({ force: true }), false);
    assert.deepEqual(useListings.getState().shows.map((s) => s.id), ['new']);
  });

  it('does not ask again within 30 minutes unless forced', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    let calls = 0;
    const inner = feedResponse([mk('x1', '2026-10-05')], '2026-09-30T08:00:00Z');
    globalThis.fetch = (async () => (calls++, inner())) as unknown as typeof fetch;
    await useListings.getState().refresh();
    await useListings.getState().refresh();
    assert.equal(calls, 1);
    await useListings.getState().refresh({ force: true });
    assert.equal(calls, 2);
  });

  it('a damaged saved copy is treated as no saved copy', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    memory.set('setnik-listings-v2:index', '["nyc"]');
    memory.set('setnik-listings-v2:nyc', '{not json');
    await useListings.getState().loadCache();
    assert.equal(useListings.getState().source, 'none');
    assert.equal(useListings.getState().ready, true);
  });

  it('downloads only the city the deck is centered on and keeps others cached', async () => {
    const { useListings, listingsUrl } = await import('../src/lib/listingsStore');
    const { useApp } = await import('../src/lib/store');
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      const shows = url.includes('shows-la.json') ? [mk('la1', '2026-10-05')] : [mk('ny1', '2026-10-05')];
      return { ok: true, status: 200, json: async () => ({ version: 1, generatedAt: '2026-10-01T08:00:00Z', attribution: ['x'], shows }) } as unknown as Response;
    }) as unknown as typeof fetch;
    useApp.getState().setFilters({ place: { label: 'Los Angeles', lat: 34, lng: -118, metro: 'la', source: 'city' } });
    await useListings.getState().refresh({ force: true });
    assert.deepEqual(asked, [listingsUrl('la')]);
    useApp.getState().setFilters({ place: { label: 'New York', lat: 40, lng: -74, metro: 'nyc', source: 'city' } });
    await useListings.getState().refresh();
    assert.equal(asked.length, 2);
    assert.deepEqual(useListings.getState().shows.map((s) => s.id).sort(), ['la1', 'ny1']);
    assert.deepEqual(Object.keys(useListings.getState().feeds).sort(), ['la', 'nyc']);

    // Next launch: both cities come back from the saved copies.
    useListings.setState({ shows: [], byId: {}, feeds: {}, source: 'none' });
    await useListings.getState().loadCache();
    assert.equal(useListings.getState().shows.length, 2);
  });

  it('a city with no listings is a valid empty feed, not an error', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    globalThis.fetch = feedResponse([], '2026-09-30T08:00:00Z');
    await useListings.getState().refresh({ force: true, metros: ['van'] });
    assert.equal(useListings.getState().error, null);
    assert.deepEqual(useListings.getState().feeds.van?.shows, []);
  });

  it('upgrades the single New York cache from earlier builds', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    memory.set('setnik-listings-cache-v1', JSON.stringify({ version: 1, generatedAt: '2026-09-30T08:00:00Z', attribution: [], shows: [mk('old1', '2026-10-05')] }));
    await useListings.getState().loadCache();
    assert.deepEqual(useListings.getState().shows.map((s) => s.id), ['old1']);
    assert.ok(useListings.getState().feeds.nyc);
  });
});
