/**
 * The listings the app shows. Starts from the bundled sample, switches to the
 * last downloaded feed, and replaces that whenever a fresh download succeeds.
 * A failed download never removes anything.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { SHOWS as SAMPLE } from '@/data/shows';

import { withRetained } from './listings/merge';
import { parseFeed } from './listings/validate';
import { useApp } from './store';
import type { Show } from './types';

/** Where the refresh job publishes the feed. Override at build time with EXPO_PUBLIC_LISTINGS_URL. */
export const LISTINGS_URL =
  process.env.EXPO_PUBLIC_LISTINGS_URL ?? 'https://github.com/hbnmusic/Show-up-app/releases/download/listings/shows.json';

const CACHE_KEY = 'pull-up-listings-cache-v1';
const RECHECK_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 20_000;

export type ListingsSource = 'sample' | 'cache' | 'live';

type ListingsState = {
  shows: Show[];
  byId: Record<string, Show>;
  source: ListingsSource;
  generatedAt: string | null;
  attribution: string[];
  checkedAt: number | null;
  refreshing: boolean;
  error: string | null;
  /** The cached feed has been read (or there was none); safe to show screens. */
  ready: boolean;

  loadCache: () => Promise<void>;
  refresh: (opts?: { force?: boolean }) => Promise<boolean>;
};

const index = (shows: Show[]): Record<string, Show> => Object.fromEntries(shows.map((s) => [s.id, s]));

export const useListings = create<ListingsState>()((set, get) => ({
  shows: SAMPLE,
  byId: index(SAMPLE),
  source: 'sample',
  generatedAt: null,
  attribution: [],
  checkedAt: null,
  refreshing: false,
  error: null,
  ready: false,

  loadCache: async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      const parsed = raw ? parseFeed(JSON.parse(raw)) : null;
      if (parsed && parsed.feed.shows.length > 0) {
        const { shows, generatedAt, attribution } = parsed.feed;
        // Anything the user already decided on stays reachable even if it is only in the sample.
        const kept = withRetained(shows, get().shows, Object.keys(useApp.getState().decisions));
        set({ shows: kept, byId: index(kept), source: 'cache', generatedAt, attribution });
      }
    } catch {
      // A damaged cache is the same as no cache.
    }
    set({ ready: true });
  },

  refresh: async ({ force = false } = {}) => {
    const st = get();
    if (st.refreshing || !LISTINGS_URL) return false;
    if (!force && st.checkedAt && Date.now() - st.checkedAt < RECHECK_MS) return false;
    set({ refreshing: true, error: null });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(LISTINGS_URL, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Listings server answered ${res.status}`);
      const parsed = parseFeed(await res.json());
      if (!parsed) throw new Error('The download was not a listings feed');
      const { feed } = parsed;
      if (feed.shows.length === 0) throw new Error('The feed had no usable shows');
      const cur = get();
      if (cur.generatedAt && feed.generatedAt && feed.generatedAt < cur.generatedAt) {
        // Older than what is already here (a stale mirror); keep what we have.
        set({ refreshing: false, checkedAt: Date.now() });
        return false;
      }
      const shows = withRetained(feed.shows, cur.shows, Object.keys(useApp.getState().decisions));
      set({
        shows,
        byId: index(shows),
        source: 'live',
        generatedAt: feed.generatedAt,
        attribution: feed.attribution,
        checkedAt: Date.now(),
        refreshing: false,
        error: null,
      });
      AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ version: 1, generatedAt: feed.generatedAt, attribution: feed.attribution, shows }),
      ).catch(() => {});
      return true;
    } catch (e) {
      const message = e instanceof Error && e.name === 'AbortError' ? 'The listings server took too long' : e instanceof Error ? e.message : 'Could not reach the listings server';
      set({ refreshing: false, error: message });
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
}));

/** Lookup for code that is not a component (reminders). */
export function getShow(id: string): Show | undefined {
  return useListings.getState().byId[id];
}
