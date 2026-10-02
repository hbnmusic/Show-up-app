/**
 * Fill in what JamBase leaves blank (price, age policy, a photo) from
 * Ticketmaster's Discovery API, for shows that Ticketmaster also lists.
 *
 * Written against the Discovery API v2 event shape from its public docs
 * (_embedded.events[] with dates, priceRanges, images, info, pleaseNote and
 * _embedded.venues / attractions). Every field is read defensively; the fetch
 * script prints how many matches and fills it got so a first real run shows
 * quickly whether a field is shaped differently than expected.
 */
import { namesMatch, normalizeName } from '../deezer';
import type { AgePolicy, Show } from '../types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export type TmEvent = {
  id: string;
  url?: string;
  /** Start as an instant (ms since epoch), when Ticketmaster has a time. */
  startMs?: number;
  /** Local calendar date at the venue, YYYY-MM-DD. */
  localDate?: string;
  venueName?: string;
  attractions: string[];
  price?: { min: number; max: number };
  age: AgePolicy;
  image?: string;
};

/** "All Ages", "18+", "21 and over" in free text. Order matters: all ages wins over a stray number. */
export function parseAge(text: string | undefined): AgePolicy {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  if (/\ball[- ]ages\b/.test(t)) return 'all_ages';
  if (/\b21\s*\+|\b21\s*(and|&)\s*(over|up|older)|\b21\s*years|\bage 21\b|\b21 or older\b/.test(t)) return '21_plus';
  if (/\b18\s*\+|\b18\s*(and|&)\s*(over|up|older)|\b18\s*years|\bage 18\b|\b18 or older\b/.test(t)) return '18_plus';
  return 'unknown';
}

export function priceFrom(ranges: unknown): { min: number; max: number } | undefined {
  if (!Array.isArray(ranges)) return undefined;
  let min: number | undefined;
  let max: number | undefined;
  for (const r of ranges) {
    if (!isObj(r)) continue;
    const lo = num(r.min);
    const hi = num(r.max);
    if (lo != null) min = min == null ? lo : Math.min(min, lo);
    if (hi != null) max = max == null ? hi : Math.max(max, hi);
  }
  if (min == null && max == null) return undefined;
  const lo = min ?? max!;
  const hi = max ?? min!;
  return { min: Math.round(lo), max: Math.round(hi) };
}

/** A wide image of at least phone-card resolution, preferring 16:9. */
export function imageFrom(images: unknown): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const ok = images
    .filter(isObj)
    .map((i) => ({ url: str(i.url), w: num(i.width) ?? 0, ratio: str(i.ratio) }))
    .filter((i): i is { url: string; w: number; ratio: string | undefined } => !!i.url && i.w >= 640);
  const wide = ok.filter((i) => i.ratio === '16_9');
  const pool = wide.length ? wide : ok;
  pool.sort((a, b) => a.w - b.w); // the smallest that is still large enough keeps downloads light
  return pool[0]?.url;
}

/** Read one Discovery API event. Returns null when it has nothing usable. */
export function parseTmEvent(raw: unknown): TmEvent | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const dates = isObj(raw.dates) ? raw.dates : {};
  const start = isObj(dates.start) ? dates.start : {};
  const dateTime = str(start.dateTime);
  const startMs = dateTime ? Date.parse(dateTime) : NaN;
  const emb = isObj(raw._embedded) ? raw._embedded : {};
  const venues = Array.isArray(emb.venues) ? emb.venues : [];
  const attractions = (Array.isArray(emb.attractions) ? emb.attractions : [])
    .map((a) => (isObj(a) ? str(a.name) : undefined))
    .filter((n): n is string => !!n);
  const age = [str(raw.info), str(raw.pleaseNote)].map(parseAge).find((a) => a !== 'unknown') ?? 'unknown';
  return {
    id,
    url: str(raw.url),
    startMs: Number.isNaN(startMs) ? undefined : startMs,
    localDate: str(start.localDate),
    venueName: isObj(venues[0]) ? str(venues[0].name) : undefined,
    attractions,
    price: priceFrom(raw.priceRanges),
    age,
    image: imageFrom(raw.images),
  };
}

const VENUE_NOISE = /\b(the|theatre|theater|club|hall|room|ballroom|live|music|venue|lounge)\b/g;
const venueKey = (n: string) => normalizeName(n).replace(VENUE_NOISE, ' ').replace(/\s+/g, ' ').trim();

function venueOk(show: Show, ev: TmEvent): boolean {
  if (!ev.venueName) return false;
  const a = venueKey(show.venue.name);
  const b = venueKey(ev.venueName);
  return a.length > 2 && b.length > 2 && (a === b || a.includes(b) || b.includes(a));
}

function artistOk(show: Show, ev: TmEvent): boolean {
  return show.acts.some((a) => ev.attractions.some((t) => namesMatch(a.name, t)));
}

function timeOk(show: Show, ev: TmEvent): boolean {
  if (show.timeTba) return !!ev.localDate && show.startsAt.slice(0, 10) === ev.localDate;
  if (ev.startMs == null) return false;
  return Math.abs(new Date(show.startsAt).getTime() - ev.startMs) <= 3 * 3600_000;
}

/** The Ticketmaster event for this show, or null. Needs the same time and either the venue or an act to agree. */
export function matchEvent(show: Show, events: TmEvent[]): TmEvent | null {
  let best: { ev: TmEvent; score: number } | null = null;
  for (const ev of events) {
    if (!timeOk(show, ev)) continue;
    const v = venueOk(show, ev);
    const a = artistOk(show, ev);
    if (!v && !a) continue;
    const score = (v ? 1 : 0) + (a ? 2 : 0);
    if (!best || score > best.score) best = { ev, score };
  }
  return best?.ev ?? null;
}

export const TM_CREDIT = 'TICKETMASTER';
export const TM_ATTRIBUTION = 'Prices, ages and photos from Ticketmaster where available';

export type Fills = { price: boolean; age: boolean; image: boolean };

/** Only blanks are filled; anything JamBase or a manual listing already says stays. */
export function enrichShow(show: Show, ev: TmEvent): { show: Show; fills: Fills } {
  const next: Show = { ...show };
  const fills: Fills = { price: false, age: false, image: false };
  const unknownPrice = !show.price.isFree && !show.price.notaflof && show.price.min == null && show.price.max == null;
  if (unknownPrice && ev.price) {
    next.price = { ...show.price, ...ev.price };
    fills.price = true;
  }
  if (show.agePolicy === 'unknown' && ev.age !== 'unknown') {
    next.agePolicy = ev.age;
    fills.age = true;
  }
  if (!show.flyerImages?.length && ev.image) {
    next.flyerImages = [ev.image];
    next.flyerCredit = TM_CREDIT;
    fills.image = true;
  }
  // JamBase's own page is the fallback link when it has no ticket seller; a real ticket page is better.
  if (ev.url && (!show.ticketUrl || show.ticketUrl === show.source.url)) next.ticketUrl = ev.url;
  return { show: next, fills };
}
