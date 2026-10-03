/**
 * Turning what someone types into a submission, and a submission row back into
 * a Show. Pure functions only (no network, no time zones from the runtime) so
 * they can be tested and behave the same on every phone.
 */
import { cleanShow } from '../listings/validate';
import { metroById } from '../metros';
import { ALL_GENRES, type Genre, type Show } from '../types';

export type Ymd = { y: number; m: number; d: number };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function realDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const dayNumber = ({ y, m, d }: Ymd) => Date.UTC(y, m - 1, d) / 86_400_000;

/**
 * "2026-10-24", "10/24", "10/24/26", "Oct 24", "24 Oct", "October 24, 2026" → "2026-10-24".
 * Without a year the next date that is not in the past is used. Returns null when it is not a real date.
 */
export function parseDateInput(text: string, today: Ymd): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let y: number | undefined;
  let m: number | undefined;
  let d: number | undefined;
  let hit: RegExpExecArray | null;
  if ((hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [y, m, d] = [+hit[1], +hit[2], +hit[3]];
  else if ((hit = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t))) {
    [m, d] = [+hit[1], +hit[2]];
    if (hit[3]) y = hit[3].length === 2 ? 2000 + +hit[3] : +hit[3];
  } else if ((hit = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(t))) {
    m = MONTHS.indexOf(hit[1].slice(0, 3)) + 1;
    d = +hit[2];
    if (hit[3]) y = +hit[3];
  } else if ((hit = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.?(?: (\d{4}))?$/.exec(t))) {
    m = MONTHS.indexOf(hit[2].slice(0, 3)) + 1;
    d = +hit[1];
    if (hit[3]) y = +hit[3];
  } else return null;
  if (!m || !d) return null;
  if (y === undefined) {
    y = today.y;
    if (realDate(y, m, d) && dayNumber({ y, m, d }) < dayNumber(today)) y += 1;
  }
  if (!realDate(y, m, d)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * "8pm", "8:30 pm", "20:00", "8" → "HH:MM". Shows are in the evening, so a bare
 * hour from 1 to 11 means PM; write "10am" for a morning show.
 */
export function parseTimeInput(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
  const hit = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t);
  if (!hit) return null;
  let h = +hit[1];
  const min = hit[2] ? +hit[2] : 0;
  if (min > 59) return null;
  const mer = hit[3];
  if (mer) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mer === 'pm' ? 12 : 0);
  } else if (h >= 1 && h <= 11) {
    h += 12;
  } else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** "20", "$15", "15-25", "15 to 25" → min and max. Null when it is not a price. */
export function parsePriceInput(text: string): { min: number; max?: number } | null {
  const t = text.trim().replace(/[$,]/g, '').toLowerCase();
  const range = /^(\d+(?:\.\d{1,2})?)\s*(?:-|–|to)\s*(\d+(?:\.\d{1,2})?)$/.exec(t);
  if (range) {
    const [a, b] = [+range[1], +range[2]];
    return a > 2000 || b > 2000 ? null : { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const one = /^(\d+(?:\.\d{1,2})?)$/.exec(t);
  if (!one || +one[1] > 2000) return null;
  return { min: +one[1] };
}

/** "Band A, Band B\nBand C" → names, headliner first. Capped at 12 like the database. */
export function parseActs(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 100);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 12);
}

/** The first web address in shared text (what Instagram sends is the post link). */
export function extractUrl(text: string | null | undefined): string | undefined {
  const hit = /https?:\/\/[^\s<>"')]+/i.exec(text ?? '');
  return hit ? hit[0].replace(/[.,;!?]+$/, '') : undefined;
}

export function isHttpUrl(v: string): boolean {
  return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v.trim()) && v.trim().length <= 500;
}

/** Characters the database refuses (control characters other than tab and newline). */
export function hasControlChars(v: string): boolean {
  return /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v);
}

/** Field limits; the database enforces the same ones. */
export const LIMITS = { venue: 120, area: 80, title: 120, address: 200, act: 100, acts: 12, url: 500, price: 2000 } as const;

export type SubmitForm = {
  metro: string;
  venueName: string;
  area: string;
  address: string;
  acts: string;
  title: string;
  date: string;
  time: string;
  free: boolean;
  price: string;
  genres: Genre[];
  ticketUrl: string;
  sourceUrl: string;
};

export const EMPTY_FORM: SubmitForm = {
  metro: '',
  venueName: '',
  area: '',
  address: '',
  acts: '',
  title: '',
  date: '',
  time: '',
  free: false,
  price: '',
  genres: [],
  ticketUrl: '',
  sourceUrl: '',
};

/** The argument of the database function submit_show. */
export type SubmitPayload = {
  metro: string;
  tz: string;
  starts_local: string;
  title: string | null;
  acts: { name: string }[];
  venue_name: string;
  venue_area: string;
  venue_address: string | null;
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  genres: Genre[];
  ticket_url: string | null;
  source_url: string | null;
};

