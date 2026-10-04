import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { ingestCandidate, processFlyerJob, processVenuePage, type FlyerJob } from '../supabase/functions/_shared/pipeline.ts';
import { ProviderError, QuotaError, type LlmProvider, type LlmRequest } from '../supabase/functions/_shared/provider.ts';
import { quotaDay } from '../supabase/functions/_shared/quota.ts';
import { licenceFor, type Candidate } from '../supabase/functions/_shared/types.ts';
import { BASEMENT, BROOKLYN, METROS, NOW, REGISTRY, UNSUPPORTED_FIELDS, ev, f, resp, vev, vresp } from './fixtures/flyers.ts';
import { MemoryStore } from './fixtures/memoryStore.ts';

/** Replays recorded model responses; records what it was sent. No live API calls. */
class Recorded implements LlmProvider {
  readonly name = 'recorded';
  seen: LlmRequest[] = [];
  constructor(private script: (unknown | Error)[]) {}
  async extract(req: LlmRequest) {
    this.seen.push(req);
    const next = this.script.length > 1 ? this.script.shift()! : this.script[0];
    if (next instanceof Error) throw next;
    return { json: next, usage: { inputTokens: 900, outputTokens: 250 } };
  }
}

const job = (ocrText: string, over: Partial<FlyerJob> = {}): FlyerJob => ({ id: 'j1', ocrText, metroHint: 'nyc', submitter: 'u1', anonymous: false, attempts: 0, ...over });
let store: MemoryStore;
beforeEach(() => { store = new MemoryStore(METROS, REGISTRY); });

