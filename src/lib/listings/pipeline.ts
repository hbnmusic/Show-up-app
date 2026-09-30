/**
 * The listings pipeline without any network or file access, so it can be
 * tested: page collection under a call budget, mapping, merging and the
 * checks that stop a bad fetch from replacing a good feed.
 */
import type { Show } from '../types';
import { DEFAULT_MAP_OPTIONS, mapJamBaseEvent, type SkipReason } from './jambase';
import { dedupeShows, mergeFeed, sortByStart, stillRelevant } from './merge';
import { cleanShow, type Feed } from './validate';

export type PageResult = { events: unknown[]; totalPages: number };
export type Fetcher = (page: number) => Promise<PageResult>;

export const ATTRIBUTION = ['Listings by JamBase (jambase.com)'];

/** Read pages 1..n, stopping at the last page or when the call budget is spent. */
export async function collect(getPage: Fetcher, budget: number) {
  const events: unknown[] = [];
  let calls = 0;
  let totalPages = 1;
  let page = 1;
  while (page <= totalPages && calls < budget) {
    const r = await getPage(page);
    calls++;
    events.push(...r.events);
    totalPages = Math.max(1, r.totalPages);
    page++;
  }
  return { events, calls, totalPages, truncated: page - 1 < totalPages };
}

export type BuildOptions = {
  mode: 'full' | 'incremental';
  now: Date;
  maxCapacity?: number;
  /** Listings maintained by hand (DIY nights JamBase does not carry). */
  manual?: unknown[];
  previous?: Show[];
};

export type Report = {
  seen: number;
  mapped: number;
  skipped: Partial<Record<SkipReason, number>>;
  manual: number;
  total: number;
  previousTotal: number;
};

export function buildFeed(rawEvents: unknown[], o: BuildOptions): { feed: Feed; report: Report } {
  const fetchedAt = o.now.toISOString();
  const skipped: Report['skipped'] = {};
  const mapped: Show[] = [];
  for (const ev of rawEvents) {
    const r = mapJamBaseEvent(ev, { fetchedAt, maxCapacity: o.maxCapacity ?? DEFAULT_MAP_OPTIONS.maxCapacity });
    if ('show' in r) mapped.push(r.show);
    else skipped[r.skip] = (skipped[r.skip] ?? 0) + 1;
  }
  const previous = (o.previous ?? []).filter((s) => s.source.provider !== 'manual');
  const merged = mergeFeed(previous, mapped, o.mode, o.now);

  const manual = (o.manual ?? [])
    .map(cleanShow)
    .filter((s): s is Show => !!s && stillRelevant(s, o.now))
    .map((s) => ({ ...s, id: s.id.startsWith('manual-') ? s.id : `manual-${s.id}`, source: { ...s.source, provider: 'manual' } }));
  const shows = sortByStart(dedupeShows([...merged, ...manual]));

  return {
    feed: { version: 1, generatedAt: fetchedAt, attribution: ATTRIBUTION, shows },
    report: {
      seen: rawEvents.length,
      mapped: mapped.length,
      skipped,
      manual: manual.length,
      total: shows.length,
      previousTotal: (o.previous ?? []).length,
    },
  };
}

/**
 * Refuse to replace a good feed with a bad one. Returns the reason to stop,
 * or null when the new feed looks sane.
 */
export function sanityProblem(report: Report, mode: 'full' | 'incremental', truncated: boolean): string | null {
  if (truncated) return 'The call budget ran out before every page was read; raise --budget or shorten --days.';
  if (mode === 'full' && report.seen === 0) return 'The API returned no events for a full fetch.';
  if (mode === 'full' && report.mapped === 0) return 'Events came back but none could be mapped; the response shape may have changed.';
  if (mode === 'full' && report.previousTotal >= 50 && report.total < report.previousTotal * 0.4) {
    return `The new feed has ${report.total} shows against ${report.previousTotal} before; not replacing it.`;
  }
  return null;
}
