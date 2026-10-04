/**
 * The licensed layer: JamBase listings, kept apart from first-party data. The operator can switch it off in Supabase
 * (fp.licensed_switches / app_flags); defaults keep it on. `purgeLicensed` is what scripts/purge-licensed.ts runs over the
 * published feed files.
 */
import { isOn, type Flags } from './flagsCore';
import type { Show } from './types';

export type LicensedSwitches = { jambase_listings: boolean };

export const DEFAULT_LICENSED: LicensedSwitches = { jambase_listings: true };

export function parseSwitches(raw: unknown): LicensedSwitches {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { jambase_listings: typeof o.jambase_listings === 'boolean' ? o.jambase_listings : true };
}

/** Removes switched-off licensed data from one show. Returns null when the whole show is a switched-off JamBase listing. */
export function applySwitches(s: Show, sw: LicensedSwitches): Show | null {
  if (s.source.provider === 'jambase' && !sw.jambase_listings) return null;
  return s;
}

export function applySwitchesToAll(shows: Show[], sw: LicensedSwitches): Show[] {
  return shows.map((s) => applySwitches(s, sw)).filter((s): s is Show => s !== null);
}

/** Purge JamBase listings from feed contents. */
export function purgeLicensed(shows: Show[], source: 'jambase'): { shows: Show[]; changed: number } {
  const kept = shows.filter((s) => s.source.provider !== source);
  return { shows: kept, changed: shows.length - kept.length };
}

/** JamBase counts as on only when both the older licensed switch and the jambase_enabled flag allow it. */
export const jambaseOn = (sw: LicensedSwitches, flags?: Flags | null): boolean => sw.jambase_listings && (flags ? isOn(flags, 'jambase_enabled') : true);

const JAMBASE_TEXT = /jambase/i;

/** A published feed rebuilt for the current switches: with JamBase off it holds no JamBase records and no JamBase credit line. */
export function rebuildFeed<F extends { shows: Show[]; attribution?: string[] }>(feed: F, jambase: boolean): { feed: F; removed: number } {
  if (jambase) return { feed, removed: 0 };
  const shows = feed.shows.filter((s) => s.source.provider !== 'jambase');
  const attribution = (feed.attribution ?? []).filter((a) => !JAMBASE_TEXT.test(a));
  return { feed: { ...feed, shows, attribution }, removed: feed.shows.length - shows.length };
}
