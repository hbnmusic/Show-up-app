/**
 * What the phone keeps for Going counts: the random going id, the Settings switch, the one-time note, the queue of changes
 * waiting to be sent, and the cached counts. Going itself (the swipe, the Going list) stays in the main store and never
 * waits on any of this.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { uuid } from '../analyticsCore';
import { switchOff, switchOn, type GoingLocal } from './core';
import { EMPTY_QUEUE, type GoingQueue } from './queue';
import { EMPTY_COUNTS, type CountsCache } from './sync';

const KEY = 'setnik-going-v1';

type GoingStore = GoingLocal & {
  loaded: boolean;
  /** The one-time note is on screen until the person dismisses it or leaves the screen. */
  noteVisible: boolean;
  counts: CountsCache;
  load: () => Promise<void>;
  setQueue: (q: GoingQueue) => void;
  setCounts: (c: CountsCache) => void;
  update: (s: GoingLocal) => void;
  showNote: () => void;
  hideNote: () => void;
  turnOff: () => void;
  turnOn: (goingIds: string[], dateOf: (id: string) => string | null, now: number, today: string) => void;
  /** "Reset all data on this phone": a new random id; the old id's rows are removed by the caller first. */
  reset: () => void;
};

const persist = (s: GoingStore) =>
  AsyncStorage.setItem(KEY, JSON.stringify({ goingId: s.goingId, include: s.include, noteShown: s.noteShown, queue: s.queue })).catch(() => {});

export const useGoing = create<GoingStore>()((set, get) => ({
  goingId: uuid(),
  include: true,
  noteShown: false,
  queue: EMPTY_QUEUE,
  loaded: false,
  noteVisible: false,
  counts: EMPTY_COUNTS,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const o = raw ? (JSON.parse(raw) as Partial<GoingLocal>) : null;
      if (o && typeof o.goingId === 'string' && o.goingId.length > 0) {
        const q = o.queue && typeof o.queue === 'object' && o.queue.pending && typeof o.queue.pending === 'object' ? o.queue : EMPTY_QUEUE;
        set({ goingId: o.goingId, include: o.include !== false, noteShown: o.noteShown === true, queue: { pending: q.pending, retryAt: typeof q.retryAt === 'number' ? q.retryAt : null, failures: typeof q.failures === 'number' ? q.failures : 0 }, loaded: true });
        return;
      }
    } catch {
      // A damaged copy is the same as none.
    }
    set({ loaded: true });
    persist(get());
  },
  setQueue: (queue) => {
    set({ queue });
    persist(get());
  },
  setCounts: (counts) => set({ counts }),
  update: (s) => {
    set({ goingId: s.goingId, include: s.include, noteShown: s.noteShown, queue: s.queue });
    persist(get());
  },
  showNote: () => {
    set({ noteVisible: true, noteShown: true });
    persist(get());
  },
  hideNote: () => set({ noteVisible: false }),
  turnOff: () => get().update(switchOff(get())),
  turnOn: (ids, dateOf, now, today) => get().update(switchOn(get(), ids, dateOf, now, today)),
  reset: () => {
    set({ goingId: uuid(), include: true, noteShown: false, queue: EMPTY_QUEUE, noteVisible: false, counts: EMPTY_COUNTS });
    persist(get());
  },
}));
