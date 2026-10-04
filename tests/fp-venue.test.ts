import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateVenue, isOwnDomain, shouldDisable, type VenueChecks } from '../supabase/functions/_shared/approval.ts';
import { clip, extractIcal, extractJsonLd, extractRss, extractWidgetJson, htmlToText, rawToCandidate, sha256Hex, toLocal } from '../supabase/functions/_shared/extract.ts';
import { parseModelOutput, parseVenueOutput } from '../supabase/functions/_shared/flyerSchema.ts';
import { isAllowed, parseRobots, robotsFromStatus } from '../supabase/functions/_shared/robots.ts';
import { validateVenuePage } from '../supabase/functions/_shared/validate.ts';
import { assignWaves, decideWidening, planScan, type MetroSetting } from '../supabase/functions/_shared/waves.ts';
import { ev, f, METROS, NOW, resp, vev, vresp } from './fixtures/flyers.ts';

const venue = { id: 'v-parkside', name: 'Parkside Hall', metro: 'nyc', address: '100 Example Ave, Brooklyn, NY' };
const nyc = METROS[0];
const BASE = 'https://parksidehall.example/events';

const LD = `<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"MusicEvent","name":"Parkside Hall presents: Velvet Automaton","startDate":"2026-10-16T20:00:00-04:00","doorTime":"2026-10-16T19:00:00-04:00",
  "performer":[{"@type":"MusicGroup","name":"Velvet Automaton"},{"@type":"MusicGroup","name":"Gentle Moth"}],
  "offers":{"@type":"Offer","price":"20","url":"/t/velvet"},"image":"/img/v.jpg","url":"/e/velvet","eventStatus":"https://schema.org/EventScheduled"},
 {"@type":"Event","name":"Old Show","startDate":"2026-09-01T20:00:00-04:00"},
 {"@type":"Organization","name":"Parkside"}]}
</script><script type="application/ld+json">{ broken json</script></head><body></body></html>`;

