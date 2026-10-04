/**
 * Readiness report for the soft-launch cities (New York and Los Angeles by default).
 *
 *   npx tsx scripts/readiness-report.ts [--metros nyc,la] [--out report.txt] [--json report.json]
 *
 * Network mode (what the owner runs): downloads the published listings, reads first-party and community shows with the
 * project's public (anon) key, and venue counts from the fp-job function.
 *   needs  SUPABASE_URL, SUPABASE_ANON_KEY (public values), FP_JOB_URL and JOB_TOKEN (for venue counts; optional)
 * Venue counts can also come from a file: --venues-json <file> (same shape as venues.json below).
 * File mode: --data-dir <dir> holds feed-<metro>.json, fp-<metro>.json, community-<metro>.json (optional) and
 * venues.json ({ coverage: [...], rejections: [{ metro, reason, count }] }); --previous-dir <dir> holds an earlier feed-<metro>.json.
 */
/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { arg } from './lib/api';
import { buildReadiness, renderReadiness, type Readiness, type VenueCounts } from './lib/readiness';
import { parseFpRows } from '../src/lib/fpMerge';
import { rowToShow, type SubmissionRow } from '../src/lib/community/form';
import { parseFeed } from '../src/lib/listings/validate';
import { listingsUrl } from '../src/lib/listings/url';
import { metroById } from '../src/lib/metros';
import type { Show } from '../src/lib/types';

const readJson = (p: string): unknown => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url.split('?')[0]}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const ids = arg('metros', 'nyc,la').split(',').map((s) => s.trim()).filter(Boolean);
  const dir = arg('data-dir', '');
  const prevDir = arg('previous-dir', '');
  const now = new Date();
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY;
  const rest = key ? { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' } : undefined;

  const notes: string[] = [];
  if (!dir && !(url && rest)) notes.push('First-party and community shows were NOT read: SUPABASE_URL or SUPABASE_ANON_KEY is not set, so those columns show 0.');
  let coverage: { metro: string; approvedA: number; approvedB: number; quarantined: number; rejected: number; disabled: number; scannedInWindow: number; venuesTotal: number }[] = [];
  let rejections: { metro: string; reason: string; count: number }[] = [];
  try {
    const venuesFile = arg('venues-json', dir ? join(dir, 'venues.json') : '');
    if (venuesFile) {
      const v = readJson(venuesFile) as { coverage?: typeof coverage; rejections?: typeof rejections } | null;
      coverage = v?.coverage ?? [];
      rejections = v?.rejections ?? [];
    } else if (process.env.FP_JOB_URL && process.env.JOB_TOKEN) {
      const r = (await getJson(process.env.FP_JOB_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-job-token': process.env.JOB_TOKEN }, body: JSON.stringify({ action: 'coverage' }) })) as { coverage?: typeof coverage; rejections?: typeof rejections };
      coverage = r.coverage ?? [];
      rejections = r.rejections ?? [];
    }
  } catch (e) {
    notes.push(`Venue counts unavailable: ${(e as Error).message}`);
  }

  const reports: Readiness[] = [];
  for (const id of ids) {
    const metro = metroById(id);
    if (!metro) throw new Error(`Unknown city: ${id}`);
    const feedRaw = dir ? readJson(join(dir, `feed-${id}.json`)) : await getJson(listingsUrl(id));
    const feed = parseFeed(feedRaw);
    if (!feed) throw new Error(`No readable listings feed for ${id}`);
    let fpRows = [] as ReturnType<typeof parseFpRows>;
    let community: Show[] = [];
    try {
      if (dir) {
        fpRows = parseFpRows(readJson(join(dir, `fp-${id}.json`)) ?? []);
        community = ((readJson(join(dir, `community-${id}.json`)) as SubmissionRow[] | null) ?? []).map(rowToShow).filter((s): s is Show => s !== null);
      } else if (url && rest) {
        fpRows = parseFpRows(await getJson(`${url}/rest/v1/rpc/fp_public_shows`, { method: 'POST', headers: rest, body: JSON.stringify({ p_metro: id }) }));
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const rows = (await getJson(`${url}/rest/v1/submissions?select=*&metro=eq.${id}&status=eq.live&starts_at=gt.${since}&order=starts_at&limit=500`, { headers: rest })) as SubmissionRow[];
        community = rows.map(rowToShow).filter((s): s is Show => s !== null);
      }
    } catch (e) {
      notes.push(`First-party or community shows unavailable for ${id}: ${(e as Error).message}`);
    }
    const prev = prevDir ? parseFeed(readJson(join(prevDir, `feed-${id}.json`))) : null;
    const cov = coverage.find((c) => c.metro === id);
    const venues: VenueCounts | null = cov ? { approvedA: cov.approvedA, approvedB: cov.approvedB, quarantined: cov.quarantined, rejected: cov.rejected, disabled: cov.disabled, scannedInWindow: cov.scannedInWindow, venuesTotal: cov.venuesTotal } : null;
    reports.push(
      buildReadiness({
        metro: { id, name: metro.name },
        now,
        jambase: feed.feed.shows,
        fpRows,
        community,
        venues,
        rejections: rejections.filter((r) => r.metro === id).sort((a, b) => b.count - a.count),
        previousIds: prev ? new Set(prev.feed.shows.map((s) => s.id)) : null,
        previousAt: prev?.feed.generatedAt ?? null,
      }),
    );
  }
  const text = (notes.length ? `${notes.map((n) => `NOTE: ${n}`).join('\n')}\n\n` : '') + renderReadiness(reports, now);
  console.log(text);
  const out = arg('out', '');
  if (out) writeFileSync(out, text);
  const json = arg('json', '');
  if (json) writeFileSync(json, JSON.stringify(reports, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
