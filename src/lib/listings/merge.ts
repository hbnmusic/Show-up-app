import type { Show } from '../types';

/** A show is dropped from the feed 3 hours after it starts (matches the deck). */
const STILL_ON_MS = 3 * 60 * 60 * 1000;

export function stillRelevant(s: Show, now: Date): boolean {
  return new Date(s.startsAt).getTime() + STILL_ON_MS > now.getTime();
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/^the /, '')
    .replace(/[^a-z0-9]+/g, '');

function headlinerName(s: Show): string {
  const top = [...s.acts].sort((a, b) => a.order - b.order)[0];
  return top?.name ?? s.title ?? '';
}

/** Same night, same room, same headliner. `startsAt` carries the local date in its first 10 characters. */
export function dedupeKey(s: Show): string {
  return [s.startsAt.slice(0, 10), norm(s.venue.name), norm(headlinerName(s))].join('|');
}

function richer(a: Show, b: Show): Show {
  const score = (s: Show) =>
    s.acts.length * 3 + (s.doorsAt ? 2 : 0) + (s.price.min != null || s.price.isFree ? 2 : 0) + (s.ticketUrl ? 1 : 0) + (s.timeTba ? -2 : 0);
  return score(b) > score(a) ? b : a;
}

/** Two records of one night at one venue with one headliner are the same show unless their start times are far apart (early and late shows). */
const SAME_SHOW_WITHIN_MS = 2 * 60 * 60 * 1000;

/**
 * Collapse listings of the same night from one or several providers.
 * The record with more detail wins; a cancelled record always wins so a
 * cancellation seen by any provider is never hidden.
 */
export function dedupeShows(shows: Show[]): Show[] {
  const groups = new Map<string, Show[]>();
  for (const s of shows) {
    const k = dedupeKey(s);
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  const out: Show[] = [];
  for (const group of groups.values()) {
    const kept: Show[] = [];
    for (const s of group) {
      const t = new Date(s.startsAt).getTime();
      const i = kept.findIndex((k) => Math.abs(new Date(k.startsAt).getTime() - t) < SAME_SHOW_WITHIN_MS);
      if (i < 0) kept.push(s);
      else if (kept[i].status === 'cancelled') continue;
      else if (s.status === 'cancelled') kept[i] = s;
      else kept[i] = richer(kept[i], s);
    }
    out.push(...kept);
  }
  return out;
}

export function sortByStart(shows: Show[]): Show[] {
  return [...shows].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() || a.id.localeCompare(b.id));
}

/**
 * Combine what the script already has with what it just fetched.
 * - full: the fetch is the whole window, so anything missing from it is gone.
 * - incremental: the fetch only holds shows changed since the last run, so it
 *   is laid over the previous list by id.
 */
export function mergeFeed(previous: Show[], incoming: Show[], mode: 'full' | 'incremental', now: Date): Show[] {
  const base = mode === 'full' ? [] : previous;
  const byId = new Map<string, Show>();
  for (const s of base) byId.set(s.id, s);
  for (const s of incoming) byId.set(s.id, s);
  return sortByStart(dedupeShows([...byId.values()].filter((s) => stillRelevant(s, now))));
}

/**
 * On the phone: keep any show the user has decided on even after it leaves
 * the feed (removed, or replaced by a fresh download), so Going never loses a show.
 */
export function withRetained(fresh: Show[], earlier: Show[], keepIds: Iterable<string>): Show[] {
  const have = new Set(fresh.map((s) => s.id));
  const out = [...fresh];
  const earlierById = new Map(earlier.map((s) => [s.id, s]));
  for (const id of keepIds) {
    if (have.has(id)) continue;
    const s = earlierById.get(id);
    if (s) out.push(s);
  }
  return out;
}
