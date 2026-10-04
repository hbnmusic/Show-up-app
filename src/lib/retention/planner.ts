/**
 * Retention notifications: which one (if any) to schedule right now. Pure: the clock and the time zone are passed in, so
 * every rule is tested without a phone. Nothing here sends or stores anything.
 *
 * Two kinds, both created on the phone from listings it already downloaded:
 *   A  "[N] new shows just added in [City], check them out!"
 *   B  "[N] [Genre] shows tonight near you, check them out!"   (or "[N] shows tonight in [City], check them out!")
 */
import { inWhen, isUpcoming, placeOk } from '../filters';
import type { Decision, Filters, Genre, Show } from '../types';

type DecisionRecord = { decision: Decision; at: number };

export type NotifType = 'A' | 'B';

export type PlanConfig = {
  minA: number;
  minB: number;
  /** Type A at most once in this many hours. */
  gapAHours: number;
  /** All notifications together: at most this many in any 7 days. */
  maxPerWeek: number;
  /** No notifications from quietStart (inclusive) to quietEnd (exclusive), city-local hours. */
  quietStartHour: number;
  quietEndHour: number;
  /** Skip if the app was opened within this many hours. */
  skipAfterOpenHours: number;
  /** Skip if the phone last downloaded the city's listings longer ago than this. */
  staleFeedHours: number;
  /** After this many notifications in a row that were never opened, pause. */
  pauseAfterUnopened: number;
  pauseDays: number;
  /** City-local send windows, minutes after midnight, [start, end). */
  windowA: readonly [number, number];
  windowB: readonly [number, number];
  /** A window that opens within this many hours may be scheduled ahead of time (the background task runs at the system's discretion). */
  lookaheadHours: number;
  /** Genre choice by Going swipes. */
  genreWindowDays: number;
  genreMinGoing: number;
};

