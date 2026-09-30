/**
 * Date helpers. All listings are in New York time, and the app is built for
 * people in New York and North Jersey, so display uses the device's local zone.
 */

const DAY = 24 * 60 * 60 * 1000;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
