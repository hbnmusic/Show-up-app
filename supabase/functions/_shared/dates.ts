/**
 * Dates, times and prices as printed on flyers and venue pages (English and French).
 * Pure functions, no Deno or React Native APIs, so the phone, the Edge Functions and the tests share them.
 */

export type Lang = 'en' | 'fr';

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janv: 1, janvier: 1,
  feb: 2, february: 2, fev: 2, fevr: 2, fevrier: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, dim: 0, dimanche: 0,
  mon: 1, monday: 1, lun: 1, lundi: 1,
  tue: 2, tues: 2, tuesday: 2, mar: 2, mardi: 2,
  wed: 3, weds: 3, wednesday: 3, mer: 3, mercredi: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, jeu: 4, jeudi: 4,
  fri: 5, friday: 5, ven: 5, vendredi: 5,
  sat: 6, saturday: 6, sam: 6, samedi: 6,
};

/** Month names that are also weekday abbreviations ("mar") are read as weekdays only when a month name is not expected. */
export function weekdayIndex(word: string | undefined | null): number | null {
  if (!word) return null;
  const w = strip(word).replace(/[^a-z]/g, '');
  return w in WEEKDAYS ? WEEKDAYS[w] : null;
}

export function monthIndex(word: string | undefined | null): number | null {
  if (!word) return null;
  const w = strip(word).replace(/[^a-z]/g, '');
  return w in MONTHS ? MONTHS[w] : null;
}

export type YMD = { y: number; m: number; d: number };

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const ymdString = (v: YMD) => `${v.y}-${pad2(v.m)}-${pad2(v.d)}`;

export function validYmd(v: YMD): boolean {
  if (!Number.isInteger(v.y) || v.m < 1 || v.m > 12 || v.d < 1 || v.d > 31) return false;
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d));
  return t.getUTCFullYear() === v.y && t.getUTCMonth() === v.m - 1 && t.getUTCDate() === v.d;
}

export function weekdayOf(v: YMD): number {
  return new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay();
}

export function dayNumber(v: YMD): number {
  return Math.floor(Date.UTC(v.y, v.m - 1, v.d) / 86400000);
}

/** Today's date in the given time zone. */
export function todayIn(tz: string, now: Date = new Date()): YMD {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: g('year'), m: g('month'), d: g('day') };
}

export type PrintedDate = {
  month: number;
  day: number;
  year?: number;
  /** Set when a numeric date could be day/month or month/day. */
  alt?: { month: number; day: number };
  weekday?: number;
};

/**
 * Reads one printed date: "Fri Oct 17", "Friday, October 17th 2026", "vendredi 17 octobre",
 * "17 oct.", "10/17", "17/10/2026", "2026-10-17". Returns null when nothing date-like is found.
 */
export function parsePrintedDate(text: string, lang: Lang = 'en'): PrintedDate | null {
  const t = strip(text).replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = t.split(/[^a-z]+/).filter(Boolean);
  // "mar" is both mardi and March: it is a weekday only when another month name is present.
  const hasMonthWord = tokens.some((w) => monthIndex(w) != null && w !== 'mar');
  let weekday: number | undefined;
  for (const w of tokens) {
    const wi = weekdayIndex(w);
    if (wi == null || (w === 'mar' && !hasMonthWord)) continue;
    weekday = wi;
    break;
  }
  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3], weekday };

  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  // "17 octobre" / "17th october 2026" and "october 17th 2026"
  for (let i = 0; i < words.length; i++) {
    const mi = monthIndex(words[i]);
    if (mi == null) continue;
    if (words[i] === 'mar' && hasMonthWord) continue;
    const before = /^(\d{1,2})(st|nd|rd|th|er)?$/.exec(words[i - 1] ?? '');
    const after = /^(\d{1,2})(st|nd|rd|th|er)?$/.exec(words[i + 1] ?? '');
    const yearAfter = (w?: string) => (w && /^20\d{2}$/.test(w) ? +w : undefined);
    if (before && (lang === 'fr' || !after)) return { month: mi, day: +before[1], year: yearAfter(words[i + 1]), weekday };
    if (after) return { month: mi, day: +after[1], year: yearAfter(words[i + 2]), weekday };
    if (before) return { month: mi, day: +before[1], year: yearAfter(words[i + 1]), weekday };
  }
  const num = /\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/.exec(t);
  if (num) {
    const a = +num[1], b = +num[2];
    let year = num[3] ? +num[3] : undefined;
    if (year != null && year < 100) year += 2000;
    const mdy = { month: a, day: b };
    const dmy = { month: b, day: a };
    const primary = lang === 'fr' ? dmy : mdy;
    const other = lang === 'fr' ? mdy : dmy;
    const otherOk = other.month >= 1 && other.month <= 12 && other.day >= 1 && other.day <= 31 && a !== b;
    return { ...primary, year, weekday, alt: otherOk ? other : undefined };
  }
  return null;
}