export const DEFAULT_PLAN: PlanConfig = {
  minA: 5,
  minB: 3,
  gapAHours: 48,
  maxPerWeek: 4,
  quietStartHour: 21,
  quietEndHour: 9,
  skipAfterOpenHours: 6,
  staleFeedHours: 48,
  pauseAfterUnopened: 5,
  pauseDays: 14,
  windowA: [17 * 60, 19 * 60],
  windowB: [15 * 60 + 30, 17 * 60 + 30],
  lookaheadHours: 4,
  genreWindowDays: 60,
  genreMinGoing: 3,
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** A notification due this long after planning is "right now". */
const SEND_DELAY_MS = 60_000;
/** When scheduling ahead, aim this far into the window so a slightly late clock still lands inside it. */
const INTO_WINDOW_MS = 5 * 60_000;

// ---- persisted state (kept on the phone; see store.ts) ------------------------------------------------------------------

export type SentEntry = { type: NotifType; /** When it is due (ms). */ at: number; /** Scheduled but not yet due. Cancelled if the app is opened first. */ pending: boolean };

export type RetentionState = {
  v: 1;
  sent: SentEntry[];
  lastAppOpenAt: number | null;
  /** Delivered notifications in a row that were never tapped. */
  unopened: number;
  pausedUntil: number | null;
  /** Last-seen show ids per city (type A baseline), most recently used city last. */
  seen: Record<string, string[]>;
  /** Types scheduled in the background that have not yet been counted in analytics. */
  unreported: NotifType[];
};

export const EMPTY_STATE: RetentionState = { v: 1, sent: [], lastAppOpenAt: null, unopened: 0, pausedUntil: null, seen: {}, unreported: [] };

// ---- city-local clock -----------------------------------------------------------------------------------------------------

export type LocalClock = { dateKey: string; minutes: number };

/** The date and minutes-after-midnight on the wall clocks of `tz` at instant `at`. Falls back to the phone's own zone if `tz` is unknown. */
export function localClock(at: Date, tz: string): LocalClock {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { dateKey: `${get('year')}-${get('month')}-${get('day')}`, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

const inQuiet = (minutes: number, cfg: PlanConfig) => minutes >= cfg.quietStartHour * 60 || minutes < cfg.quietEndHour * 60;

// ---- state transitions (pure) ------------------------------------------------------------------------------------------

const MAX_SENT = 30;
/** Last-seen ids per city are bounded: this many ids, for this many cities. */
export const MAX_SEEN_IDS = 4000;
export const MAX_SEEN_CITIES = 6;

/** Marks scheduled notifications that have come due as delivered, and ends an expired pause. */
export function settle(s: RetentionState, now: number, cfg: PlanConfig = DEFAULT_PLAN): RetentionState {
  let { unopened, pausedUntil } = s;
  const sent = s.sent.map((e) => {
    if (!e.pending || e.at > now) return e;
    unopened += 1;
    return { ...e, pending: false };
  });
  if (unopened >= cfg.pauseAfterUnopened && pausedUntil == null) {
    const last = Math.max(...sent.filter((e) => !e.pending).map((e) => e.at), now);
    pausedUntil = last + cfg.pauseDays * DAY;
  }
  if (pausedUntil != null && now >= pausedUntil) {
    pausedUntil = null;
    unopened = 0;
  }
  return { ...s, sent: sent.filter((e) => now - e.at < 14 * DAY).slice(-MAX_SENT), unopened, pausedUntil };
}

export function recordScheduled(s: RetentionState, type: NotifType, dueAt: number): RetentionState {
  return { ...s, sent: [...s.sent, { type, at: dueAt, pending: true }].slice(-MAX_SENT), unreported: [...s.unreported, type].slice(-10) };
}

/** The app came to the front: notifications still waiting to fire are dropped (the person is here), and the clock for "recently opened" restarts. */
export function onAppOpened(s: RetentionState, now: number): { state: RetentionState; cancelPending: boolean } {
  const settled = settle(s, now);
  const cancelPending = settled.sent.some((e) => e.pending);
  return { state: { ...settled, sent: settled.sent.filter((e) => !e.pending), lastAppOpenAt: now }, cancelPending };
}

export function onNotificationOpened(s: RetentionState, now: number): RetentionState {
  return { ...settle(s, now), unopened: 0, pausedUntil: null, lastAppOpenAt: now };
}

/** Replaces the last-seen set for a city (bounded in size and in number of cities). */
export function markSeen(s: RetentionState, city: string, ids: string[]): RetentionState {
  const { [city]: _old, ...rest } = s.seen;
  const kept = Object.entries(rest).slice(-(MAX_SEEN_CITIES - 1));
  return { ...s, seen: { ...Object.fromEntries(kept), [city]: [...new Set(ids)].slice(-MAX_SEEN_IDS) } };
}

// ---- counting ---------------------------------------------------------------------------------------------------------------

export type PlanInput = {
  now: Date;
  /** The city's IANA time zone. */
  tz: string;
  city: { id: string; name: string };
  enabled: { flag: boolean; metro: boolean; permission: boolean; typeA: boolean; typeB: boolean };
  state: RetentionState;
  /** When the phone last downloaded this city's listings (ms), or null if it never has. */
  feedUpdatedAt: number | null;
  shows: Show[];
  filters: Filters;
  decisions: Record<string, DecisionRecord>;
  config?: Partial<PlanConfig>;
};

/** Upcoming, undecided shows in the selected city and radius, which is what the deck would offer. */
function deckShows(i: PlanInput): Show[] {
  return i.shows.filter((s) => s.venue.metro === i.city.id && isUpcoming(s, i.now) && !i.decisions[s.id] && placeOk(s, i.filters));
}

/** Shows in the deck that were not in the last-seen set. Null when there is no baseline yet (the first run only records one). */
export function newShows(i: PlanInput): Show[] | null {
  const seen = i.state.seen[i.city.id];
  if (!seen) return null;
  const known = new Set(seen);
  return deckShows(i).filter((s) => !known.has(s.id));
}

export const tonightShows = (i: PlanInput): Show[] => deckShows(i).filter((s) => inWhen(s, 'tonight', i.now));

/** Going swipes in the last `windowDays` per genre, from shows still on the phone. Untagged shows are ignored. */
export function goingCounts(i: PlanInput, cfg: PlanConfig): Map<Genre, number> {
  const byId = new Map(i.shows.map((s) => [s.id, s]));
  const since = i.now.getTime() - cfg.genreWindowDays * DAY;
  const out = new Map<Genre, number>();
  for (const [id, rec] of Object.entries(i.decisions)) {
    if (rec.decision !== 'going' || rec.at < since) continue;
    const s = byId.get(id);
    if (!s) continue;
    for (const g of new Set(s.genres)) out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/**
 * The genre for a type B notification, or null for the generic wording.
 * 1. An active genre filter; with several, the one with the most Going swipes (ties: more shows tonight, then filter order).
 * 2. Otherwise the genre with the most Going swipes in the last 60 days, if it has at least 3 (ties: more shows tonight, then name).
 */
export function chooseGenre(i: PlanInput, cfg: PlanConfig, tonight: Show[]): Genre | null {
  const counts = goingCounts(i, cfg);
  const tonightBy = (g: Genre) => tonight.filter((s) => s.genres.includes(g)).length;
  const rank = (a: Genre, b: Genre) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || tonightBy(b) - tonightBy(a);
  if (i.filters.genres.length) {
    return [...i.filters.genres].sort(rank)[0]; // stable: ties keep filter order
  }
  const eligible = [...counts.entries()].filter(([, n]) => n >= cfg.genreMinGoing).map(([g]) => g);
  if (!eligible.length) return null;
  return eligible.sort((a, b) => rank(a, b) || a.localeCompare(b))[0];
}

// ---- the plan ------------------------------------------------------------------------------------------------------------------

export type SkipReason =
  | 'switched_off'
  | 'city_off'
  | 'no_permission'
  | 'both_off'
  | 'paused'
  | 'recently_opened'
  | 'stale_feed'
  | 'quiet_hours'
  | 'daily_cap'
  | 'weekly_cap'
  | 'nothing_due';

export type Plan =
  | { send: false; reason: SkipReason; considered?: { A: string; B: string } }
  | { send: true; type: NotifType; n: number; genre: Genre | null; title: string; body: string; sendAt: Date; /** Deep link opened when tapped. */ url: string; considered: { A: string; B: string } };

/** "Rock", "Hip-Hop & R&B" read fine in a sentence; the genre name goes in as it is. */
export function templateA(n: number, city: string): { title: string; body: string } {
  return { title: 'New shows', body: `${n} new shows just added in ${city}, check them out!` };
}
export function templateB(n: number, city: string, genre: Genre | null): { title: string; body: string } {
  return { title: 'Tonight', body: genre ? `${n} ${genre} shows tonight near you, check them out!` : `${n} shows tonight in ${city}, check them out!` };
}

type Timing = { kind: 'in_window' | 'upcoming' | 'passed' | 'far'; sendAt?: Date };

function timingFor(win: readonly [number, number], clock: LocalClock, now: Date, cfg: PlanConfig): Timing {
  if (clock.minutes >= win[1]) return { kind: 'passed' };
  if (clock.minutes >= win[0]) return { kind: 'in_window', sendAt: new Date(now.getTime() + SEND_DELAY_MS) };
  const minutesUntil = win[0] - clock.minutes;
  if (minutesUntil > cfg.lookaheadHours * 60) return { kind: 'far' };
  return { kind: 'upcoming', sendAt: new Date(now.getTime() + minutesUntil * 60_000 + INTO_WINDOW_MS) };
}

/** True if `at`, on the city's clock, falls inside [start, end). Guards a computed send time against a clock change in between. */
function insideWindow(at: Date, tz: string, win: readonly [number, number]): boolean {
  const m = localClock(at, tz).minutes;
  return m >= win[0] && m < win[1];
}

export function planRetention(input: PlanInput): Plan {
  const cfg: PlanConfig = { ...DEFAULT_PLAN, ...input.config };
  const now = input.now.getTime();
  const e = input.enabled;
  if (!e.flag) return { send: false, reason: 'switched_off' };
  if (!e.metro) return { send: false, reason: 'city_off' };
  if (!e.permission) return { send: false, reason: 'no_permission' };
  if (!e.typeA && !e.typeB) return { send: false, reason: 'both_off' };

  const st = settle(input.state, now, cfg);
  if (st.pausedUntil != null && now < st.pausedUntil) return { send: false, reason: 'paused' };
  if (st.lastAppOpenAt != null && now - st.lastAppOpenAt < cfg.skipAfterOpenHours * HOUR) return { send: false, reason: 'recently_opened' };
  if (input.feedUpdatedAt == null || now - input.feedUpdatedAt > cfg.staleFeedHours * HOUR) return { send: false, reason: 'stale_feed' };

  const clock = localClock(input.now, input.tz);
  if (inQuiet(clock.minutes, cfg)) return { send: false, reason: 'quiet_hours' };

  const live = st.sent; // delivered or still waiting; cancelled ones were removed when the app opened
  if (live.some((s) => localClock(new Date(s.at), input.tz).dateKey === clock.dateKey)) return { send: false, reason: 'daily_cap' };
  if (live.filter((s) => now - s.at < 7 * DAY).length >= cfg.maxPerWeek) return { send: false, reason: 'weekly_cap' };

  const withState: PlanInput = { ...input, state: st };
  const considered = { A: 'off', B: 'off' };

  // Type B: tonight.
  let b: { n: number; genre: Genre | null; sendAt: Date } | null = null;
  if (e.typeB) {
    const t = timingFor(cfg.windowB, clock, input.now, cfg);
    if (t.kind === 'passed' || t.kind === 'far' || !t.sendAt || !insideWindow(t.sendAt, input.tz, cfg.windowB)) considered.B = t.kind === 'passed' ? 'window_passed' : 'window_not_open';
    else {
      const tonight = tonightShows(withState);
      const genre = chooseGenre(withState, cfg, tonight);
      const n = genre ? tonight.filter((s) => s.genres.includes(genre)).length : tonight.length;
      if (n < cfg.minB) considered.B = `below_minimum:${n}`;
      else {
        considered.B = 'eligible';
        b = { n, genre, sendAt: t.sendAt };
      }
    }
  }
  if (b) {
    const tpl = templateB(b.n, input.city.name, b.genre);
    const q = new URLSearchParams({ rt: 'B' });
    if (b.genre) q.set('g', b.genre);
    return { send: true, type: 'B', n: b.n, genre: b.genre, ...tpl, sendAt: b.sendAt, url: `/?${q}`, considered };
  }

  // Type A: new shows.
  if (e.typeA) {
    const lastA = Math.max(0, ...st.sent.filter((s) => s.type === 'A').map((s) => s.at));
    const t = timingFor(cfg.windowA, clock, input.now, cfg);
    if (lastA && now - lastA < cfg.gapAHours * HOUR) considered.A = 'sent_within_48h';
    else if (t.kind === 'passed' || t.kind === 'far' || !t.sendAt || !insideWindow(t.sendAt, input.tz, cfg.windowA)) considered.A = t.kind === 'passed' ? 'window_passed' : 'window_not_open';
    else {
      const fresh = newShows(withState);
      if (!fresh) considered.A = 'no_baseline';
      else if (fresh.length < cfg.minA) considered.A = `below_minimum:${fresh.length}`;
      else {
        const tpl = templateA(fresh.length, input.city.name);
        return { send: true, type: 'A', n: fresh.length, genre: null, ...tpl, sendAt: t.sendAt, url: '/?rt=A', considered: { ...considered, A: 'eligible' } };
      }
    }
  }
  return { send: false, reason: 'nothing_due', considered };
}
