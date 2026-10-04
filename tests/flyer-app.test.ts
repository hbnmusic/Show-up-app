import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conflictNotes, sourcesNote, ticketLabel } from '../src/lib/fpText.ts';
import { licensedCandidates, mergeFirstParty, parseFpRows, type FpRow } from '../src/lib/fpMerge.ts';
import { prepareOcr, layoutHints, withCaption, type OcrResult } from '../src/lib/flyer/prepare.ts';
import { handleLink, handleText, readFlyerImage, sendPrepared, LINK_FAILED_MESSAGE, type FlyerDeps } from '../src/lib/flyer/share.ts';
import { CONFIRMATION_RULES, dayLabel, noticesFor, submittedRows, THANKS_BODY, viewJob } from '../src/lib/flyer/status.ts';
import type { Job } from '../src/lib/fp/api.ts';
import { applySwitchesToAll } from '../src/lib/licensed.ts';
import type { Show } from '../src/lib/types.ts';
import { BROOKLYN } from './fixtures/flyers.ts';

const frame = (top: number, height: number, left = 10, width = 300) => ({ top, height, left, width });
const ocr: OcrResult = {
  text: BROOKLYN.ocr,
  blocks: [
    { text: 'PARKSIDE HALL PRESENTS', frame: frame(10, 20), lines: [{ text: 'PARKSIDE HALL PRESENTS', frame: frame(10, 20) }] },
    { text: 'VELVET AUTOMATON', frame: frame(60, 90), lines: [{ text: 'VELVET AUTOMATON', frame: frame(60, 90) }] },
    { text: 'w/ Gentle Moth + Tin Orchard', frame: frame(170, 24), lines: [{ text: 'w/ Gentle Moth + Tin Orchard', frame: frame(170, 24) }] },
    { text: 'IG @velvetautomaton', frame: frame(480, 18), lines: [{ text: 'IG @velvetautomaton', frame: frame(480, 18) }] },
  ],
};