describe('extraction tiers', () => {
  it('JSON-LD: reads events from @graph, skips broken blocks and non-events', () => {
    const raw = extractJsonLd(LD, BASE);
    assert.equal(raw.length, 2);
    assert.deepEqual(raw[0].performers, ['Velvet Automaton', 'Gentle Moth']);
    assert.equal(raw[0].ticketUrl, 'https://parksidehall.example/t/velvet');
    assert.deepEqual(raw[0].price, { min: 20, max: 20 });
    const ok = rawToCandidate(raw[0], venue, nyc, NOW, 'jsonld', BASE);
    assert.ok('candidate' in ok);
    if ('candidate' in ok) {
      assert.equal(ok.candidate.localDate, '2026-10-16');
      assert.equal(ok.candidate.startLocal, '20:00');
      assert.equal(ok.candidate.doorsLocal, '19:00');
      assert.equal(ok.candidate.headliner, 'Velvet Automaton');
      assert.equal(ok.candidate.title, undefined); // the "presents" name is just the act
      assert.equal(ok.candidate.address, venue.address);
      assert.equal(ok.candidate.imageUrl, 'https://parksidehall.example/img/v.jpg');
    }
    assert.deepEqual(rawToCandidate(raw[1], venue, nyc, NOW, 'jsonld', BASE), { reject: 'past' });
  });

  it('iCal: reads UTC, zoned and all-day events and cancelled status', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Tin Orchard', 'DTSTART:20261017T003000Z', 'URL:https://parksidehall.example/e/tin', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Salt Lick', 'DTSTART;TZID=America/Chicago:20261018T200000', 'STATUS:CANCELLED', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Day Fest', 'DTSTART;VALUE=DATE:20261020', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const raw = extractIcal(ics, BASE);
    assert.equal(raw.length, 3);
    assert.deepEqual(toLocal(raw[0].start, 'America/New_York'), { date: '2026-10-16', time: '20:30' }); // 00:30Z is 20:30 the evening before in New York
    assert.deepEqual(toLocal(raw[1].start, 'America/New_York'), { date: '2026-10-18', time: '21:00' }); // Chicago 20:00 is 21:00 in New York
    assert.equal(raw[1].status, 'cancelled');
    assert.deepEqual(toLocal(raw[2].start, 'America/New_York'), { date: '2026-10-20' });
  });

  it('RSS: reads items with an events-namespace start date and ignores plain posts', () => {
    const xml = `<rss><channel><item><title>Honey Radio</title><link>/e/honey</link><ev:startdate>2026-10-22T20:00:00</ev:startdate></item><item><title>News post</title><link>/n</link></item></channel></rss>`;
    const raw = extractRss(xml, BASE);
    assert.equal(raw.length, 1);
    assert.equal(raw[0].url, 'https://parksidehall.example/e/honey');
  });

  it("calendar widget JSON: The Events Calendar and Squarespace payloads from the venue's own domain", () => {
    const tribe = { events: [{ title: 'Paper Lanterns', start_date: '2026-10-23 20:00:00', url: '/e/pl', cost: '$12', image: { url: '/i.jpg' } }] };
    const raw = extractWidgetJson(tribe, BASE);
    assert.equal(raw[0].start, '2026-10-23T20:00:00');
    assert.deepEqual(raw[0].price, { min: 12, max: 12 });
    const sq = { upcoming: [{ title: 'Night Owls', startDate: Date.parse('2026-10-24T00:00:00Z'), fullUrl: '/e/no' }] };
    assert.equal(extractWidgetJson(sq, BASE).length, 1);
    assert.deepEqual(extractWidgetJson('nope', BASE), []);
  });

  it('page text for the model: strips scripts, navigation and tags, and hashes stably', async () => {
    const html = `<nav>Home About</nav><script>var x=1</script><h1>Events</h1><div>Fri Oct 16 — Velvet &amp; Co</div><footer>© 2026</footer>`;
    const t = htmlToText(html);
    assert.ok(!/Home|var x|©/.test(t), t);
    assert.ok(t.includes('Velvet & Co'));
    assert.equal(await sha256Hex(t), await sha256Hex(htmlToText(html)));
    assert.notEqual(await sha256Hex(t), await sha256Hex(t + ' changed'));
    assert.ok(clip('x'.repeat(50000)).length <= 24000);
  });

  it('model tier: validates dates, checks weekday, and publishes passing events with the venue fixed', () => {
    const page = 'Fri Oct 16 Velvet Automaton 8pm\nSat Oct 17 Salt Lick Division 9pm\nSat Oct 18 Wrong Day 9pm';
    const parsed = parseVenueOutput(vresp([
      vev({ headliner: 'Velvet Automaton', date: 'Fri Oct 16', start: '8pm', evidence: 'Fri Oct 16 Velvet Automaton 8pm' }),
      vev({ headliner: 'Salt Lick Division', date: 'Sat Oct 17', evidence: 'Sat Oct 17 Salt Lick Division 9pm' }),
      vev({ headliner: 'Wrong Day', date: 'Sat Oct 18', weekday: 'Sat', evidence: 'Sat Oct 18 Wrong Day 9pm' }),
    ]), page);
    const r = validateVenuePage(parsed, venue, nyc, NOW, BASE);
    assert.deepEqual(r.candidates.map((c) => c.localDate), ['2026-10-16', '2026-10-17']);
    assert.deepEqual(r.rejects.map((x) => x.reason), ['weekday_mismatch']);
    assert.equal(r.candidates[0].venueId, 'v-parkside');
    assert.equal(r.candidates[0].sourceType, 'venue_site');
  });
});

describe('venue page answers', () => {
  const page = 'Fri Oct 16 Velvet Automaton 8pm $15\nSat Oct 17 Salt Lick Division 9pm';
  it('drops events whose headliner or evidence is not on the page, and printed values that are not on the page', () => {
    const p = parseVenueOutput(vresp([
      vev({ headliner: 'Velvet Automaton', date: 'Fri Oct 16', start: '8pm', price: '$99', evidence: 'Fri Oct 16 Velvet Automaton 8pm' }),
      vev({ headliner: 'Invented Band', date: 'Fri Oct 16', evidence: 'Fri Oct 16 Invented Band' }),
      vev({ headliner: 'Salt Lick Division', date: 'Sat Oct 17', evidence: 'a quote that is not on the page' }),
    ]), page);
    assert.equal(p.events.length, 1);
    assert.equal(p.events[0].fields.start?.value, '8pm');
    assert.equal(p.events[0].fields.price, undefined); // "$99" is not printed on the page
  });
  it('does not need an is_flyer flag, and treats unreadable or unsafe answers as no events', () => {
    assert.equal(parseVenueOutput({ is_safe: true, events: [vev({ headliner: 'Velvet Automaton', date: 'Fri Oct 16' })] }, page).isFlyer, true);
    assert.deepEqual(parseVenueOutput(null, page).events, []);
    assert.deepEqual(parseVenueOutput('{ truncated', page).events, []);
    assert.deepEqual(parseVenueOutput({ is_safe: false, events: [vev({ headliner: 'Velvet Automaton', date: 'Fri Oct 16' })] }, page).events, []);
  });
});

