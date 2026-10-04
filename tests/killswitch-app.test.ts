/// <reference types="node" />
/**
 * Kill switches in the app: fetching and caching the flags, and what each switch changes on the phone.
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

import { pickCardPhoto } from '../src/lib/cardPhoto';
import { runFlagEffects, type FlagEffectDeps } from '../src/lib/flagEffects';
import { DEFAULT_FLAGS, FLAG_REFRESH_MS, parseFlags, type Flags } from '../src/lib/flagsCore';
import { FLYER_PAUSED_MESSAGE, intakeGate, viewJob } from '../src/lib/flyer/status';
import type { Show } from '../src/lib/types';

const off = (...keys: string[]): Flags => parseFlags(keys.map((key) => ({ key, enabled: false, message: null })));

const mk = (id: string, provider: 'jambase' | 'community' = 'jambase'): Show => ({
  id, startsAt: '2026-10-20T20:00:00-04:00',
  venue: { name: 'Room', neighborhood: 'Greenpoint', area: 'Brooklyn', metro: 'nyc', city: 'Brooklyn, NY', addressVisibility: 'public' },
  acts: [{ name: id, order: 0 }], genres: [], price: {}, status: 'scheduled',
  source: { provider, url: 'https://www.jambase.com', fetchedAt: '2026-09-30' }, updatedAt: '2026-09-30T00:00:00Z',
});

describe('flag fetch, cache and defaults', () => {
  const setup = (over: Partial<{ stored: string | null; remote: Flags | null }> = {}) => {
    let t = 1_000_000;
    const state = { stored: over.stored ?? null, remote: over.remote ?? null, fetches: 0 };
    return {
      state,
      advance: (ms: number) => (t += ms),
      deps: {
        load: async () => state.stored,
        save: async (v: string) => void (state.stored = v),
        fetchRemote: async () => { state.fetches++; return state.remote; },
        now: () => t,
      },
    };
  };

  it('uses the defaults (all ON) only when the flags have never been fetched', async () => {
    const { createFlagsStore } = await import('../src/lib/flags');
    const s = setup();
    const store = createFlagsStore(s.deps);
    await store.getState().load();
    assert.deepEqual(store.getState().flags, DEFAULT_FLAGS);
    assert.equal(store.getState().fetchedAt, null);
    assert.equal(store.getState().loaded, true);
  });

  it('fetches, applies and caches; a second call inside 15 minutes does not fetch again', async () => {
    const { createFlagsStore } = await import('../src/lib/flags');
    const s = setup({ remote: off('deezer_enabled') });
    const store = createFlagsStore(s.deps);
    await store.getState().load();
    assert.equal(await store.getState().refresh(), true);
    assert.equal(store.getState().flags.deezer_enabled.enabled, false);
    assert.equal(s.state.fetches, 1);
    s.advance(FLAG_REFRESH_MS - 1000);
    assert.equal(await store.getState().refresh(), false);
    assert.equal(s.state.fetches, 1);
    s.advance(2000);
    s.state.remote = DEFAULT_FLAGS;
    assert.equal(await store.getState().refresh(), true); // changed back on
    assert.equal(s.state.fetches, 2);
    assert.equal(store.getState().flags.deezer_enabled.enabled, true);
  });

  it('force bypasses the 15-minute rule', async () => {
    const { createFlagsStore } = await import('../src/lib/flags');
    const s = setup({ remote: DEFAULT_FLAGS });
    const store = createFlagsStore(s.deps);
    await store.getState().refresh();
    await store.getState().refresh({ force: true });
    assert.equal(s.state.fetches, 2);
  });

  it('keeps the last known values when the server cannot be reached, and retries on the next foreground', async () => {
    const { createFlagsStore } = await import('../src/lib/flags');
    const s = setup({ remote: off('jambase_enabled') });
    const store = createFlagsStore(s.deps);
    await store.getState().refresh();
    s.advance(FLAG_REFRESH_MS + 1);
    s.state.remote = null; // offline
    assert.equal(await store.getState().refresh(), false);
    assert.equal(store.getState().flags.jambase_enabled.enabled, false); // still the last known value, not the default
    s.advance(61_000);
    s.state.remote = DEFAULT_FLAGS;
    assert.equal(await store.getState().refresh(), true);
  });

  it('a new launch starts from the cached values and does not fetch again within 15 minutes', async () => {
    const { createFlagsStore } = await import('../src/lib/flags');
    const s = setup({ remote: off('notifications_enabled') });
    await createFlagsStore(s.deps).getState().refresh();
    const second = createFlagsStore(s.deps);
    await second.getState().load();
    assert.equal(second.getState().flags.notifications_enabled.enabled, false);
    assert.equal(await second.getState().refresh(), false);
    assert.equal(s.state.fetches, 1);
  });

  it('a damaged cache is the same as none', async () => {
    const { createFlagsStore } = await import('../src/lib/flags');
    const store = createFlagsStore(setup({ stored: '{not json' }).deps);
    await store.getState().load();
    assert.deepEqual(store.getState().flags, DEFAULT_FLAGS);
  });
});

describe('jambase_enabled in the app', () => {
  const realFetch = globalThis.fetch;
  const feed = (shows: Show[]) => async () => ({ ok: true, status: 200, json: async () => ({ version: 1, generatedAt: '2026-10-01T08:00:00Z', attribution: ['Listings by JamBase (jambase.com)'], shows }) }) as unknown as Response;
  beforeEach(async () => {
    memory.clear();
    globalThis.fetch = realFetch;
    const { useApp } = await import('../src/lib/store');
    const { useListings } = await import('../src/lib/listingsStore');
    const { useFlags } = await import('../src/lib/flags');
    useApp.getState().resetAll();
    useFlags.setState({ flags: DEFAULT_FLAGS });
    useListings.setState({ shows: [], byId: {}, feeds: {}, fpRows: {}, source: 'none', generatedAt: null, attribution: [], checkedAt: {}, refreshing: false, error: null, ready: false });
  });

  it('ON: shows and the credit line appear', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    globalThis.fetch = feed([mk('a'), mk('b')]);
    await useListings.getState().refresh({ force: true });
    assert.equal(useListings.getState().shows.length, 2);
    assert.match(useListings.getState().attribution[0], /JamBase/);
  });

  it('OFF: a feed with JamBase records yields none of them and no credit line, without errors', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    const { useFlags } = await import('../src/lib/flags');
    useFlags.setState({ flags: off('jambase_enabled') });
    globalThis.fetch = feed([mk('a'), mk('b'), mk('c', 'community')]);
    await useListings.getState().refresh({ force: true });
    assert.deepEqual(useListings.getState().shows.map((s) => s.id), ['c']);
    assert.deepEqual(useListings.getState().attribution, []);
    assert.equal(useListings.getState().error, null);
    assert.ok(!(memory.get('pull-up-listings-v2:nyc') ?? '').includes('"jambase"'));
  });

  it('OFF: a feed with no licensed shows at all is handled', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    const { useFlags } = await import('../src/lib/flags');
    useFlags.setState({ flags: off('jambase_enabled') });
    globalThis.fetch = feed([]);
    assert.equal(await useListings.getState().refresh({ force: true }), true);
    assert.equal(useListings.getState().shows.length, 0);
    assert.equal(useListings.getState().error, null);
  });

  it('switched off after shows were cached: they are dropped from the list and from the saved copy; switched on again they return on refresh', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    const { useFlags } = await import('../src/lib/flags');
    globalThis.fetch = feed([mk('a'), mk('b')]);
    await useListings.getState().refresh({ force: true });
    assert.ok((memory.get('pull-up-listings-v2:nyc') ?? '').includes('jambase'));
    useFlags.setState({ flags: off('jambase_enabled') });
    await useListings.getState().recombine();
    assert.equal(useListings.getState().shows.length, 0);
    assert.deepEqual(useListings.getState().attribution, []);
    assert.equal(JSON.parse(memory.get('pull-up-listings-v2:nyc')!).shows.length, 0);
    useFlags.setState({ flags: DEFAULT_FLAGS });
    await useListings.getState().refresh({ force: true });
    assert.equal(useListings.getState().shows.length, 2);
  });

  it('a decided JamBase show kept from an older download is dropped too while the switch is off', async () => {
    const { useListings } = await import('../src/lib/listingsStore');
    const { useApp } = await import('../src/lib/store');
    const { useFlags } = await import('../src/lib/flags');
    globalThis.fetch = feed([mk('a'), mk('b')]);
    await useListings.getState().refresh({ force: true });
    useApp.getState().decide('a', 'going');
    useFlags.setState({ flags: off('jambase_enabled') });
    globalThis.fetch = feed([mk('b')]);
    await useListings.getState().refresh({ force: true });
    assert.equal(useListings.getState().shows.length, 0);
  });
});

describe('deezer_enabled in the app', () => {
  const realFetch = globalThis.fetch;
  it('OFF: no Deezer request is made, so no preview or photo exists', async () => {
    const { useFlags } = await import('../src/lib/flags');
    const { resolveShow, usePreviewStore, clearPreviews } = await import('../src/lib/previews');
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ data: [] }), { status: 200 }); }) as typeof fetch;
    clearPreviews();
    useFlags.setState({ flags: off('deezer_enabled') });
    await resolveShow(mk('x'));
    assert.equal(calls, 0);
    assert.deepEqual(usePreviewStore.getState().byShow, {});
    useFlags.setState({ flags: DEFAULT_FLAGS });
    await resolveShow(mk('x'));
    assert.ok(calls > 0);
    clearPreviews();
    assert.deepEqual(usePreviewStore.getState().byShow, {});
    globalThis.fetch = realFetch;
  });

  it('OFF: the image falls through to the generated poster (no Deezer photo, no credit); ON: the photo is used', () => {
    const previews = { acts: [{ order: 0, status: 'found', confidence: 'high', picture: 'https://cdn.deezer.example/a.jpg' }] };
    assert.equal(pickCardPhoto(mk('p'), undefined, previews, false), undefined);
    assert.deepEqual(pickCardPhoto(mk('p'), undefined, previews, true), { url: 'https://cdn.deezer.example/a.jpg', credit: 'DEEZER' });
  });
});

describe('what happens when a switch changes (runFlagEffects)', () => {
  const effects = (marker = false) => {
    const log: string[] = [];
    const deps: FlagEffectDeps = {
      recombine: async () => void log.push('recombine'),
      clearDeezer: async () => void log.push('clearDeezer'),
      cancelNotifications: async () => void log.push('cancelNotifications'),
      getMarker: async () => marker,
      setMarker: async (v) => { marker = v; log.push(`marker:${v}`); },
    };
    return { log, deps, marker: () => marker };
  };

  it('all ON: only rebuilds the list', async () => {
    const e = effects();
    await runFlagEffects(DEFAULT_FLAGS, e.deps);
    assert.deepEqual(e.log, ['recombine']);
  });

  it('deezer OFF: clears previews and photos once, not at every launch; ON again resets the marker', async () => {
    const e = effects();
    await runFlagEffects(off('deezer_enabled'), e.deps);
    assert.deepEqual(e.log, ['recombine', 'clearDeezer', 'marker:true']);
    e.log.length = 0;
    await runFlagEffects(off('deezer_enabled'), e.deps);
    assert.deepEqual(e.log, ['recombine']);
    e.log.length = 0;
    await runFlagEffects(DEFAULT_FLAGS, e.deps);
    assert.deepEqual(e.log, ['recombine', 'marker:false']);
  });

  it('notifications OFF: cancels the scheduled ones on every run', async () => {
    const e = effects();
    const r = await runFlagEffects(off('notifications_enabled'), e.deps);
    assert.equal(r.cancelledNotifications, true);
    assert.ok(e.log.includes('cancelNotifications'));
  });
});

describe('flyer switches in the app', () => {
  it('the paused message is the one the owner specified', () => {
    assert.equal(FLYER_PAUSED_MESSAGE, 'Flyer sharing is paused right now. Nothing was sent.');
  });

  it('the share screen waits for the saved switches, stops when intake is off, and goes when it is on', () => {
    assert.equal(intakeGate(false, true), 'wait');
    assert.equal(intakeGate(false, false), 'wait');
    assert.equal(intakeGate(true, false), 'paused');
    assert.equal(intakeGate(true, true), 'go');
  });

  it('a flyer waiting because reading is paused is shown as in line, not as an error', () => {
    const v = viewJob({ id: 'j', status: 'queued', result: null, reason: null, createdAt: '', finishedAt: null, notified: false, shows: [] });
    assert.equal(v.tone, 'working');
    assert.match(v.detail, /paused/);
  });
});