export type DateRejection = 'unreadable' | 'invalid_date' | 'past' | 'too_far' | 'weekday_mismatch';

export type ResolvedDate = { ok: true; date: YMD; inferredYear: boolean } | { ok: false; reason: DateRejection };

/**
 * Turns a printed date into a real one. With no printed year the next occurrence on or after today is
 * used, and it must fall within 12 months. A weekday printed on the flyer must match; a mismatch rejects
 * the date (the weekday is the strongest check we have against misread digits).
 */
export function resolveDate(printed: PrintedDate | null, today: YMD, weekdayText?: string | null): ResolvedDate {
  if (!printed) return { ok: false, reason: 'unreadable' };
  const weekday = weekdayText ? weekdayIndex(weekdayText) ?? printed.weekday : printed.weekday;
  const options = [{ month: printed.month, day: printed.day }, ...(printed.alt ? [printed.alt] : [])];
  const horizon = dayNumber(today) + 366;
  let firstFail: DateRejection = 'invalid_date';
  for (const o of options) {
    let candidates: YMD[];
    if (printed.year != null) candidates = [{ y: printed.year, m: o.month, d: o.day }];
    else candidates = [today.y, today.y + 1].map((y) => ({ y, m: o.month, d: o.day }));
    const real = candidates.filter(validYmd);
    if (real.length === 0) continue;
    const future = real.find((c) => dayNumber(c) >= dayNumber(today));
    if (!future) { firstFail = 'past'; continue; }
    if (dayNumber(future) > horizon) { firstFail = 'too_far'; continue; }
    if (weekday != null && weekdayOf(future) !== weekday) {
      // A flyer without a year may mean the following year when that year's weekday fits (still within the horizon).
      if (printed.year == null) {
        const next = real.find((c) => c.y > future.y && dayNumber(c) <= horizon && weekdayOf(c) === weekday);
        if (next) return { ok: true, date: next, inferredYear: true };
      }
      firstFail = 'weekday_mismatch';
      continue;
    }
    return { ok: true, date: future, inferredYear: printed.year == null };
  }
  return { ok: false, reason: firstFail };
}

/** "8pm", "8:30 PM", "8 p.m.", "20h", "20 h", "20h30", "20:30" → "20:00" style. Null when unclear (a bare "8"). */
export function parseTime(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  let m = /\b(\d{1,2})\s?h\s?(\d{2})?\b/.exec(t);
  if (m) {
    const h = +m[1], min = m[2] ? +m[2] : 0;
    return h <= 23 && min <= 59 ? `${pad2(h)}:${pad2(min)}` : null;
  }
  m = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/.exec(t);
  if (m) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    return `${pad2(h)}:${pad2(min)}`;
  }
  m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
  if (m) return `${pad2(+m[1])}:${m[2]}`;
  return null;
}

export type ParsedPrice = { min?: number; max?: number; isFree?: boolean; notaflof?: boolean };

/** "Free", "gratuit", "$15", "15$ adv / 20$ door", "$10-15", "PWYC". Empty object when nothing is stated. */
export function parsePrice(text: string | null | undefined): ParsedPrice {
  if (!text) return {};
  const t = strip(text);
  if (/\b(free|gratuit|gratis|no cover|entree libre)\b/.test(t) && !/\d/.test(t)) return { isFree: true };
  const nums = [...t.matchAll(/(\d+(?:[.,]\d{1,2})?)\s*\$|\$\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:usd|cad|eur)/g)].map((m) =>
    Number((m[1] ?? m[2] ?? m[3]).replace(',', '.')),
  );
  const out: ParsedPrice = {};
  if (/\b(pwyc|pay what you can|sliding scale|notaflof|prix libre|contribution volontaire)\b/.test(t)) out.notaflof = true;
  if (nums.length) {
    out.min = Math.min(...nums);
    out.max = Math.max(...nums);
    if (out.min === 0 && out.max === 0) { out.isFree = true; delete out.min; delete out.max; }
  }
  return out;
}

/** Wall-clock local date + time → "YYYY-MM-DDTHH:MM:00" (offset added by the caller with the metro's zone). */
export const localStamp = (d: YMD, hhmm: string) => `${ymdString(d)}T${hhmm}:00`;
