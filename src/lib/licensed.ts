/**
 * The licensed layer: JamBase listings, kept apart from first-party data. The operator can switch it off in Supabase
 * (fp.licensed_switches / app_flags); defaults keep it on. `purgeLicensed` is what scripts/purge-licensed.ts runs over the
 * published feed files.
 */
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