describe('polite fetching', () => {
  const ua = 'PullUpBot/1.0 (+https://example.test/bot)';
  it('follows robots.txt: our own group, the wildcard group, longest match, Allow ties, wildcards', () => {
    const txt = `User-agent: *\nDisallow: /private/\nAllow: /private/events\nDisallow: /*.pdf$\nCrawl-delay: 5\n\nUser-agent: pulluptbot-other\nDisallow: /\n`;
    const r = parseRobots(txt, ua);
    assert.equal(isAllowed(r, '/events'), true);
    assert.equal(isAllowed(r, '/private/x'), false);
    assert.equal(isAllowed(r, '/private/events/2026'), true);
    assert.equal(isAllowed(r, '/menu.pdf'), false);
    assert.equal(r.crawlDelaySec, 5);
    const ours = parseRobots(`User-agent: PullUpBot\nDisallow: /\n\nUser-agent: *\nAllow: /`, ua);
    assert.equal(isAllowed(ours, '/events'), false);
    assert.equal(isAllowed(parseRobots('', ua), '/anything'), true);
    assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:', ua), '/x'), true);
  });

  it('treats a missing robots.txt as allowed and an error or login wall as not allowed', () => {
    assert.equal(robotsFromStatus(404), 'allow_all');
    assert.equal(robotsFromStatus(200), 'parse');
    assert.equal(robotsFromStatus(403), 'deny_all');
    assert.equal(robotsFromStatus(503), 'deny_all');
  });
});

describe('automatic venue approval', () => {
  const good: VenueChecks = { website: 'https://parksidehall.example', robots: 'ok', nameMatches: true, insideMetro: true, structuredEvents: 0, aiEventsWithEvidence: 2, venueTypeOk: true };

  it('approves structured venues as tier A and model-read venues as tier B', () => {
    assert.deepEqual(evaluateVenue({ ...good, structuredEvents: 3 }), { decision: 'approved', tier: 'A', reasons: [] });
    assert.deepEqual(evaluateVenue(good), { decision: 'approved', tier: 'B', reasons: [] });
  });

  it('rejects with reasons: not own domain, robots, bot wall, name, outside metro, venue type', () => {
    assert.deepEqual(evaluateVenue({ ...good, website: 'https://www.facebook.com/parkside' }).reasons, ['not_own_domain']);
    assert.deepEqual(evaluateVenue({ ...good, website: 'https://www.songkick.com/venues/1' }).reasons, ['not_own_domain']);
    assert.deepEqual(evaluateVenue({ ...good, robots: 'disallowed' }).reasons, ['robots_disallow']);
    assert.deepEqual(evaluateVenue({ ...good, robots: 'bot_wall' }).reasons, ['bot_wall']);
    assert.deepEqual(evaluateVenue({ ...good, nameMatches: false }).reasons, ['name_mismatch']);
    assert.deepEqual(evaluateVenue({ ...good, insideMetro: false }).reasons, ['outside_metro']);
    assert.deepEqual(evaluateVenue({ ...good, venueTypeOk: false }).reasons, ['venue_type']);
    assert.equal(evaluateVenue({ ...good, nameMatches: false, robots: 'disallowed' }).reasons.length, 2);
  });

  it('quarantines when nothing valid was found or the address cannot be checked', () => {
    assert.deepEqual(evaluateVenue({ ...good, aiEventsWithEvidence: 0 }), { decision: 'quarantined', tier: 'C', reasons: ['no_valid_events_in_trial'] });
    assert.deepEqual(evaluateVenue({ ...good, insideMetro: null }).reasons, ['address_unverified']);
  });

  it('recognises own domains', () => {
    assert.equal(isOwnDomain('https://parksidehall.example'), true);
    assert.equal(isOwnDomain('https://m.facebook.com/x'), false);
    assert.equal(isOwnDomain('https://dice.fm/venue/x'), false);
    assert.equal(isOwnDomain('not a url'), false);
  });
});

