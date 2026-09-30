/**
 * Which reminders a going show should get. Pure, so it can be tested without a phone.
 */
import { doorsDate, headliner, supportActs } from './showText';
import { addDays, formatTime, startOfDay } from './time';
import type { ReminderPrefs, Show } from './types';

export type PlannedReminder = {
  kind: 'dayBefore' | 'dayOf' | 'beforeDoors';
  at: Date;
  title: string;
  body: string;
};

/** iOS keeps only the 64 soonest local notifications, so only the next two weeks are scheduled. */
export const SCHEDULE_WINDOW_DAYS = 14;

const MIN_LEAD_MS = 60 * 1000;

function lineupShort(s: Show): string {
  const rest = supportActs(s);
  const head = headliner(s);
  if (rest.length === 0) return head;
  if (rest.length === 1) return `${head} + ${rest[0]}`;
  return `${head} + ${rest.length} more`;
}

export function planReminders(s: Show, prefs: ReminderPrefs, now: Date): PlannedReminder[] {
  if (s.status === 'cancelled') return [];
  const start = new Date(s.startsAt);
  const doors = doorsDate(s);
  if (start.getTime() - now.getTime() > SCHEDULE_WINDOW_DAYS * 86400_000) return [];

  const name = s.title && s.acts.length === 0 ? s.title : headliner(s);
  const where = `${s.venue.name}, ${s.venue.neighborhood}`;
  // Some listings give only a start time; do not call it doors.
  const when = s.timeTba ? 'time TBA' : s.doorsAt ? `doors ${formatTime(doors)}` : `starts ${formatTime(doors)}`;
  const out: PlannedReminder[] = [];

  if (prefs.dayBefore) {
    const at = startOfDay(addDays(start, -1));
    at.setHours(18, 0, 0, 0);
    out.push({ kind: 'dayBefore', at, title: `Tomorrow: ${name}`, body: `${where} · ${when}` });
  }
  if (prefs.dayOf) {
    const at = startOfDay(start);
    at.setHours(12, 0, 0, 0);
    if (at.getTime() < doors.getTime() - 60 * 60 * 1000) {
      out.push({ kind: 'dayOf', at, title: `Tonight: ${name}`, body: `${where} · ${when}` });
    }
  }
  if (prefs.beforeDoors && !s.timeTba) {
    const at = new Date(doors.getTime() - 60 * 60 * 1000);
    out.push({
      kind: 'beforeDoors',
      at,
      title: s.doorsAt ? `Doors in 1 hour at ${s.venue.name}` : `Starts in 1 hour at ${s.venue.name}`,
      body: `${lineupShort(s)} · ${s.venue.neighborhood}`,
    });
  }
  return out.filter((r) => r.at.getTime() > now.getTime() + MIN_LEAD_MS);
}
