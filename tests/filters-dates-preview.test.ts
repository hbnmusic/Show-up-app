import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SHOWS } from './fixtures/shows';
import { cleanRange, inRange, monthGrid, nextRange, parseYmd, rangeLabel } from '../src/lib/dateRange';
import { activeFilterCount, buildQueue, inWhen, whenText, type PreviewLookup } from '../src/lib/filters';
import { DEFAULT_FILTERS, type Filters, type Show } from '../src/lib/types';

// Tue Sep 29 2026, 9 PM New York
const now = new Date('2026-09-29T21:00:00-04:00');
const filters = (over: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...over });
const show = (startsAt: string): Show => ({ ...SHOWS[0], id: `x-${startsAt}`, startsAt }) as Show;

describe('date filter', () => {
  it('a single date keeps only that night (the venue calendar, with the 5 AM rollover)', () => {
    const r = { from: '2026-10-03', to: '2026-10-03' };
    assert.equal(inWhen(show('2026-10-03T20:00:00-04:00'), 'dates', now, r), true);
    assert.equal(inWhen(show('2026-10-04T01:00:00-04:00'), 'dates', now, r), true); // a 1 AM set belongs to the night before
    assert.equal(inWhen(show('2026-10-04T20:00:00-04:00'), 'dates', now, r), false);
    assert.equal(inWhen(show('2026-10-02T20:00:00-04:00'), 'dates', now, r), false);
  });
  it('a range includes both end dates', () => {
    const r = { from: '2026-10-02', to: '2026-10-04' };
    for (const d of ['2026-10-02', '2026-10-03', '2026-10-04']) assert.equal(inWhen(show(`${d}T20:00:00-04:00`), 'dates', now, r), true, d);
    assert.equal(inWhen(show('2026-10-05T20:00:00-04:00'), 'dates', now, r), false);
  });
  it('no dates chosen yet means no limit, and past shows are still left out', () => {
    assert.equal(inWhen(show('2026-12-01T20:00:00-05:00'), 'dates', now, null), true);
    const q = buildQueue(SHOWS, filters({ when: 'dates', dates: { from: '2026-09-01', to: '2026-09-28' } }), {}, now);
    assert.equal(q.length, 0);
  });
  it('the deck holds only shows inside the range', () => {
    const q = buildQueue(SHOWS, filters({ when: 'dates', dates: { from: '2026-10-03', to: '2026-10-04' } }), {}, now);
    assert.ok(q.length > 0);
    for (const s of q) assert.ok(s.startsAt >= '2026-10-03' && s.startsAt < '2026-10-05T05', s.startsAt);
  });
  it('tapping days: single date, extend, earlier day, same day, finished range', () => {
    assert.deepEqual(nextRange(null, '2026-10-10'), { from: '2026-10-10', to: '2026-10-10' });
    assert.deepEqual(nextRange({ from: '2026-10-10', to: '2026-10-10' }, '2026-10-12'), { from: '2026-10-10', to: '2026-10-12' });
    assert.deepEqual(nextRange({ from: '2026-10-10', to: '2026-10-10' }, '2026-10-08'), { from: '2026-10-08', to: '2026-10-10' });
    assert.equal(nextRange({ from: '2026-10-10', to: '2026-10-10' }, '2026-10-10'), null);
    assert.deepEqual(nextRange({ from: '2026-10-10', to: '2026-10-12' }, '2026-10-20'), { from: '2026-10-20', to: '2026-10-20' });
  });
  it('month grid, labels and saved-value cleaning', () => {
    const g = monthGrid(2026, 9); // October 2026 starts on a Thursday
    assert.equal(g[0].filter(Boolean).length, 3);
    assert.equal(g[0][4], '2026-10-01');
    assert.equal(g.flat().filter(Boolean).length, 31);
    assert.ok(g.every((w) => w.length === 7));
    assert.equal(rangeLabel({ from: '2026-10-24', to: '2026-10-24' }), 'Oct 24');
    assert.equal(rangeLabel({ from: '2026-10-24', to: '2026-10-26' }), 'Oct 24 – Oct 26');
    assert.equal(rangeLabel({ from: '2026-12-30', to: '2027-01-02' }), 'Dec 30, 2026 – Jan 2, 2027');
    assert.equal(parseYmd('2026-02-30'), null);
    assert.equal(cleanRange({ from: '2026-10-05', to: '2026-10-01' }), null);
    assert.equal(cleanRange('x'), null);
    assert.deepEqual(cleanRange({ from: '2026-10-01', to: '2026-10-05' }), { from: '2026-10-01', to: '2026-10-05' });
    assert.equal(inRange({ from: '2026-10-01', to: '2026-10-05' }, '2026-10-05'), true);
  });
  it('shows the dates in words and counts as an active filter', () => {
    const f = filters({ when: 'dates', dates: { from: '2026-10-24', to: '2026-10-26' } });
    assert.equal(whenText(f), 'Oct 24 – Oct 26');
    assert.equal(whenText(filters({ when: 'week' })), 'Next 7 days');
    assert.equal(activeFilterCount(f, DEFAULT_FILTERS), 1);
  });
});

describe('only shows with a preview', () => {
  const week = buildQueue(SHOWS, DEFAULT_FILTERS, {}, now);
  const [a, b, c] = week;
  const lookup: PreviewLookup = (id) => (id === a.id ? 'none' : id === b.id ? 'playable' : 'unknown');
  const on = filters({ previewOnly: true });

  it('drops shows whose previews were checked and found nothing; keeps playable and not-yet-checked ones', () => {
    const q = buildQueue(SHOWS, on, {}, now, null, null, lookup);
    assert.ok(!q.some((s) => s.id === a.id));
    assert.ok(q.some((s) => s.id === b.id) && q.some((s) => s.id === c.id));
    assert.equal(q.length, week.length - 1);
  });
  it('does nothing when the filter is off or nothing is known', () => {
    assert.equal(buildQueue(SHOWS, DEFAULT_FILTERS, {}, now, null, null, lookup).length, week.length);
    assert.equal(buildQueue(SHOWS, on, {}, now).length, week.length);
  });
  it('does not apply to the "New" chip, which must list every new show', () => {
    const q = buildQueue(SHOWS, on, {}, now, null, new Set([a.id, b.id]), lookup);
    assert.deepEqual(q.map((s) => s.id).sort(), [a.id, b.id].sort());
  });
  it('counts as an active filter', () => {
    assert.equal(activeFilterCount(on, DEFAULT_FILTERS), 1);
  });
});
