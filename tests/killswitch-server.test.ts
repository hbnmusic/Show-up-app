import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { extractAi, handleFlyerExtract, planAction, runRetry } from '../supabase/functions/_shared/jobs.ts';
import { DEFAULT_FLAGS, fetchFlagsHttp, flagsStale, FLAG_REFRESH_MS, isOn, parseFlags, readFlags } from '../supabase/functions/_shared/flags.ts';
import type { LlmProvider } from '../supabase/functions/_shared/provider.ts';
import type { Sql } from '../supabase/functions/_shared/supabaseStore.ts';
import { rebuildFeed, jambaseOn, DEFAULT_LICENSED } from '../src/lib/licensed';
import { readApiFlags, runVenueScan } from '../scripts/lib/scanRun';
import type { Api } from '../scripts/lib/scan';
import type { PoliteFetcher } from '../scripts/lib/polite';
import { BROOKLYN, NOW, vev, vresp } from './fixtures/flyers.ts';
import { freshDb } from './fixtures/pg.ts';

let db: PGlite;
let sql: Sql;
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

class Replay implements LlmProvider {
  readonly name = 'replay';
  calls = 0;
  constructor(private script: unknown[]) {}
  async extract() {
    this.calls++;
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    return { json: next, usage: { inputTokens: 1000, outputTokens: 200 } };
  }
}
const setFlag = (key: string, enabled: boolean, message: string | null = null) => sql`update public.app_flags set enabled = ${enabled}, message = ${message} where key = ${key}`;
const deps = (provider: LlmProvider | null) => ({ sql, provider, now: NOW });

