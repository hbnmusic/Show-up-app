/**
 * Fetch upcoming shows for each city in src/lib/metros.ts from JamBase and
 * write the one feed the app downloads.
 *
 *   JAMBASE_API_KEY=... npx tsx scripts/fetch-listings.ts --mode full
 *
 * Options (all optional):
 *   --mode full|incremental   incremental only asks for shows changed since the last run
 *   --out listings/shows.json
 *   --manual listings/manual.json   hand-kept listings merged in
 *   --days 60                 how far ahead to look (free plan allows about 6 months)
 *   --metros nyc,la,chi       which cities to fetch (default: all)
 *   --max-capacity 1500       skip bigger venues
 *   --budget 60               most API calls one city may use in a run
 *   --monthly-cap 900         stop fetching once this many calls are spent this month (free plan: 1,000)
 *   --dump-sample listings/raw-sample.json   save the first raw page for inspection
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { ATTRIBUTION, buildFeed, collect, sanityProblem } from '../src/lib/listings/pipeline';
import { dedupeShows, sortByStart, stillRelevant } from '../src/lib/listings/merge';
import { parseFeed, type Feed } from '../src/lib/listings/validate';
import { METROS, type Metro } from '../src/lib/metros';
import type { Show } from '../src/lib/types';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Also report failures as GitHub annotations so they show on the run summary page. */
function fail(message: string, code = 1): never {
  console.error(process.env.GITHUB_ACTIONS ? `::error title=Listings fetch failed::${message.replace(/\r?\n/g, ' ')}` : message);
  process.exit(code);
}

