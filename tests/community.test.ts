/// <reference types="node" />
/** Community submissions: parsing what people type, validation, row mapping and merging with provider listings. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { beforeEach, describe, it } from 'node:test';

const memory = new Map<string, string>();
const fake = {
  getItem: async (k: string) => memory.get(k) ?? null,
  setItem: async (k: string, v: string) => void memory.set(k, v),
  removeItem: async (k: string) => void memory.delete(k),
};
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === '@react-native-async-storage/async-storage') return { __esModule: true, default: fake };
  return realLoad.call(this, request, ...rest);
};

import {
  buildPayload,
  EMPTY_FORM,
  extractUrl,
  offsetString,
  parseActs,
  parseDateInput,
  parsePriceInput,
  parseTimeInput,
  rowToShow,
  type SubmissionRow,
  type SubmitForm,
} from '../src/lib/community/form';

const TODAY = { y: 2026, m: 10, d: 1 };

describe('date input', () => {
  it('reads common formats', () => {
    assert.equal(parseDateInput('2026-10-24', TODAY), '2026-10-24');
    assert.equal(parseDateInput('10/24', TODAY), '2026-10-24');
    assert.equal(parseDateInput('10/24/26', TODAY), '2026-10-24');
    assert.equal(parseDateInput('Oct 24', TODAY), '2026-10-24');
    assert.equal(parseDateInput('October 24th, 2026', TODAY), '2026-10-24');
    assert.equal(parseDateInput('24 oct', TODAY), '2026-10-24');
  });
  it('picks the next occurrence when the year is left out', () => {
    assert.equal(parseDateInput('9/15', TODAY), '2027-09-15');
    assert.equal(parseDateInput('10/1', TODAY), '2026-10-01');
  });
  it('rejects things that are not dates', () => {
    assert.equal(parseDateInput('2/30', TODAY), null);
    assert.equal(parseDateInput('13/4/2027', TODAY), null);
    assert.equal(parseDateInput('soon', TODAY), null);
    assert.equal(parseDateInput('', TODAY), null);
  });
});

describe('time input', () => {
  it('reads common formats', () => {
    assert.equal(parseTimeInput('8pm'), '20:00');
    assert.equal(parseTimeInput('8:30 PM'), '20:30');
    assert.equal(parseTimeInput('8'), '20:00');
    assert.equal(parseTimeInput('8:30'), '20:30');
    assert.equal(parseTimeInput('20:00'), '20:00');
    assert.equal(parseTimeInput('10am'), '10:00');
    assert.equal(parseTimeInput('12am'), '00:00');
    assert.equal(parseTimeInput('12pm'), '12:00');
    assert.equal(parseTimeInput('9 p.m.'), '21:00');
  });
  it('rejects things that are not times', () => {
    assert.equal(parseTimeInput('25:00'), null);
    assert.equal(parseTimeInput('8:75'), null);
    assert.equal(parseTimeInput('13pm'), null);
    assert.equal(parseTimeInput('late'), null);
  });
});

describe('price, bands and links', () => {
  it('parses prices', () => {
    assert.deepEqual(parsePriceInput('$20'), { min: 20 });
    assert.deepEqual(parsePriceInput('15-25'), { min: 15, max: 25 });
    assert.deepEqual(parsePriceInput('25 to 15'), { min: 15, max: 25 });
    assert.equal(parsePriceInput('cheap'), null);
    assert.equal(parsePriceInput('5000'), null);
  });
  it('splits bands, drops repeats, keeps order', () => {
    assert.deepEqual(parseActs('A, B\nC,  a ,'), ['A', 'B', 'C']);
    assert.equal(parseActs(Array.from({ length: 20 }, (_, i) => `Band ${i}`).join(',')).length, 12);
  });
  it('finds the link in shared text', () => {
    assert.equal(extractUrl('https://www.instagram.com/p/AbC123/?igsh=xyz'), 'https://www.instagram.com/p/AbC123/?igsh=xyz');
    assert.equal(extractUrl('Look at this (https://example.com/e/1), wow.'), 'https://example.com/e/1');
    assert.equal(extractUrl('no link here'), undefined);
  });
});

const good: SubmitForm = {
  ...EMPTY_FORM,
  metro: 'nyc',
  venueName: ' Elsewhere ',
  area: 'Bushwick',
  acts: 'The Band, Support',
  date: '10/24',
  time: '8pm',
  price: '15-20',
  genres: ['Punk'],
  sourceUrl: 'https://www.instagram.com/p/AbC123/',
};

describe('building a submission', () => {
  it('produces the database payload', () => {
    const r = buildPayload(good, TODAY);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.starts_local, '2026-10-24T20:00');
    assert.equal(r.payload.tz, 'America/New_York');
    assert.equal(r.payload.venue_name, 'Elsewhere');
    assert.deepEqual(r.payload.acts, [{ name: 'The Band' }, { name: 'Support' }]);
    assert.equal(r.payload.price_min, 15);
    assert.equal(r.payload.price_max, 20);
  });
  it('reports every problem at once', () => {
    const r = buildPayload({ ...EMPTY_FORM, date: 'x', time: 'y', ticketUrl: 'nope' }, TODAY);
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.ok(r.errors.length >= 6);
  });
  it('accepts a named night with no bands, and ignores price when free', () => {
    const r = buildPayload({ ...good, acts: '', title: 'Block party', free: true, price: 'junk' }, TODAY);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.payload.price_min, null);
  });
  it('rejects dates more than a year out', () => {
    const r = buildPayload({ ...good, date: '2028-01-01' }, TODAY);
    assert.ok(!r.ok);
  });

  it('rejects over-long text, too many bands and control characters (same limits as the database)', () => {
    const cases: [Partial<SubmitForm>, RegExp][] = [
      [{ venueName: 'v'.repeat(121) }, /venue/i],
      [{ area: 'a'.repeat(81) }, /neighborhood/i],
      [{ title: 't'.repeat(121) }, /event name/i],
      [{ address: 'x'.repeat(201) }, /address/i],
      [{ acts: Array.from({ length: 13 }, (_, n) => `Band ${n}`).join(', ') }, /at most 12/i],
      [{ acts: 'b'.repeat(101) }, /band name/i],
      [{ venueName: 'Bad\u0007Name' }, /unusual characters/i],
      [{ ticketUrl: `https://example.com/${'x'.repeat(500)}` }, /ticket link/i],
      [{ free: false, price: '2500' }, /price/i],
    ];
    for (const [patch, re] of cases) {
      const r = buildPayload({ ...good, ...patch }, TODAY);
      assert.equal(r.ok, false, JSON.stringify(patch).slice(0, 60));
      if (!r.ok) assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(patch).slice(0, 60)} -> ${r.errors.join('|')}`);
    }
  });

  it('keeps the author id on community shows so they can be reported and blocked', () => {
    const s = rowToShow({ ...row, created_by: 'author-1' });
    assert.equal(s?.source.author, 'author-1');
    assert.equal(rowToShow({ ...row, created_by: null })?.source.author, undefined);
  });
});

const row: SubmissionRow = {
  id: '11111111-2222-3333-4444-555555555555',
  created_by: 'u1',
  created_at: '2026-10-01T12:00:00Z',
  status: 'live',
  metro: 'chi',
  title: null,
  acts: [{ name: 'Headliner' }, { name: 'Opener' }],
  venue_name: 'Empty Bottle',
  venue_area: 'Ukrainian Village',
  venue_address: null,
  starts_local: '2026-11-07T21:00',
  utc_offset_min: -360,
  price_min: 12,
  price_max: null,
  is_free: false,
  genres: ['Indie Rock', 'Not A Genre'],
  ticket_url: null,
  source_url: 'https://example.com/post',
  confirm_count: 1,
  report_count: 0,
};

describe('row to show', () => {
  it('formats offsets', () => {
    assert.equal(offsetString(-300), '-05:00');
    assert.equal(offsetString(330), '+05:30');
    assert.equal(offsetString(0), '+00:00');
  });
  it('maps a database row to a Show on the venue clock', () => {
    const s = rowToShow(row);
    assert.ok(s);
    assert.equal(s.id, 'cm-11111111-2222-3333-4444-555555555555');
    assert.equal(s.startsAt, '2026-11-07T21:00:00-06:00');
    assert.equal(s.venue.metro, 'chi');
    assert.equal(s.venue.city, 'Ukrainian Village, IL');
    assert.deepEqual(s.genres, ['Indie Rock']);
    assert.equal(s.source.provider, 'community');
    assert.equal(s.ticketUrl, 'https://example.com/post');
  });
  it('drops a row with nothing to show', () => {
    assert.equal(rowToShow({ ...row, acts: [], title: null }), null);
  });
});

describe('community shows in the listings', () => {
  beforeEach(() => memory.clear());

  it('hides a community show the provider already lists, keeps a new one', async () => {
    const provider = {
      id: 'jb-1',
      startsAt: '2026-11-07T21:00:00-06:00',
      venue: { name: 'The Empty Bottle', neighborhood: 'UV', area: 'Chicago', metro: 'chi', city: 'Chicago, IL', addressVisibility: 'public' },
      acts: [{ name: 'Headliner', order: 0 }],
      genres: [],
      price: {},
      status: 'scheduled',
      source: { provider: 'jambase', url: '', fetchedAt: '2026-10-01' },
      updatedAt: '2026-10-01T00:00:00Z',
    };
    const dup = rowToShow(row)!;
    const fresh = rowToShow({ ...row, id: 'aaaa', venue_name: 'Hideout', acts: [{ name: 'Someone Else' }] })!;
    const feed = (shows: unknown[]) => JSON.stringify({ version: 1, generatedAt: '2026-10-01T00:00:00Z', attribution: [], shows });
    memory.set('pull-up-listings-v2:index', JSON.stringify(['chi', 'community:chi']));
    memory.set('pull-up-listings-v2:chi', feed([provider]));
    memory.set('pull-up-listings-v2:community:chi', feed([dup, fresh]));

    const { useListings } = await import('../src/lib/listingsStore');
    await useListings.getState().loadCache();
    const ids = useListings.getState().shows.map((s) => s.id).sort();
    assert.deepEqual(ids, ['cm-aaaa', 'jb-1']);
    assert.equal(useListings.getState().generatedAt, '2026-10-01T00:00:00Z');
  });
});
