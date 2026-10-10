import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { track } from './analyticsCore';
import { cleanRange } from './dateRange';
import {
  DEFAULT_FILTERS,
  DEFAULT_REMINDER_PREFS,
  type Decision,
  type Filters,
  type ReminderPrefs,
} from './types';

export type DecisionRecord = { decision: Decision; at: number };
export type Attendance = 'went' | 'skipped';

type AppState = {
  decisions: Record<string, DecisionRecord>;
  /** Shows swiped this session, newest last, for Undo. */
  history: string[];
  filters: Filters;
  reminderPrefs: ReminderPrefs;
  /** Per-show reminder switch; missing means on. */
  reminderOff: Record<string, true>;
  /** Shows sent to the phone calendar, with the time it was done. */
  calendarAdded: Record<string, number>;
  attendance: Record<string, Attendance>;
  autoplay: boolean;
  /** Deezer artist ids the user flagged as the wrong artist, per act name. */
  wrongArtist: Record<string, number[]>;
  notificationsAsked: boolean;
  /** The location prompt has been shown once. */
  placeAsked: boolean;
  hydrated: boolean;

  decide: (showId: string, decision: Decision) => void;
  clearDecision: (showId: string) => void;
  undo: () => string | null;
  setFilters: (f: Partial<Filters>) => void;
  resetFilters: () => void;
  setReminderPrefs: (p: Partial<ReminderPrefs>) => void;
  setShowReminders: (showId: string, on: boolean) => void;
  markCalendar: (showId: string) => void;
  setAttendance: (showId: string, a: Attendance | null) => void;
  setAutoplay: (on: boolean) => void;
  flagWrongArtist: (actName: string, artistId: number) => void;
  setNotificationsAsked: () => void;
  markPlaceAsked: () => void;
  resetAll: () => void;
};

const initial = {
  decisions: {},
  history: [],
  filters: DEFAULT_FILTERS,
  reminderPrefs: DEFAULT_REMINDER_PREFS,
  reminderOff: {},
  calendarAdded: {},
  attendance: {},
  autoplay: true,
  wrongArtist: {},
  notificationsAsked: false,
  placeAsked: false,
};

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      ...initial,
      hydrated: false,

      decide: (showId, decision) =>
        set((s) => ({
          decisions: { ...s.decisions, [showId]: { decision, at: Date.now() } },
          history: [...s.history.filter((id) => id !== showId), showId].slice(-50),
        })),

      clearDecision: (showId) =>
        set((s) => {
          const decisions = { ...s.decisions };
          delete decisions[showId];
          return { decisions, history: s.history.filter((id) => id !== showId) };
        }),

      undo: () => {
        const { history } = get();
        const last = history[history.length - 1];
        if (!last) return null;
        get().clearDecision(last);
        return last;
      },

      setFilters: (f) => {
        const prev = get().filters;
        set((s) => ({ filters: { ...s.filters, ...f } }));
        for (const k of Object.keys(f) as (keyof Filters)[]) {
          if (JSON.stringify(prev[k]) === JSON.stringify(f[k])) continue;
          if (k === 'place') {
            const metro = f.place?.metro;
            if (metro && metro !== prev.place?.metro) track('city_changed', { metro, source: f.place?.source });
          } else track('filter_changed', { filter: k });
        }
      },
      // Reset keeps the place: it is where the person is, not a preference to clear.
      resetFilters: () => {
        track('filter_changed', { filter: 'reset' });
        set((s) => ({ filters: { ...DEFAULT_FILTERS, place: s.filters.place } }));
      },

      setReminderPrefs: (p) => set((s) => ({ reminderPrefs: { ...s.reminderPrefs, ...p } })),

      setShowReminders: (showId, on) =>
        set((s) => {
          const reminderOff = { ...s.reminderOff };
          if (on) delete reminderOff[showId];
          else reminderOff[showId] = true;
          return { reminderOff };
        }),

      markCalendar: (showId) => set((s) => ({ calendarAdded: { ...s.calendarAdded, [showId]: Date.now() } })),

      setAttendance: (showId, a) =>
        set((s) => {
          const attendance = { ...s.attendance };
          if (a) attendance[showId] = a;
          else delete attendance[showId];
          return { attendance };
        }),

      setAutoplay: (on) => set({ autoplay: on }),

      flagWrongArtist: (actName, artistId) =>
        set((s) => {
          const key = actName.toLowerCase();
          const list = s.wrongArtist[key] ?? [];
          return { wrongArtist: { ...s.wrongArtist, [key]: [...new Set([...list, artistId])] } };
        }),

      setNotificationsAsked: () => set({ notificationsAsked: true }),
      markPlaceAsked: () => set({ placeAsked: true }),

      resetAll: () => set({ ...initial }),
    }),
    {
      name: 'setnik-state-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        decisions: s.decisions,
        filters: s.filters,
        reminderPrefs: s.reminderPrefs,
        reminderOff: s.reminderOff,
        calendarAdded: s.calendarAdded,
        attendance: s.attendance,
        autoplay: s.autoplay,
        wrongArtist: s.wrongArtist,
        notificationsAsked: s.notificationsAsked,
        placeAsked: s.placeAsked,
      }),
      // Filters saved by older builds have no place and carry an obsolete `areas` list.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const { areas: _areas, venueTypes: _venueTypes, age: _age, ...saved } = (p.filters ?? {}) as Record<string, unknown>;
        const genres = Array.isArray(saved.genres)
          ? [...new Set((saved.genres as string[]).map((g) => (g === 'Club & Techno' ? 'Electronic' : g)))]
          : [];
        const dates = cleanRange(saved.dates);
        const when = saved.when === 'dates' && !dates ? DEFAULT_FILTERS.when : saved.when;
        return { ...current, ...p, filters: { ...DEFAULT_FILTERS, ...saved, when, dates, previewOnly: saved.previewOnly === true, genres } as Filters };
      },
      onRehydrateStorage: () => () => {
        useApp.setState({ hydrated: true });
      },
    },
  ),
);

export function decisionOf(showId: string): Decision | undefined {
  return useApp.getState().decisions[showId]?.decision;
}
