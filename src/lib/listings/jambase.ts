/**
 * JamBase event → Show.
 *
 * Written against JamBase's published OpenAPI schema (v3, schema.org-style
 * Concert objects). Every field is read defensively because the only payload
 * available when this was written was the schema, not a live response; the
 * fetch script reports what it skipped and why so a first real run shows
 * quickly if a field is shaped differently than expected.
 */
import type { Area, Genre, Price, Show } from '../types';
import { isDateOnly, localToIso } from './tz';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

export type SkipReason =
  | 'not-a-concert'
  | 'deleted'
  | 'no-id'
  | 'no-date'
  | 'bad-date'
  | 'no-venue'
  | 'no-performers'
  | 'outside-areas'
  | 'large-venue';

export type MapOptions = {
  fetchedAt: string;
  /** Skip venues that hold more than this many people (arenas, stadiums). */
  maxCapacity: number;
};

export const DEFAULT_MAP_OPTIONS = { maxCapacity: 1500 } as const;

export type MapResult = { show: Show } | { skip: SkipReason };

/** JamBase's genre slugs are coarse; only the ones that map cleanly are used. */
const GENRES: Record<string, Genre[]> = {
  punk: ['Punk'],
  metal: ['Metal'],
  indie: ['Indie Rock'],
  folk: ['Folk'],
  pop: ['Pop'],
  jazz: ['Jazz & Improv'],
  edm: ['Club & Techno'],
  'rhythm-and-blues-soul': ['Soul & Gospel'],
};

export function mapGenres(slugs: string[]): Genre[] {
  const out: Genre[] = [];
  for (const s of slugs) for (const g of GENRES[s.toLowerCase()] ?? []) if (!out.includes(g)) out.push(g);
  return out;
}

const QUEENS = [
  'queens', 'long island city', 'astoria', 'ridgewood', 'flushing', 'jamaica', 'forest hills', 'sunnyside',
  'woodside', 'corona', 'jackson heights', 'elmhurst', 'glendale', 'maspeth', 'rockaway', 'far rockaway',
  'richmond hill', 'bayside', 'whitestone', 'howard beach', 'ozone park',
];
const MANHATTAN = ['new york', 'new york city', 'manhattan', 'nyc'];

/** Map a JamBase locality/region to the app's four areas, or null if it is elsewhere. */
export function areaFor(locality: string | undefined, region: string | undefined, lat: number | undefined): Area | null {
  const city = (locality ?? '').toLowerCase();
  const reg = (region ?? '').toUpperCase();
  if (reg === 'NJ' || reg === 'NEW JERSEY') {
    // Central and shore towns are outside the app's North Jersey scope.
    return lat == null || lat >= 40.65 ? 'North Jersey' : null;
  }
  if (reg && reg !== 'NY' && reg !== 'NEW YORK') return null;
  if (city === 'brooklyn') return 'Brooklyn';
  if (QUEENS.includes(city)) return 'Queens';
  if (MANHATTAN.includes(city)) return 'Manhattan';
  return null;
}

