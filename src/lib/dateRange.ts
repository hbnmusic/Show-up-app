/** Helpers for the "pick dates" filter: a month grid, range selection and labels. Pure, so they are tested without a phone. */
import { MONTHS } from './time';
import type { DateRange } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD from a Date's own (device-local) fields. */
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return ymd(d) === s ? d : null;
}

export const addDaysYmd = (s: string, n: number): string => {
  const d = parseYmd(s) ?? new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/** Weeks (Sunday first) of a month; days outside the month are null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * What a tap on a day does. With nothing chosen, or a finished range, a tap picks that single date. With a single date chosen,
 * a tap on a later day extends it to a range, a tap on an earlier day makes the range end at the old date, and a tap on the
 * same day clears the choice.
 */
export function nextRange(cur: DateRange | null, tapped: string): DateRange | null {
  if (!cur || cur.from !== cur.to) return { from: tapped, to: tapped };
  if (tapped === cur.from) return null;
  return tapped > cur.from ? { from: cur.from, to: tapped } : { from: tapped, to: cur.from };
}

export const inRange = (r: DateRange | null, day: string): boolean => !!r && day >= r.from && day <= r.to;

function dayLabel(s: string, withYear: boolean): string {
  const d = parseYmd(s);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ''}` : s;
}

/** "Oct 24" or "Oct 24 – Oct 26"; the year is added only when the range crosses years. */
export function rangeLabel(r: DateRange): string {
  const multiYear = r.from.slice(0, 4) !== r.to.slice(0, 4);
  return r.from === r.to ? dayLabel(r.from, false) : `${dayLabel(r.from, multiYear)} – ${dayLabel(r.to, multiYear)}`;
}

/** Keeps only well-formed saved values (a saved range from an older or damaged state is dropped). */
export function cleanRange(v: unknown): DateRange | null {
  if (!v || typeof v !== 'object') return null;
  const { from, to } = v as Record<string, unknown>;
  if (typeof from !== 'string' || typeof to !== 'string' || !parseYmd(from) || !parseYmd(to) || from > to) return null;
  return { from, to };
}
