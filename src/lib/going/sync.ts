/**
 * Sending queued Going changes, and fetching counts. Both take their dependencies as arguments so they are tested without a
 * phone or a network. Nothing here ever throws into the caller: Going stays fully local when the network is down.
 */
import { afterFailure, afterSuccess, isDue, takeBatch, toChanges, type GoingQueue } from './queue';

export type FlushDeps = {
  now: () => number;
  /** The going_counts_enabled kill switch. */
  flagOn: () => boolean;
  /** The "Include my Going in public counts" switch. */
  includeOn: () => boolean;
  getQueue: () => GoingQueue;
  setQueue: (q: GoingQueue) => void;
  /** One set_going call. Returns true when the server accepted it. */
  send: (changes: { show_id: string; going: boolean; date: string }[]) => Promise<boolean>;
};

let flushing = false;

/** Sends what is queued, a batch at a time, until the queue is empty or a call fails. Returns how many batches were sent. */
export async function flushGoing(d: FlushDeps): Promise<number> {
  if (flushing) return 0;
  if (!d.flagOn() || !d.includeOn()) return 0;
  flushing = true;
  let sent = 0;
  try {
    while (d.flagOn() && d.includeOn() && isDue(d.getQueue(), d.now())) {
      const batch = takeBatch(d.getQueue());
      if (batch.length === 0) break;
      let ok = false;
      try {
        ok = await d.send(toChanges(batch));
      } catch {
        ok = false;
      }
      if (!ok) {
        d.setQueue(afterFailure(d.getQueue(), d.now()));
        break;
      }
      d.setQueue(afterSuccess(d.getQueue(), batch));
      sent++;
    }
  } finally {
    flushing = false;
  }
  return sent;
}

// ---- counts --------------------------------------------------------------------------------------------------------

export const COUNTS_REFRESH_MS = 15 * 60_000;
/** After a failed fetch, wait this long before trying the same list again. */
export const COUNTS_RETRY_MS = 60_000;
export const COUNTS_BATCH = 50;

export type CountsCache = {
  byId: Record<string, number>;
  /** When each list ("deck", "going") was last fetched successfully (ms). */
  fetchedAt: Record<string, number>;
  /** When each list was last tried (ms), successful or not. */
  triedAt: Record<string, number>;
};
export const EMPTY_COUNTS: CountsCache = { byId: {}, fetchedAt: {}, triedAt: {} };

export function countsDue(c: CountsCache, list: string, now: number): boolean {
  const ok = c.fetchedAt[list];
  if (ok != null && now >= ok && now - ok < COUNTS_REFRESH_MS) return false;
  const tried = c.triedAt[list];
  if (tried != null && now >= tried && now - tried < COUNTS_RETRY_MS) return false;
  return true;
}

/** Only whole numbers of 1 or more are counts; anything else from the server is ignored. */
export function parseCounts(raw: unknown): Record<string, number> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number' && Number.isInteger(v) && v >= 1) out[k] = v;
  return out;
}

export type CountsDeps = {
  now: () => number;
  flagOn: () => boolean;
  get: () => CountsCache;
  set: (c: CountsCache) => void;
  /** One get_going_counts call; null on any failure. */
  fetch: (ids: string[]) => Promise<unknown | null>;
};

/**
 * Fetches counts for the shows in one list, at most once every 15 minutes per list. With the switch off, or on any failure,
 * nothing new is shown. Shows missing from the reply are hidden (their count is at or below the threshold).
 */
export async function refreshCounts(d: CountsDeps, list: string, ids: string[]): Promise<boolean> {
  if (!d.flagOn()) {
    if (Object.keys(d.get().byId).length) d.set({ ...d.get(), byId: {} });
    return false;
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0 || !countsDue(d.get(), list, d.now())) return false;
  const at = d.now();
  d.set({ ...d.get(), triedAt: { ...d.get().triedAt, [list]: at } });
  const found: Record<string, number> = {};
  for (let i = 0; i < unique.length; i += COUNTS_BATCH) {
    let raw: unknown | null = null;
    try {
      raw = await d.fetch(unique.slice(i, i + COUNTS_BATCH));
    } catch {
      raw = null;
    }
    const parsed = raw == null ? null : parseCounts(raw);
    if (!parsed) return false; // keep what is cached; try again after the retry wait
    Object.assign(found, parsed);
  }
  const byId = { ...d.get().byId };
  for (const id of unique) {
    if (found[id] != null) byId[id] = found[id];
    else delete byId[id];
  }
  d.set({ byId, fetchedAt: { ...d.get().fetchedAt, [list]: at }, triedAt: d.get().triedAt });
  return true;
}
