/// <reference types="node" />
/**
 * Logic tests that run without a phone: `npm test`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SHOWS } from '../src/data/shows';
import { chooseArtist, isCollaboration, namesMatch, normalizeName } from '../src/lib/deezer';
import { buildQueue, inWhen, matchesFilters } from '../src/lib/filters';
import { planReminders } from '../src/lib/reminderPlan';
import { DEFAULT_FILTERS, DEFAULT_REMINDER_PREFS, type Show } from '../src/lib/types';

const byId = (id: string) => {
  const s = SHOWS.find((x) => x.id === id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};

describe('sample data', () => {
  it('has unique ids and valid dates', () => {
    const ids = new Set(SHOWS.map((s) => s.id));
    assert.equal(ids.size, SHOWS.length);
    for (const s of SHOWS) assert.ok(!Number.isNaN(new Date(s.startsAt).getTime()), s.id);
  });

  it('uses the right New York offset either side of Nov 1', () => {
    const oct = SHOWS.find((s) => s.startsAt.startsWith('2026-10-31'))!;
    const nov = SHOWS.find((s) => s.startsAt.startsWith('2026-11-05'))!;
    assert.ok(oct.startsAt.endsWith('-04:00'));
    assert.ok(nov.startsAt.endsWith('-05:00'));
  });
});

describe('filters', () => {
  // Tue Sep 29 2026, 9 PM New York
  const now = new Date('2026-09-29T21:00:00-04:00');

  it('next 7 days covers Oct 1 to Oct 5 from Sep 29', () => {
    const q = buildQueue(SHOWS, DEFAULT_FILTERS, {}, now);
    assert.ok(q.length > 20);
    for (const s of q) assert.ok(s.startsAt < '2026-10-06', s.id);
    // soonest first
    for (let i = 1; i < q.length; i++) assert.ok(new Date(q[i - 1].startsAt) <= new Date(q[i].startsAt));
  });

  it('this weekend on a Tuesday means Fri–Sun', () => {
    const fri = byId(SHOWS.find((s) => s.startsAt.startsWith('2026-10-02'))!.id);
    const thu = byId(SHOWS.find((s) => s.startsAt.startsWith('2026-10-01'))!.id);
    assert.equal(inWhen(fri, 'weekend', now), true);
    assert.equal(inWhen(thu, 'weekend', now), false);
  });

  it('a 1 AM set still counts as tonight', () => {
    const late = { ...SHOWS[0], startsAt: '2026-09-30T01:00:00-04:00' } as Show;
    assert.equal(inWhen(late, 'tonight', now), true);
  });

  it('decided shows leave the deck', () => {
    const q = buildQueue(SHOWS, DEFAULT_FILTERS, {}, now);
    const q2 = buildQueue(SHOWS, DEFAULT_FILTERS, { [q[0].id]: 'going', [q[1].id]: 'passed' }, now);
    assert.equal(q2.length, q.length - 2);
    assert.ok(!q2.some((s) => s.id === q[0].id || s.id === q[1].id));
  });

  it('keeps the pinned card on top after a filter change', () => {
    const later = SHOWS.find((s) => s.startsAt.startsWith('2026-10-05'))!;
    const q = buildQueue(SHOWS, DEFAULT_FILTERS, {}, now, later.id);
    assert.equal(q[0].id, later.id);
  });

  it('unknown prices and ages only pass under Any', () => {
    const unknown = SHOWS.find((s) => !s.price.isFree && s.price.min == null && s.agePolicy === 'unknown')!;
    assert.equal(matchesFilters(unknown, { ...DEFAULT_FILTERS, when: 'all', price: 'under10' }, now), false);
    assert.equal(matchesFilters(unknown, { ...DEFAULT_FILTERS, when: 'all', age: 'all_ages' }, now), false);
    assert.equal(matchesFilters(unknown, { ...DEFAULT_FILTERS, when: 'all' }, now), true);
  });

  it('area and genre filters narrow the deck', () => {
    const q = buildQueue(SHOWS, { ...DEFAULT_FILTERS, when: 'all', areas: ['Queens'], genres: ['Metal'] }, {}, now);
    assert.ok(q.length > 0);
    for (const s of q) {
      assert.equal(s.venue.area, 'Queens');
      assert.ok(s.genres.includes('Metal'));
    }
  });

  it('past shows drop out of the deck three hours after start', () => {
    const s = SHOWS[0];
    const after = new Date(new Date(s.startsAt).getTime() + 3.5 * 3600_000);
    assert.equal(matchesFilters(s, { ...DEFAULT_FILTERS, when: 'all' }, after), false);
  });
});

describe('reminders', () => {
  const show = SHOWS.find((s) => s.startsAt === '2026-10-05T18:00:00-04:00')!; // Krallice, Saint Vitus

  it('plans noon day-of and one hour before doors by default', () => {
    const r = planReminders(show, DEFAULT_REMINDER_PREFS, new Date('2026-10-01T10:00:00-04:00'));
    assert.deepEqual(
      r.map((x) => x.kind),
      ['dayOf', 'beforeDoors'],
    );
    assert.equal(r[1].at.getTime(), new Date('2026-10-05T17:00:00-04:00').getTime());
    assert.match(r[0].title, /Krallice/);
  });

  it('skips reminders that are already in the past', () => {
    const r = planReminders(show, DEFAULT_REMINDER_PREFS, new Date('2026-10-05T13:00:00-04:00'));
    assert.deepEqual(
      r.map((x) => x.kind),
      ['beforeDoors'],
    );
  });

  it('only schedules shows in the next 14 days', () => {
    const r = planReminders(show, DEFAULT_REMINDER_PREFS, new Date('2026-09-01T10:00:00-04:00'));
    assert.equal(r.length, 0);
  });

  it('adds the day-before reminder when switched on', () => {
    const r = planReminders(show, { ...DEFAULT_REMINDER_PREFS, dayBefore: true }, new Date('2026-10-01T10:00:00-04:00'));
    assert.equal(r[0].kind, 'dayBefore');
  });

  it('skips before-doors when the time is TBA', () => {
    const tba = SHOWS.find((s) => s.timeTba)!;
    const r = planReminders(tba, DEFAULT_REMINDER_PREFS, new Date(new Date(tba.startsAt).getTime() - 3 * 86400_000));
    assert.ok(!r.some((x) => x.kind === 'beforeDoors'));
  });
});

describe('preview matching', () => {
  it('normalizes names', () => {
    assert.equal(normalizeName('Hélène Barbier'), 'helene barbier');
    assert.equal(normalizeName('Ink & Dagger'), 'ink and dagger');
    assert.ok(namesMatch('The Serfs', 'Serfs'));
    assert.ok(!namesMatch('Spy', 'Spy Kids'));
  });

  it('flags collaborations', () => {
    assert.ok(isCollaboration('Ka Baird / Chris Cochrane / Mike Pride'));
    assert.ok(!isCollaboration('Book/Spirit'));
  });

  const cands = [
    { id: 1, name: 'Krallice', fans: 5000, albums: 12 },
    { id: 2, name: 'Krallice Tribute', fans: 3, albums: 1 },
  ];

  it('one exact match is high confidence', () => {
    const m = chooseArtist('Krallice', cands);
    assert.equal(m.kind, 'match');
    if (m.kind === 'match') {
      assert.equal(m.artist.id, 1);
      assert.equal(m.confidence, 'high');
    }
  });

  it('several exact matches pick the most followed and mark it possible', () => {
    const m = chooseArtist('Spy', [
      { id: 10, name: 'SPY', fans: 50, albums: 2 },
      { id: 11, name: 'Spy', fans: 900, albums: 4 },
    ]);
    assert.equal(m.kind, 'match');
    if (m.kind === 'match') {
      assert.equal(m.artist.id, 11);
      assert.equal(m.confidence, 'possible');
    }
  });

  it('no exact match means no preview', () => {
    assert.equal(chooseArtist('Heaviness Fell', [{ id: 3, name: 'Heaviness', fans: 10, albums: 1 }]).kind, 'none');
  });

  it('a rejected artist is skipped', () => {
    assert.equal(chooseArtist('Krallice', cands, [1]).kind, 'none');
  });

  it('short names are never high confidence', () => {
    const m = chooseArtist('DNE', [{ id: 4, name: 'DNE', fans: 10, albums: 1 }]);
    assert.equal(m.kind === 'match' && m.confidence, 'possible');
  });
});
