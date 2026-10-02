import type { Decision, Filters, Genre, Show, VenueType, WhenFilter } from './types';
import { distanceMi } from './metros';
import { addDays, startOfDay, wall, wallNow } from './time';

/** A show stays in the deck until 3 hours after it starts. */
const STILL_ON_MS = 3 * 60 * 60 * 1000;

/** Nights end at 5 AM, so a 1 AM set still counts as "tonight". */
const NIGHT_ROLLOVER_HOURS = 5;

export function showStart(s: Show): Date {
  return new Date(s.startsAt);
}

/** Start of the "night" a moment belongs to. */
function nightOf(d: Date): Date {
  const shifted = new Date(d.getTime() - NIGHT_ROLLOVER_HOURS * 3600_000);
  return startOfDay(shifted);
}

export function isUpcoming(s: Show, now: Date): boolean {
  if (s.status === 'cancelled') return false;
  return showStart(s).getTime() + STILL_ON_MS > now.getTime();
}

/** Days are the venue's own: a show at 11 PM in Chicago is "tonight" there, whatever the phone's zone says. */
export function inWhen(s: Show, when: WhenFilter, now: Date): boolean {
  const night = nightOf(wall(s.startsAt)).getTime();
  const tonight = nightOf(wallNow(s.startsAt, now));
  const t = tonight.getTime();
  switch (when) {
    case 'tonight':
      return night === t;
    case 'tomorrow':
      return night === addDays(tonight, 1).getTime();
    case 'weekend': {
      // Friday through Sunday of the current week (or this weekend if it is one now).
      const dow = tonight.getDay(); // 0 Sun … 6 Sat
      const daysToFri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
      const fri = addDays(tonight, daysToFri).getTime();
      const sun = addDays(new Date(fri), 2).getTime();
      return night >= Math.max(fri, t) && night <= sun;
    }
    case 'week':
      return night >= t && night < addDays(tonight, 7).getTime();
    case 'month':
      return night >= t && night < addDays(tonight, 30).getTime();
    case 'all':
      return true;
  }
}

export function priceOk(s: Show, price: Filters['price']): boolean {
  const p = s.price;
  switch (price) {
    case 'any':
      return true;
    case 'free':
      return !!p.isFree;
    case 'under10':
      return !!p.isFree || (p.max ?? p.min ?? Infinity) <= 10;
    case 'under20':
      return !!p.isFree || (p.max ?? p.min ?? Infinity) <= 20;
  }
}

/** Inside the chosen circle. A venue without coordinates counts if it is in the same city feed. */
export function placeOk(s: Show, f: Filters): boolean {
  const p = f.place;
  if (!p) return true;
  const { lat, lng } = s.venue;
  if (lat != null && lng != null) return distanceMi(p.lat, p.lng, lat, lng) <= f.radiusMi;
  return !p.metro || s.venue.metro === p.metro;
}

export function ageOk(s: Show, age: Filters['age']): boolean {
  switch (age) {
    case 'any':
      return true;
    case 'all_ages':
      return s.agePolicy === 'all_ages';
    case '18_plus':
      return s.agePolicy === 'all_ages' || s.agePolicy === '18_plus';
  }
}

/** The House & basement chip covers both kinds of home venue. */
function venueTypeOk(t: VenueType, selected: VenueType[]): boolean {
  if (selected.length === 0) return true;
  if (selected.includes(t)) return true;
  if ((t === 'basement' || t === 'house') && (selected.includes('house') || selected.includes('basement')))
    return true;
  return false;
}

function genreOk(genres: Genre[], selected: Genre[]): boolean {
  return selected.length === 0 || genres.some((g) => selected.includes(g));
}

export function matchesFilters(s: Show, f: Filters, now: Date): boolean {
  return (
    isUpcoming(s, now) &&
    inWhen(s, f.when, now) &&
    placeOk(s, f) &&
    venueTypeOk(s.venue.type, f.venueTypes) &&
    genreOk(s.genres, f.genres) &&
    priceOk(s, f.price) &&
    ageOk(s, f.age)
  );
}

export function byStart(a: Show, b: Show): number {
  return showStart(a).getTime() - showStart(b).getTime() || a.id.localeCompare(b.id);
}

/**
 * The deck: undecided shows that match the filters, soonest first.
 * If `pinnedId` still matches it stays on top, so a filter change never
 * swaps the card someone is listening to.
 */
export function buildQueue(
  shows: Show[],
  filters: Filters,
  decisions: Record<string, Decision | undefined>,
  now: Date,
  pinnedId?: string | null,
): Show[] {
  const list = shows
    .filter((s) => !decisions[s.id] && matchesFilters(s, filters, now))
    .sort(byStart);
  if (pinnedId) {
    const i = list.findIndex((s) => s.id === pinnedId);
    if (i > 0) {
      const [pinned] = list.splice(i, 1);
      list.unshift(pinned);
    }
  }
  return list;
}

export function activeFilterCount(f: Filters, defaults: Filters): number {
  let n = 0;
  if (f.when !== defaults.when) n++;
  if (f.radiusMi !== defaults.radiusMi) n++;
  if (f.venueTypes.length) n++;
  if (f.genres.length) n++;
  if (f.price !== 'any') n++;
  if (f.age !== 'any') n++;
  return n;
}

export const WHEN_LABELS: Record<WhenFilter, string> = {
  tonight: 'Tonight',
  tomorrow: 'Tomorrow',
  weekend: 'This weekend',
  week: 'Next 7 days',
  month: 'Next 30 days',
  all: 'All upcoming',
};