describe('flyer jobs end to end', () => {
  it('an uncorroborated flyer from a regular submitter waits as pending and is visible to nobody else', async () => {
    const out = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([BROOKLYN.model]), now: NOW });
    assert.equal(out.status, 'done');
    assert.equal(out.result, 'pending');
    assert.equal(out.reason, 'needs_confirmation');
    assert.equal([...store.shows.values()][0].visibility, 'pending');
    assert.equal([...store.shows.values()][0].submitter, 'u1');
  });

  it('a trusted submitter publishes straight away', async () => {
    store.trusted.add('u1');
    const out = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([BROOKLYN.model]), now: NOW });
    assert.equal(out.result, 'published');
    assert.equal([...store.shows.values()][0].visibility, 'public');
  });

  it('a second independent flyer of the same show corroborates the first and both end in one public show', async () => {
    const p = new Recorded([BROOKLYN.model]);
    await processFlyerJob(job(BROOKLYN.ocr), { store, provider: p, now: NOW });
    const second = await processFlyerJob(job(BROOKLYN.ocr, { id: 'j2', submitter: 'u2' }), { store, provider: p, now: NOW });
    assert.equal(second.result, 'published');
    assert.equal(store.shows.size, 1);
    assert.equal([...store.shows.values()][0].visibility, 'public');
    assert.equal(store.records.length, 2);
  });

  it('the same person sharing the same flyer twice does not corroborate themselves', async () => {
    const p = new Recorded([BROOKLYN.model]);
    await processFlyerJob(job(BROOKLYN.ocr), { store, provider: p, now: NOW });
    const again = await processFlyerJob(job(BROOKLYN.ocr, { id: 'j2' }), { store, provider: p, now: NOW });
    assert.equal(again.result, 'pending');
    assert.equal(store.shows.size, 1);
  });

  it("a flyer matching the venue's own page record is corroborated and publishes; the card shows both sources", async () => {
    const venueRecord: Candidate = {
      sourceType: 'venue_site', licence: licenceFor('venue_site'), fetchedAt: NOW.toISOString(), metro: 'nyc', venueId: 'v-parkside', venueName: 'Parkside Hall',
      localDate: '2026-10-16', startLocal: '20:00', headliner: 'Velvet Automaton', supports: ['Gentle Moth'], genres: [], addressMode: 'registry', address: REGISTRY[0].address,
    };
    await ingestCandidate(store, venueRecord, { submitter: null, trusted: true, metro: 'nyc' });
    const out = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([BROOKLYN.model]), now: NOW });
    assert.equal(out.result, 'published');
    assert.equal(store.shows.size, 1);
    const show = [...store.shows.values()][0];
    assert.deepEqual(show.merged.sources.map((s) => s.sourceType).sort(), ['flyer', 'venue_site']);
    assert.equal(show.merged.fieldSource.start, 'venue_site'); // venue site wins start time over the flyer
  });

  it('a venue-site record arriving after a pending flyer promotes it to public', async () => {
    await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([BROOKLYN.model]), now: NOW });
    const venueRecord: Candidate = {
      sourceType: 'venue_site', licence: 'first_party', fetchedAt: NOW.toISOString(), metro: 'nyc', venueId: 'v-parkside', venueName: 'Parkside Hall',
      localDate: '2026-10-16', startLocal: '20:00', headliner: 'Velvet Automaton', supports: [], genres: [], addressMode: 'registry',
    };
    const r = await ingestCandidate(store, venueRecord, { submitter: null, trusted: true, metro: 'nyc' });
    assert.ok(!('skipped' in r) && r.visibility === 'public');
    assert.equal(store.shows.size, 1);
    assert.equal([...store.shows.values()][0].submitter, 'u1'); // the submitter keeps their credit
  });

  it('low-confidence flyers stay pending even from trusted submitters', async () => {
    store.trusted.add('u1');
    const low = resp([ev({ headliner: f('Honey Radio', 'HONEY RADIO', 0.5), venue: f('Parkside Hall', 'PARKSIDE HALL'), date: f('FRI OCT 16', 'FRI OCT 16') })]);
    const out = await processFlyerJob(job('PARKSIDE HALL\nHONEY RADIO\nFRI OCT 16'), { store, provider: new Recorded([low]), now: NOW });
    assert.equal(out.result, 'pending');
    assert.equal(out.reason, 'low_confidence');
  });

  it('sends only redacted text to the model', async () => {
    const p = new Recorded([BROOKLYN.model]);
    await processFlyerJob(job(`${BROOKLYN.ocr}\ncall (212) 555-0147 or booker@example.com`), { store, provider: p, now: NOW });
    const sent = p.seen[0].prompt;
    assert.ok(!/555-0147|booker@example|@velvetautomaton/.test(sent), sent);
    assert.ok(sent.includes('VELVET AUTOMATON'));
    assert.ok(sent.includes('Brooklyn'.length ? 'New York' : ''), 'metro context is in the prompt');
    assert.ok(sent.includes('America/New_York'));
  });

  it('rejects non-flyers, unsafe content and unreadable dates with a reason', async () => {
    assert.deepEqual(
      [(await processFlyerJob(job('lunch menu'), { store, provider: new Recorded([resp([], { is_flyer: false })]), now: NOW })).reason,
       (await processFlyerJob(job('x'), { store, provider: new Recorded([resp([], { is_safe: false })]), now: NOW })).reason],
      ['not_a_flyer', 'unsafe'],
    );
    const wrong = await processFlyerJob(job('PARKSIDE HALL\nPAPER LANTERNS\nSAT OCT 16'), { store, provider: new Recorded([resp([ev({ headliner: f('Paper Lanterns', 'PAPER LANTERNS'), venue: f('Parkside Hall', 'PARKSIDE HALL'), date: f('SAT OCT 16', 'SAT OCT 16') })])]), now: NOW });
    assert.equal(wrong.result, 'rejected');
    assert.equal(wrong.reason, 'weekday_mismatch');
    assert.equal(store.shows.size, 0);
  });

  it('keeps a house show without a street address', async () => {
    const out = await processFlyerJob(job(BASEMENT.ocr), { store, provider: new Recorded([BASEMENT.model]), now: NOW });
    assert.equal(out.result, 'pending');
    const m = [...store.shows.values()][0].merged;
    assert.equal(m.address, undefined);
    assert.equal(m.addressMode, 'withheld');
    assert.equal(m.city, 'Brooklyn');
  });

  it('drops unsupported fields (no price or genre without text behind them)', async () => {
    await processFlyerJob(job(UNSUPPORTED_FIELDS.ocr), { store, provider: new Recorded([UNSUPPORTED_FIELDS.model]), now: NOW });
    const m = [...store.shows.values()][0].merged;
    assert.equal(m.price, undefined);
    assert.deepEqual(m.genres, []);
  });

  it('refuses banned submitters without calling the model', async () => {
    store.banned.add('u1');
    const p = new Recorded([BROOKLYN.model]);
    const out = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: p, now: NOW });
    assert.equal(out.reason, 'banned');
    assert.equal(p.seen.length, 0);
  });

  it('does not bring back a removed or blocked show', async () => {
    await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([BROOKLYN.model]), now: NOW });
    const s = [...store.shows.values()][0];
    s.visibility = 'removed';
    const again = await processFlyerJob(job(BROOKLYN.ocr, { id: 'j2', submitter: 'u2' }), { store, provider: new Recorded([BROOKLYN.model]), now: NOW });
    assert.equal(again.result, 'rejected');
    assert.equal(s.visibility, 'removed');
    store = new MemoryStore(METROS, REGISTRY);
    store.blockedKeys.add('v-parkside|2026-10-16|velvetautomaton');
    const blocked = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([BROOKLYN.model]), now: NOW });
    assert.equal(blocked.result, 'rejected');
    assert.equal(store.shows.size, 0);
  });
});

