/**
 * The listings the app shows. There is one downloaded feed per city, and the
 * app only downloads the city it is looking at (plus any it has visited, which
 * stay cached so saved shows keep working). The copy from the last successful
 * download is read at launch and a fresh download replaces it. A failed
 * download never removes anything. With no saved copy and no network the list
 * is empty and the deck says so.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { flagOn } from './flags';
import { mergeFirstParty, parseFpRows, type FpRow } from './fpMerge';
import { applySwitchesToAll, DEFAULT_LICENSED, parseSwitches, type LicensedSwitches } from './licensed';
import { dedupeKey, withRetained } from './listings/merge';
import { parseFeed } from './listings/validate';
import { DEFAULT_METRO } from './metros';
import { useApp } from './store';
import { communityEnabled } from './communityConfig';
import type { Show } from './types';

/**
 * Where the refresh job publishes each city's feed; {metro} is replaced by the
 * city id. Override at build time with EXPO_PUBLIC_LISTINGS_URL.
 */
export const LISTINGS_URL =
  process.env.EXPO_PUBLIC_LISTINGS_URL ?? 'https://github.com/hbnmusic/Show-up-app/releases/download/listings/shows-{metro}.json';

export const listingsUrl = (metro: string) => LISTINGS_URL.replace('{metro}', metro);

const CACHE_PREFIX = 'pull-up-listings-v2:';
const FP_PREFIX = 'pull-up-fp-v1:';
const SWITCH_KEY = 'pull-up-licensed-switches-v1';
const INDEX_KEY = `${CACHE_PREFIX}index`;
/** Before per-city feeds the app saved one New York feed under this key. */
const LEGACY_KEY = 'pull-up-listings-cache-v1';
const RECHECK_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 20_000;

export type ListingsSource = 'none' | 'cache' | 'live';

type MetroFeed = { generatedAt: string; attribution: string[]; shows: Show[]; source: 'cache' | 'live' };

type ListingsState = {
  /** Every cached city's shows together, de-duplicated. */
  shows: Show[];
  byId: Record<string, Show>;
  feeds: Record<string, MetroFeed>;
  /** First-party shows (venue pages, shared flyers) per city. */
  fpRows: Record<string, FpRow[]>;
  /** On/off switches for the licensed layer (JamBase listings). */
  switches: LicensedSwitches;
  source: ListingsSource;
  generatedAt: string | null;
  attribution: string[];
  checkedAt: Record<string, number>;
  refreshing: boolean;
  error: string | null;
  /** The cached feeds have been read (or there were none); safe to show screens. */
  ready: boolean;

  loadCache: () => Promise<void>;
  /** Download the given cities (default: the one the deck is centered on). */
  refresh: (opts?: { force?: boolean; metros?: string[] }) => Promise<boolean>;
  /** Re-download the shows other people added (after submitting or confirming one). */
  refreshCommunity: (metros?: string[]) => Promise<boolean>;
  /** Re-download first-party shows and the licensed-layer switches (after sharing a flyer, or on refresh). */
  refreshFirstParty: (metros?: string[]) => Promise<boolean>;
  /** Rebuild the combined list after a kill switch changed (JamBase on or off), and drop cached JamBase shows when it is off. */
  recombine: () => Promise<void>;
};

/** Shows other people added are kept as one extra feed per city, under this prefix. */
const COMMUNITY_FEED = 'community:';
export const isCommunityFeed = (id: string) => id.startsWith(COMMUNITY_FEED);

const index = (shows: Show[]): Record<string, Show> => Object.fromEntries(shows.map((s) => [s.id, s]));

/** The older licensed switch and the jambase_enabled kill switch both have to allow JamBase. */
const effective = (sw: LicensedSwitches): LicensedSwitches => ({ ...sw, jambase_listings: sw.jambase_listings && flagOn('jambase_enabled') });

