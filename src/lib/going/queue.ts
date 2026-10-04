/**
 * The queue of Going changes waiting to be sent. Pure: the clock is passed in. A change is "this show is (not) Going", so
 * sending one twice is harmless (the server counts one row per phone per show), and only the latest change per show is kept.
 */
export type GoingEntry = { going: boolean; /** The show's local date, YYYY-MM-DD (the server uses it for the 7-day clean-up). */ date: string; at: number };

export type GoingQueue = {
  pending: Record<string, GoingEntry>;
  /** Do not try again before this time (ms), after a failure. */
  retryAt: number | null;
  failures: number;
};

export const EMPTY_QUEUE: GoingQueue = { pending: {}, retryAt: null, failures: 0 };
export const MAX_BATCH = 50;
/** The queue never grows past this many shows (a phone offline for weeks). */
export const MAX_PENDING = 500;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60_000;

export function enqueue(q: GoingQueue, showId: string, going: boolean, date: string, at: number): GoingQueue {
  const pending = { ...q.pending, [showId]: { going, date, at } };
  const ids = Object.keys(pending);
  if (ids.length > MAX_PENDING) {
    // Drop the oldest changes first.
    ids.sort((a, b) => pending[a].at - pending[b].at).slice(0, ids.length - MAX_PENDING).forEach((id) => delete pending[id]);
  }
  return { ...q, pending };
}

export function isDue(q: GoingQueue, now: number): boolean {
  if (Object.keys(q.pending).length === 0) return false;
  return q.retryAt == null || now >= q.retryAt || now < q.retryAt - MAX_RETRY_MS; // a clock set back does not stall the queue
}

export function takeBatch(q: GoingQueue, max = MAX_BATCH): { showId: string; entry: GoingEntry }[] {
  return Object.entries(q.pending)
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, max)
    .map(([showId, entry]) => ({ showId, entry }));
}

/** Removes what was sent, except a show that changed again while the request was in flight. */
export function afterSuccess(q: GoingQueue, sent: { showId: string; entry: GoingEntry }[]): GoingQueue {
  const pending = { ...q.pending };
  for (const { showId, entry } of sent) if (pending[showId]?.at === entry.at) delete pending[showId];
  return { pending, retryAt: null, failures: 0 };
}

export function afterFailure(q: GoingQueue, now: number): GoingQueue {
  const failures = q.failures + 1;
  return { ...q, failures, retryAt: now + Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(failures - 1, 7)) };
}

/** The body of one set_going call. */
export function toChanges(batch: { showId: string; entry: GoingEntry }[]) {
  return batch.map(({ showId, entry }) => ({ show_id: showId, going: entry.going, date: entry.date }));
}
