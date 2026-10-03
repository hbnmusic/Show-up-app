/**
 * Checks for listings that arrive from outside the app (a downloaded feed or
 * a cached copy). Anything malformed is dropped rather than allowed to crash
 * a screen that assumes the Show type.
 */
import { ALL_GENRES, type Genre, type Show } from '../types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const validDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(new Date(v).getTime());
const STATUSES = ['scheduled', 'cancelled', 'moved'];
const VISIBILITY = ['public', 'neighborhood_only', 'on_request'];

const tmSources = (o: Obj): Show['fieldSources'] | undefined => {
  const out: NonNullable<Show['fieldSources']> = {};
  if (o.price === 'ticketmaster') out.price = 'ticketmaster';
  if (o.image === 'ticketmaster') out.image = 'ticketmaster';
  if (o.ticketUrl === 'ticketmaster') out.ticketUrl = 'ticketmaster';
  return Object.keys(out).length ? out : undefined;
};

/** Returns a cleaned Show, or null when the record cannot be shown safely. */
export function cleanShow(raw: unknown): Show | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (!validDate(raw.startsAt)) return null;
  const v = raw.venue;
  if (!isObj(v) || typeof v.name !== 'string' || !v.name) return null;
  if (typeof v.area !== 'string' || !v.area) return null;
  if (!Array.isArray(raw.acts)) return null;
  const acts = raw.acts
    .filter((a): a is Obj => isObj(a) && typeof a.name === 'string' && a.name.length > 0)
    .map((a, i) => ({ ...a, name: a.name as string, order: typeof a.order === 'number' ? a.order : i }));
  const title = typeof raw.title === 'string' && raw.title ? raw.title : undefined;
  if (acts.length === 0 && !title) return null;

  // "Club & Techno" was renamed; feeds and caches written before that still carry the old name.
  const genres = (Array.isArray(raw.genres) ? raw.genres : [])
    .map((g) => (g === 'Club & Techno' ? 'Electronic' : g))
    .filter((g, i, all): g is Genre => ALL_GENRES.includes(g as Genre) && all.indexOf(g) === i);
  const price = isObj(raw.price) ? raw.price : {};
  const source = isObj(raw.source) ? raw.source : {};
  const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

  return {
    id: raw.id,
    title,
    startsAt: raw.startsAt,
    doorsAt: validDate(raw.doorsAt) ? raw.doorsAt : undefined,
    endsAt: validDate(raw.endsAt) ? raw.endsAt : undefined,
    timeTba: raw.timeTba === true ? true : undefined,
    venue: {
      name: v.name,
      neighborhood: str(v.neighborhood) ?? (v.area as string),
      area: v.area,
      // Feeds from before multi-city support were NYC only.
      metro: str(v.metro) ?? 'nyc',
      lat: typeof v.lat === 'number' && Number.isFinite(v.lat) ? v.lat : undefined,
      lng: typeof v.lng === 'number' && Number.isFinite(v.lng) ? v.lng : undefined,
      city: str(v.city) ?? (v.area as string),
      address: str(v.address),
      addressVisibility: VISIBILITY.includes(v.addressVisibility as string)
        ? (v.addressVisibility as Show['venue']['addressVisibility'])
        : 'public',
    },
    acts,
    genres,
    price: {
      min: typeof price.min === 'number' ? price.min : undefined,
      max: typeof price.max === 'number' ? price.max : undefined,
      isFree: price.isFree === true ? true : undefined,
      notaflof: price.notaflof === true ? true : undefined,
    },
    flyerImages: Array.isArray(raw.flyerImages) ? raw.flyerImages.filter((x): x is string => typeof x === 'string') : undefined,
    flyerCredit: str(raw.flyerCredit),
    ticketUrl: str(raw.ticketUrl),
    fieldSources: isObj(raw.fieldSources) ? tmSources(raw.fieldSources) : undefined,
    status: STATUSES.includes(raw.status as string) ? (raw.status as Show['status']) : 'scheduled',
    source: {
      provider: str(source.provider) ?? 'unknown',
      url: str(source.url) ?? '',
      fetchedAt: str(source.fetchedAt) ?? '',
      ...(str(source.author) ? { author: str(source.author) } : {}),
    },
    updatedAt: validDate(raw.updatedAt) ? raw.updatedAt : (raw.startsAt as string),
  };
}

export type Feed = {
  version: 1;
  generatedAt: string;
  /** Provider credit lines the app must show. */
  attribution: string[];
  shows: Show[];
  /** JamBase calls spent this calendar month, so the refresh job can stay under the plan limit. */
  usage?: { month: string; calls: number };
};

/** Parse a downloaded feed. Returns null when it is not a feed at all. */
export function parseFeed(raw: unknown): { feed: Feed; dropped: number } | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.shows)) return null;
  const shows: Show[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const r of raw.shows) {
    const s = cleanShow(r);
    if (!s || seen.has(s.id)) {
      dropped++;
      continue;
    }
    seen.add(s.id);
    shows.push(s);
  }
  const attribution = Array.isArray(raw.attribution) ? raw.attribution.filter((x): x is string => typeof x === 'string') : [];
  const u = isObj(raw.usage) ? raw.usage : null;
  const usage = u && typeof u.month === 'string' && typeof u.calls === 'number' ? { month: u.month, calls: u.calls } : undefined;
  return {
    feed: { version: 1, generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '', attribution, shows, usage },
    dropped,
  };
}