function combine(feeds: Record<string, MetroFeed>, fpRows: Record<string, FpRow[]> = {}, rawSwitches: LicensedSwitches = DEFAULT_LICENSED) {
  const switches = effective(rawSwitches);
  const byId = new Map<string, Show>();
  const entries = Object.entries(feeds);
  // Provider listings first (with the licensed-layer switches applied and first-party shows merged in, one card per show),
  // so a community copy of a show the provider already has is dropped.
  const metros = new Set([...entries.filter(([id]) => !isCommunityFeed(id)).map(([id]) => id), ...Object.keys(fpRows)]);
  for (const id of metros) {
    const licensed = applySwitchesToAll(feeds[id]?.shows ?? [], switches);
    const merged = fpRows[id]?.length ? mergeFirstParty(licensed, fpRows[id], id) : licensed;
    for (const s of merged) if (!byId.has(s.id)) byId.set(s.id, s);
  }
  const taken = new Set([...byId.values()].map(dedupeKey));
  for (const [id, f] of entries) {
    if (!isCommunityFeed(id)) continue;
    for (const s of f.shows) {
      const k = dedupeKey(s);
      if (byId.has(s.id) || taken.has(k)) continue;
      taken.add(k);
      byId.set(s.id, s);
    }
  }
  const shows = [...byId.values()];
  const list = entries.filter(([id]) => !isCommunityFeed(id)).map(([, f]) => f);
  const generatedAt = list.map((f) => f.generatedAt).filter(Boolean).sort().pop() ?? null;
  const attribution = [...new Set(list.flatMap((f) => f.attribution))].filter((a) => switches.jambase_listings || !/jambase/i.test(a));
  const source: ListingsSource = list.length === 0 ? 'none' : list.some((f) => f.source === 'live') ? 'live' : 'cache';
  return { shows, byId: index(shows), generatedAt, attribution, source };
}

function currentMetros(): string[] {
  return [useApp.getState().filters.place?.metro ?? DEFAULT_METRO.id];
}

async function save(metro: string, feed: MetroFeed, known: string[]) {
  try {
    await AsyncStorage.setItem(
      `${CACHE_PREFIX}${metro}`,
      JSON.stringify({ version: 1, generatedAt: feed.generatedAt, attribution: feed.attribution, shows: feed.shows }),
    );
    if (!known.includes(metro)) await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([...known, metro]));
  } catch {
    // The cache is a convenience; a full disk should not break the app.
  }
}