describe('automatic disabling', () => {
  const ok = { fetchOk: true, extracted: 10, rejected: 0 };
  it('disables on robots, bot wall and takedown immediately', () => {
    assert.equal(shouldDisable({ recent: [ok], robots: 'disallowed', takedown: false }), 'robots_disallow');
    assert.equal(shouldDisable({ recent: [ok], robots: 'bot_wall', takedown: false }), 'bot_wall');
    assert.equal(shouldDisable({ recent: [ok], robots: 'ok', takedown: true }), 'takedown');
  });
  it('disables after 3 failed fetches in a row, not after 2', () => {
    const bad = { fetchOk: false, extracted: 0, rejected: 0 };
    assert.equal(shouldDisable({ recent: [bad, bad, bad], robots: 'ok', takedown: false }), 'fetch_errors');
    assert.equal(shouldDisable({ recent: [bad, bad, ok], robots: 'ok', takedown: false }), null);
  });
  it('disables when 40% of what was read over the last 5 runs failed validation', () => {
    const r = (e: number, x: number) => ({ fetchOk: true, extracted: e, rejected: x });
    assert.equal(shouldDisable({ recent: [r(5, 2), r(5, 2), r(5, 2), r(5, 2), r(5, 2)], robots: 'ok', takedown: false }), 'validator_rejections');
    assert.equal(shouldDisable({ recent: [r(5, 1), r(5, 1), r(5, 1), r(5, 1), r(5, 1)], robots: 'ok', takedown: false }), null);
    assert.equal(shouldDisable({ recent: [r(5, 5), r(5, 5)], robots: 'ok', takedown: false }), null); // too few runs to judge
  });
});

describe('waves and scheduling', () => {
  const metros = [
    { id: 'nyc', hot: true }, { id: 'la', hot: true }, { id: 'atl', hot: false }, { id: 'aus', hot: false }, { id: 'bos2', hot: false }, { id: 'tiny', hot: false },
  ];
  it('wave 1 is the hot metros; wave 2 is the next largest by show volume; the rest are wave 3', () => {
    assert.deepEqual(assignWaves(metros, { atl: 50, aus: 90, bos2: 10, tiny: 1 }, 2), { nyc: 1, la: 1, aus: 2, atl: 2, bos2: 3, tiny: 3 });
  });

  const setting = (id: string, wave: 1 | 2 | 3, last: string | null, enabled = true): MetroSetting => ({ id, wave, venueScanEnabled: enabled, dailyRequestBudget: 10, lastFullScanAt: last });
  const now = new Date('2026-10-10T12:00:00Z');
  const quiet = [0.4, 0.5, 0.3, 0.6, 0.5, 0.4, 0.2];

  it('widens only when earlier waves were fully scanned in time and quota stayed under headroom for 7 days', () => {
    const settings = [setting('nyc', 1, '2026-10-06T00:00:00Z'), setting('la', 1, '2026-10-08T00:00:00Z')];
    const base = { currentWave: 1 as const, settings, now, refreshDays: 7, dailyUsageShare: quiet, headroom: 0.7 };
    assert.deepEqual(decideWidening(base).widen, true);
    assert.equal(decideWidening(base).nextWave, 2);
    assert.equal(decideWidening({ ...base, settings: [setting('nyc', 1, '2026-09-20T00:00:00Z')] }).widen, false);
    assert.equal(decideWidening({ ...base, dailyUsageShare: [0.4, 0.8, 0.3, 0.6, 0.5, 0.4, 0.2] }).widen, false);
    assert.equal(decideWidening({ ...base, dailyUsageShare: [0.4, 0.5] }).widen, false);
    assert.ok(decideWidening({ ...base, dailyUsageShare: [0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] }).reasons[0].includes('70%'));
  });

  it('a metro switched off by hand does not hold back widening', () => {
    const settings = [setting('nyc', 1, '2026-10-06T00:00:00Z'), setting('la', 1, '2026-08-01T00:00:00Z')];
    const base = { currentWave: 1 as const, settings, now, refreshDays: 7, dailyUsageShare: quiet, headroom: 0.7 };
    assert.equal(decideWidening(base).widen, false);
    assert.equal(decideWidening({ ...base, offFlags: new Set(['la']) }).widen, true);
    assert.equal(decideWidening({ ...base, currentWave: 3 }).widen, false);
  });

  it('plans scans: skips disabled metros, runs the most overdue first and keeps model requests inside each metro budget', () => {
    const settings = [setting('nyc', 1, null), { ...setting('la', 1, null, false) }, { ...setting('chi', 1, null), dailyRequestBudget: 1 }];
    const v = (id: string, metro: string, tier: 'A' | 'B', last: string | null, status = 'approved') => ({ id, metro, tier, lastCheckedAt: last, status });
    const plan = planScan([
      v('a', 'nyc', 'A', '2026-09-30T00:00:00Z'), v('b', 'nyc', 'B', '2026-10-01T00:00:00Z'), v('c', 'la', 'A', null), v('d', 'chi', 'B', '2026-09-20T00:00:00Z'),
      v('e', 'chi', 'B', '2026-09-25T00:00:00Z'), v('f', 'nyc', 'A', '2026-10-09T00:00:00Z'), v('g', 'nyc', 'A', null, 'disabled'),
    ], settings, now, 7);
    assert.deepEqual(plan.venues.map((x) => x.id), ['d', 'a', 'b']);
    assert.equal(plan.skippedForBudget, 1); // 'e' waits: chi's budget is 1 model request per day
    assert.deepEqual(plan.aiUsed, { chi: 1, nyc: 1 });
  });
});

