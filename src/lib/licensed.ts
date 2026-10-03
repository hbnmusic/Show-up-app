/**
 * The licensed layer (JamBase listings, Ticketmaster price, photo and ticket link) kept apart from first-party data.
 * Each family has an on/off switch the operator sets in Supabase (fp.licensed_switches); defaults keep everything on.
 * `purgeLicensed` is what scripts/purge-licensed.ts runs over the published feed files.
 */
import type { Show } from './types';

export type LicensedSwitches = {
  jambase_listings: boolean;
  ticketmaster_price: boolean;
  ticketmaster_photo: boolean;
  ticketmaster_link: boolean;
};

export const DEFAULT_LICENSED: LicensedSwitches = { jambase_listings: true, ticketmaster_price: true, ticketmaster_photo: true, ticketmaster_link: true };

export function parseSwitches(raw: unknown): LicensedSwitches {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const get = (k: keyof LicensedSwitches) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : true);
  return { jambase_listings: get('jambase_listings'), ticketmaster_price: get('ticketmaster_price'), ticketmaster_photo: get('ticketmaster_photo'), ticketmaster_link: get('ticketmaster_link') };
}

const TM_LINK = /(^|\.)(ticketmaster|livenation)\./i;
const isTmUrl = (u?: string) => {
  if (!u) return false;
  try {
    return TM_LINK.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

/** What Ticketmaster supplied on a show: stamped fields, plus the photo credit and link domain on feeds written before stamping. */
function tmFields(s: Show) {
  const f = s.fieldSources ?? {};
  return { price: f.price === 'ticketmaster', image: f.image === 'ticketmaster' || s.flyerCredit === 'TICKETMASTER', link: f.ticketUrl === 'ticketmaster' || isTmUrl(s.ticketUrl) };
}

/** Removes switched-off licensed data from one show. Returns null when the whole show is a switched-off JamBase listing. */
export function applySwitches(s: Show, sw: LicensedSwitches): Show | null {
  if (s.source.provider === 'jambase' && !sw.jambase_listings) return null;
  if (sw.ticketmaster_price && sw.ticketmaster_photo && sw.ticketmaster_link) return s;
  const tm = tmFields(s);
  const next: Show = { ...s };
  if (!sw.ticketmaster_price && tm.price) next.price = {};
  if (!sw.ticketmaster_photo && tm.image) {
    delete next.flyerImages;
    delete next.flyerCredit;
  }
  if (!sw.ticketmaster_link && tm.link) delete next.ticketUrl;
  return next;
}

export function applySwitchesToAll(shows: Show[], sw: LicensedSwitches): Show[] {
  return shows.map((s) => applySwitches(s, sw)).filter((s): s is Show => s !== null);
}

/** Purge one source from feed contents. Ticketmaster: removes its stamped fields. JamBase: removes JamBase listings. */
export function purgeLicensed(shows: Show[], source: 'jambase' | 'ticketmaster'): { shows: Show[]; changed: number } {
  if (source === 'jambase') {
    const kept = shows.filter((s) => s.source.provider !== 'jambase');
    return { shows: kept, changed: shows.length - kept.length };
  }
  const off: LicensedSwitches = { jambase_listings: true, ticketmaster_price: false, ticketmaster_photo: false, ticketmaster_link: false };
  let changed = 0;
  const out = shows.map((s) => {
    const n = applySwitches(s, off)!;
    const had = JSON.stringify(n) !== JSON.stringify(s);
    if (had) changed++;
    if (n.fieldSources) delete n.fieldSources;
    return n;
  });
  return { shows: out, changed };
}
