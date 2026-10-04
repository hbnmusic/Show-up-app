import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canadianCheck, makeGeocoder, milesBetween } from '../scripts/lib/geo.ts';
import { looksBlocked, PoliteFetcher, USER_AGENT, type FetchFn } from '../scripts/lib/polite.ts';
import { readStructured, scanVenue, trialVenue, type Api, type PlanVenue } from '../scripts/lib/scan.ts';
import { sha256Hex, htmlToText } from '../supabase/functions/_shared/extract.ts';

type Route = { status?: number; body?: string; headers?: Record<string, string> };
function fakeNet(routes: Record<string, Route | Error>) {
  const log: { url: string; headers: Record<string, string>; at: number }[] = [];
  let clock = 0;
  const fn: FetchFn = async (url, init) => {
    log.push({ url, headers: init.headers, at: clock });
    const r = routes[url] ?? { status: 404, body: '' };
    if (r instanceof Error) throw r;
    const h = r.headers ?? {};
    return { status: r.status ?? 200, headers: { get: (n) => h[n.toLowerCase()] ?? null }, text: async () => r.body ?? '' };
  };
  const fetcher = new PoliteFetcher(fn, async (ms) => { clock += ms; }, () => clock);
  return { fetcher, log, clock: () => clock };
}

function fakeApi(replies: Record<string, Record<string, unknown>> = {}) {
  const calls: { action: string; body: Record<string, any> }[] = [];
  const api: Api = async (action, body = {}) => { calls.push({ action, body: body as Record<string, any> }); return replies[action] ?? {}; };
  return { api, calls };
}

const venue: PlanVenue = { id: 'v1', metro: 'nyc', name: 'Parkside Hall', website: 'https://parksidehall.example', eventsUrl: 'https://parksidehall.example/events', address: '100 Example Ave, Brooklyn, NY' };
const LD = `<script type="application/ld+json">{"@type":"MusicEvent","name":"Velvet Automaton","startDate":"2026-10-16T20:00:00-04:00"}</script>`;
const ROBOTS_OK = { 'https://parksidehall.example/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' } as Route };
const longText = `Parkside Hall events. ${'Fri Oct 16 Velvet Automaton 8pm doors 7pm tickets. '.repeat(10)}`;

describe('polite fetching', () => {
  it('identifies the bot, reads robots.txt first, spaces requests per host and never sends cookies', async () => {
    const { fetcher, log } = fakeNet({ ...ROBOTS_OK, 'https://parksidehall.example/events': { body: 'ok' }, 'https://parksidehall.example/other': { body: 'ok' } });
    await fetcher.get('https://parksidehall.example/events');
    await fetcher.get('https://parksidehall.example/other');
    assert.equal(log[0].url, 'https://parksidehall.example/robots.txt');
    assert.ok(log.every((l) => l.headers['user-agent'] === USER_AGENT && !('cookie' in l.headers) && !('authorization' in l.headers)));
    assert.ok(USER_AGENT.includes('https://'), 'a contact URL is in the user agent');
    assert.ok(log[2].at - log[1].at >= 3000, 'at least 3 s between requests to one host');
    assert.equal(log.filter((l) => l.url.endsWith('robots.txt')).length, 1, 'robots.txt is fetched once per run');
  });

  it('skips pages robots.txt disallows without requesting them, honours Crawl-delay, treats a robots error as deny', async () => {
    const a = fakeNet({ 'https://a.example/robots.txt': { body: 'User-agent: *\nDisallow: /events\nCrawl-delay: 10' }, 'https://a.example/events': { body: 'x' }, 'https://a.example/ok': { body: 'x' }, 'https://a.example/ok2': { body: 'x' } });
    assert.deepEqual(await a.fetcher.get('https://a.example/events'), { kind: 'robots_disallowed' });
    await a.fetcher.get('https://a.example/ok');
    const t = a.clock();
    await a.fetcher.get('https://a.example/ok2');
    assert.ok(a.clock() - t >= 10000);
    assert.ok(!a.log.some((l) => l.url === 'https://a.example/events'));
    const b = fakeNet({ 'https://b.example/robots.txt': { status: 500 }, 'https://b.example/events': { body: 'x' } });
    assert.deepEqual(await b.fetcher.get('https://b.example/events'), { kind: 'robots_disallowed' });
    const c = fakeNet({ 'https://c.example/robots.txt': { status: 404 }, 'https://c.example/events': { body: 'hello' } });
    assert.equal((await c.fetcher.get('https://c.example/events')).kind, 'ok');
  });

  it('sends conditional requests and understands 304', async () => {
    const { fetcher, log } = fakeNet({ ...ROBOTS_OK, 'https://parksidehall.example/events': { status: 304 } });
    assert.deepEqual(await fetcher.get('https://parksidehall.example/events', { etag: '"abc"', lastModified: 'Sat, 03 Oct 2026 10:00:00 GMT' }), { kind: 'not_modified' });
    assert.equal(log[1].headers['if-none-match'], '"abc"');
    assert.equal(log[1].headers['if-modified-since'], 'Sat, 03 Oct 2026 10:00:00 GMT');
  });

  it('gives up on blocks and bot walls instead of working around them (no retry, no second attempt)', async () => {
    for (const r of [{ status: 403, body: 'Forbidden' }, { status: 429, body: 'slow down' }, { status: 503, body: '<title>Just a moment...</title>' }, { status: 200, body: '<html>Please verify you are human. captcha</html>' }, { status: 200, body: 'x', headers: { 'cf-mitigated': 'challenge' } }]) {
      const { fetcher, log } = fakeNet({ ...ROBOTS_OK, 'https://parksidehall.example/events': r });
      const out = await fetcher.get('https://parksidehall.example/events');
      assert.equal(out.kind, 'bot_wall', JSON.stringify(r));
      assert.equal(log.filter((l) => l.url.endsWith('/events')).length, 1);
    }
    assert.equal(looksBlocked(200, { get: () => null }, `${LD} captcha`), null); // real content that mentions captcha is not a wall
    assert.equal(looksBlocked(500, { get: () => null }, 'oops'), null);
  });
});

