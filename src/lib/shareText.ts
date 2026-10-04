/**
 * The plain-text message for "Send to a friend". Built on the phone from data the show already has; nothing is sent to a server.
 * One fact per line. The lines before the links stay under about 300 characters.
 */
import { APP_NAME, APP_SHARE_URL } from './legal';
import { headliner, supportActs } from './showText';
import { formatTime, MONTHS, WEEKDAYS, wall } from './time';
import type { Show } from './types';

const MAX_BEFORE_LINKS = 300;

function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "Sat, Oct 17" on the venue's own calendar, whatever the phone's zone. */
export function shareDay(s: Show): string {
  const d = wall(s.startsAt);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Sat, Oct 17 · 8 PM" (venue-local); the time is left out when the listing has none. */
export function shareWhen(s: Show): string {
  return s.timeTba ? shareDay(s) : `${shareDay(s)} · ${formatTime(wall(s.startsAt))}`;
}

export function formatGoing(n: number): string {
  return `${Math.round(n)} going`;
}

/** `going` is the count the app is displaying for this show, or null/undefined when none is shown. */
export function shareMessage(s: Show, going?: number | null): string {
  const head = clip(headliner(s), 70);
  const supports = supportActs(s).filter(Boolean).slice(0, 2).map((n) => clip(n, 40));
  const title = s.acts.length === 0 && s.title ? clip(s.title, 70) : head;
  const line1 = supports.length && s.acts.length ? `${title} with ${supports.join(', ')}` : title;
  const place = [s.venue.name, s.venue.city || s.venue.area].filter(Boolean).map((p) => clip(p, 50)).join(', ');
  const lines = [line1, place, shareWhen(s)];
  if (going != null && going > 0) lines.push(formatGoing(going));
  // Keep the text part short: drop the supporting acts first if the lines run long.
  if (lines.join('\n').length > MAX_BEFORE_LINKS && supports.length) lines[0] = title;
  const out = lines.filter(Boolean);
  if (s.ticketUrl) out.push(s.ticketUrl);
  out.push(`Found on ${APP_NAME}: ${APP_SHARE_URL}`);
  return out.join('\n');
}

/**
 * What the share sheet told us. React Native on Android resolves "sharedAction" as soon as the sheet opens and never says
 * whether anything was sent, so there is no completion to report; iOS reports an activity type when a target was used.
 */
export function shareOutcome(r: { action?: string; activityType?: string | null } | null | undefined): { completed?: boolean } {
  if (!r) return {};
  if (r.action === 'dismissedAction') return { completed: false };
  if (r.action === 'sharedAction' && r.activityType) return { completed: true };
  return {};
}
