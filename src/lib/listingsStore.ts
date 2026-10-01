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

import { withRetained } from './listings/merge';
import { parseFeed } from './listings/validate';
import { DEFAULT_METRO } from './metros';
import { useApp } from './store';
import type { Show } from './types';

/**
 * Where the refresh job publishes each city's feed; {metro} is replaced by the
 * city id. Override at build time with EXPO_PUBLIC_LISTINGS_URL.
 */
export const LISTINGS_URL =
  process.env.EXPO_PUBLIC_LISTINGS_URL ?? 'https://github.com/hbnmusic/Show-up-app/releases/download/listings/shows-{metro}.json';

export const listingsUrl = (metro: string) => LISTINGS_URL.replace('{metro}', metro);

const CACHE_PREFIX = 'pull-up-listings-v2:';
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
};

const index = (shows: Show[]): Record<string, Show> => Object.fromEntries(shows.map((s) => [s.id, s]));

function combine(feeds: Record<string, MetroFeed>) {
  const byId = new Map<string, Show>();
  for (const f of Object.values(feeds)) for (const s of f.shows) if (!byId.has(s.id)) byId.set(s.id, s);
  const shows = [...byId.values()];
  const list = Object.values(feeds);
  const generatedAt = list.map((f) => f.generatedAt).filter(Boolean).sort().pop() ?? null;
  const attribution = [...new Set(list.flatMap((f) => f.attribution))];
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
    set({ feeds, ...combine(feeds), ready: true });
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
        const shows = withRetained(feed.shows, have?.shows ?? [], Object.keys(useApp.getState().decisions));
        const metroFeed: MetroFeed = { generatedAt: feed.generatedAt, attribution: feed.attribution, shows, source: 'live' };
        const feeds = { ...cur.feeds, [id]: metroFeed };
        set({ feeds, ...combine(feeds), checkedAt: { ...cur.checkedAt, [id]: Date.now() } });
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
    set({ refreshing: false, error: firstError });
    return changed;
  },
}));

/** Lookup for code that is not a component (reminders). */
export function getShow(id: string): Show | undefined {
  return useListings.getState().byId[id];
}