/** Check the form. Returns the payload, or one message per problem. */
export function buildPayload(f: SubmitForm, today: Ymd): { ok: true; payload: SubmitPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const metro = metroById(f.metro);
  if (!metro) errors.push('Choose the city.');
  const acts = parseActs(f.acts);
  const title = f.title.trim().slice(0, 120);
  if (acts.length === 0 && !title) errors.push('Add at least one band or a name for the night.');
  if (!f.venueName.trim()) errors.push('Add the venue.');
  if (!f.area.trim()) errors.push('Add the neighborhood or town.');
  const date = parseDateInput(f.date, today);
  if (!date) errors.push('The date was not understood. Try 10/24 or Oct 24.');
  else if (dayNumber({ y: +date.slice(0, 4), m: +date.slice(5, 7), d: +date.slice(8, 10) }) - dayNumber(today) > 365) {
    errors.push('That date is more than a year away.');
  }
  const time = parseTimeInput(f.time);
  if (!time) errors.push('The start time was not understood. Try 8pm or 20:00.');

  let min: number | null = null;
  let max: number | null = null;
  if (!f.free && f.price.trim()) {
    const p = parsePriceInput(f.price);
    if (!p) errors.push('The price was not understood. Try 20 or 15-25.');
    else [min, max] = [p.min, p.max ?? null];
  }
  const ticket = f.ticketUrl.trim();
  if (ticket && !isHttpUrl(ticket)) errors.push('The ticket link must start with http:// or https://.');
  const source = f.sourceUrl.trim();
  if (source && !isHttpUrl(source)) errors.push('The post link must start with http:// or https://.');

  const rawActs = f.acts.split(/[\n,]+/).map((a) => a.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (new Set(rawActs.map((a) => a.toLowerCase())).size > LIMITS.acts) errors.push(`List at most ${LIMITS.acts} bands.`);
  if (rawActs.some((a) => a.length > LIMITS.act)) errors.push(`Each band name can be up to ${LIMITS.act} characters.`);
  if (f.venueName.trim().length > LIMITS.venue) errors.push(`The venue can be up to ${LIMITS.venue} characters.`);
  if (f.area.trim().length > LIMITS.area) errors.push(`The neighborhood can be up to ${LIMITS.area} characters.`);
  if (title.length > LIMITS.title || f.title.trim().length > LIMITS.title) errors.push(`The event name can be up to ${LIMITS.title} characters.`);
  if (f.address.trim().length > LIMITS.address) errors.push(`The address can be up to ${LIMITS.address} characters.`);
  if ([f.venueName, f.area, f.title, f.address, f.acts].some(hasControlChars)) errors.push('Remove unusual characters from the text fields.');
  if ((min !== null && (min < 0 || min > LIMITS.price)) || (max !== null && (max < 0 || max > LIMITS.price))) {
    errors.push(`Prices must be between 0 and ${LIMITS.price}.`);
  }
  if (errors.length || !metro || !date || !time) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      metro: metro.id,
      tz: metro.tz,
      starts_local: `${date}T${time}`,
      title: title || null,
      acts: acts.map((name) => ({ name })),
      venue_name: f.venueName.trim().slice(0, 120),
      venue_area: f.area.trim().slice(0, 80),
      venue_address: f.address.trim().slice(0, 200) || null,
      price_min: min,
      price_max: max,
      is_free: f.free,
      genres: f.genres.filter((g) => ALL_GENRES.includes(g)).slice(0, 3),
      ticket_url: ticket || null,
      source_url: source || null,
    },
  };
}

/** A row of the submissions table, as the app reads it. */
export type SubmissionRow = {
  id: string;
  created_by: string | null;
  created_at: string;
  status: 'pending' | 'live' | 'removed';
  metro: string;
  title: string | null;
  acts: { name?: unknown }[] | null;
  venue_name: string;
  venue_area: string;
  venue_address: string | null;
  starts_local: string;
  utc_offset_min: number;
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  genres: string[] | null;
  ticket_url: string | null;
  source_url: string | null;
  confirm_count: number;
  report_count: number;
};

/** "-300" → "-05:00". */
export function offsetString(min: number): string {
  const a = Math.abs(Math.trunc(min));
  return `${min < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Community show ids start with this so they never collide with provider ids. */
export const COMMUNITY_PREFIX = 'cm-';

export function rowToShow(row: SubmissionRow): Show | null {
  const metro = metroById(row.metro);
  const acts = (Array.isArray(row.acts) ? row.acts : [])
    .map((a) => (typeof a?.name === 'string' ? a.name : ''))
    .filter(Boolean)
    .map((name, order) => ({ name, order }));
  return cleanShow({
    id: `${COMMUNITY_PREFIX}${row.id}`,
    title: row.title ?? undefined,
    startsAt: `${row.starts_local}:00${offsetString(row.utc_offset_min)}`,
    venue: {
      name: row.venue_name,
      neighborhood: row.venue_area,
      area: row.venue_area,
      metro: row.metro,
      city: metro ? `${row.venue_area}, ${metro.state}` : row.venue_area,
      address: row.venue_address ?? undefined,
      addressVisibility: 'public',
    },
    acts,
    genres: (row.genres ?? []).filter((g) => ALL_GENRES.includes(g as Genre)),
    price: {
      min: row.price_min ?? undefined,
      max: row.price_max ?? undefined,
      isFree: row.is_free ? true : undefined,
    },
    ticketUrl: row.ticket_url ?? row.source_url ?? undefined,
    status: 'scheduled',
    source: { provider: 'community', url: row.source_url ?? '', fetchedAt: row.created_at, ...(row.created_by ? { author: row.created_by } : {}) },
    updatedAt: row.created_at,
  });
}
