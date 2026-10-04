/**
 * Remote kill switches in the app. Read at launch and whenever the app returns to the front, at most every 15 minutes;
 * the last values are cached on the phone and used if the server cannot be reached. Defaults (everything ON) apply only
 * when the flags have never been fetched. See supabase/KILL_SWITCHES.md.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './communityConfig';
import { DEFAULT_FLAGS, FLAG_REFRESH_MS, fetchFlagsHttp, flagsStale, isOn, parseFlags, type FlagKey, type Flags } from './flagsCore';

const KEY = 'pull-up-flags-v1';
/** After a failed attempt, wait this long before trying again (the 15-minute rule applies once values have been fetched). */
const RETRY_MS = 60 * 1000;

export type FlagsDeps = {
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  fetchRemote: () => Promise<Flags | null>;
  now: () => number;
};

export type FlagsState = {
  flags: Flags;
  /** When the flags were last fetched from the server (ms), or null if never. */
  fetchedAt: number | null;
  lastAttemptAt: number | null;
  loaded: boolean;
  /** Reads the cached copy. */
  load: () => Promise<void>;
  /** Fetches if the cached copy is older than 15 minutes (or `force`). Returns true when the values changed. */
  refresh: (opts?: { force?: boolean }) => Promise<boolean>;
};

const same = (a: Flags, b: Flags) => JSON.stringify(a) === JSON.stringify(b);

export function createFlagsStore(deps: FlagsDeps) {
  return create<FlagsState>()((set, get) => ({
    flags: DEFAULT_FLAGS,
    fetchedAt: null,
    lastAttemptAt: null,
    loaded: false,

    load: async () => {
      try {
        const raw = await deps.load();
        const saved = raw ? (JSON.parse(raw) as { fetchedAt?: unknown; flags?: unknown }) : null;
        if (saved && typeof saved.fetchedAt === 'number') {
          set({ flags: parseFlags(saved.flags), fetchedAt: saved.fetchedAt, loaded: true });
          return;
        }
      } catch {
        // A damaged copy is the same as none.
      }
      set({ loaded: true });
    },

    refresh: async ({ force = false } = {}) => {
      const { fetchedAt, lastAttemptAt, flags: before } = get();
      const now = deps.now();
      if (!force) {
        if (!flagsStale(fetchedAt, now)) return false;
        if (lastAttemptAt != null && now - lastAttemptAt < RETRY_MS && now >= lastAttemptAt) return false;
      }
      set({ lastAttemptAt: now });
      const fresh = await deps.fetchRemote();
      if (!fresh) return false; // keep the last known values
      set({ flags: fresh, fetchedAt: now });
      deps.save(JSON.stringify({ fetchedAt: now, flags: fresh })).catch(() => {});
      return !same(before, fresh);
    },
  }));
}

export const useFlags = createFlagsStore({
  load: () => AsyncStorage.getItem(KEY),
  save: (v) => AsyncStorage.setItem(KEY, v),
  fetchRemote: () => fetchFlagsHttp(SUPABASE_URL, SUPABASE_ANON_KEY),
  now: () => Date.now(),
});

/** Outside a component (background task, reminders, previews). */
export const flagOn = (key: FlagKey): boolean => isOn(useFlags.getState().flags, key);

/** Inside a component: re-renders when the switch changes. */
export const useFlag = (key: FlagKey): boolean => useFlags((s) => isOn(s.flags, key));

export { FLAG_REFRESH_MS };
