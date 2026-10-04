/**
 * Fetch upcoming shows for the cities in src/lib/metros.ts from JamBase and
 * write one feed file per city, which is what the app downloads.
 *
 *   JAMBASE_API_KEY=... npx tsx scripts/fetch-listings.ts
 *
 * The free plan allows 1,000 calls a month, so each run refreshes only the
 * cities that are due, most overdue first: large markets every two days, the rest every
 * few days. A city is read in full when it is new and then every few weeks (to
 * extend the date window); in between it only asks for shows changed since its
 * last sync. A running monthly call count in state.json stops the job at the cap.
 *
 * Options (all optional):
 *   --dir listings            where shows-<city>.json and state.json live
 *   --mode auto|full|incremental   full re-reads every selected city (still limited by the budgets)
 *   --manual listings/manual.json  hand-kept listings merged into their city
 *   --days 60                 how far ahead to look (free plan allows about 6 months)
 *   --metros nyc,la           only these cities (default: all)
 *   --max-capacity N          skip venues listed as bigger than this (default: keep all)
 *   --budget 60               most API calls one city may use in a run
 *   --run-budget 150          most API calls the whole run may use
 *   --monthly-cap 900         stop once this many calls are spent this month
 *   --hot-hours 48 --cold-hours 168 --full-every-days 42   refresh pacing
 *   --dump-sample listings/raw-sample.json   save the first raw page for inspection
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { ATTRIBUTION, buildFeed, collect, sanityProblem } from '../src/lib/listings/pipeline';
import { fetchFlagsHttp, isOn, parseFlags } from '../src/lib/flagsCore';
import { parseFeed, type Feed } from '../src/lib/listings/validate';
import { METROS, type Metro } from '../src/lib/metros';

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

const dir = arg('dir', 'listings');
const manualPath = arg('manual', 'listings/manual.json');
const days = Number(arg('days', '60'));
const budget = Number(arg('budget', '60'));
const runBudget = Number(arg('run-budget', '150'));
const monthlyCap = Number(arg('monthly-cap', '900'));
const hotHours = Number(arg('hot-hours', '48'));
const coldHours = Number(arg('cold-hours', '168'));
const fullEveryDays = Number(arg('full-every-days', '42'));
const maxCapacity = process.argv.includes('--max-capacity') ? Number(arg('max-capacity', '0')) : undefined;
const requested = arg('mode', 'auto');
if (!['auto', 'full', 'incremental'].includes(requested)) {
  console.error('--mode must be auto, full or incremental');
  process.exit(2);
}
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

const now = new Date();
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

async function get(metro: Metro, page: number, since?: string, dumpThis = false) {
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
    if (dump && dumpThis && page === 1) {
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

type MetroState = { fullAt?: string; syncedAt?: string; calls?: number; empty?: boolean };
type State = { month: string; calls: number; metros: Record<string, MetroState> };

const HOUR = 3600_000;
const ageHours = (iso: string | undefined) => (iso ? (now.getTime() - Date.parse(iso)) / HOUR : Infinity);
const feedFile = (id: string) => path.join(dir, `shows-${id}.json`);
const writeAtomic = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
};

/** First run after the single-file feed: split it by city so those cities have listings until their full read. */
function seedFromLegacy(state: State) {
  const legacy = parseFeed(readJson(path.join(dir, 'shows.json')));
  if (!legacy) return;
  const by = new Map<string, Feed['shows']>();
  for (const sh of legacy.feed.shows) by.set(sh.venue.metro, [...(by.get(sh.venue.metro) ?? []), sh]);
  for (const [id, shows] of by) {
    if (!METROS.some((m) => m.id === id)) continue;
    writeAtomic(feedFile(id), { version: 1, generatedAt: legacy.feed.generatedAt, attribution: legacy.feed.attribution, shows });
    // No fullAt: those feeds were filtered to small venues, so each city gets a fresh full read.
    state.metros[id] = { syncedAt: legacy.feed.generatedAt };
  }
  if (legacy.feed.usage?.month === state.month) state.calls = legacy.feed.usage.calls;
  console.log(`Seeded ${by.size} cities from the earlier single-file feed.`);
}

/**
 * The jambase_enabled kill switch. Read live (public RPC, anon key) at the start and again before each city, so a switch
 * takes effect within a run; falls back to the flags file the workflow saved, and to ON if neither can be read.
 */
