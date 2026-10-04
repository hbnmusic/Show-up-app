/**
 * Reading a venue's own events page. Tiers, cheapest first: JSON-LD, iCal, RSS, the venue's own calendar widget
 * data, and only then the language model on stripped page text. Pure parsing; fetching is done by the caller.
 */
import { parsePrice, parseTime, todayIn, dayNumber, type ParsedPrice } from './dates.ts';
import { isBlockedUrl, safeImage } from './blocked.ts';
import { mapStatedGenres } from './genres.ts';
import { cleanActName } from './text.ts';
import { licenceFor, type Candidate, type MetroRow, type ShowStatus, type VenueRow } from './types.ts';

export type RawEvent = {
  name: string;
  performers: string[];
  /** ISO 8601 with or without offset, or a bare date. */
  start: string;
  doors?: string;
  url?: string;
  ticketUrl?: string;
  image?: string;
  status?: ShowStatus;
  price?: ParsedPrice;
  genre?: string;
  agePolicy?: string;
};

export type Tier = 'jsonld' | 'ical' | 'rss' | 'widget' | 'ai';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const abs = (u: string | undefined, base: string): string | undefined => {
  if (!u) return undefined;
  try {
    const url = new URL(u, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));

// ---- Tier 1: JSON-LD ------------------------------------------------------------------------------------------

const EVENT_TYPE = /^(?:Event|MusicEvent|Festival|ComedyEvent|TheaterEvent|DanceEvent|EventSeries)$/;

function ldEvents(node: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(node)) return node.forEach((n) => ldEvents(n, out));
  if (!isObj(node)) return;
  const types = arr(node['@type']).map(String);
  if (types.some((t) => EVENT_TYPE.test(t.replace(/^.*[\/#]/, '')))) out.push(node);
  if (node['@graph']) ldEvents(node['@graph'], out);
  if (node.itemListElement) ldEvents(arr(node.itemListElement).map((e) => (isObj(e) && e.item ? e.item : e)), out);
}

function ldStatus(v: unknown): ShowStatus | undefined {
  const t = String(v ?? '');
  if (/Cancel/i.test(t)) return 'cancelled';
  if (/Postpone|Rescheduled|MovedOnline/i.test(t)) return 'moved';
  if (/Scheduled/i.test(t)) return 'scheduled';
  return undefined;
}

export function extractJsonLd(html: string, baseUrl: string): RawEvent[] {
  const found: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      ldEvents(JSON.parse(decode(m[1]).trim()), found);
    } catch {
      // A broken block is skipped; the others may be fine.
    }
  }
  const out: RawEvent[] = [];
  for (const e of found) {
    const start = str(e.startDate);
    const name = str(e.name);
    if (!start || !name) continue;
    const performers = [...arr(e.performer), ...arr(e.performers)].map((p) => (isObj(p) ? str(p.name) : str(p))).filter((x): x is string => !!x);
    const offers = arr(e.offers).filter(isObj);
    const price = offers.length
      ? offers.reduce<ParsedPrice>((acc, o) => {
          const n = Number(o.price ?? o.lowPrice);
          const hi = Number(o.highPrice ?? o.price);
          if (!Number.isFinite(n)) return acc;
          if (n === 0 && (acc.min == null || acc.min === 0)) return { isFree: true };
          return { min: Math.min(acc.min ?? n, n), max: Math.max(acc.max ?? hi, Number.isFinite(hi) ? hi : n) };
        }, {})
      : undefined;
    const image = Array.isArray(e.image) ? e.image[0] : e.image;
    out.push({
      name: decode(name),
      performers: performers.map(decode),
      start,
      doors: str(e.doorTime),
      url: abs(str(e.url), baseUrl),
      ticketUrl: abs(str(offers[0]?.url), baseUrl),
      image: abs(isObj(image) ? str(image.url) : str(image), baseUrl),
      status: ldStatus(e.eventStatus),
      price: price && Object.keys(price).length ? price : undefined,
      genre: str(e.genre) ?? undefined,
    });
  }
  return out;
}

// ---- Tier 2: iCal and RSS ----------------------------------------------------------------------------------------

function unfold(txt: string): string[] {
  return txt.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function icalDate(v: string, params: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return undefined;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  const stamp = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  if (m[7]) return `${stamp}Z`;
  const tz = /TZID=([^;:]+)/.exec(params)?.[1];
  return tz ? `${stamp}@${tz}` : stamp; // "@Zone" is resolved by toLocal
}

export function extractIcal(txt: string, baseUrl: string): RawEvent[] {
  const out: RawEvent[] = [];
  let ev: Record<string, { v: string; p: string }> | null = null;
  for (const line of unfold(txt)) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT' && ev) {
      const start = ev.DTSTART ? icalDate(ev.DTSTART.v, ev.DTSTART.p) : undefined;
      if (start && ev.SUMMARY) {
        const status = /CANCEL/i.test(ev.STATUS?.v ?? '') ? 'cancelled' : undefined;
        out.push({ name: ev.SUMMARY.v.replace(/\\,/g, ',').replace(/\\n/g, ' '), performers: [], start, url: abs(ev.URL?.v, baseUrl), status });
      }
      ev = null;
    } else if (ev) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      if (!(name in ev)) ev[name.toUpperCase()] = { v: line.slice(i + 1), p: params.join(';') };
    }
  }
  return out;
}

/** RSS or Atom items that carry a start date in an events namespace (ev:startdate, xcal:dtstart, event:startdate). */
export function extractRss(xml: string, baseUrl: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const item = m[0];
    const tag = (n: string) => decode((new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i').exec(item)?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
    const start = tag('ev:startdate') || tag('xcal:dtstart') || tag('event:startdate') || tag('tribe:startdate');
    const name = tag('title');
    if (!start || !name) continue;
    out.push({ name, performers: [], start, url: abs(tag('link'), baseUrl) });
  }
  return out;
}

// ---- Tier 3: the venue's own calendar widget data ---------------------------------------------------------------

/** WordPress "The Events Calendar" REST payload, or Squarespace `?format=json` events collection. */
export function extractWidgetJson(data: unknown, baseUrl: string): RawEvent[] {
  if (!isObj(data)) return [];
  const out: RawEvent[] = [];
  for (const e of arr(data.events)) {
    if (!isObj(e)) continue;
    const start = str(e.start_date) ?? str(e.startDate);
    const name = str(e.title);
    if (!start || !name) continue;
    out.push({
      name: decode(name),
      performers: [],
      start: start.includes('T') ? start : start.replace(' ', 'T'),
      url: abs(str(e.url), baseUrl),
      image: isObj(e.image) ? abs(str(e.image.url), baseUrl) : undefined,
      price: e.cost ? parsePrice(String(e.cost)) : undefined,
      status: e.status === 'cancelled' ? 'cancelled' : undefined,
    });
  }
  for (const e of arr(data.upcoming)) {
    if (!isObj(e) || typeof e.startDate !== 'number') continue;
    const name = str(e.title);
    if (!name) continue;
    out.push({ name: decode(name), performers: [], start: new Date(e.startDate).toISOString(), url: abs(str(e.fullUrl), baseUrl), image: abs(str(e.assetUrl), baseUrl) });
  }
  return out;
}

// ---- Conversion ---------------------------------------------------------------------------------------------------

/** Local date and time at the venue for an ISO value ("…Z", "+hh:mm", "@Zone", or bare local). */
export function toLocal(start: string, tz: string): { date: string; time?: string } | null {
  let s = start.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s };
  let zone: string | null = null;
  const at = /^(.*)@(.+)$/.exec(s);
  if (at) { s = at[1]; zone = at[2]; }
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  if (!hasOffset) {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    if (!zone || zone === tz) return { date: m[1], time: `${m[2]}:${m[3]}` };
    // A different zone was named: convert through that zone's offset.
    return convertFromZone(m[1], `${m[2]}:${m[3]}`, zone, tz);
  }
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return null;
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(t);
  const g = (n: string) => p.find((x) => x.type === n)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

function convertFromZone(date: string, time: string, from: string, to: string): { date: string; time?: string } | null {
  try {
    const wall = Date.parse(`${date}T${time}:00Z`);
    const off = (ms: number, z: string) => {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
      const g = (n: string) => Number(p.find((x) => x.type === n)!.value);
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
    };
    let utc = wall - off(wall, from);
    utc = wall - off(utc, from);
    return toLocal(new Date(utc).toISOString(), to);
  } catch {
    return null;
  }
}

export type RejectReason = 'no_date' | 'past' | 'too_far' | 'no_name' | 'not_music';

export function rawToCandidate(
  raw: RawEvent,
  venue: Pick<VenueRow, 'id' | 'name' | 'metro' | 'address'>,
  metro: MetroRow,
  now: Date,
  tier: Tier,
  pageUrl: string,
): { candidate: Candidate } | { reject: RejectReason } {
  const local = toLocal(raw.start, metro.tz);
  if (!local) return { reject: 'no_date' };
  const [y, m, d] = local.date.split('-').map(Number);
  const today = todayIn(metro.tz, now);
  const dn = dayNumber({ y, m, d });
  if (dn < dayNumber(today)) return { reject: 'past' };
  if (dn > dayNumber(today) + 366) return { reject: 'too_far' };
  const name = cleanActName(raw.name);
  const performers = raw.performers.length ? raw.performers : [];
  const headliner = performers[0] ?? name;
  if (!headliner) return { reject: 'no_name' };
  const doors = raw.doors ? toLocal(raw.doors, metro.tz)?.time ?? parseTime(raw.doors) ?? undefined : undefined;
  const supports = performers.slice(1);
  return {
    candidate: {
      sourceType: 'venue_site',
      licence: licenceFor('venue_site'),
      sourceUrl: raw.url && !isBlockedUrl(raw.url) ? raw.url : pageUrl,
      fetchedAt: now.toISOString(),
      metro: metro.id,
      venueId: venue.id,
      venueName: venue.name,
      localDate: local.date,
      startLocal: local.time,
      doorsLocal: doors,
      headliner,
      supports,
      title: performers.length && name !== performers[0] ? name : undefined,
      price: raw.price,
      ticketUrl: raw.ticketUrl,
      status: raw.status ?? 'scheduled',
      genres: mapStatedGenres(raw.genre),
      agePolicy: raw.agePolicy,
      address: venue.address,
      addressMode: venue.address ? 'registry' : 'withheld',
      imageUrl: safeImage(raw.image),
      evidence: { tier },
    },
  };
}

// ---- Tier 4 helpers: page text for the model ------------------------------------------------------------------

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/article|\/section)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cap text sent to the model; venue pages are mostly navigation after stripping, so a few thousand words is plenty. */
export const MAX_AI_CHARS = 24000;
export const clip = (t: string) => (t.length > MAX_AI_CHARS ? t.slice(0, MAX_AI_CHARS) : t);
