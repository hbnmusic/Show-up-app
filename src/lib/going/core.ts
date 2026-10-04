/**
 * The pure rules for Going counts on the phone: which Going changes to queue, what the Settings switch does, and the
 * one-time note. The store (store.ts) applies these; tests run them without a phone.
 */
import { enqueue, EMPTY_QUEUE, type GoingQueue } from './queue';

export type GoingLocal = {
  /** Random id made on this phone. Separate from the analytics install id and from any account. */
  goingId: string;
  /** The "Include my Going in public counts" switch. */
  include: boolean;
  /** The one-time inline note has been shown. */
  noteShown: boolean;
  queue: GoingQueue;
};

export type Change = { showId: string; going: boolean };
export type Decisions = Record<string, { decision: string }>;

/** Shows whose Going status differs between two sets of decisions. */
export function diffGoing(prev: Decisions, next: Decisions): Change[] {
  const out: Change[] = [];
  const was = (d: Decisions, id: string) => d[id]?.decision === 'going';
  for (const id of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = was(prev, id);
    const b = was(next, id);
    if (a !== b) out.push({ showId: id, going: b });
  }
  return out;
}

/** Queues changes. Nothing is queued while the switch or the kill switch is off, or for a show with no known date. */
export function queueChanges(
  s: GoingLocal,
  changes: Change[],
  dateOf: (showId: string) => string | null,
  now: number,
  flagOn: boolean,
): GoingLocal {
  if (!flagOn || !s.include) return s;
  let queue = s.queue;
  for (const c of changes) {
    const date = dateOf(c.showId);
    if (!date) continue;
    queue = enqueue(queue, c.showId, c.going, date, now);
  }
  return queue === s.queue ? s : { ...s, queue };
}

/** The switch turned OFF: the phone's rows are deleted on the server (by the caller) and nothing waits to be sent. */
export function switchOff(s: GoingLocal): GoingLocal {
  return { ...s, include: false, queue: EMPTY_QUEUE };
}

/** The switch turned back ON (or the kill switch came back): re-send the current Going list. */
export function switchOn(
  s: GoingLocal,
  goingIds: string[],
  dateOf: (showId: string) => string | null,
  now: number,
  today: string,
): GoingLocal {
  const on = { ...s, include: true };
  const changes = goingIds.filter((id) => (dateOf(id) ?? '') >= today).map((showId) => ({ showId, going: true }));
  return queueChanges(on, changes, dateOf, now, true);
}

/** True when this change is the person's first Going on this phone and the note has not been shown. */
export function shouldShowNote(s: GoingLocal, changes: Change[]): boolean {
  return !s.noteShown && s.include && changes.some((c) => c.going);
}

/** The show's local calendar date, YYYY-MM-DD, from a wall-clock Date (see time.wall). */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
