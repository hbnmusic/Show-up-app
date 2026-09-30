/**
 * Fetch upcoming NYC / North Jersey shows from JamBase and write the feed
 * the app downloads.
 *
 *   JAMBASE_API_KEY=... npx tsx scripts/fetch-listings.ts --mode full
 *
 * Options (all optional):
 *   --mode full|incremental   incremental only asks for shows changed since the last run
 *   --out listings/shows.json
 *   --manual listings/manual.json   hand-kept listings merged in
 *   --days 60                 how far ahead to look (free plan allows about 6 months)
 *   --lat 40.7128 --lng -74.006 --radius 25   search circle in miles
 *   --max-capacity 1500       skip bigger venues
 *   --budget 60               most API calls this run may make (free plan: 1,000 a month)
 *   --dump-sample listings/raw-sample.json   save the first raw page for inspection
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { buildFeed, collect, sanityProblem } from '../src/lib/listings/pipeline';
import { parseFeed } from '../src/lib/listings/validate';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Also report failures as GitHub annotations so they show on the run summary page. */
function fail(message: string, code = 1): never {
  console.error(process.env.GITHUB_ACTIONS ? `::error title=Listings fetch failed::${message.replace(/\r?\n/g, ' ')}` : message);
  process.exit(code);
}

const key = process.env.JAMBASE_API_KEY;
if (!key) {
  fail('Set JAMBASE_API_KEY (a JamBase Data API key).', 2);
}

const out = arg('out', 'listings/shows.json');
const manualPath = arg('manual', 'listings/manual.json');
const days = Number(arg('days', '60'));
const budget = Number(arg('budget', '60'));
const maxCapacity = Number(arg('max-capacity', '1500'));
const lat = arg('lat', '40.7128');
const lng = arg('lng', '-74.006');
const radius = arg('radius', '25');
const dump = process.argv.includes('--dump-sample') ? arg('dump-sample', 'listings/raw-sample.json') : null;

const bases = process.env.JAMBASE_BASE_URL
  ? [process.env.JAMBASE_BASE_URL]
  : ['https://api.data.jambase.com/v3', 'https://data.jambase.com/v3'];
let base = bases[0];

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const previous = parseFeed(readJson(out));
const requested = arg('mode', previous ? 'incremental' : 'full');
if (requested !== 'full' && requested !== 'incremental') {
  console.error('--mode must be full or incremental');
  process.exit(2);
}
let mode: 'full' | 'incremental' = requested;
if (mode === 'incremental' && !previous?.feed.generatedAt) mode = 'full';

const now = new Date();
const dayET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const from = dayET(now);
const to = dayET(new Date(now.getTime() + days * 86400_000));

async function get(page: number, since?: string) {
  const q = new URLSearchParams({
    eventType: 'concert',
    geoLatitude: lat,
    geoLongitude: lng,
    geoRadiusAmount: radius,
    geoRadiusUnits: 'mi',
    eventDateFrom: from,
    eventDateTo: to,
    sort: 'eventDate',
    perPage: '100',
    page: String(page),
  });
  if (since) q.set('dateModifiedFrom', since);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${base}/events?${q}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    } catch (e) {
      // Wrong host on the very first call: try the next known base once.
      const next = bases[bases.indexOf(base) + 1];
      if (page === 1 && next) {
        base = next;
        continue;
      }
      throw e;
    }
    if (res.status === 404 && page === 1 && bases.indexOf(base) < bases.length - 1) {
      base = bases[bases.indexOf(base) + 1];
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`JamBase refused the key (HTTP ${res.status}).`);
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`JamBase returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { events?: unknown[]; pagination?: { totalPages?: number } };
    if (dump && page === 1) {
      fs.mkdirSync(path.dirname(dump), { recursive: true });
      fs.writeFileSync(dump, JSON.stringify({ base, query: q.toString(), body: { ...body, events: (body.events ?? []).slice(0, 5) } }, null, 2));
    }
    return { events: body.events ?? [], totalPages: body.pagination?.totalPages ?? 1 };
  }
}

async function main() {
  const since = mode === 'incremental' ? previous!.feed.generatedAt.replace(/\.\d+Z$/, '').replace(/Z$/, '') : undefined;
  console.log(`Mode ${mode}; ${from} to ${to}; ${radius} mi around ${lat},${lng}${since ? `; changed since ${since} UTC` : ''}`);
  const got = await collect((p) => get(p, since), budget);

  const manualRaw = readJson(manualPath);
  const { feed, report } = buildFeed(got.events, {
    mode,
    now,
    maxCapacity,
    manual: Array.isArray(manualRaw) ? manualRaw : [],
    previous: previous?.feed.shows,
  });

  console.log(`API calls: ${got.calls} (budget ${budget}); pages ${got.calls}/${got.totalPages}${got.truncated ? ' TRUNCATED' : ''}`);
  console.log(`Seen ${report.seen}, mapped ${report.mapped}, manual ${report.manual}, feed now ${report.total} (was ${report.previousTotal})`);
  console.log('Skipped:', Object.keys(report.skipped).length ? report.skipped : 'none');

  const problem = sanityProblem(report, mode, got.truncated);
  if (problem) {
    fail(`Not writing ${out}: ${problem} (seen ${report.seen}, mapped ${report.mapped}, skipped ${JSON.stringify(report.skipped)})`);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(`${out}.tmp`, JSON.stringify(feed));
  fs.renameSync(`${out}.tmp`, out);
  console.log(`Wrote ${out}`);
}

main().catch((e) => {
  const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
  fail(`${e instanceof Error ? e.message : String(e)}${cause} [base ${base}]`);
});
