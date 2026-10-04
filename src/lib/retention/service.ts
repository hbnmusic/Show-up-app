/**
 * Connects the retention planner to the app: reads the stores, schedules through the system, and handles the app opening,
 * going to the background, and a notification being tapped. Everything here runs on the phone.
 */

import { track } from '../analyticsCore';
import { useFlags, flagOn } from '../flags';
import { useListings } from '../listingsStore';
import { metroById } from '../metros';
import { useApp } from '../store';
import type { Genre } from '../types';
import { ALL_GENRES } from '../types';
import { cancelRetentionNotifications } from './cancel';
import { permissionGranted, scheduleRetention, scheduleTest } from './notify';
import { runRetentionCheck, type CheckDeps, type CheckResult } from './orchestrate';
import {
  chooseGenre,
  DEFAULT_PLAN,
  markSeen,
  newShows,
  onAppOpened,
  onNotificationOpened,
  templateA,
  templateB,
  tonightShows,
  type NotifType,
  type PlanInput,
  type RetentionState,
} from './planner';
import { planTap, parseTapUrl } from './tap';
import { useRetention } from './store';

/** Reads every store the planner needs, after making sure they are loaded (in the background the app's screens never ran). */
export async function ensureLoaded(): Promise<void> {
  if (!useApp.getState().hydrated) await useApp.persist.rehydrate();
  if (!useFlags.getState().loaded) await useFlags.getState().load();
  if (!useListings.getState().ready) await useListings.getState().loadCache();
  if (!useRetention.getState().loaded) await useRetention.getState().load();
}

type Gathered = NonNullable<Awaited<ReturnType<CheckDeps['gather']>>>;

/** The planner's view of this phone right now, or null when no city is selected yet. */
export function gather(): Gathered | null {
  const app = useApp.getState();
  const metroId = app.filters.place?.metro;
  const metro = metroById(metroId);
  if (!metro) return null;
  const r = useRetention.getState();
  return {
    tz: metro.tz,
    city: { id: metro.id, name: metro.name },
    enabled: { metro: metro.notificationsEnabled, typeA: r.typeA, typeB: r.typeB },
    feedUpdatedAt: useListings.getState().lastDownloadAt[metro.id] ?? null,
    shows: useListings.getState().shows,
    filters: app.filters,
    decisions: app.decisions,
  };
}

export function realDeps(): CheckDeps {
  return {
    now: () => new Date(),
    notificationsFlagOn: async () => {
      await useFlags.getState().refresh().catch(() => false);
      return flagOn('notifications_enabled');
    },
    gather: async () => gather(),
    refreshFeed: async (cityId) => {
      await useListings.getState().refresh({ metros: [cityId] }).catch(() => false);
    },
    gatherAfterRefresh: async () => gather(),
    permissionGranted,
    loadState: async () => useRetention.getState().state,
    saveState: async (s) => useRetention.getState().setState(s),
    schedule: scheduleRetention,
    cancelAll: async () => void (await cancelRetentionNotifications()),
  };
}

/** One background check. Loads what the app would have loaded, then plans and schedules. */
export async function backgroundCheck(): Promise<CheckResult> {
  await ensureLoaded();
  return runRetentionCheck(realDeps());
}

// ---- the app coming to the front and going away -------------------------------------------------------------------------

/** The person opened the app: drop a notification still waiting to fire, report the ones scheduled in the background, restart the "recently opened" clock. */
export async function onForeground(): Promise<void> {
  await ensureLoaded();
  const r = useRetention.getState();
  const { state, cancelPending } = onAppOpened(r.state, Date.now());
  for (const t of state.unreported) track('notif_scheduled', { type: t });
  r.setState({ ...state, unreported: [] });
  if (cancelPending) await cancelRetentionNotifications();
}

/**
 * Called after a download in the foreground, and when the app goes to the background. A first look at a city records the
 * baseline for "new shows"; later, the baseline moves only when the app goes to the background, so what arrived while the
 * phone was idle is still "new" when a notification is tapped.
 */
export function noteSeen(opts: { background: boolean }): void {
  const r = useRetention.getState();
  const g = gather();
  if (!g || r.pendingOpen || r.newChip) return;
  const has = !!r.state.seen[g.city.id];
  if (has && !opts.background) return;
  const ids = g.shows.filter((s) => s.venue.metro === g.city.id).map((s) => s.id);
  if (ids.length === 0) return;
  let next: RetentionState = markSeen(r.state, g.city.id, ids);
  if (opts.background) next = { ...next, lastAppOpenAt: Date.now() };
  r.setState(next);
}

// ---- a notification was tapped ----------------------------------------------------------------------------------------

const handled = new Set<string>();