describe('scanning a venue', () => {
  it('structured data wins: JSON-LD events go to the server and no model request is made', async () => {
    const { fetcher } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: `<html>${LD}</html>`, headers: { etag: '"e1"' } } });
    const { api, calls } = fakeApi();
    assert.equal((await scanVenue(venue, fetcher, api)).result, 'ingested');
    assert.deepEqual(calls.map((c) => c.action), ['ingest_events']);
    assert.equal(calls[0].body.tier, 'jsonld');
    assert.equal(calls[0].body.events.length, 1);
    assert.equal(calls[0].body.run.etag, '"e1"');
  });

  it('follows an iCal link, an events feed and the calendar plugin endpoint before using the model', async () => {
    const ics = 'BEGIN:VEVENT\nSUMMARY:Tin Orchard\nDTSTART:20261017T200000Z\nEND:VEVENT';
    const a = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: '<link rel="alternate" type="text/calendar" href="/events.ics">' }, 'https://parksidehall.example/events.ics': { body: ics } });
    const r1 = await readStructured(venue.eventsUrl!, '<link rel="alternate" type="text/calendar" href="/events.ics">', a.fetcher);
    assert.equal(r1?.tier, 'ical');
    const tribe = JSON.stringify({ events: [{ title: 'Paper Lanterns', start_date: '2026-10-23 20:00:00', url: '/e/1' }] });
    const b = fakeNet({ ...ROBOTS_OK, 'https://parksidehall.example/wp-json/tribe/events/v1/events?per_page=100': { body: tribe } });
    const r2 = await readStructured(venue.eventsUrl!, '<div class="tribe-events-calendar"></div>', b.fetcher);
    assert.equal(r2?.tier, 'widget');
    const c = fakeNet({ ...ROBOTS_OK });
    assert.equal(await readStructured(venue.eventsUrl!, '<p>no data</p>', c.fetcher), null);
  });

  it('with no structured data it sends stripped text to the model only when the page text changed', async () => {
    const html = `<nav>menu</nav><main>${longText}</main>`;
    const { fetcher } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: html } });
    const first = fakeApi({ extract_ai: { status: 'ok' } });
    assert.equal((await scanVenue(venue, fetcher, first.api)).result, 'ai');
    assert.deepEqual(first.calls.map((c) => c.action), ['extract_ai']);
    assert.ok(!first.calls[0].body.text.includes('menu'));
    const hash = await sha256Hex(htmlToText(html));
    assert.equal(first.calls[0].body.run.contentHash, hash);
    const second = fakeApi();
    const { fetcher: f2 } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: html } });
    assert.equal((await scanVenue({ ...venue, contentHash: hash }, f2, second.api)).result, 'unchanged');
    assert.deepEqual(second.calls.map((c) => c.action), ['record_run']); // no model request
  });

  it('records robots, bot-wall, fetch errors and 304s as runs (health) without ingesting anything', async () => {
    const cases: [Record<string, Route | Error>, string, Record<string, unknown>][] = [
      [{ 'https://parksidehall.example/robots.txt': { body: 'User-agent: *\nDisallow: /' } }, 'robots', { robots: 'disallowed' }],
      [{ ...ROBOTS_OK, [venue.eventsUrl!]: { status: 403, body: 'no' } }, 'bot_wall', { robots: 'bot_wall' }],
      [{ ...ROBOTS_OK, [venue.eventsUrl!]: new Error('ECONNRESET') }, 'error', { fetchOk: false }],
      [{ ...ROBOTS_OK, [venue.eventsUrl!]: { status: 304 } }, 'not_modified', { note: 'not_modified' }],
      [{ ...ROBOTS_OK, [venue.eventsUrl!]: { body: '<p>short</p>' } }, 'no_text', { note: 'no_text' }],
    ];
    for (const [routes, result, run] of cases) {
      const { fetcher } = fakeNet(routes);
      const { api, calls } = fakeApi();
      assert.equal((await scanVenue(venue, fetcher, api)).result, result);
      assert.deepEqual(calls.map((c) => c.action), ['record_run']);
      assert.deepEqual(Object.fromEntries(Object.keys(run).map((k) => [k, calls[0].body.run[k]])), run);
    }
  });

  it('a quota answer is not recorded as a run, so the venue is tried again next time', async () => {
    const { fetcher } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: `<main>${longText}</main>` } });
    const { api } = fakeApi({ extract_ai: { status: 'quota' } });
    assert.equal((await scanVenue(venue, fetcher, api)).result, 'quota');
  });
});

