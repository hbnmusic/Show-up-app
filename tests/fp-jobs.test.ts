import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { approveVenue, coverage, extractAi, handleFlyerExtract, ingestEvents, licensedLink, maintenance, markFullScans, planAction, recordRun, runRetry, setWaves, upsertVenues } from '../supabase/functions/_shared/jobs.ts';
import { QuotaError, type LlmProvider } from '../supabase/functions/_shared/provider.ts';
import type { Sql } from '../supabase/functions/_shared/supabaseStore.ts';
import { BROOKLYN, NOW, resp, ev, f, vev, vresp } from './fixtures/flyers.ts';
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
    if (next instanceof Error) throw next;
    return { json: next, usage: { inputTokens: 1000, outputTokens: 200 } };
  }
}

before(async () => {
  ({ db, sql } = await freshDb());
  for (let i = 1; i <= 9; i++) await sql`insert into auth.users (id, email) values (${U(i)}::uuid, ${`u${i}@t.test`})`;
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate fp.flyer_jobs, fp.shows, fp.venues, fp.ai_usage, fp.venue_runs, fp.widening_log, fp.licensed_links restart identity cascade; delete from public.terms_acceptances; delete from public.banned_users;`);
  await db.exec(`update fp.metro_config set last_full_scan_at = null`);
});
const accept = (n: number) => sql`insert into public.terms_acceptances (user_id, version) values (${U(n)}::uuid, '2026-10-04')`;
const deps = (provider: LlmProvider | null, now = NOW) => ({ sql, provider, now });
const newVenue = async (name = 'Parkside Hall', metro = 'nyc', status = 'approved') =>
  (await sql`insert into fp.venues (canonical_name, metro, address, website, status, seeded_from, tier) values (${name}, ${metro}, '100 Example Ave', 'https://parksidehall.example', ${status}, 'own_site', 'A') returning id::text as id`)[0].id as string;

describe('flyer-extract', () => {
  it('needs the Terms accepted first, then runs the job and stores only redacted text', async () => {
    const p = new Replay([BROOKLYN.model]);
    const body = { text: `${BROOKLYN.ocr}\nbook: me@example.com (212) 555-0147`, metro: 'nyc', origin: 'image' };
    assert.deepEqual((await handleFlyerExtract({ id: U(1), anonymous: false }, body, deps(p))).body.error, 'terms');
    await accept(1);
    const r = await handleFlyerExtract({ id: U(1), anonymous: false }, body, deps(p));
    assert.equal(r.status, 200);
    assert.equal(r.body.result, 'pending');
    const job = (await sql`select ocr_text, status, result, anonymous, origin, attempts from fp.flyer_jobs`)[0];
    assert.ok(!/me@example|555-0147/.test(job.ocr_text));
    assert.deepEqual([job.status, job.result, job.anonymous, job.origin, job.attempts], ['done', 'pending', false, 'image', 1]);
  });

  it('gives anonymous installs a lower daily limit than signed-in people', async () => {
    await accept(2); await accept(3);
    const p = new Replay([BROOKLYN.model]);
    const body = { text: BROOKLYN.ocr, metro: 'nyc' };
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await handleFlyerExtract({ id: U(2), anonymous: true }, body, deps(p))).status);
    assert.deepEqual(codes, [200, 200, 200, 429]);
    const signed: number[] = [];
    for (let i = 0; i < 11; i++) signed.push((await handleFlyerExtract({ id: U(3), anonymous: false }, body, deps(p))).status);
    assert.equal(signed.filter((c) => c === 200).length, 10);
    assert.equal(signed[10], 429);
  });

  it('refuses banned people, bad text, and says "not configured" when no key is set (the job waits)', async () => {
    await accept(4); await accept(5);
    await sql`insert into public.banned_users (user_id) values (${U(4)}::uuid)`;
    assert.equal((await handleFlyerExtract({ id: U(4), anonymous: false }, { text: BROOKLYN.ocr }, deps(new Replay([BROOKLYN.model])))).body.error, 'banned');
    assert.equal((await handleFlyerExtract({ id: U(5), anonymous: false }, { text: 'hi' }, deps(new Replay([]))) ).body.error, 'bad_text');
    const r = await handleFlyerExtract({ id: U(5), anonymous: false }, { text: BROOKLYN.ocr, metro: 'nyc' }, deps(null));
    assert.equal(r.body.reason, 'not_configured');
    assert.equal((await sql`select status from fp.flyer_jobs where submitter = ${U(5)}::uuid`)[0].status, 'retry');
  });

  it('a 429 queues the job as "processing"; the retry worker finishes it later and the person can see the result', async () => {
    await accept(6);
    const p = new Replay([new QuotaError(), BROOKLYN.model]);
    const r = await handleFlyerExtract({ id: U(6), anonymous: false }, { text: BROOKLYN.ocr, metro: 'nyc' }, deps(p));
    assert.deepEqual([r.body.status, r.body.result], ['retry', 'processing']);
    // Nothing is due yet.
    await sql`update fp.flyer_jobs set next_attempt_at = now() + interval '1 hour'`;
    assert.equal((await runRetry(deps(p))).body.processed, 0);
    await sql`update fp.flyer_jobs set next_attempt_at = now() - interval '1 second'`;
    const run = await runRetry(deps(p));
    assert.equal(run.body.processed, 1);
    const job = (await sql`select status, result, attempts, notified, array_length(show_ids, 1) as n from fp.flyer_jobs`)[0];
    assert.deepEqual([job.status, job.result, job.attempts, job.notified, job.n], ['done', 'pending', 2, false, 1]);
  });

  it('a job stuck in "processing" after a crash goes back to the queue', async () => {
    await accept(7);
    const j = await sql`insert into fp.flyer_jobs (submitter, metro_hint, ocr_text, status, claimed_at, next_attempt_at) values (${U(7)}::uuid, 'nyc', ${BROOKLYN.ocr}, 'processing', now() - interval '20 minutes', now() - interval '20 minutes') returning id::text as id`;
    const run = await runRetry(deps(new Replay([BROOKLYN.model])));
    assert.equal(run.body.processed, 1);
    assert.equal((await sql`select status from fp.flyer_jobs where id = ${j[0].id}::uuid`)[0].status, 'done');
  });

  it('stops retrying for the minute when the quota is the problem, and gives a visible final result after 8 tries', async () => {
    await accept(8);
    const p = new Replay([new QuotaError()]);
    await sql`insert into fp.flyer_jobs (submitter, metro_hint, ocr_text, status, attempts, next_attempt_at) values (${U(8)}::uuid, 'nyc', ${BROOKLYN.ocr}, 'retry', 7, now() - interval '2 minutes'), (${U(8)}::uuid, 'nyc', ${BROOKLYN.ocr}, 'retry', 0, now() - interval '1 minute')`;
    const run = await runRetry(deps(p));
    assert.equal(run.body.processed, 1); // stopped after the first quota hit; the other job waits for the next minute
    const rows = await sql`select status, result, reason, attempts from fp.flyer_jobs order by attempts desc`;
    assert.deepEqual(rows[0], { status: 'failed', result: 'rejected', reason: 'quota_gave_up', attempts: 8 });
  });
});

describe('venue scanning', () => {
  const ld = (name: string, start: string) => ({ name, performers: [name], start });

  it('ingests structured events, ignores past ones without penalty, and clears "unconfirmed" when listed again', async () => {
    const id = await newVenue();
    const r = await ingestEvents(deps(null), { venueId: id, tier: 'jsonld', pageUrl: 'https://parksidehall.example/events', events: [ld('Night Owls', '2026-10-23T20:00:00-04:00'), ld('Day Dreamers', '2026-10-24T20:00:00-04:00'), ld('Old News', '2026-09-01T20:00:00-04:00')], run: { fetchOk: true } });
    assert.deepEqual([r.body.ingested, r.body.rejected], [2, 0]);
    assert.equal((await sql`select count(*)::int as n from fp.shows where visibility = 'public'`)[0].n, 2);
    const again = await ingestEvents(deps(null), { venueId: id, tier: 'jsonld', pageUrl: 'p', events: [ld('Night Owls', '2026-10-23T20:00:00-04:00')], run: { fetchOk: true } });
    assert.equal(again.body.ingested, 1);
    const rows = await sql`select headliner, unconfirmed, status from fp.shows order by headliner`;
    assert.deepEqual(rows, [{ headliner: 'Day Dreamers', unconfirmed: true, status: 'scheduled' }, { headliner: 'Night Owls', unconfirmed: false, status: 'scheduled' }]);
  });

  it('auto-disables after 3 failed fetches in a row, and for robots or bot-wall findings', async () => {
    const id = await newVenue();
    assert.equal(await recordRun(sql, id, { fetchOk: false }), null);
    assert.equal(await recordRun(sql, id, { fetchOk: false }), null);
    assert.equal(await recordRun(sql, id, { fetchOk: false }), 'fetch_errors');
    assert.deepEqual((await sql`select status, status_reasons from fp.venues where id = ${id}::uuid`)[0], { status: 'disabled', status_reasons: ['fetch_errors'] });
    const id2 = await newVenue('Rust Belt Room', 'chi');
    assert.equal(await recordRun(sql, id2, { fetchOk: true, robots: 'bot_wall' }), 'bot_wall');
  });

  it('auto-disables when 40% of what a venue yields keeps failing validation', async () => {
    const id = await newVenue();
    const bad = { fetchOk: true, extracted: 10, rejected: 5 };
    const codes: (string | null)[] = [];
    for (let i = 0; i < 5; i++) codes.push(await recordRun(sql, id, bad));
    assert.deepEqual(codes, [null, null, null, null, 'validator_rejections']);
  });

  it('reads a model-tier page, counts the request and its tokens, and publishes valid events', async () => {
    const id = await newVenue('Parkside Hall', 'nyc');
    const page = 'Fri Oct 16 Velvet Automaton 8pm';
    const model = vresp([vev({ headliner: 'Velvet Automaton', date: 'Fri Oct 16', start: '8pm', evidence: 'Fri Oct 16 Velvet Automaton 8pm' })]);
    const r = await extractAi(deps(new Replay([model])), { venueId: id, url: 'https://parksidehall.example/events', text: page, run: { fetchOk: true, contentHash: 'abc' } });
    assert.deepEqual([r.body.status, r.body.extracted, r.body.ingested], ['ok', 1, 1]);
    const u = await sql`select requests, input_tokens::int as i, output_tokens::int as o from fp.ai_usage where kind = 'venue'`;
    assert.deepEqual(u, [{ requests: 1, i: 1000, o: 200 }]);
    assert.equal((await sql`select content_hash from fp.venues where id = ${id}::uuid`)[0].content_hash, 'abc');
  });

  it('approves, quarantines and rejects candidates with reasons stored', async () => {
    const a = await newVenue('A', 'nyc', 'candidate');
    const b = await newVenue('B', 'nyc', 'candidate');
    const c = await newVenue('C', 'nyc', 'candidate');
    const checks = { website: 'https://a.example', robots: 'ok' as const, nameMatches: true, insideMetro: true as boolean | null, structuredEvents: 0, aiEventsWithEvidence: 2, venueTypeOk: true };
    assert.equal((await approveVenue(sql, a, checks, 'ai')).body.tier, 'B');
    assert.equal((await approveVenue(sql, b, { ...checks, aiEventsWithEvidence: 0 }, 'ai')).body.decision, 'quarantined');
    assert.deepEqual((await approveVenue(sql, c, { ...checks, website: 'https://www.facebook.com/x' }, null)).body.reasons, ['not_own_domain']);
    const rows = await sql`select canonical_name, status, tier, status_reasons from fp.venues order by canonical_name`;
    assert.deepEqual(rows.map((r) => [r.canonical_name, r.status, r.tier]), [['A', 'approved', 'B'], ['B', 'quarantined', 'C'], ['C', 'rejected', null]]);
  });

  it('seeds the registry without duplicates and only into known metros', async () => {
    const v = { name: 'Rust Belt Room', metro: 'chi', seededFrom: 'own_site' as const, website: 'https://rustbelt.example' };
    assert.equal((await upsertVenues(sql, [v, { ...v, name: 'rust belt room' }, { ...v, name: 'Elsewhere', metro: 'zzz' }])).body.added, 1);
    assert.equal((await upsertVenues(sql, [{ name: 'Wiki Hall', metro: 'nyc', seededFrom: 'wikidata', wikidataId: 'Q1' }])).body.added, 1);
    assert.equal((await upsertVenues(sql, [{ name: 'Wiki Hall (renamed)', metro: 'nyc', seededFrom: 'wikidata', wikidataId: 'Q1' }])).body.added, 0);
    await assert.rejects(() => sql`insert into fp.venues (canonical_name, metro, seeded_from) values ('X', 'nyc', 'osm')`);
  });

  it('plans a scan: due venues in enabled metros, model budget per metro, and trials for candidates', async () => {
    await newVenue('Due', 'nyc');
    const off = await newVenue('Off metro', 'atl'); // wave 3, scanning off
    await newVenue('Cand', 'nyc', 'candidate');
    await sql`update fp.venues set last_checked_at = now() where id = ${off}::uuid`;
    const r = await planAction(deps(null));
    assert.deepEqual((r.body.scan as { name: string }[]).map((v) => v.name), ['Due']);
    assert.deepEqual((r.body.trial as { name: string }[]).map((v) => v.name), ['Cand']);
  });
});

describe('waves', () => {
  it('assigns wave 2 by show volume without touching the hot metros', async () => {
    const r = await setWaves(sql, { atl: 500, aus: 400, sea: 300 });
    const w = r.body.waves as Record<string, number>;
    assert.equal(w.nyc, 1);
    assert.equal(w.atl, 2);
    assert.equal(Object.values(w).filter((x) => x === 1).length, 10);
  });

  it('keeps wave 1 only until its venues are fully scanned and 7 quiet days are recorded, and logs every decision', async () => {
    const venue = await newVenue('V', 'nyc');
    await sql`update fp.venues set last_checked_at = now() where id = ${venue}::uuid`;
    await markFullScans(sql);
    const noUsage = await maintenance(deps(null));
    assert.equal(noUsage.body.widen, false);
    for (let d = 1; d <= 7; d++) await sql`insert into fp.ai_usage (day, kind, requests) values (${new Date(NOW.getTime() - d * 86400_000).toISOString().slice(0, 10)}::date, 'venue', 40)`;
    // Other wave-1 metros have no venues, so only metros with approved venues count as scanned: set the rest as scanned too.
    await sql`update fp.metro_config set last_full_scan_at = now() where wave = 1`;
    const widened = await maintenance(deps(null, new Date(NOW.getTime())));
    assert.equal(widened.body.widen, true);
    assert.equal(widened.body.nextWave, 2);
    assert.equal((await sql`select value from fp.ai_config where key = 'current_wave'`)[0].value, 2);
    assert.equal((await sql`select count(*)::int as n from fp.widening_log`)[0].n, 2);
    assert.equal((await sql`select count(*)::int as n from fp.metro_config where wave = 2 and venue_scan_enabled`)[0].n, 0 + (await sql`select count(*)::int as n from fp.metro_config where wave = 2`)[0].n);
  });

  it('does not widen when quota use was above headroom on any recent day', async () => {
    await sql`update fp.metro_config set last_full_scan_at = now() where wave = 1`;
    for (let d = 1; d <= 7; d++) await sql`insert into fp.ai_usage (day, kind, requests) values (${new Date(NOW.getTime() - d * 86400_000).toISOString().slice(0, 10)}::date, 'venue', ${d === 3 ? 160 : 40})`;
    const r = await maintenance(deps(null));
    assert.equal(r.body.widen, false);
    assert.ok((r.body.reasons as string[]).some((x) => x.includes('80%')));
  });
});

describe('licensed links and coverage', () => {
  it('stores ids only and lets a licensed match corroborate a high-confidence pending flyer', async () => {
    const hi = (await sql`insert into fp.shows (key, metro, venue_name, local_date, headliner, visibility, confidence) values ('a', 'nyc', 'V', current_date + 5, 'H', 'pending', 0.95) returning id::text as id`)[0].id;
    const lo = (await sql`insert into fp.shows (key, metro, venue_name, local_date, headliner, visibility, confidence) values ('b', 'nyc', 'V', current_date + 6, 'L', 'pending', 0.5) returning id::text as id`)[0].id;
    await licensedLink(sql, [{ showId: hi, source: 'jambase', externalId: 'jb:123' }, { showId: lo, source: 'ticketmaster', externalId: 'tm:9' }]);
    const rows = await sql`select headliner, visibility, corroborated from fp.shows order by headliner`;
    assert.deepEqual(rows, [{ headliner: 'H', visibility: 'public', corroborated: true }, { headliner: 'L', visibility: 'pending', corroborated: true }]);
    assert.equal((await sql`select count(*)::int as n from fp.licensed_links`)[0].n, 2);
  });

  it('builds the coverage report and the weekly summary', async () => {
    await newVenue('V1', 'nyc');
    await sql`insert into fp.shows (key, metro, venue_name, local_date, headliner, visibility, sources) values ('k', 'nyc', 'V', current_date + 5, 'H', 'public', '[{"sourceType":"venue_site"},{"sourceType":"flyer"}]'::jsonb)`;
    const r = await coverage(deps(null), { weekly: true });
    const nyc = (r.body.coverage as { metro: string; approvedA: number; upcomingShows: number; showsBySource: Record<string, number> }[]).find((c) => c.metro === 'nyc')!;
    assert.deepEqual([nyc.approvedA, nyc.upcomingShows, nyc.showsBySource.venue_site, nyc.showsBySource.flyer], [1, 1, 1, 1]);
    assert.ok((r.body.summary as string).includes('upcoming shows'));
    assert.equal((await sql`select count(*)::int as n from fp.weekly_summaries`)[0].n, 1);
  });
});

describe('JSON parameters', () => {
  it('are always sent as text and cast on the server (the postgres client double-encodes a string typed jsonb)', async () => {
    const fs = await import('node:fs');
    for (const f of ['jobs.ts', 'supabaseStore.ts']) {
      const src = fs.readFileSync(new URL(`../supabase/functions/_shared/${f}`, import.meta.url), 'utf8');
      assert.equal(/\$\{[^}]*\}::jsonb/.test(src.replace(/@> '[^']*'::jsonb/g, '')), false, `${f} has a bare ::jsonb parameter`);
    }
  });
});