function priceOf(offers: unknown[], free: unknown): Price {
  if (free === true) return { isFree: true, min: 0, max: 0 };
  let min: number | undefined;
  let max: number | undefined;
  for (const o of offers) {
    if (!isObj(o) || !isObj(o.priceSpecification)) continue;
    const spec = o.priceSpecification;
    const lo = num(spec.minPrice) ?? num(spec.price);
    const hi = num(spec.maxPrice) ?? num(spec.price);
    if (lo != null) min = min == null ? lo : Math.min(min, lo);
    if (hi != null) max = max == null ? hi : Math.max(max, hi);
  }
  if (min == null && max == null) return {};
  return { min, max };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

type Performer = { name: string; headliner: boolean; rank: number; genres: string[] };

function performersOf(raw: unknown[]): Performer[] {
  const out: Performer[] = [];
  raw.forEach((p, i) => {
    if (!isObj(p)) return;
    const name = str(p.name);
    if (!name) return;
    const genres = list(p.genre)
      .map((g) => (isObj(g) ? str(g.identifier) ?? str(g.name) : str(g)))
      .filter((g): g is string => !!g);
    out.push({ name, headliner: p['x-isHeadliner'] === true, rank: num(p['x-performanceRank']) ?? i + 1000, genres });
  });
  // Headliners first, then by billing rank; the sort is stable so equal ranks keep API order.
  return out.sort((a, b) => Number(b.headliner) - Number(a.headliner) || a.rank - b.rank);
}

export function mapJamBaseEvent(ev: unknown, opts: MapOptions): MapResult {
  if (!isObj(ev)) return { skip: 'not-a-concert' };
  const type = str(ev['@type']);
  if (type && type !== 'Concert') return { skip: 'not-a-concert' };
  if (ev.deletedAt || ev.mergedInto) return { skip: 'deleted' };

  const identifier = str(ev.identifier);
  if (!identifier) return { skip: 'no-id' };

  const venue = isObj(ev.location) ? ev.location : undefined;
  const venueName = venue && str(venue.name);
  if (!venue || !venueName) return { skip: 'no-venue' };

  const address = isObj(venue.address) ? venue.address : {};
  const geo = isObj(venue.geo) ? venue.geo : {};
  const region = isObj(address.addressRegion)
    ? str(address.addressRegion.alternateName) ?? str(address.addressRegion.name)
    : str(address.addressRegion);
  const locality = str(address.addressLocality);
  const area = areaFor(locality, region, num(geo.latitude));
  if (!area) return { skip: 'outside-areas' };

  const capacity = num(venue.maximumAttendeeCapacity);
  if (capacity != null && capacity > opts.maxCapacity) return { skip: 'large-venue' };

  const startRaw = str(ev.startDate);
  if (!startRaw) return { skip: 'no-date' };
  const tz = str(address['x-timezone']) ?? 'America/New_York';
  const timeTba = isDateOnly(startRaw);
  const startsAt = localToIso(timeTba ? `${startRaw.trim()}T20:00:00` : startRaw, tz);
  if (!startsAt) return { skip: 'bad-date' };
  const doorRaw = str(ev.doorTime);
  const doorsAt = doorRaw && !isDateOnly(doorRaw) ? localToIso(doorRaw, tz) ?? undefined : undefined;
  const endRaw = str(ev.endDate);
  const endsAt = endRaw && !isDateOnly(endRaw) ? localToIso(endRaw, tz) ?? undefined : undefined;

  const performers = performersOf(list(ev.performer));
  const title = str(ev['x-customTitle']);
  if (performers.length === 0 && !title) return { skip: 'no-performers' };

  const offers = list(ev.offers);
  const ticketUrl = offers.map((o) => (isObj(o) ? str(o.url) : undefined)).find((u) => !!u);
  const eventUrl = str(ev.url) ?? 'https://www.jambase.com';
  const status = str(ev.eventStatus);
  const modified = str(ev.dateModified);

  const idPart = slug(identifier.replace(/^.*:/, '')) || slug(identifier);
  return {
    show: {
      id: `jb-${idPart}`,
      title,
      startsAt,
      doorsAt,
      endsAt,
      timeTba: timeTba || undefined,
      venue: {
        name: venueName,
        type: 'venue',
        neighborhood: area === 'Manhattan' ? 'Manhattan' : locality ?? area,
        area,
        city: [locality ?? area, region].filter(Boolean).join(', '),
        address: str(address.streetAddress),
        addressVisibility: 'public',
      },
      acts: performers.map((p, order) => ({ name: p.name, order })),
      genres: mapGenres(performers.flatMap((p) => p.genres)),
      price: priceOf(offers, ev.isAccessibleForFree),
      agePolicy: 'unknown',
      ticketUrl: ticketUrl ?? eventUrl,
      status: status === 'cancelled' ? 'cancelled' : status === 'postponed' || status === 'rescheduled' ? 'moved' : 'scheduled',
      source: { provider: 'jambase', url: eventUrl, fetchedAt: opts.fetchedAt },
      updatedAt: modified ? localToIso(modified.length === 10 ? `${modified}T00:00:00` : modified, 'UTC') ?? opts.fetchedAt : opts.fetchedAt,
    },
  };
}
