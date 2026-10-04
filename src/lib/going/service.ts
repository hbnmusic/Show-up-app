/**
 * Connects Going counts to the app: watches Going changes, sends them in the background, fetches counts, and runs the
 * Settings switch. Every call is fire-and-forget: a failure here never reaches the swipe or the Going list.
 */
import { useFlags } from '../flags';
import { isOn } from '../flagsCore';
import { getShow } from '../listingsStore';
import { useApp } from '../store';
import { wall } from '../time';
import { forgetMyGoing, getGoingCounts, setGoing } from './api';
import { diffGoing, localDate, queueChanges, shouldShowNote } from './core';
import { useGoing } from './store';
import { flushGoing, refreshCounts, type CountsDeps, type FlushDeps } from './sync';

export const goingFlagOn = () => isOn(useFlags.getState().flags, 'going_counts_enabled');

/** The show's local date (venue-local), or null when the show is not in the downloaded listings. */
export function showDate(id: string): string | null {
  const s = getShow(id);
  if (!s) return null;
  try {
    return localDate(wall(s.startsAt));
  } catch {
    return null;
  }
}

const today = () => localDate(new Date());

function flushDeps(): FlushDeps {
  const g = useGoing;
  return {
    now: () => Date.now(),
    flagOn: goingFlagOn,
    includeOn: () => g.getState().include,
    getQueue: () => g.getState().queue,
    setQueue: (q) => g.getState().setQueue(q),
    send: (changes) => setGoing(g.getState().goingId, changes),
  };
}

export function flushNow(): void {
  flushGoing(flushDeps()).catch(() => {});
}

function countsDeps(): CountsDeps {
  return {
    now: () => Date.now(),
    flagOn: goingFlagOn,
    get: () => useGoing.getState().counts,
    set: (c) => useGoing.getState().setCounts(c),
    fetch: (ids) => getGoingCounts(ids),
  };
}

/** Fetch counts for one list ("deck" or "going"). At most once every 15 minutes per list; nothing is shown on failure. */
export function refreshGoingCounts(list: 'deck' | 'going', ids: string[]): void {
  refreshCounts(countsDeps(), list, ids).catch(() => {});
}

/** Called for every change to the Going list. Never throws. */
export function onGoingChanges(changes: { showId: string; going: boolean }[]): void {
  try {
    const s = useGoing.getState();
    if (shouldShowNote(s, changes)) s.showNote();
    const next = queueChanges(useGoing.getState(), changes, showDate, Date.now(), goingFlagOn());
    if (next !== useGoing.getState()) useGoing.getState().update(next);
    flushNow();
  } catch {
    // Going stays local.
  }
}

/** Start watching the Going list. Call once the saved decisions are loaded. Returns the stop function. */
export function startGoingWatcher(): () => void {
  const unsub = useApp.subscribe((s, prev) => {
    if (s.decisions === prev.decisions) return;
    const changes = diffGoing(prev.decisions, s.decisions);
    if (changes.length) onGoingChanges(changes);
  });
  flushNow(); // anything left in the queue from last time
  return unsub;
}

/** The Going ids to send again after the switch or the kill switch comes back on. */
export function currentGoingIds(): string[] {
  return Object.entries(useApp.getState().decisions)
    .filter(([, r]) => r.decision === 'going')
    .map(([id]) => id);
}

/** Settings switch. OFF deletes this phone's rows on the server and stops sending; ON re-sends the current Going list. */
export function setIncludeInCounts(on: boolean): void {
  const g = useGoing.getState();
  if (!on) {
    g.turnOff();
    forgetMyGoing(g.goingId).catch(() => {});
    return;
  }
  g.turnOn(currentGoingIds(), showDate, Date.now(), today());
  flushNow();
}

/** The kill switch came back on: send the current Going list again (the server rows were purged while it was off). */
export function resendAfterFlagOn(): void {
  const g = useGoing.getState();
  if (!g.include) return;
  g.turnOn(currentGoingIds(), showDate, Date.now(), today());
  flushNow();
}

/** "Reset all data on this phone": remove this phone's rows, then start with a new random id. */
export function resetGoing(): void {
  const g = useGoing.getState();
  const old = g.goingId;
  g.reset();
  forgetMyGoing(old).catch(() => {});
}

/** The count to show for a show, or null (hidden). Never zero, never a local guess. */
export function countFor(byId: Record<string, number>, id: string): number | null {
  const n = byId[id];
  return typeof n === 'number' && n >= 1 ? n : null;
}