async function jambaseAllowed(): Promise<boolean> {
  const live = await fetchFlagsHttp(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  if (live) return isOn(live, 'jambase_enabled');
  const saved = readJson(path.join(dir, 'flags.json'));
  return saved ? isOn(parseFlags(saved), 'jambase_enabled') : true;
}

async function main() {
  if (!(await jambaseAllowed())) {
    console.log('JamBase is switched off (jambase_enabled). No JamBase calls were made.');
    return;
  }
  console.log(`Key: ${key!.slice(0, 9)}... (${key!.length} characters)`);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Key shape::starts ${key!.slice(0, 9)}, ${key!.length} characters, raw secret ${process.env.JAMBASE_API_KEY!.length} characters`);

  const month = now.toISOString().slice(0, 7);
  const saved = readJson(path.join(dir, 'state.json')) as Partial<State> | null;
  const state: State = {
    month,
    calls: saved?.month === month && typeof saved.calls === 'number' ? saved.calls : 0,
    metros: saved?.metros && typeof saved.metros === 'object' ? { ...saved.metros } : {},
  };
  if (!saved) seedFromLegacy(state);
  console.log(`Calls already used this month: ${state.calls} (cap ${monthlyCap}), cities tracked: ${Object.keys(state.metros).length}`);

  type Job = { metro: Metro; mode: 'full' | 'incremental'; urgency: number };
  const jobs: Job[] = [];
  for (const metro of metros) {
    const st = state.metros[metro.id] ?? {};
    const never = !st.fullAt;
    const needFull = never || requested === 'full' || (requested !== 'incremental' && ageHours(st.fullAt) >= fullEveryDays * 24);
    const minAge = st.empty ? 168 : metro.hot ? hotHours : coldHours;
    const age = ageHours(st.syncedAt);
    if (!never && requested !== 'full' && age < minAge) continue;
    jobs.push({ metro, mode: needFull ? 'full' : 'incremental', urgency: never ? 1e9 - METROS.indexOf(metro) : age / minAge });
  }
  jobs.sort((x, y) => y.urgency - x.urgency);
  console.log(`${jobs.length} of ${metros.length} cities are due: ${jobs.map((j) => `${j.metro.id}(${j.mode[0]})`).join(' ') || 'none'}`);

  const manualRaw = readJson(manualPath);
  const manual = Array.isArray(manualRaw) ? manualRaw : [];
  let runCalls = 0;
  let ok = 0;
  const failures: string[] = [];
  let dumped = false;

  for (const { metro, mode } of jobs) {
    if (!(await jambaseAllowed())) {
      console.log('JamBase was switched off during the run; stopping before the next city.');
      break;
    }
    const allowed = Math.min(budget, runBudget - runCalls, monthlyCap - state.calls);
    if (allowed <= 0) {
      console.log(`Stopping: ${runCalls >= runBudget ? 'run budget' : 'monthly cap'} reached with cities still due.`);
      break;
    }
    const prev = parseFeed(readJson(feedFile(metro.id)));
    const mine = prev?.feed.shows.filter((s) => s.source.provider !== 'manual') ?? [];
    const st = state.metros[metro.id] ?? {};
    const since = mode === 'incremental' && st.syncedAt ? st.syncedAt.replace(/\.\d+Z$/, '').replace(/Z$/, '') : undefined;
    console.log(`\n${metro.name}: ${mode}; ${dayIn(now, metro.tz)} + ${days} days${since ? `; changed since ${since} UTC` : ''}`);
    try {
      const got = await collect((p) => get(metro, p, since, !dumped && (dumped = true)), allowed);
      state.calls += got.calls;
      runCalls += got.calls;
      const { feed, report } = buildFeed(got.events, { mode, now, maxCapacity, manual, previous: mine, metro: metro.id });
      console.log(`  calls ${got.calls}/${allowed}; pages ${got.calls}/${got.totalPages}${got.truncated ? ' TRUNCATED' : ''}; seen ${report.seen}, mapped ${report.mapped}, now ${report.total} (was ${report.previousTotal})`);
      const noCoverage = mode === 'full' && report.seen === 0 && mine.length === 0;
      const problem = noCoverage ? null : sanityProblem(report, mode, got.truncated && mine.length > 0);
      if (problem) throw new Error(`${problem} (skipped ${JSON.stringify(report.skipped)})`);
      if (got.truncated) warn(`${metro.name}: the call limit ended the read at page ${got.calls} of ${got.totalPages}; later dates are missing.`);
      if (noCoverage) warn(`${metro.name}: JamBase returned no events here; it will be checked again in a week.`);
      writeAtomic(feedFile(metro.id), feed);
      state.metros[metro.id] = {
        fullAt: mode === 'full' ? now.toISOString() : st.fullAt,
        syncedAt: now.toISOString(),
        calls: got.calls,
        empty: noCoverage || undefined,
      };
      ok++;
    } catch (e) {
      const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
      const msg = `${metro.name}: ${e instanceof Error ? e.message : String(e)}${cause}`;
      failures.push(msg);
      warn(`${msg}. Keeping the previous listings for this city.`);
      // An auth failure will repeat for every city; stop spending calls on it.
      if (/refused the key/.test(msg)) break;
    }
  }

  writeAtomic(path.join(dir, 'state.json'), state);
  console.log(`\nRefreshed ${ok} of ${jobs.length} due cities with ${runCalls} calls; ${state.calls}/${monthlyCap} used this month.`);
  if (jobs.length > 0 && ok === 0 && failures.length > 0) fail(`No city could be refreshed. ${failures.join(' | ')} [base ${base}]`);
}

main().catch((e) => {
  const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
  fail(`${e instanceof Error ? e.message : String(e)}${cause} [base ${base}]`);
});