import { coverageReport, weeklySummary } from '../supabase/functions/_shared/coverage.ts';

describe('coverage report', () => {
  it('counts venues by status and tier, scans inside the window, and shows by source', () => {
    const venues = [
      { id: '1', metro: 'nyc', tier: 'A' as const, status: 'approved' as const, lastCheckedAt: '2026-10-08T00:00:00Z' },
      { id: '2', metro: 'nyc', tier: 'B' as const, status: 'approved' as const, lastCheckedAt: '2026-09-01T00:00:00Z' },
      { id: '3', metro: 'nyc', tier: 'C' as const, status: 'quarantined' as const },
      { id: '4', metro: 'nyc', status: 'rejected' as const },
      { id: '5', metro: 'la', tier: 'A' as const, status: 'disabled' as const },
    ];
    const shows = [{ metro: 'nyc', sources: ['venue_site', 'flyer'] }, { metro: 'nyc', sources: ['flyer'] }, { metro: 'la', sources: ['venue_site'] }];
    const [nyc, la] = coverageReport(['nyc', 'la'], venues, shows, new Date('2026-10-10T00:00:00Z'), 7);
    assert.deepEqual([nyc.venuesTotal, nyc.approvedA, nyc.approvedB, nyc.quarantined, nyc.rejected, nyc.scannedInWindow, nyc.upcomingShows], [4, 1, 1, 1, 1, 1, 2]);
    assert.deepEqual(nyc.showsBySource, { venue_site: 1, flyer: 2 });
    assert.equal(la.disabled, 1);
  });

  it('writes the weekly summary in plain language', () => {
    const cov = coverageReport(['nyc'], [{ id: '1', metro: 'nyc', tier: 'A', status: 'approved', lastCheckedAt: '2026-10-08T00:00:00Z' }], [{ metro: 'nyc', sources: ['venue_site'] }], new Date('2026-10-10T00:00:00Z'), 7);
    const text = weeklySummary({ coverage: cov, newlyDisabled: [{ venue: 'Rust Belt Room', reason: 'bot_wall' }], topRejections: [{ reason: 'weekday_mismatch', count: 4 }], quotaShare: [0.4, 0.6], wideningDecisions: ['Stayed on wave 1: only 2 of 7 days recorded.'], flyers: { received: 5, published: 2, pending: 2, rejected: 1 } });
    assert.ok(text.includes('1 venues are being read automatically'));
    assert.ok(text.includes('Rust Belt Room (bot_wall)'));
    assert.ok(text.includes('average 50%'));
    assert.ok(text.includes('weekday_mismatch (4)'));
  });
});