describe('prepareOcr', () => {
  it('removes handles, emails and phones before anything is sent', () => {
    const p = prepareOcr({ text: 'Velvet Automaton live. Book: bookings@band.example or 718-555-0123. IG @velvetautomaton', blocks: [] });
    assert.ok(!('error' in p));
    if (!('error' in p)) {
      assert.doesNotMatch(p.text, /bookings@|555-0123|@velvetautomaton/);
      assert.match(p.text, /Velvet Automaton/);
    }
  });
  it('rejects empty and marker-only text', () => {
    assert.deepEqual(prepareOcr({ text: '  ', blocks: [] }), { error: 'no_text' });
    assert.deepEqual(prepareOcr({ text: 'hi@x.example 718-555-0123 @someone', blocks: [] }), { error: 'no_text' });
    assert.deepEqual(prepareOcr({ text: 'x'.repeat(9000), blocks: [] }), { error: 'too_long' });
  });
  it('layout hints rank the large type and are redacted', () => {
    const h = layoutHints(ocr.blocks);
    const rows = h.split('\n');
    assert.equal(rows.length, 4);
    assert.match(rows[0], /^\[top, size /);
    assert.match(rows[1], /VELVET AUTOMATON/);
    assert.ok(Number(/size ([\d.]+)x/.exec(rows[1])![1]) > 2);
    assert.doesNotMatch(h, /@velvetautomaton/);
  });
  it('caption joins the text', () => {
    assert.match(withCaption('flyer text', 'Doors at 8'), /Post caption:\nDoors at 8/);
    assert.equal(withCaption('flyer text', ' '), 'flyer text');
  });
});

function deps(over: Partial<FlyerDeps> = {}) {
  const tracked: { name: string; props: Record<string, unknown> }[] = [];
  const sent: Record<string, unknown>[] = [];
  const d: FlyerDeps = {
    ocr: async () => ({ ok: true, result: ocr }),
    previewOnPhone: async () => null,
    previewOnServer: async () => null,
    submit: async (b) => { sent.push(b); return { ok: true, data: { jobId: 'j1', status: 'done', result: 'pending', showIds: ['s1'] } }; },
    track: (name, props) => tracked.push({ name, props }),
    ...over,
  };
  return { d, tracked, sent };
}

describe('flyer sharing steps', () => {
  it('sends only text and layout, never an image', async () => {
    const { d, sent, tracked } = deps();
    const r = await readFlyerImage('file:///flyer.jpg', d);
    assert.ok('prepared' in r);
    if ('prepared' in r) await sendPrepared(r.prepared, 'nyc', 'image', d);
    assert.deepEqual(Object.keys(sent[0]).sort(), ['layout', 'metro', 'origin', 'text']);
    assert.doesNotMatch(JSON.stringify(sent[0]), /file:\/\/|base64/);
    const e = tracked.map((t) => t.name);
    assert.ok(e.includes('flyer_ocr') && e.includes('flyer_result'));
    // analytics carry counts and codes only
    assert.doesNotMatch(JSON.stringify(tracked), /Velvet|Parkside/i);
  });
  it('reports unreadable images and missing recogniser', async () => {
    const blank = deps({ ocr: async () => ({ ok: true, result: { text: '', blocks: [] } }) });
    assert.deepEqual(await readFlyerImage('x', blank.d), { kind: 'no_text' });
    const gone = deps({ ocr: async () => ({ ok: false, error: 'unavailable' }) });
    assert.deepEqual(await readFlyerImage('x', gone.d), { kind: 'unavailable' });
  });
  it('maps server errors to plain messages', async () => {
    const { d } = deps({ submit: async () => ({ ok: false, error: 'limit', code: 'limit', status: 429 }) });
    const o = await sendPrepared({ text: 'a'.repeat(30), layout: '' }, undefined, 'image', d);
    assert.equal(o.kind, 'error');
    assert.match((o as { message: string }).message, /limit/i);
  });
  it('tracks a quota hit when the job is queued for retry', async () => {
    const { d, tracked } = deps({ submit: async () => ({ ok: true, data: { jobId: 'j', status: 'retry', result: 'processing', quotaHit: true } }) });
    await sendPrepared({ text: 'a'.repeat(30), layout: '' }, undefined, 'image', d);
    assert.ok(tracked.some((t) => t.name === 'ai_quota'));
  });
});

describe('shared links', () => {
  it('phone read works: image text is sent with origin link', async () => {
    const { d, sent } = deps({ previewOnPhone: async () => ({ imageUrl: 'https://cdn.example/flyer.jpg', caption: 'Friday at Parkside' }) });
    const o = await handleLink('https://posts.example/p/abc', 'nyc', d, async () => true);
    assert.equal(o.kind, 'submitted');
    assert.equal((o as { imageUri?: string }).imageUri, 'https://cdn.example/flyer.jpg');
    assert.equal(sent[0].origin, 'link');
    assert.match(String(sent[0].text), /Post caption/);
  });
  it('falls back to the server when the phone gets nothing', async () => {
    let asked = 0;
    const { d, tracked } = deps({ previewOnServer: async () => { asked++; return { imageUrl: 'https://cdn.example/f.jpg' }; } });
    const o = await handleLink('https://posts.example/p/abc', 'nyc', d, async () => true);
    assert.equal(asked, 1);
    assert.equal(o.kind, 'submitted');
    assert.deepEqual(tracked.find((t) => t.name === 'link_fetch')?.props, { via: 'server', ok: true });
  });
  it('shows the single failure prompt when neither route works', async () => {
    const { d, sent } = deps();
    assert.deepEqual(await handleLink('https://posts.example/p/abc', 'nyc', d, async () => true), { kind: 'link_failed' });
    assert.equal(sent.length, 0);
    assert.equal(LINK_FAILED_MESSAGE, "Couldn't get the flyer from that link. Share a screenshot instead.");
  });
  it('refuses unsafe addresses without any request', async () => {
    let called = false;
    const { d } = deps({ previewOnPhone: async () => { called = true; return null; } });
    for (const u of ['http://x.example/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://user:pw@x.example/a']) {
      assert.deepEqual(await handleLink(u, 'nyc', d, async () => true), { kind: 'link_failed' });
    }
    assert.equal(called, false);
  });
  it('uses the caption alone when the image has no readable text', async () => {
    const { d, sent } = deps({
      ocr: async () => ({ ok: true, result: { text: '', blocks: [] } }),
      previewOnPhone: async () => ({ imageUrl: 'https://cdn.example/f.jpg', caption: 'Velvet Automaton at Parkside Hall, Friday October 16, doors 7pm, $15' }),
    });
    assert.equal((await handleLink('https://posts.example/p/1', 'nyc', d, async () => true)).kind, 'submitted');
    assert.match(String(sent[0].text), /Velvet Automaton/);
  });
  it('plain shared text is used directly', async () => {
    const { d, sent } = deps();
    assert.equal((await handleText('Velvet Automaton at Parkside Hall Fri Oct 16 8pm', 'nyc', d)).kind, 'submitted');
    assert.equal(sent.length, 1);
    assert.deepEqual(await handleText('hi', 'nyc', d), { kind: 'no_text' });
  });
});

const job = (o: Partial<Job>): Job => ({ id: 'j', status: 'done', result: 'published', reason: null, createdAt: '', finishedAt: '', notified: false, shows: [{ id: 's', headliner: 'Velvet Automaton', localDate: '2026-10-16', visibility: 'public' }], ...o });

describe('job status and notices', () => {
  it('describes each state in plain words', () => {
    assert.equal(viewJob(job({})).tone, 'live');
    assert.equal(viewJob(job({ result: 'pending', reason: 'needs_confirmation', shows: [{ id: 's', headliner: 'Velvet Automaton', localDate: '2026-10-16', visibility: 'pending' }] })).tone, 'waiting');
    assert.equal(viewJob(job({ result: 'processing', status: 'retry' })).tone, 'working');
    assert.match(viewJob(job({ result: 'rejected', reason: 'not_a_flyer', shows: [] })).detail, /concert flyer/);
    assert.match(viewJob(job({ result: 'rejected', reason: 'something_new', shows: [] })).detail, /could not use/);
  });
  it('notifies once for live, waiting and rejected; never for working or already notified', () => {
    const n = noticesFor([
      job({ id: 'a' }), job({ id: 'b', result: 'pending', shows: [{ id: 's', headliner: 'Velvet Automaton', localDate: '2026-10-16', visibility: 'pending' }] }), job({ id: 'c', result: 'rejected', reason: 'no_events', shows: [] }),
      job({ id: 'd', result: 'processing', status: 'retry' }), job({ id: 'e', notified: true }),
    ]);
    assert.deepEqual(n.map((x) => x.jobId), ['a', 'b', 'c']);
    assert.match(n[1].title, /second confirmation/);
  });
});

const sw = { jambase_listings: true, ticketmaster_price: true, ticketmaster_photo: true, ticketmaster_link: true };
const lic = (o: Partial<Show> = {}): Show => ({
  id: 'jambase:1', startsAt: '2026-10-16T20:00:00-04:00', doorsAt: '2026-10-16T19:00:00-04:00',
  venue: { name: 'Parkside Hall', neighborhood: 'Williamsburg', area: 'Brooklyn', metro: 'nyc', lat: 40.71, lng: -73.96, city: 'Brooklyn, NY', addressVisibility: 'public', address: '100 Example Ave' },
  acts: [{ name: 'Velvet Automaton', order: 0 }, { name: 'Gentle Moth', order: 1 }], genres: ['Indie Rock'], price: { min: 20, max: 25 },
  flyerImages: ['https://tm.example/img.jpg'], flyerCredit: 'TICKETMASTER', ticketUrl: 'https://ticketmaster.example/e/1', fieldSources: { price: 'ticketmaster', image: 'ticketmaster', ticketUrl: 'ticketmaster' },
  status: 'scheduled', source: { provider: 'jambase', url: 'https://jambase.example/1', fetchedAt: '2026-10-01T00:00:00Z' }, updatedAt: '2026-10-01T00:00:00Z', ...o,
});
const row = (o: Partial<FpRow> = {}): FpRow => ({
  id: 'r1', metro: 'nyc', venueId: 'v1', venueName: 'Parkside Hall', city: 'Brooklyn', address: '100 Example Ave, Brooklyn, NY', addressMode: 'registry', localDate: '2026-10-16', startLocal: '20:00', doorsLocal: '19:00',
  startsAt: '2026-10-16T20:00:00-04:00', doorsAt: '2026-10-16T19:00:00-04:00', lat: 40.71, lng: -73.96, headliner: 'Velvet Automaton', supports: ['Gentle Moth', 'Tin Orchard'], price: { min: 15, max: 18 }, ticketUrl: 'https://parksidehall.example/velvet', status: 'scheduled', genres: ['Indie Rock'], agePolicy: 'All ages', imageUrl: 'https://parksidehall.example/velvet.jpg',
  conflicts: [], sources: [{ sourceType: 'venue_site', licence: 'first_party', url: 'https://parksidehall.example/events', fetchedAt: '2026-10-02T00:00:00Z' }], unconfirmed: false, pending: false, author: null, ...o,
});

describe('one card per show', () => {
  it('merges a venue-site row with a licensed show, keeping the licensed id and field sources', () => {
    const out = mergeFirstParty([lic()], [row()], 'nyc');
    assert.equal(out.length, 1);
    const s = out[0];
    assert.equal(s.id, 'jambase:1');
    assert.deepEqual(s.acts.map((a) => a.name), ['Velvet Automaton', 'Gentle Moth', 'Tin Orchard']);
    // price and ticket link: Ticketmaster outranks the venue site by the fixed priority; image: venue site first
    assert.equal(s.price.min, 20);
    assert.equal(s.ticketUrl, 'https://ticketmaster.example/e/1');
    assert.equal(s.flyerImages?.[0], 'https://parksidehall.example/velvet.jpg');
    assert.equal(s.flyerCredit, 'Parkside Hall');
    assert.equal(s.provenance?.fieldSource.price, 'ticketmaster');
    assert.match(sourcesNote(s)!, /Venue's website/);
    assert.match(sourcesNote(s)!, /Ticketmaster/);
    assert.equal(ticketLabel(s), 'Tickets on Ticketmaster');
    // price disagreement is flagged, not hidden
    assert.ok(conflictNotes(s).some((t) => /price/.test(t)));
  });
  it('turning Ticketmaster photo off falls back without it', () => {
    const only = applySwitchesToAll([lic()], { ...sw, ticketmaster_photo: false, ticketmaster_price: false, ticketmaster_link: false });
    const out = mergeFirstParty(only, [row({ imageUrl: null })], 'nyc');
    assert.equal(out[0].flyerImages, undefined);
    assert.equal(out[0].price.min, 15);
    assert.equal(out[0].ticketUrl, 'https://parksidehall.example/velvet');
  });
  it('JamBase listings switched off leave only the first-party card', () => {
    const none = applySwitchesToAll([lic()], { ...sw, jambase_listings: false });
    const out = mergeFirstParty(none, [row()], 'nyc');
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'fp:r1');
    assert.equal(out[0].provenance?.fpId, 'r1');
  });
  it('a different night or venue stays a separate card', () => {
    const out = mergeFirstParty([lic()], [row({ localDate: '2026-10-17', startsAt: '2026-10-17T20:00:00-04:00' })], 'nyc');
    assert.equal(out.length, 2);
    assert.ok(out.some((s) => s.id === 'fp:r1'));
  });
  it('a flyer-only row has no address unless the registry gave one, and keeps its pending flag', () => {
    const [s] = mergeFirstParty([], [row({ sources: [{ sourceType: 'flyer', licence: 'first_party' }], addressMode: 'withheld', address: null, venueId: null, pending: true, imageUrl: null })], 'nyc');
    assert.equal(s.venue.address, undefined);
    assert.equal(s.venue.addressVisibility, 'on_request');
    assert.equal(s.provenance?.pending, true);
    assert.match(sourcesNote(s)!, /Shared flyer/);
  });
  it('licensed candidates split Ticketmaster fields into their own record', () => {
    const c = licensedCandidates(lic(), 'nyc');
    assert.deepEqual(c.map((x) => x.sourceType), ['jambase', 'ticketmaster']);
    assert.equal(c[0].price, undefined);
    assert.equal(c[1].price?.min, 20);
    assert.deepEqual(licensedCandidates(lic({ source: { provider: 'community', url: '', fetchedAt: '' } }), 'nyc'), []);
  });
  it('drops malformed rows', () => {
    assert.equal(parseFpRows([{ id: 'x' }, null, 5, { ...row(), startsAt: 'tomorrow' }, row()]).length, 1);
    assert.deepEqual(parseFpRows('nope'), []);
  });
});

describe('Submitted tab rows and the thank-you text', () => {
  const show = (visibility: 'public' | 'pending' | 'removed', id = 's1') => ({ id, headliner: 'Velvet Automaton', localDate: '2026-10-16', visibility, venueName: 'Parkside Hall', startLocal: '20:00' });
  const job = (over: Partial<Job>): Job => ({ id: 'j1', status: 'done', result: 'pending', reason: 'needs_confirmation', createdAt: '2026-10-04T12:00:00Z', finishedAt: null, notified: false, shows: [], ...over });

  it('labels each flyer: reading, verified, awaiting confirmation, removed, not listed', () => {
    const rows = submittedRows([
      job({ id: 'a', status: 'processing', result: 'processing' }),
      job({ id: 'b', result: 'published', reason: null, shows: [show('public', 'b1')] }),
      job({ id: 'c', shows: [show('pending', 'c1')] }),
      job({ id: 'd', shows: [show('removed', 'd1')] }),
      job({ id: 'e', result: 'rejected', reason: 'past_date', shows: [] }),
    ]);
    assert.deepEqual(rows.map((r) => r.label), ['Reading', 'Verified', 'Awaiting confirmation', 'Removed', 'Not listed']);
    assert.equal(rows[1].when, 'Parkside Hall · Fri, Oct 16');
    assert.match(rows[4].detail, /passed/);
    assert.equal(new Set(rows.map((r) => r.key)).size, 5);
  });

  it('a pending flyer that another person confirmed later shows as verified, and no longer as waiting', () => {
    const j = job({ shows: [show('public')] });
    assert.equal(submittedRows([j])[0].label, 'Verified');
    assert.equal(submittedRows([j])[0].detail, 'Confirmed. It is on the deck for everyone.');
    assert.equal(viewJob(j).tone, 'live');
  });

  it('one flyer with several shows gives one row per show', () => {
    const rows = submittedRows([job({ result: 'published', shows: [show('public', 'x'), show('pending', 'y')] })]);
    assert.deepEqual(rows.map((r) => [r.showId, r.state]), [['x', 'verified'], ['y', 'waiting']]);
  });

  it('formats dates without shifting the day and states the confirmation rules', () => {
    assert.equal(dayLabel('2026-10-16'), 'Fri, Oct 16');
    assert.match(THANKS_BODY, /received.*reviewed to be added to the listings/);
    assert.match(CONFIRMATION_RULES, /another person shares the same show/);
  });
});