describe('trial read and automatic approval inputs', () => {
  const geoYes = async () => true as boolean | null;

  it('sends the checks for a venue with structured events (tier A inputs)', async () => {
    const { fetcher } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: `<h1>Parkside Hall</h1>${LD}` } });
    const { api, calls } = fakeApi({ ingest_events: { ingested: 3 }, approve: { decision: 'approved', reasons: [] } });
    const r = await trialVenue(venue, fetcher, api, geoYes);
    assert.equal(r.decision, 'approved');
    const c = calls.find((x) => x.action === 'approve')!.body;
    assert.deepEqual([c.checks.robots, c.checks.nameMatches, c.checks.insideMetro, c.checks.structuredEvents, c.method], ['ok', true, true, 3, 'jsonld']);
  });

  it('rejects at once when the page does not mention the venue, or robots/bot walls apply, without spending a model request', async () => {
    const notName = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: `<main>Some other place ${longText.replace(/Parkside Hall/g, 'Elsewhere')}</main>` } });
    const a = fakeApi({ approve: { decision: 'rejected', reasons: ['name_mismatch'] } });
    await trialVenue(venue, notName.fetcher, a.api, geoYes);
    assert.deepEqual(a.calls.map((c) => c.action), ['approve']);
    assert.equal(a.calls[0].body.checks.nameMatches, false);
    const walled = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { status: 403, body: 'no' } });
    const b = fakeApi({ approve: { decision: 'rejected', reasons: ['bot_wall'] } });
    await trialVenue(venue, walled.fetcher, b.api, geoYes);
    assert.equal(b.calls[0].body.checks.robots, 'bot_wall');
    const disallowed = fakeNet({ 'https://parksidehall.example/robots.txt': { body: 'User-agent: *\nDisallow: /' } });
    const c = fakeApi({ approve: { decision: 'rejected', reasons: ['robots_disallow'] } });
    await trialVenue(venue, disallowed.fetcher, c.api, geoYes);
    assert.equal(c.calls[0].body.checks.robots, 'disallowed');
  });

  it('uses the model for the trial only when there is no structured data, and defers on quota', async () => {
    const { fetcher } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: `<main>${longText}</main>` } });
    const ok = fakeApi({ extract_ai: { status: 'ok', ingested: 4 }, approve: { decision: 'approved', reasons: [] } });
    await trialVenue(venue, fetcher, ok.api, geoYes);
    assert.deepEqual([ok.calls[0].action, ok.calls[1].body.checks.aiEventsWithEvidence, ok.calls[1].body.method], ['extract_ai', 4, 'ai']);
    const { fetcher: f2 } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: `<main>${longText}</main>` } });
    const q = fakeApi({ extract_ai: { status: 'quota' } });
    assert.equal((await trialVenue(venue, f2, q.api, geoYes)).decision, 'deferred');
    assert.ok(!q.calls.some((c) => c.action === 'approve'));
  });

  it('flags a venue outside the metro and one that is a stadium', async () => {
    const { fetcher } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: `<main>${longText}</main>` } });
    const a = fakeApi({ approve: { decision: 'rejected', reasons: ['outside_metro'] } });
    await trialVenue(venue, fetcher, a.api, async () => false);
    assert.equal(a.calls.at(-1)!.body.checks.insideMetro, false);
    assert.deepEqual(a.calls.map((c) => c.action), ['approve']);
    const { fetcher: f2 } = fakeNet({ ...ROBOTS_OK, [venue.eventsUrl!]: { body: `<main>${longText.replace(/Parkside Hall/g, 'Big Stadium')}</main>` } });
    const b = fakeApi({ approve: { decision: 'rejected', reasons: ['venue_type'] } });
    await trialVenue({ ...venue, name: 'Big Stadium' }, f2, b.api, geoYes);
    assert.equal(b.calls.at(-1)!.body.checks.venueTypeOk, false);
  });
});

