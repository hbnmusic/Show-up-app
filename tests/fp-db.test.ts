import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { ingestCandidate, processFlyerJob } from '../supabase/functions/_shared/pipeline.ts';
import { ProviderError, type LlmProvider } from '../supabase/functions/_shared/provider.ts';
import { quotaDay } from '../supabase/functions/_shared/quota.ts';
import { PgStore, type Sql } from '../supabase/functions/_shared/supabaseStore.ts';
import { BROOKLYN, NOW } from './fixtures/flyers.ts';
import { freshDb } from './fixtures/pg.ts';

let db: PGlite;
let sql: Sql;
let store: PgStore;
let venueId: string;
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

class Replay implements LlmProvider {
  readonly name = 'replay';
  constructor(private json: unknown) {}
  async extract() { return { json: this.json, usage: { inputTokens: 900, outputTokens: 250 } }; }
}

before(async () => {
  ({ db, sql } = await freshDb());
  store = new PgStore(sql);
  await sql`insert into auth.users (id, email) values (${U1}::uuid, 'a@t.test'), (${U2}::uuid, 'b@t.test')`;
  const r = await sql`insert into fp.venues (canonical_name, aliases, metro, address, neighborhood, website, status, seeded_from, tier)
    values ('Parkside Hall', array['Parkside'], 'nyc', '100 Example Ave, Brooklyn, NY', 'Williamsburg', 'https://parksidehall.example', 'approved', 'own_site', 'A') returning id::text as id`;
  venueId = r[0].id;
});
after(async () => { await db.close(); });

const job = (id: string, submitter: string) => ({ id, ocrText: BROOKLYN.ocr, metroHint: 'nyc', submitter, anonymous: false, attempts: 0 });