// Tolerate a key pasted with spaces, quotes or a "Bearer " prefix.
// Invisible characters (zero-width spaces and the like) sneak in when copying; keys are plain ASCII.
const key = process.env.JAMBASE_API_KEY?.replace(/[^\x21-\x7e]/g, '')
  .replace(/^["']|["']$/g, '')
  .replace(/^Bearer/i, '');
if (!key) {
  fail('Set JAMBASE_API_KEY (a JamBase Data API key).', 2);
}

const out = arg('out', 'listings/shows.json');
const manualPath = arg('manual', 'listings/manual.json');
const days = Number(arg('days', '60'));
const budget = Number(arg('budget', '60'));
const monthlyCap = Number(arg('monthly-cap', '900'));
const maxCapacity = Number(arg('max-capacity', '1500'));
const wanted = arg('metros', METROS.map((m) => m.id).join(',')).split(',').map((x) => x.trim());
const metros = METROS.filter((m) => wanted.includes(m.id));
if (metros.length === 0) fail(`--metros matched nothing (known: ${METROS.map((m) => m.id).join(', ')})`, 2);
const dump = process.argv.includes('--dump-sample') ? arg('dump-sample', 'listings/raw-sample.json') : null;

const bases = process.env.JAMBASE_BASE_URL
  ? [process.env.JAMBASE_BASE_URL]
  : ['https://api.data.jambase.com/v3', 'https://data.jambase.com/v3'];
let base = bases[0];
/** What each address answered on the first page, for the error message. */
const tried: string[] = [];

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

const now = new Date();
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

async function get(metro: Metro, page: number, since?: string) {
  const q = new URLSearchParams({
    eventType: 'concert',
    geoLatitude: String(metro.lat),
    geoLongitude: String(metro.lng),
    geoRadiusAmount: String(metro.radiusMi),
    geoRadiusUnits: 'mi',
    eventDateFrom: dayIn(now, metro.tz),
    eventDateTo: dayIn(new Date(now.getTime() + days * 86400_000), metro.tz),
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
    if (page === 1 && [401, 403, 404].includes(res.status)) {
      const snippet = (await res.clone().text()).slice(0, 160).replace(/\s+/g, ' ');
      tried.push(`${base} -> ${res.status} ${snippet}`);
      if (bases.indexOf(base) < bases.length - 1) {
        base = bases[bases.indexOf(base) + 1];
        continue;
      }
    }
    if (res.status === 401 || res.status === 403) {
      const body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`JamBase refused the key (HTTP ${res.status}). Tried: ${tried.join('; ')}. Response: ${body}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`JamBase returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      const text = (await res.text()).slice(0, 120).replace(/\s+/g, ' ');
      throw new Error(`${base} answered ${res.status} with ${type || 'no content type'} instead of JSON: ${text}. Earlier answers: ${tried.join('; ') || 'none'}`);
    }
    const body = (await res.json()) as { events?: unknown[]; pagination?: { totalPages?: number } };
    if (dump && page === 1) {
      const file = dump.replace(/\.json$/, `.${metro.id}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ base, query: q.toString(), body: { ...body, events: (body.events ?? []).slice(0, 5) } }, null, 2));
    }
    return { events: body.events ?? [], totalPages: body.pagination?.totalPages ?? 1 };
  }
}

function warn(message: string) {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning title=Listings::${message.replace(/\r?\n/g, ' ')}` : `Warning: ${message}`);
}

async function main() {
  console.log(`Key: ${key!.slice(0, 9)}... (${key!.length} characters)`);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Key shape::starts ${key!.slice(0, 9)}, ${key!.length} characters, raw secret ${process.env.JAMBASE_API_KEY!.length} characters`);

  const month = now.toISOString().slice(0, 7);
  let spent = previous?.feed.usage?.month === month ? previous.feed.usage.calls : 0;
  console.log(`Calls already used this month: ${spent} (cap ${monthlyCap})`);

  const manualRaw = readJson(manualPath);
  const manual = Array.isArray(manualRaw) ? manualRaw : [];
  const before = previous?.feed.shows ?? [];
  const results: Show[] = [];
  const failures: string[] = [];
  let succeeded = 0;
  let total = 0;

  for (const metro of metros) {
    const mine = before.filter((s) => s.venue.metro === metro.id && s.source.provider !== 'manual');
    // A city that has never been fetched needs a full read, whatever mode was asked for.
    const mode: 'full' | 'incremental' = requested === 'full' || mine.length === 0 || !previous?.feed.generatedAt ? 'full' : 'incremental';
    const since = mode === 'incremental' ? previous!.feed.generatedAt.replace(/\.\d+Z$/, '').replace(/Z$/, '') : undefined;
    const allowed = Math.min(budget, monthlyCap - spent);
    if (allowed <= 0) {
      warn(`${metro.name}: monthly call cap reached (${spent}/${monthlyCap}); keeping the previous listings.`);
      results.push(...mine);
      continue;
    }
    console.log(`\n${metro.name}: ${mode}; ${dayIn(now, metro.tz)} + ${days} days; ${metro.radiusMi} mi around ${metro.lat},${metro.lng}${since ? `; changed since ${since} UTC` : ''}`);
    try {
      const got = await collect((p) => get(metro, p, since), allowed);
      spent += got.calls;
      const { feed, report } = buildFeed(got.events, { mode, now, maxCapacity, manual, previous: mine, metro: metro.id });
      console.log(`  API calls: ${got.calls} (allowed ${allowed}); pages ${got.calls}/${got.totalPages}${got.truncated ? ' TRUNCATED' : ''}`);
      console.log(`  Seen ${report.seen}, mapped ${report.mapped}, manual ${report.manual}, now ${report.total} (was ${report.previousTotal})`);
      console.log('  Skipped:', Object.keys(report.skipped).length ? report.skipped : 'none');
      // A full read that ran out of calls still holds the nearest dates; that is worth keeping for a new city
      // but not for one that already had a complete listing.
      const problem = sanityProblem(report, mode, got.truncated && mine.length > 0);
      if (problem) throw new Error(`${problem} (seen ${report.seen}, mapped ${report.mapped}, skipped ${JSON.stringify(report.skipped)})`);
      if (got.truncated) warn(`${metro.name}: the call limit ended the read at page ${got.calls} of ${got.totalPages}; later dates are missing. Lower --days or raise --budget.`);
      results.push(...feed.shows);
      total += feed.shows.length;
      succeeded++;
    } catch (e) {
      const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
      const msg = `${metro.name}: ${e instanceof Error ? e.message : String(e)}${cause}`;
      failures.push(msg);
      warn(`${msg}. Keeping the previous listings for this city.`);
      results.push(...mine);
    }
  }

  // Cities that were not asked for this run stay as they were.
  const asked = new Set(metros.map((m) => m.id as string));
  for (const s of before) if (!asked.has(s.venue.metro) && s.source.provider !== 'manual' && stillRelevant(s, now)) results.push(s);

  if (succeeded === 0 && failures.length === 0) {
    console.log('Nothing fetched (monthly call cap reached); the published feed is unchanged.');
    return;
  }
  if (succeeded === 0) fail(`No city could be refreshed. ${failures.join(' | ')} [base ${base}]`);

  const feed: Feed = {
    version: 1,
    generatedAt: now.toISOString(),
    attribution: ATTRIBUTION,
    shows: sortByStart(dedupeShows(results)),
    usage: { month, calls: spent },
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(`${out}.tmp`, JSON.stringify(feed));
  fs.renameSync(`${out}.tmp`, out);
  const per = Object.fromEntries(METROS.map((m) => [m.id, feed.shows.filter((s) => s.venue.metro === m.id).length]));
  console.log(`\nWrote ${out}: ${feed.shows.length} shows ${JSON.stringify(per)}; ${spent} calls used this month; ${succeeded}/${metros.length} cities refreshed (${total} fresh)`);
}

main().catch((e) => {
  const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
  fail(`${e instanceof Error ? e.message : String(e)}${cause} [base ${base}]`);
});
