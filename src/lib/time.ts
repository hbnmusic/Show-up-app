/**
 * Date helpers. A show's time is shown as the clock on the venue's wall: a
 * 7 PM show in New York reads 7 PM even on a phone in Vancouver. Feed times
 * carry the venue's UTC offset (2026-10-10T19:00:00-04:00), so `wall` reads the
 * clock digits straight from the string and returns a Date whose *device-local*
 * fields equal them. Such a Date is only for display and day arithmetic; use
 * the real Date for sorting, countdowns and scheduling.
 */

const DAY = 24 * 60 * 60 * 1000;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WALL_RE = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/;
const OFFSET_RE = /(?:([+-])(\d\d):?(\d\d)|Z)$/;

/** Minutes the string's own offset is ahead of UTC, or null if it has none. */
export function offsetMinutes(iso: string): number | null {
  const m = OFFSET_RE.exec(iso);
  if (!m) return null;
  if (!m[1]) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** The venue's wall-clock time for an ISO string, as a device-local Date (display only). */
export function wall(iso: string): Date {
  const m = WALL_RE.exec(iso);
  if (!m || offsetMinutes(iso) == null) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/** "Now" on the clock of the venue that `iso` belongs to, in the same display form as `wall`. */
export function wallNow(iso: string, now: Date = new Date()): Date {
  const off = offsetMinutes(iso);
  if (off == null) return now;
  const t = new Date(now.getTime() + off * 60_000);
  return new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes());
}

/** The real instant for a wall-clock Date (from `wall`) at the same venue offset as `iso`. */
export function fromWall(iso: string, w: Date): Date {
  const off = offsetMinutes(iso);
  if (off == null) return w;
  return new Date(Date.UTC(w.getFullYear(), w.getMonth(), w.getDate(), w.getHours(), w.getMinutes()) - off * 60_000);
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function formatTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** "Fri Oct 16" */
export function formatDay(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Tonight", "Tomorrow", or "Fri Oct 16". */
export function relativeDay(d: Date, now: Date = new Date()): string {
  if (sameDay(d, now)) return 'Tonight';
  if (sameDay(d, addDays(now, 1))) return 'Tomorrow';
  return formatDay(d);
}

/** Minutes until a date, rounded down. */
export function minutesUntil(d: Date, now: Date = new Date()): number {
  return Math.floor((d.getTime() - now.getTime()) / 60000);
}

export { DAY };