describe('quota handling', () => {
  it('a 429 puts the job back in the queue as "processing" with a backoff, and counts it as throttled', async () => {
    const out = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([new QuotaError()]), now: NOW });
    assert.equal(out.status, 'retry');
    assert.equal(out.result, 'processing');
    assert.equal(out.retryAtMs, NOW.getTime() + 30_000);
    assert.equal(store.usageByDay.get(quotaDay(NOW))!.throttled, 1);
    assert.equal(store.shows.size, 0);
  });

  it('honours a longer server retry hint and gives up with a visible result after the attempt limit', async () => {
    const hinted = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([new QuotaError(600)]), now: NOW });
    assert.equal(hinted.retryAtMs, NOW.getTime() + 600_000);
    const last = await processFlyerJob(job(BROOKLYN.ocr, { attempts: 7 }), { store, provider: new Recorded([new QuotaError()]), now: NOW });
    assert.equal(last.status, 'failed');
    assert.equal(last.reason, 'quota_gave_up');
  });

  it('a retry that succeeds later finishes normally', async () => {
    const p = new Recorded([new QuotaError(), BROOKLYN.model]);
    const first = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: p, now: NOW });
    assert.equal(first.status, 'retry');
    const second = await processFlyerJob(job(BROOKLYN.ocr, { attempts: 1 }), { store, provider: p, now: new Date(NOW.getTime() + 60_000) });
    assert.equal(second.status, 'done');
    assert.equal(second.result, 'pending');
  });

  it('does not call the model once the daily cap is spent, and the flyer reserve survives venue scans', async () => {
    store.cfg = { dailyCap: 10, flyerReserveShare: 0.3, model: 'm' };
    const day = quotaDay(NOW);
    await store.addUsage(day, 'venue', { requests: 7 });
    const p = new Recorded([BROOKLYN.model]);
    const venue = { ...REGISTRY[0], id: 'v-parkside' };
    const blocked = await processVenuePage(venue, { url: 'https://parksidehall.example/events', text: 'x' }, { store, provider: p, now: NOW });
    assert.equal(blocked.status, 'quota'); // the last 3 requests belong to flyers
    const flyer = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: p, now: NOW });
    assert.equal(flyer.status, 'done');
    await store.addUsage(day, 'flyer', { requests: 2 });
    const full = await processFlyerJob(job(BROOKLYN.ocr, { id: 'j9' }), { store, provider: new Recorded([BROOKLYN.model]), now: NOW });
    assert.equal(full.status, 'retry');
    assert.equal(full.quotaHit, true);
  });

  it('a provider error is retried, not lost', async () => {
    const out = await processFlyerJob(job(BROOKLYN.ocr), { store, provider: new Recorded([new ProviderError('boom')]), now: NOW });
    assert.equal(out.status, 'retry');
  });
});

describe('venue pages and disappearing shows', () => {
  const page = 'Fri Oct 16 Velvet Automaton 8pm\nSat Oct 17 Salt Lick Division 9pm';
  const model = vresp([
    vev({ headliner: 'Velvet Automaton', date: 'Fri Oct 16', start: '8pm', evidence: 'Fri Oct 16 Velvet Automaton 8pm' }),
    vev({ headliner: 'Salt Lick Division', date: 'Sat Oct 17', start: '9pm', evidence: 'Sat Oct 17 Salt Lick Division 9pm' }),
  ]);

  it('publishes validated events from the venue page and counts them', async () => {
    const r = await processVenuePage(REGISTRY[0], { url: 'https://parksidehall.example/events', text: page }, { store, provider: new Recorded([model]), now: NOW });
    assert.ok(r.status === 'ok' && r.extracted === 2 && r.rejected === 0);
    assert.deepEqual([...store.shows.values()].map((s) => s.visibility), ['public', 'public']);
    assert.equal(store.usageByDay.get(quotaDay(NOW))!.venue, 1);
    assert.equal(store.usageByDay.get(quotaDay(NOW))!.tokens, 1150);
  });

  it('a show missing from the next read becomes unconfirmed, not cancelled, and comes back when listed again', async () => {
    await processVenuePage(REGISTRY[0], { url: 'u', text: page }, { store, provider: new Recorded([model]), now: NOW });
    const keys = [...store.shows.values()].map((s) => s.merged.key);
    const n = await store.markUnconfirmed('v-parkside', [keys[0]], '2026-10-03');
    assert.equal(n, 1);
    const second = [...store.shows.values()][1];
    assert.equal(second.unconfirmed, true);
    assert.equal(second.merged.status, 'scheduled');
    await store.markUnconfirmed('v-parkside', keys, '2026-10-03');
    assert.equal(second.unconfirmed, false);
  });
});

describe('venue page diagnostics', () => {
  it('records why a reply gave no events (unreadable vs. empty)', async () => {
    const store = new MemoryStore(METROS, REGISTRY);
    class Meta implements LlmProvider {
      readonly name = 'meta';
      constructor(private json: unknown) {}
      async extract() { return { json: this.json, usage: { inputTokens: 10, outputTokens: 5 }, meta: { finish: 'MAX_TOKENS', textLength: 8000, thoughtTokens: 0, head: '{"events":[' } }; }
    }
    const bad = await processVenuePage(REGISTRY[0], { url: 'u', text: 'Fri Oct 16 Velvet Automaton 8pm' }, { store, provider: new Meta(null), now: NOW });
    assert.ok(bad.status === 'ok' && bad.note?.startsWith('unreadable_reply:MAX_TOKENS:8000'));
    const empty = await processVenuePage(REGISTRY[0], { url: 'u', text: 'Fri Oct 16 Velvet Automaton 8pm' }, { store, provider: new Meta(vresp([])), now: NOW });
    assert.ok(empty.status === 'ok' && empty.note === 'model_found_no_events');
  });
});