/** Returns true when the notification was a retention notification (so the caller does not also treat it as a show reminder). */
export function onNotificationTapped(id: string, data: Record<string, unknown> | undefined, sentAt: number | undefined): boolean {
  const kind = data?.kind;
  if (kind !== 'retention' && kind !== 'retention-test') return false;
  if (handled.has(id)) return true;
  handled.add(id);
  // A notification from days ago that the system hands back again is not a fresh tap.
  if (sentAt && Date.now() - sentAt > 24 * 3600_000) return true;
  const tap = parseTapUrl(data?.url);
  if (!tap) return true;
  const r = useRetention.getState();
  if (kind === 'retention') {
    r.setState(onNotificationOpened(r.state, Date.now()));
    track('notif_opened', { type: tap.type });
  }
  const genre = ALL_GENRES.includes(tap.genre as Genre) ? (tap.genre as Genre) : null;
  r.setPendingOpen({ type: tap.type, genre });
  return true;
}

/** Applies a pending tap to the deck. Called by the deck screen once listings and a city are ready. */
export function consumePendingOpen(): void {
  const r = useRetention.getState();
  const pending = r.pendingOpen;
  if (!pending) return;
  const app = useApp.getState();
  const g = gather();
  r.setPendingOpen(null);
  if (!g) return;
  const input: PlanInput = { ...g, enabled: { flag: true, permission: true, ...g.enabled }, now: new Date(), state: r.state };
  const ids = pending.type === 'A' ? (newShows(input) ?? []).map((s) => s.id) : [];
  const plan = planTap(pending.type, pending.genre, ids, app.filters);
  app.setFilters(plan.filters);
  r.setNewChip(plan.onlyIds && plan.restore ? { city: g.city.id, ids: plan.onlyIds, restore: plan.restore } : null);
}

export function clearNewChip(): void {
  const r = useRetention.getState();
  const chip = r.newChip;
  if (!chip) return;
  r.setNewChip(null);
  if (chip.restore) useApp.getState().setFilters(chip.restore);
}

// ---- Settings -------------------------------------------------------------------------------------------------------------

export function setRetentionToggle(type: NotifType, on: boolean): void {
  const r = useRetention.getState();
  r.setToggle(type, on);
  track('notif_setting_changed', { type, state: on ? 'on' : 'off' });
  if (!on) {
    cancelRetentionNotifications(type).catch(() => {});
    r.setState({ ...r.state, sent: r.state.sent.filter((e) => !(e.type === type && e.pending)) });
  }
  syncRetentionTask().catch(() => {});
}

export type TestResult = { ok: true; a: string; b: string } | { ok: false; reason: 'switched_off' | 'no_city' | 'city_off' | 'no_permission' };

/** Sends one test notification of each kind, with the real wording and this city's real counts, a few seconds from now. */
export async function sendTestNotifications(): Promise<TestResult> {
  await ensureLoaded();
  await useFlags.getState().refresh().catch(() => false);
  if (!flagOn('notifications_enabled')) return { ok: false, reason: 'switched_off' };
  const g = gather();
  if (!g) return { ok: false, reason: 'no_city' };
  if (!g.enabled.metro) return { ok: false, reason: 'city_off' };
  if (!(await permissionGranted())) return { ok: false, reason: 'no_permission' };
  const r = useRetention.getState();
  const input: PlanInput = { ...g, enabled: { flag: true, permission: true, ...g.enabled }, now: new Date(), state: r.state };
  const tonight = tonightShows(input);
  const genre = chooseGenre(input, DEFAULT_PLAN, tonight);
  const nB = genre ? tonight.filter((s) => s.genres.includes(genre)).length : tonight.length;
  const nA = newShows(input)?.length ?? 0;
  const a = templateA(nA, g.city.name);
  const b = templateB(nB, g.city.name, genre);
  const q = new URLSearchParams({ rt: 'B' });
  if (genre) q.set('g', genre);
  await scheduleTest('A', `Test: ${a.title}`, a.body, '/?rt=A', 3);
  await scheduleTest('B', `Test: ${b.title}`, b.body, `/?${q}`, 8);
  return { ok: true, a: a.body, b: b.body };
}

// ---- the background task is registered only while it can do something ------------------------------------------------

/** Registers or unregisters the background task to match the switches, the toggles and the permission. */
export async function syncRetentionTask(): Promise<'registered' | 'unregistered'> {
  // Loaded lazily so tests and web never pull in the native modules.
  const { registerRetentionTask, unregisterRetentionTask } = await import('./task');
  await ensureLoaded();
  const r = useRetention.getState();
  const wanted = flagOn('notifications_enabled') && (r.typeA || r.typeB) && (await permissionGranted());
  if (wanted) {
    await registerRetentionTask();
    return 'registered';
  }
  await unregisterRetentionTask();
  await cancelRetentionNotifications();
  return 'unregistered';
}