export const useListings = create<ListingsState>()((set, get) => ({
  shows: [],
  byId: {},
  feeds: {},
  fpRows: {},
  switches: DEFAULT_LICENSED,
  source: 'none',
  generatedAt: null,
  attribution: [],
  checkedAt: {},
  refreshing: false,
  error: null,
  ready: false,

  loadCache: async () => {
    const feeds: Record<string, MetroFeed> = {};
    try {
      const rawIndex = await AsyncStorage.getItem(INDEX_KEY);
      let ids: unknown = rawIndex ? JSON.parse(rawIndex) : [];
      if (!Array.isArray(ids)) ids = [];
      for (const id of ids as string[]) {
        try {
          const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${id}`);
          const parsed = raw ? parseFeed(JSON.parse(raw)) : null;
          if (parsed) feeds[id] = { ...parsed.feed, source: 'cache' };
        } catch {
          // A damaged copy of one city is the same as no copy of it.
        }
      }
      if (Object.keys(feeds).length === 0) {
        // Upgrading from the single New York feed.
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        const parsed = legacy ? parseFeed(JSON.parse(legacy)) : null;
        if (parsed && parsed.feed.shows.length > 0) feeds.nyc = { ...parsed.feed, source: 'cache' };
      }
    } catch {
      // Damaged cache storage is the same as no cache.
    }
    const fpRows: Record<string, FpRow[]> = {};
    let switches = DEFAULT_LICENSED;
    try {
      switches = parseSwitches(JSON.parse((await AsyncStorage.getItem(SWITCH_KEY)) ?? '{}'));
      for (const id of Object.keys(feeds)) {
        const raw = await AsyncStorage.getItem(`${FP_PREFIX}${id}`);
        if (raw) fpRows[id] = parseFpRows(JSON.parse(raw));
      }
    } catch {
      // Damaged copies are the same as none.
    }
    set({ feeds, fpRows, switches, ...combine(feeds, fpRows, switches), ready: true });
  },

  refresh: async ({ force = false, metros } = {}) => {
    const st = get();
    if (st.refreshing) return false;
    const wanted = (metros ?? currentMetros()).filter(
      (id) => force || !st.checkedAt[id] || Date.now() - st.checkedAt[id] >= RECHECK_MS,
    );
    if (wanted.length === 0) return false;
    set({ refreshing: true, error: null });
    let changed = false;
    let firstError: string | null = null;

    for (const id of wanted) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(listingsUrl(id), { signal: ctl.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Listings server answered ${res.status}`);
        const parsed = parseFeed(await res.json());
        if (!parsed) throw new Error('The download was not a listings feed');
        const { feed } = parsed;
        const cur = get();
        const have = cur.feeds[id];
        if (have?.generatedAt && feed.generatedAt && feed.generatedAt < have.generatedAt) {
          // Older than what is already here (a stale mirror); keep what we have.
          set({ checkedAt: { ...cur.checkedAt, [id]: Date.now() } });
          continue;
        }
        const jb = flagOn('jambase_enabled');
        const dropJb = (list: Show[]) => (jb ? list : list.filter((s) => s.source.provider !== 'jambase'));
        const shows = withRetained(dropJb(feed.shows), dropJb(have?.shows ?? []), Object.keys(useApp.getState().decisions));
        const metroFeed: MetroFeed = { generatedAt: feed.generatedAt, attribution: jb ? feed.attribution : feed.attribution.filter((a) => !/jambase/i.test(a)), shows, source: 'live' };
        const feeds = { ...cur.feeds, [id]: metroFeed };
        set({ feeds, ...combine(feeds, cur.fpRows, cur.switches), checkedAt: { ...cur.checkedAt, [id]: Date.now() } });
        await save(id, metroFeed, Object.keys(cur.feeds));
        changed = true;
      } catch (e) {
        const message =
          e instanceof Error && e.name === 'AbortError'
            ? 'The listings server took too long'
            : e instanceof Error
              ? e.message
              : 'Could not reach the listings server';
        firstError ??= message;
      } finally {
        clearTimeout(timer);
      }
    }
    const communityChanged = await get().refreshCommunity(wanted);
    const fpChanged = await get().refreshFirstParty(wanted);
    set({ refreshing: false, error: firstError });
    return changed || communityChanged || fpChanged;
  },

  refreshCommunity: async (metros) => {
    if (!communityEnabled) return false;
    // Loaded on demand so builds and tests without the community database never pull in its client.
    const { fetchLiveShows } = await import('./community/api');
    let changed = false;
    for (const metro of metros ?? currentMetros()) {
      // A failure here is ignored: the provider listings are what the app depends on.
      const res = await fetchLiveShows(metro);
      if (!res.ok) continue;
      const id = `${COMMUNITY_FEED}${metro}`;
      const cur = get();
      const have = cur.feeds[id];
      const shows = withRetained(res.data, have?.shows ?? [], Object.keys(useApp.getState().decisions));
      const feed: MetroFeed = { generatedAt: new Date().toISOString(), attribution: [], shows, source: 'live' };
      const feeds = { ...cur.feeds, [id]: feed };
      set({ feeds, ...combine(feeds, cur.fpRows, cur.switches) });
      await save(id, feed, Object.keys(cur.feeds));
      changed = true;
    }
    return changed;
  },

  recombine: async () => {
    const cur = get();
    let feeds = cur.feeds;
    if (!flagOn('jambase_enabled')) {
      // The next refresh would replace these anyway; clear them now so nothing from JamBase stays on the phone.
      feeds = Object.fromEntries(
        Object.entries(cur.feeds).map(([id, f]) => [id, { ...f, shows: f.shows.filter((s) => s.source.provider !== 'jambase'), attribution: f.attribution.filter((a) => !/jambase/i.test(a)) }]),
      );
      const known = Object.keys(cur.feeds);
      for (const [id, f] of Object.entries(feeds)) if (f.shows.length !== cur.feeds[id].shows.length) await save(id, f, known);
    }
    set({ feeds, ...combine(feeds, cur.fpRows, cur.switches) });
  },

  refreshFirstParty: async (metros) => {
    if (!communityEnabled) return false;
    const { fetchFpShows, fetchSwitches } = await import('./fp/api');
    let changed = false;
    const sw = await fetchSwitches();
    if (sw.ok) {
      set({ switches: sw.data });
      AsyncStorage.setItem(SWITCH_KEY, JSON.stringify(sw.data)).catch(() => {});
      changed = true;
    }
    for (const metro of metros ?? currentMetros()) {
      // A failure here is ignored: the provider listings are what the app depends on.
      const res = await fetchFpShows(metro);
      if (!res.ok) continue;
      const cur = get();
      const keep = new Set(Object.keys(useApp.getState().decisions));
      const have = new Set(res.data.map((r) => r.id));
      const retained = (cur.fpRows[metro] ?? []).filter((r) => !have.has(r.id) && keep.has(`fp:${r.id}`));
      const rows = [...res.data, ...retained];
      const fpRows = { ...cur.fpRows, [metro]: rows };
      set({ fpRows, ...combine(cur.feeds, fpRows, get().switches) });
      AsyncStorage.setItem(`${FP_PREFIX}${metro}`, JSON.stringify(rows)).catch(() => {});
      changed = true;
    }
    if (changed) set(combine(get().feeds, get().fpRows, get().switches));
    return changed;
  },
}));

/** Lookup for code that is not a component (reminders). */
export function getShow(id: string): Show | undefined {
  return useListings.getState().byId[id];
}