describe('address checks by metro', () => {
  it('Canada: city plus province or matching postal prefix is inside; a postal code from another province is outside; else unknown', () => {
    assert.equal(canadianCheck('200 rue Exemple, Montréal, QC H2T 1A1', 'Montréal', 'QC'), 'inside');
    assert.equal(canadianCheck('200 rue Exemple, Montreal H2T 1A1', 'Montréal', 'QC'), 'inside'); // postal prefix H = Quebec
    assert.equal(canadianCheck('1 King St W, Toronto, ON M5H 1A1', 'Toronto', 'ON'), 'inside');
    assert.equal(canadianCheck('1 King St W, Toronto, ON V5H 1A1', 'Toronto', 'ON'), 'outside'); // V = British Columbia
    assert.equal(canadianCheck('1 Main St', 'Toronto', 'ON'), 'unknown');
    assert.equal(canadianCheck('5 Dock Rd, Halifax', 'Toronto', 'ON'), 'unknown');
  });

  it('US: asks the Census geocoder and checks the distance to the metro; no match means unknown', async () => {
    const reply = (x: number, y: number): FetchFn => async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: { addressMatches: [{ coordinates: { x, y } }] } }) });
    const near = makeGeocoder(reply(-73.95, 40.72));
    assert.equal(await near({ ...venue }), true);
    const far = makeGeocoder(reply(-87.63, 41.88)); // Chicago
    assert.equal(await far({ ...venue }), false);
    const none = makeGeocoder(async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: { addressMatches: [] } }) }));
    assert.equal(await none({ ...venue }), null);
    assert.equal(await makeGeocoder(reply(0, 0))({ ...venue, address: null }), null);
    assert.ok(milesBetween({ lat: 40.7128, lng: -74.006 }, { lat: 40.7128, lng: -74.006 }) < 0.01);
  });
});

describe('inside-metro check with coordinates', () => {
  it('uses the venue coordinates when present and the address geocoder otherwise', async () => {
    const { withCoordinates } = await import('../scripts/lib/geo.ts');
    const nyc = { lat: 40.71, lng: -74.0, radiusMi: 25 };
    let asked = 0;
    const g = withCoordinates(async () => { asked++; return null; }, (id) => (id === 'nyc' ? nyc : undefined));
    assert.equal(await g({ id: 'a', metro: 'nyc', name: 'A', lat: 40.7, lng: -73.95 }), true);
    assert.equal(await g({ id: 'b', metro: 'nyc', name: 'B', lat: 34.05, lng: -118.2 }), false);
    assert.equal(asked, 0);
    assert.equal(await g({ id: 'c', metro: 'nyc', name: 'C' }), null);
    assert.equal(asked, 1);
  });
});