describe('Postgres store (real SQL against the fp schema)', () => {
  it('loads the 47 seeded metros with aliases and the 10 wave-1 metros', async () => {
    const metros = await store.metros();
    assert.equal(metros.length, 47);
    assert.ok(metros.find((m) => m.id === 'nyc')!.aliases!.includes('Brooklyn'));
    assert.equal((await sql`select count(*)::int as n from fp.metro_config where wave = 1 and venue_scan_enabled`)[0].n, 10);
  });

  it('runs a flyer job: pending first, then public when a second person shares the same flyer', async () => {
    const { BROOKLYN: B } = await import('./fixtures/flyers.ts');
    const first = await processFlyerJob(job('j1', U1), { store, provider: new Replay(B.model), now: NOW });
    assert.equal(first.result, 'pending');
    const second = await processFlyerJob(job('j2', U2), { store, provider: new Replay(B.model), now: NOW });
    assert.equal(second.result, 'published');
    const shows = await sql`select headliner, visibility, corroborated, address, address_mode, local_date::text as d, start_local, supports, price, sources, submitter::text as submitter from fp.shows`;
    assert.equal(shows.length, 1);
    assert.equal(shows[0].visibility, 'public');
    assert.equal(shows[0].corroborated, true);
    assert.equal(shows[0].address, '100 Example Ave, Brooklyn, NY');
    assert.equal(shows[0].d, '2026-10-16');
    assert.equal(shows[0].start_local, '20:00');
    assert.deepEqual(shows[0].supports, ['Gentle Moth', 'Tin Orchard']);
    assert.equal(shows[0].submitter, U1);
    assert.equal(shows[0].sources.length, 2);
    assert.equal((await sql`select count(*)::int as n from fp.source_records`)[0].n, 2);
  });

  it('records usage with token counts for the quota day', async () => {
    const u = await sql`select kind, requests, input_tokens::int as i, output_tokens::int as o from fp.ai_usage where day = ${quotaDay(NOW)}::date`;
    assert.deepEqual(u, [{ kind: 'flyer', requests: 2, i: 1800, o: 500 }]);
    assert.deepEqual(await store.usage(quotaDay(NOW)), { flyer: 2, venue: 0 });
  });

  it('source records are append-only, first-party only, and cascade away with their show', async () => {
    await assert.rejects(() => sql`update fp.source_records set source_url = 'x'`, /append-only/);
    await assert.rejects(() => sql`delete from fp.source_records`, /append-only/);
    await assert.rejects(() => sql`insert into fp.source_records (source_type, licence, fetched_at, local_date, payload) values ('flyer', 'jambase', now(), current_date, '{}')`);
    await assert.rejects(() => sql`insert into fp.source_records (source_type, fetched_at, local_date, payload) values ('jambase', now(), current_date, '{}')`);
    await assert.rejects(() => sql`insert into fp.licensed_links (show_id, source, external_id) values (gen_random_uuid(), 'deezer', 'x')`);
  });

  it('keeps licensed data out: licensed_links holds ids only', async () => {
    const cols = await sql`select column_name from information_schema.columns where table_schema = 'fp' and table_name = 'licensed_links' order by column_name`;
    assert.deepEqual(cols.map((c) => c.column_name), ['created_at', 'external_id', 'show_id', 'source']);
  });

  it('marks shows a venue stopped listing as unconfirmed (not cancelled) and clears it when listed again', async () => {
    const venue = { sourceType: 'venue_site' as const, licence: 'first_party' as const, fetchedAt: NOW.toISOString(), metro: 'nyc', venueId, venueName: 'Parkside Hall', startLocal: '21:00', supports: [], genres: [], addressMode: 'registry' as const };
    const a = await ingestCandidate(store, { ...venue, localDate: '2026-10-23', headliner: 'Night Owls' }, { submitter: null, trusted: true, metro: 'nyc' });
    const b = await ingestCandidate(store, { ...venue, localDate: '2026-10-24', headliner: 'Day Dreamers' }, { submitter: null, trusted: true, metro: 'nyc' });
    assert.ok(!('skipped' in a) && !('skipped' in b));
    const keyA = !('skipped' in a) ? a.merged.key : '';
    const n = await store.markUnconfirmed(venueId, [keyA], '2026-10-03');
    assert.equal(n, 1);
    const rows = await sql`select headliner, unconfirmed, status from fp.shows where headliner in ('Night Owls', 'Day Dreamers') order by headliner`;
    assert.deepEqual(rows, [{ headliner: 'Day Dreamers', unconfirmed: true, status: 'scheduled' }, { headliner: 'Night Owls', unconfirmed: false, status: 'scheduled' }]);
  });

  it('a takedown removes the show, blocks its key and the show cannot come back', async () => {
    const [{ id, key }] = await sql`select id::text as id, key from fp.shows where headliner = 'Night Owls'`;
    await db.exec(`update fp.shows set visibility = 'removed', removed_reason = 'takedown' where id = '${id}'`);
    await db.exec(`insert into fp.blocked_keys (key, reason) values ('${key}', 'takedown')`);
    const again = await ingestCandidate(store, { sourceType: 'venue_site', licence: 'first_party', fetchedAt: NOW.toISOString(), metro: 'nyc', venueId, venueName: 'Parkside Hall', localDate: '2026-10-23', startLocal: '21:00', headliner: 'Night Owls', supports: [], genres: [], addressMode: 'registry' }, { submitter: null, trusted: true, metro: 'nyc' });
    assert.deepEqual(again, { skipped: 'removed' });
  });

  it('a blocked image url is never stored again', async () => {
    await sql`insert into fp.blocked_urls (url, reason) values ('https://venue.example/bad.jpg', 'takedown')`;
    const r = await ingestCandidate(store, { sourceType: 'venue_site', licence: 'first_party', fetchedAt: NOW.toISOString(), metro: 'nyc', venueId, venueName: 'Parkside Hall', localDate: '2026-11-01', startLocal: '20:00', headliner: 'Cloud Atlas', supports: [], genres: [], addressMode: 'registry', imageUrl: 'https://venue.example/bad.jpg' }, { submitter: null, trusted: true, metro: 'nyc' });
    assert.ok(!('skipped' in r));
    assert.equal((await sql`select image_url from fp.shows where headliner = 'Cloud Atlas'`)[0].image_url, null);
  });

  it('trust: banned submitters are refused; three confirmed shows with nothing removed make a trusted submitter', async () => {
    await sql`insert into public.banned_users (user_id) values (${U2}::uuid)`;
    assert.equal(await store.isBanned(U2), true);
    assert.equal(await store.isTrusted(U1), false);
    for (const h of ['A', 'B', 'C']) await sql`insert into fp.shows (key, metro, venue_name, local_date, headliner, visibility, confirm_count, submitter) values (${'k' + h}, 'nyc', 'V', current_date + 9, ${h}, 'public', 1, ${U1}::uuid)`;
    assert.equal(await store.isTrusted(U1), true);
    await sql`update fp.shows set removed_reason = 'reports' where headliner = 'A'`;
    assert.equal(await store.isTrusted(U1), false);
  });

  it('a provider failure leaves the database untouched', async () => {
    class Boom implements LlmProvider { readonly name = 'boom'; async extract(): Promise<never> { throw new ProviderError('x'); } }
    const before = (await sql`select count(*)::int as n from fp.shows`)[0].n;
    const out = await processFlyerJob(job('j3', U1), { store, provider: new Boom(), now: NOW });
    assert.equal(out.status, 'retry');
    assert.equal((await sql`select count(*)::int as n from fp.shows`)[0].n, before);
  });
});
