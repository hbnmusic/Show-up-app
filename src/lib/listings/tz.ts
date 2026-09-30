/**
 * Wall-clock time in a named time zone → ISO 8601 with offset.
 * Used by the listings script only (Node); the app never parses time zones.
 */

const pad = (n: number) => String(n).padStart(2, '0');

function offsetMinutes(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * "2026-10-05T20:00:00" + "America/New_York" → "2026-10-05T20:00:00-04:00".
 * A value that already carries an offset is normalised and returned as is.
 * Returns null for anything that is not a date-time or a time zone Node knows.
 */
export function localToIso(local: string, tz: string): string | null {
  const m = LOCAL.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', explicit] = m;
  const stamp = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (explicit) {
    if (explicit === 'Z') return `${stamp}+00:00`;
    const e = explicit.replace(':', '');
    return `${stamp}${e.slice(0, 3)}:${e.slice(3)}`;
  }
  try {
    const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    let utc = wall - offsetMinutes(wall, tz) * 60000;
    utc = wall - offsetMinutes(utc, tz) * 60000; // second pass settles times near a clock change
    const off = offsetMinutes(utc, tz);
    const sign = off < 0 ? '-' : '+';
    const a = Math.abs(off);
    return `${stamp}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  } catch {
    return null;
  }
}

/** True for a bare date such as "2026-10-05" (a listing with no time). */
export function isDateOnly(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}
