/// <reference types="node" />
/** "Send to a friend": the message text, and that nothing but text is handed to the share sheet. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { APP_NAME, APP_SHARE_URL } from '../src/lib/legal';
import { formatGoing, shareMessage, shareOutcome } from '../src/lib/shareText';
import type { Show } from '../src/lib/types';

const show = (over: Partial<Show> = {}, acts: string[] = ['Velvet Automaton', 'Hex Kitchen', 'Dust Choir']): Show =>
  ({
    id: 'jb-1',
    startsAt: '2026-10-17T20:00:00-04:00',
    venue: { name: 'Elsewhere', city: 'Brooklyn, NY', area: 'Brooklyn', neighborhood: 'Bushwick', metro: 'nyc', addressVisibility: 'public' },
    acts: acts.map((name, order) => ({ name, order })),
    genres: [],
    price: {},
    status: 'scheduled',
    source: { provider: 'jambase', url: '', fetchedAt: '' },
    updatedAt: '',
    ...over,
  }) as Show;

const FOOT = `Found on ${APP_NAME}: ${APP_SHARE_URL}`;

describe('share message', () => {
  it('has every field, one fact per line, with the app link last', () => {
    const m = shareMessage(show({ ticketUrl: 'https://tix.example/1' }), 23);
    assert.deepEqual(m.split('\n'), [
      'Velvet Automaton with Hex Kitchen, Dust Choir',
      'Elsewhere, Brooklyn, NY',
      'Sat, Oct 17 · 8 PM',
      '23 going',
      'https://tix.example/1',
      FOOT,
    ]);
  });
  it('omits the time when the listing has none', () => {
    const m = shareMessage(show({ timeTba: true }));
    assert.ok(m.includes('Sat, Oct 17\n'));
    assert.ok(!m.includes('·'));
  });
  it('omits the ticket line when there is no ticket link', () => {
    const lines = shareMessage(show()).split('\n');
    assert.equal(lines.length, 4);
    assert.equal(lines[3], FOOT);
  });
  it('shows N going only when a count is being displayed', () => {
    assert.ok(!/going/.test(shareMessage(show())));
    assert.ok(!/going/.test(shareMessage(show(), null)));
    assert.ok(!/going/.test(shareMessage(show(), 0)));
    assert.ok(shareMessage(show(), 16).includes('\n16 going\n'));
  });
  it('lists at most two supporting acts and a headliner alone when there are none', () => {
    const many = shareMessage(show({}, ['A', 'B', 'C', 'D', 'E'])).split('\n')[0];
    assert.equal(many, 'A with B, C');
    assert.equal(shareMessage(show({}, ['Solo'])).split('\n')[0], 'Solo');
  });
  it('keeps long names short: the text before the links stays under about 300 characters', () => {
    const long = 'X'.repeat(200);
    const m = shareMessage(
      show({ venue: { name: long, city: long, area: '', neighborhood: '', metro: 'nyc', addressVisibility: 'public' } }, [long, long, long]),
      40,
    );
    const before = m.split('\n').slice(0, -1).join('\n');
    assert.ok(before.length < 300, `was ${before.length}`);
  });
  it('keeps French and other accented characters intact', () => {
    const m = shareMessage(show({ venue: { name: 'Café de la Danse', city: 'Montréal, QC', area: '', neighborhood: '', metro: 'nyc', addressVisibility: 'public' } }, ['Les Chaînes Éternelles', 'Ça Ira', 'Ñandú']));
    assert.ok(m.includes('Les Chaînes Éternelles with Ça Ira, Ñandú'));
    assert.ok(m.includes('Café de la Danse, Montréal, QC'));
  });
  it('uses the venue-local day and time near midnight, whatever zone the phone is in', () => {
    // A phone in New York (the test zone) reading a Los Angeles show at 11:30 PM Saturday.
    assert.ok(shareMessage(show({ startsAt: '2026-10-17T23:30:00-07:00' })).includes('Sat, Oct 17 · 11:30 PM'));
    assert.ok(shareMessage(show({ startsAt: '2026-10-18T00:15:00-07:00' })).includes('Sun, Oct 18 · 12:15 AM'));
  });
  it('is not shifted by daylight saving: the clock on the venue wall is what is shown', () => {
    // New York ends DST on 2026-11-01 at 2 AM. 1:30 AM exists twice; 8 PM after is on standard time.
    assert.ok(shareMessage(show({ startsAt: '2026-11-01T01:30:00-04:00' })).includes('Sun, Nov 1 · 1:30 AM'));
    assert.ok(shareMessage(show({ startsAt: '2026-11-01T20:00:00-05:00' })).includes('Sun, Nov 1 · 8 PM'));
    assert.ok(shareMessage(show({ startsAt: '2026-03-08T20:00:00-04:00' })).includes('Sun, Mar 8 · 8 PM'));
  });
  it('falls back to the event title when there are no acts', () => {
    assert.equal(shareMessage(show({ title: 'Open Mic Night' }, [])).split('\n')[0], 'Open Mic Night');
  });
});

describe('going chip text', () => {
  it('reads "N going"', () => {
    assert.equal(formatGoing(16), '16 going');
    assert.equal(formatGoing(1204), '1204 going');
  });
});

describe('share sheet payload and result', () => {
  it('hands the share sheet text only: no image, file or url field', () => {
    const src = readFileSync(new URL('../src/lib/share.ts', import.meta.url), 'utf8');
    const calls = [...src.matchAll(/Share\.share\((\{[^}]*\})\)/g)];
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].replace(/\s/g, ''), '{message:shareMessage(show,going)}');
    assert.ok(!/image|file|expo-sharing|url:/i.test(calls[0][1]));
  });
  it('the message itself contains no data or file URLs', () => {
    const m = shareMessage(show({ ticketUrl: 'https://tix.example/1', flyerImages: ['https://img.example/a.jpg'] }), 20);
    assert.ok(!m.includes('img.example'));
    assert.ok(!/data:|file:/.test(m));
  });
  it('reports completion only when the OS says so', () => {
    assert.deepEqual(shareOutcome({ action: 'sharedAction' }), {}); // Android: no completion is reported
    assert.deepEqual(shareOutcome({ action: 'sharedAction', activityType: 'com.x' }), { completed: true });
    assert.deepEqual(shareOutcome({ action: 'dismissedAction' }), { completed: false });
    assert.deepEqual(shareOutcome(null), {});
  });
});
