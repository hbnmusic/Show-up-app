import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parsePrice, parsePrintedDate, parseTime, resolveDate, ymdString } from '../supabase/functions/_shared/dates.ts';

const today = { y: 2026, m: 10, d: 3 }; // a Saturday

const resolve = (text: string, lang: 'en' | 'fr' = 'en', weekday?: string) => resolveDate(parsePrintedDate(text, lang), today, weekday);
const iso = (r: ReturnType<typeof resolve>) => (r.ok ? ymdString(r.date) : r.reason);

describe('printed dates', () => {
  it('reads English forms and infers the year', () => {
    assert.equal(iso(resolve('Fri Oct 16')), '2026-10-16');
    assert.equal(iso(resolve('Friday, October 16th')), '2026-10-16');
    assert.equal(iso(resolve('OCT 16')), '2026-10-16');
  });

  it('reads French forms with French weekdays and months', () => {
    assert.equal(iso(resolve('vendredi 16 octobre', 'fr')), '2026-10-16');
    assert.equal(iso(resolve('ven. 16 oct.', 'fr')), '2026-10-16');
    assert.equal(iso(resolve('samedi 12 décembre', 'fr')), '2026-12-12');
    assert.equal(iso(resolve('mar 6 oct', 'fr')), '2026-10-06'); // mar = mardi
    assert.equal(iso(resolve('Mar 17', 'en')), '2027-03-17'); // March 17
  });

  it('reads numeric dates by language and uses the weekday to settle day/month order', () => {
    assert.equal(iso(resolve('16/10', 'fr')), '2026-10-16');
    assert.equal(iso(resolve('10/16', 'en')), '2026-10-16');
    assert.equal(iso(resolve('2026-10-16')), '2026-10-16');
    // 10/11 is Oct 11 (a Sunday) in English order or Nov 10 (a Tuesday) in day-first order.
    assert.equal(iso(resolve('10/11', 'en', 'Tuesday')), '2026-11-10');
    assert.equal(iso(resolve('10/11', 'en', 'Sunday')), '2026-10-11');
  });

  it('rejects a weekday that does not match the date', () => {
    assert.equal(iso(resolve('Sat Oct 16')), 'weekday_mismatch');
    assert.equal(iso(resolve('16 octobre', 'fr', 'samedi')), 'weekday_mismatch');
  });

  it('rolls an unyeared date to next year when that year fits the weekday', () => {
    // Sep 1 2026 is past; Sep 1 2027 is a Wednesday.
    const r = resolve('Wed Sept 1');
    assert.equal(iso(r), '2027-09-01');
    assert.equal(r.ok && r.inferredYear, true);
  });

  it('rejects past dates, dates more than a year out, and invalid dates', () => {
    assert.equal(iso(resolve('Oct 1 2026')), 'past');
    assert.equal(iso(resolve('Oct 20 2027')), 'too_far');
    assert.equal(iso(resolve('Feb 30')), 'invalid_date');
    assert.equal(iso(resolve('no date here')), 'unreadable');
  });

  it('keeps today', () => {
    assert.equal(iso(resolve('Sat Oct 3')), '2026-10-03');
  });
});

describe('times and prices', () => {
  it('parses clock times in English and French styles', () => {
    assert.equal(parseTime('8pm'), '20:00');
    assert.equal(parseTime('8:30 PM'), '20:30');
    assert.equal(parseTime('9 p.m.'), '21:00');
    assert.equal(parseTime('12am'), '00:00');
    assert.equal(parseTime('20 h'), '20:00');
    assert.equal(parseTime('20h30'), '20:30');
    assert.equal(parseTime('19:45'), '19:45');
    assert.equal(parseTime('8'), null);
    assert.equal(parseTime('25h'), null);
  });

  it('parses prices including Canadian formats', () => {
    assert.deepEqual(parsePrice('Free'), { isFree: true });
    assert.deepEqual(parsePrice('Gratuit'), { isFree: true });
    assert.deepEqual(parsePrice('$15'), { min: 15, max: 15 });
    assert.deepEqual(parsePrice('15$ adv / 20$ porte'), { min: 15, max: 20 });
    assert.deepEqual(parsePrice('$10 CAD'), { min: 10, max: 10 });
    assert.deepEqual(parsePrice('$10 PWYC'), { min: 10, max: 10, notaflof: true });
    assert.deepEqual(parsePrice('all ages'), {});
  });
});