before(async () => {
  ({ db, sql } = await freshDb());
  for (let i = 1; i <= 4; i++) await sql`insert into auth.users (id, email) values (${U(i)}::uuid, ${`u${i}@t.test`})`;
  for (let i = 1; i <= 4; i++) await sql`insert into public.terms_acceptances (user_id, version) values (${U(i)}::uuid, '2026-10-09')`;
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate fp.flyer_jobs, fp.shows, fp.venues, fp.ai_usage, fp.venue_runs restart identity cascade; update public.app_flags set enabled = true, message = null;`);
});

describe('flag table and get_flags()', () => {
  it('has seven flags, all ON by default, and get_flags returns only the flags', async () => {
    const r = await sql`select public.get_flags() as f`;
    const rows = r[0].f as { key: string; enabled: boolean; message: string | null }[];
    assert.deepEqual(rows.map((x) => x.key), ['ai_extraction_enabled', 'deezer_enabled', 'flyer_intake_enabled', 'going_counts_enabled', 'jambase_enabled', 'notifications_enabled', 'venue_scan_enabled']);
    assert.ok(rows.every((x) => x.enabled && x.message === null));
    assert.deepEqual(Object.keys(rows[0]).sort(), ['enabled', 'key', 'message']);
  });

  it('turning one off by SQL shows in get_flags and stamps updated_at', async () => {
    const before = (await sql`select updated_at from public.app_flags where key = 'deezer_enabled'`)[0].updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await setFlag('deezer_enabled', false, 'Previews are paused.');
    const flags = parseFlags((await sql`select public.get_flags() as f`)[0].f);
    assert.deepEqual(flags.deezer_enabled, { enabled: false, message: 'Previews are paused.' });
    assert.equal(isOn(flags, 'jambase_enabled'), true);
    const after = (await sql`select updated_at from public.app_flags where key = 'deezer_enabled'`)[0].updated_at;
    assert.ok(new Date(after).getTime() > new Date(before).getTime());
  });

  it('rejects unknown flag names and long messages', async () => {
    await assert.rejects(() => sql`insert into public.app_flags (key) values ('something_else')`);
    await assert.rejects(() => setFlag('deezer_enabled', false, 'x'.repeat(201)));
  });
});

describe('reading flags', () => {
  it('treats anything missing or malformed as ON and ignores unknown keys', () => {
    assert.deepEqual(parseFlags(null), DEFAULT_FLAGS);
    assert.deepEqual(parseFlags('nonsense'), DEFAULT_FLAGS);
    assert.deepEqual(parseFlags([{ key: 'nope', enabled: false }, { key: 'deezer_enabled' }, { key: 'jambase_enabled', enabled: 'no' }]), DEFAULT_FLAGS);
    assert.equal(parseFlags([{ key: 'jambase_enabled', enabled: false }]).jambase_enabled.enabled, false);
    assert.equal(parseFlags({ ai_extraction_enabled: false }).ai_extraction_enabled.enabled, false);
  });

  it('readFlags returns defaults when the table cannot be read', async () => {
    const broken: Sql = async () => { throw new Error('down'); };
    assert.deepEqual(await readFlags(broken), DEFAULT_FLAGS);
  });

  it('refreshes after 15 minutes, never sooner', () => {
    assert.equal(flagsStale(null, 1000), true);
    assert.equal(flagsStale(1000, 1000 + FLAG_REFRESH_MS - 1), false);
    assert.equal(flagsStale(1000, 1000 + FLAG_REFRESH_MS), true);
    assert.equal(flagsStale(5000, 1000), true); // a clock that went backwards
  });

  it('fetchFlagsHttp uses the public RPC with the anon key, and returns null on any failure', async () => {
    const seen: { url: string; key: string | null }[] = [];
    const ok = async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), key: new Headers(init?.headers).get('apikey') });
      return new Response(JSON.stringify([{ key: 'jambase_enabled', enabled: false, message: null }]), { status: 200 });
    };
    const f = await fetchFlagsHttp('https://p.supabase.co/', 'anon-key', ok as typeof fetch);
    assert.equal(f?.jambase_enabled.enabled, false);
    assert.deepEqual(seen, [{ url: 'https://p.supabase.co/rest/v1/rpc/get_flags', key: 'anon-key' }]);
    assert.equal(await fetchFlagsHttp('https://p.supabase.co', 'k', (async () => new Response('x', { status: 500 })) as typeof fetch), null);
    assert.equal(await fetchFlagsHttp('https://p.supabase.co', 'k', (async () => { throw new Error('offline'); }) as typeof fetch), null);
    assert.equal(await fetchFlagsHttp(undefined, undefined), null);
  });
});

describe('ai_extraction_enabled', () => {
  it('OFF: flyer-extract returns a paused status, queues the flyer, and makes no Gemini request', async () => {
    await setFlag('ai_extraction_enabled', false);
    const p = new Replay([BROOKLYN.model]);
    const r = await handleFlyerExtract({ id: U(1), anonymous: false }, { text: BROOKLYN.ocr, metro: 'nyc' }, deps(p));
    assert.deepEqual([r.status, r.body.status, r.body.reason], [200, 'paused', 'ai_paused']);
    assert.equal(p.calls, 0);
    const job = (await sql`select status, attempts from fp.flyer_jobs`)[0];
    assert.deepEqual(job, { status: 'queued', attempts: 0 });
  });

  it('OFF: the retry worker leaves queued flyers alone; ON again: they are read', async () => {
    await setFlag('ai_extraction_enabled', false);
    const p = new Replay([BROOKLYN.model]);
    await handleFlyerExtract({ id: U(1), anonymous: false }, { text: BROOKLYN.ocr, metro: 'nyc' }, deps(p));
    const off = await runRetry(deps(p));
    assert.deepEqual([off.body.processed, off.body.note, p.calls], [0, 'ai_paused', 0]);
    assert.equal((await sql`select status from fp.flyer_jobs`)[0].status, 'queued');
    await setFlag('ai_extraction_enabled', true);
    const on = await runRetry(deps(p));
    assert.equal(on.body.processed, 1);
    assert.equal(p.calls, 1);
    assert.equal((await sql`select status from fp.flyer_jobs`)[0].status, 'done');
  });

  it('OFF: venue pages are not sent to the model and nothing is recorded, so the page is read again later', async () => {
    const v = (await sql`insert into fp.venues (canonical_name, metro, address, website, status, seeded_from, tier) values ('Parkside Hall', 'nyc', '1 Ave', 'https://parksidehall.example', 'approved', 'own_site', 'A') returning id::text as id`)[0].id as string;
    const model = vresp([vev({ headliner: 'Velvet Automaton', date: 'Fri Oct 16', start: '8pm', evidence: 'Fri Oct 16 Velvet Automaton 8pm' })]);
    const p = new Replay([model]);
    await setFlag('ai_extraction_enabled', false);
    const off = await extractAi(deps(p), { venueId: v, url: 'https://parksidehall.example/events', text: 'Fri Oct 16 Velvet Automaton 8pm', run: { fetchOk: true, contentHash: 'abc' } });
    assert.equal(off.body.status, 'paused');
    assert.equal(p.calls, 0);
    assert.equal((await sql`select count(*)::int as n from fp.venue_runs`)[0].n, 0);
    assert.equal((await sql`select content_hash from fp.venues`)[0].content_hash, null);
    await setFlag('ai_extraction_enabled', true);
    const on = await extractAi(deps(p), { venueId: v, url: 'https://parksidehall.example/events', text: 'Fri Oct 16 Velvet Automaton 8pm', run: { fetchOk: true, contentHash: 'abc' } });
    assert.equal(on.body.status, 'ok');
    assert.equal(p.calls, 1);
  });

  it('OFF: venue_scan keeps working (not switched), and other tiers are unaffected by the AI switch', async () => {
    await setFlag('ai_extraction_enabled', false);
    const plan = await planAction(deps(null));
    assert.equal(plan.body.paused, undefined);
  });
});

describe('flyer_intake_enabled', () => {
  it('OFF: the server stores nothing and says paused (for older app versions)', async () => {
    await setFlag('flyer_intake_enabled', false);
    const p = new Replay([BROOKLYN.model]);
    const r = await handleFlyerExtract({ id: U(2), anonymous: false }, { text: BROOKLYN.ocr, metro: 'nyc' }, deps(p));
    assert.deepEqual([r.body.status, r.body.reason, r.body.jobId], ['paused', 'intake_paused', null]);
    assert.equal(p.calls, 0);
    assert.equal((await sql`select count(*)::int as n from fp.flyer_jobs`)[0].n, 0);
  });

  it('ON: works as before', async () => {
    const r = await handleFlyerExtract({ id: U(2), anonymous: false }, { text: BROOKLYN.ocr, metro: 'nyc' }, deps(new Replay([BROOKLYN.model])));
    assert.equal(r.body.result, 'pending');
  });
});

describe('venue_scan_enabled', () => {
  it('OFF: the plan is empty and flagged paused', async () => {
    await setFlag('venue_scan_enabled', false);
    const r = await planAction(deps(null));
    assert.deepEqual([r.body.paused, r.body.scan, r.body.trial], ['venue_scan', [], []]);
  });
});

/** A fake fp-job API for the scanner. */
function fakeApi(opts: { flags: () => unknown[]; plan?: Record<string, unknown> }) {
  const calls: string[] = [];
  const api: Api = async (action) => {
    calls.push(action);
    if (action === 'flags') return { flags: opts.flags() };
    if (action === 'plan') return opts.plan ?? { scan: [], trial: [] };
    if (action === 'maintenance') return { reasons: ['ok'] };
    return {};
  };
  return { api, calls };
}
const run = (api: Api, over: Partial<Parameters<typeof runVenueScan>[0]> = {}) =>
  runVenueScan({ api, fetcher: {} as PoliteFetcher, geocode: async () => true, maxVenues: 10, maxTrials: 10, deadline: Date.now() + 60_000, ...over });

describe('the scheduled venue scan', () => {
  it('OFF: exits cleanly after reading the flags, without planning, scanning or running maintenance', async () => {
    const { api, calls } = fakeApi({ flags: () => [{ key: 'venue_scan_enabled', enabled: false }] });
    const r = await run(api);
    assert.equal(r.skipped, 'venue_scan_off');
    assert.deepEqual(calls, ['flags']);
  });

  it('ON: plans, then runs maintenance', async () => {
    const { api, calls } = fakeApi({ flags: () => [] });
    const r = await run(api);
    assert.equal(r.skipped, undefined);
    assert.deepEqual(calls, ['flags', 'plan', 'maintenance']);
  });

  it('a plan that comes back paused also ends the run cleanly', async () => {
    const { api, calls } = fakeApi({ flags: () => [], plan: { paused: 'venue_scan', scan: [], trial: [] } });
    assert.equal((await run(api)).skipped, 'venue_scan_off');
    assert.ok(!calls.includes('maintenance'));
  });

  it('is switched off between batches: stops before the next venue and skips maintenance', async () => {
    let off = false;
    const venues = Array.from({ length: 6 }, (_, i) => ({ id: `v${i}`, metro: 'nyc', name: `V${i}`, website: null, eventsUrl: null }));
    const { api, calls } = fakeApi({ flags: () => (off ? [{ key: 'venue_scan_enabled', enabled: false }] : []), plan: { scan: venues, trial: [] } });
    const wrapped: Api = async (a, b) => {
      if (a === 'record_run') off = true; // the owner flips the switch while venues are being read
      return api(a, b);
    };
    const r = await run(wrapped, { flagEvery: 2 });
    assert.equal(r.stoppedByFlag, true);
    assert.ok(!calls.includes('maintenance'));
    assert.ok(calls.filter((c) => c === 'record_run').length < 6);
  });

  it('readApiFlags keeps the defaults when the call fails', async () => {
    const f = await readApiFlags((async () => { throw new Error('down'); }) as Api);
    assert.deepEqual(f, DEFAULT_FLAGS);
  });
});

describe('jambase_enabled in the feeds', () => {
  const show = (id: string, provider: 'jambase' | 'community') => ({ id, source: { provider, url: '', fetchedAt: '' } }) as never;
  const feed = { version: 1, generatedAt: '', attribution: ['Listings by JamBase (jambase.com)', 'Other credit'], shows: [show('a', 'jambase'), show('b', 'community')] };

  it('ON: nothing changes', () => {
    assert.equal(rebuildFeed(feed, true).feed, feed);
  });

  it('OFF: the feed keeps only first-party and community shows, and the JamBase credit goes', () => {
    const r = rebuildFeed(feed, false);
    assert.deepEqual(r.feed.shows.map((s: { id: string }) => s.id), ['b']);
    assert.deepEqual(r.feed.attribution, ['Other credit']);
    assert.equal(r.removed, 1);
  });

  it('either the licensed switch or the flag turns it off', () => {
    assert.equal(jambaseOn(DEFAULT_LICENSED, parseFlags(null)), true);
    assert.equal(jambaseOn(DEFAULT_LICENSED, parseFlags([{ key: 'jambase_enabled', enabled: false }])), false);
    assert.equal(jambaseOn({ jambase_listings: false }, parseFlags(null)), false);
  });
});

/** Runs scripts/fetch-listings.ts against local stand-in servers: one for Supabase flags, one for JamBase. Counts the calls JamBase receives. */
async function runFetchListings(flagRows: unknown[]) {
  let jambaseHits = 0;
  const jb = createServer((_req, res) => { jambaseHits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ events: [], pagination: { totalPages: 1 } })); });
  const sb = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(flagRows)); });
  jb.listen(0); sb.listen(0);
  await Promise.all([once(jb, 'listening'), once(sb, 'listening')]);
  const dir = mkdtempSync(join(tmpdir(), 'listings-'));
  writeFileSync(join(dir, 'state.json'), '{}');
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/fetch-listings.ts', '--dir', dir, '--metros', 'nyc', '--manual', join(dir, 'none.json')], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, JAMBASE_API_KEY: 'test-key', JAMBASE_BASE_URL: `http://127.0.0.1:${(jb.address() as AddressInfo).port}`, SUPABASE_URL: `http://127.0.0.1:${(sb.address() as AddressInfo).port}`, SUPABASE_ANON_KEY: 'anon' },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  await once(child, 'exit');
  jb.close(); sb.close();
  return { jambaseHits, out, dir };
}

describe('the refresh job (scripts/fetch-listings.ts)', () => {
  it('OFF: makes zero JamBase calls', async () => {
    const r = await runFetchListings([{ key: 'jambase_enabled', enabled: false, message: null }]);
    assert.equal(r.jambaseHits, 0);
    assert.match(r.out, /switched off \(jambase_enabled\)/);
  });

  it('ON: calls JamBase', async () => {
    const r = await runFetchListings([]);
    assert.ok(r.jambaseHits > 0, r.out);
    assert.equal(JSON.parse(readFileSync(join(r.dir, 'state.json'), 'utf8')).calls > 0, true);
  });
});
