/** Coverage numbers per metro and the weekly plain-language summary. */
import type { VenueRow } from './types.ts';

export type MetroCoverage = {
  metro: string;
  venuesTotal: number;
  approvedA: number;
  approvedB: number;
  quarantined: number;
  rejected: number;
  disabled: number;
  /** Approved venues checked within the refresh window. */
  scannedInWindow: number;
  upcomingShows: number;
  showsBySource: Record<string, number>;
};

export type VenueStatusRow = Pick<VenueRow, 'id' | 'metro' | 'tier' | 'status'> & { lastCheckedAt?: string | null };

export function coverageReport(
  metros: readonly string[],
  venues: readonly VenueStatusRow[],
  shows: readonly { metro: string | null; sources: readonly string[] }[],
  now: Date,
  refreshDays: number,
): MetroCoverage[] {
  const horizon = now.getTime() - refreshDays * 86400_000;
  return metros.map((m) => {
    const vs = venues.filter((v) => v.metro === m);
    const sh = shows.filter((s) => s.metro === m);
    const bySource: Record<string, number> = {};
    for (const s of sh) for (const src of new Set(s.sources)) bySource[src] = (bySource[src] ?? 0) + 1;
    const approved = vs.filter((v) => v.status === 'approved');
    return {
      metro: m,
      venuesTotal: vs.length,
      approvedA: approved.filter((v) => v.tier === 'A').length,
      approvedB: approved.filter((v) => v.tier === 'B').length,
      quarantined: vs.filter((v) => v.status === 'quarantined').length,
      rejected: vs.filter((v) => v.status === 'rejected').length,
      disabled: vs.filter((v) => v.status === 'disabled').length,
      scannedInWindow: approved.filter((v) => v.lastCheckedAt && Date.parse(v.lastCheckedAt) >= horizon).length,
      upcomingShows: sh.length,
      showsBySource: bySource,
    };
  });
}

export type WeeklyInput = {
  coverage: readonly MetroCoverage[];
  newlyDisabled: readonly { venue: string; reason: string }[];
  topRejections: readonly { reason: string; count: number }[];
  quotaShare: readonly number[];
  wideningDecisions: readonly string[];
  flyers: { received: number; published: number; pending: number; rejected: number };
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function weeklySummary(i: WeeklyInput): string {
  const lines: string[] = [];
  const approved = i.coverage.reduce((n, c) => n + c.approvedA + c.approvedB, 0);
  const shows = i.coverage.reduce((n, c) => n + c.upcomingShows, 0);
  lines.push(`This week: ${approved} venues are being read automatically (${i.coverage.reduce((n, c) => n + c.approvedA, 0)} from structured data, ${i.coverage.reduce((n, c) => n + c.approvedB, 0)} using the model). ${shows} upcoming shows come from our own sources.`);
  if (i.quotaShare.length) {
    const avg = i.quotaShare.reduce((a, b) => a + b, 0) / i.quotaShare.length;
    lines.push(`Model quota: average ${pct(avg)} of the daily cap over the last ${i.quotaShare.length} days, highest day ${pct(Math.max(...i.quotaShare))}.`);
  }
  lines.push(`Flyers: ${i.flyers.received} received, ${i.flyers.published} published, ${i.flyers.pending} waiting for confirmation, ${i.flyers.rejected} rejected.`);
  if (i.newlyDisabled.length) lines.push(`Venues switched off by the safety rules: ${i.newlyDisabled.map((d) => `${d.venue} (${d.reason})`).join('; ')}.`);
  else lines.push('No venues were switched off this week.');
  if (i.topRejections.length) lines.push(`Most common reasons shows or venues were rejected: ${i.topRejections.slice(0, 5).map((r) => `${r.reason} (${r.count})`).join(', ')}.`);
  if (i.wideningDecisions.length) lines.push(`Wave decisions: ${i.wideningDecisions.join(' ')}`);
  const thin = i.coverage.filter((c) => c.approvedA + c.approvedB > 0 && c.scannedInWindow < (c.approvedA + c.approvedB) * 0.8).map((c) => c.metro);
  if (thin.length) lines.push(`Metros where fewer than 80% of venues were read inside the refresh window: ${thin.join(', ')}.`);
  return lines.join('\n');
}
