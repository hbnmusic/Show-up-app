/**
 * What the app keeps on the phone for retention notifications: the two toggles, the planner's state (send history, last-seen
 * show ids per city, the unopened streak) and the "New" chip. All of it stays on the phone; none is sent anywhere.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { Genre } from '../types';
import { EMPTY_STATE, type NotifType, type RetentionState } from './planner';
import type { TapRestore } from './tap';

const KEY = 'setnik-retention-v1';

export type NewChip = { city: string; ids: string[]; /** Filters to put back when the chip is cleared. */ restore: TapRestore | null };
export type PendingOpen = { type: NotifType; genre: Genre | null };

type Persisted = { typeA: boolean; typeB: boolean; state: RetentionState };

type RetentionStore = {
  loaded: boolean;
  /** Toggles in Settings. On by default; a notification also needs the system permission. */
  typeA: boolean;
  typeB: boolean;
  state: RetentionState;
  /** Set when a notification was tapped; the deck screen applies it once and clears it. */
  pendingOpen: PendingOpen | null;
  newChip: NewChip | null;

  load: () => Promise<void>;
  setToggle: (type: NotifType, on: boolean) => void;
  setState: (state: RetentionState) => void;
  setPendingOpen: (p: PendingOpen | null) => void;
  setNewChip: (c: NewChip | null) => void;
  /** "Reset all data on this phone". */
  reset: () => void;
};

function sanitize(raw: unknown): Persisted {
  const o = typeof raw === 'object' && raw ? (raw as Partial<Persisted>) : {};
  const s = o.state && typeof o.state === 'object' && (o.state as RetentionState).v === 1 ? (o.state as RetentionState) : EMPTY_STATE;
  return {
    typeA: o.typeA !== false,
    typeB: o.typeB !== false,
    state: {
      ...EMPTY_STATE,
      ...s,
      sent: Array.isArray(s.sent) ? s.sent.filter((e) => e && (e.type === 'A' || e.type === 'B') && typeof e.at === 'number') : [],
      seen: s.seen && typeof s.seen === 'object' ? s.seen : {},
      unreported: Array.isArray(s.unreported) ? s.unreported.filter((t) => t === 'A' || t === 'B') : [],
    },
  };
}

const persist = (s: RetentionStore) =>
  AsyncStorage.setItem(KEY, JSON.stringify({ typeA: s.typeA, typeB: s.typeB, state: s.state } satisfies Persisted)).catch(() => {});

export const useRetention = create<RetentionStore>()((set, get) => ({
  loaded: false,
  typeA: true,
  typeB: true,
  state: EMPTY_STATE,
  pendingOpen: null,
  newChip: null,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const p = sanitize(raw ? JSON.parse(raw) : null);
      set({ typeA: p.typeA, typeB: p.typeB, state: p.state, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setToggle: (type, on) => {
    set(type === 'A' ? { typeA: on } : { typeB: on });
    persist(get());
  },
  setState: (state) => {
    set({ state });
    persist(get());
  },
  setPendingOpen: (pendingOpen) => set({ pendingOpen }),
  setNewChip: (newChip) => set({ newChip }),
  reset: () => {
    set({ typeA: true, typeB: true, state: EMPTY_STATE, pendingOpen: null, newChip: null });
    persist(get());
  },
}));
