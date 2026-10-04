import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildReadiness, renderReadiness } from '../scripts/lib/readiness';
import type { FpRow } from '../src/lib/fpMerge';
import type { Show } from '../src/lib/types';

const NOW = new Date('2026-10-14T20:00:00Z'); // 4 pm in New York
const mk = (id: string, startsAt: string, o: Partial<Show> = {}, provider: Show['source']['provider'] = 'jambase'): Show => ({
  id, startsAt, venue: { name: `Hall ${id}`, neighborhood: '', area: '', metro: 'nyc', city: '', addressVisibility: 'public' },
  acts: [{ name: `Band ${id}`, order: 0 }], genres: [], price: {}, status: 'scheduled',
  source: { provider, url: 'https://x.example', fetchedAt: '' }, updatedAt: '', ...o,
});
const fp = (id: string, headliner: string, localDate: string): FpRow => ({
  id, metro: 'nyc', venueId: null, venueName: `Venue ${id}`, addressMode: 'registry', localDate, startLocal: '20:00', startsAt: `${localDate}T20:00:00-04:00`,
  headliner, supports: [], status: 'scheduled', genres: ['Punk'], conflicts: [], sources: [{ sourceType: 'venue_site', url: 'https://v.example' } as never], unconfirmed: false, pending: false,
});

describe('readiness report', () => {
  const jb = [
    mk('t1', '2026-10-14T20:00:00-04:00', { genres: ['Rock'] }),
    mk('t2', '2026-10-14T21:00:00-04:00', { genres: ['Rock'] }),
    mk('t3', '2026-10-14T22:00:00-04:00', { genres: ['Rock', 'Punk'] }),
    mk('t4', '2026-10-14T20:30:00-04:00'),
    mk('w1', '2026-10-17T20:00:00-04:00', { genres: ['Jazz & Improv'] }),
    mk('m1', '2026-11-05T20:00:00-04:00'),
    mk('far', '2026-12-30T20:00:00-05:00'),
    mk('gone', '2026-10-01T20:00:00-04:00'),
  ];
  const r = buildReadiness({
    metro: { id: 'nyc', name: 'New York' }, now: NOW, jambase: jb,
    fpRows: [fp('f1', 'Solo Band', '2026-10-15'), fp('f2', 'Another Band', '2026-10-20')],
    community: [mk('c1', '2026-10-16T20:00:00-04:00', {}, 'community')],
    venues: { approvedA: 4, approvedB: 2, quarantined: 1, rejected: 3, disabled: 0, scannedInWindow: 5, venuesTotal: 10 },
    rejections: [{ reason: 'no_events_found', count: 3 }, { reason: 'bot_wall', count: 1 }],
    previousIds: new Set(['t1', 't2', 'w1', 'm1']),
    previousAt: '2026-10-12T00:00:00Z',
  });

  it('counts upcoming shows in 7 and 30 days, leaving out past shows', () => {
    assert.equal(r.total, 10); // 7 JamBase upcoming + 2 first-party + 1 community
    assert.equal(r.next7, 8);  // t1-t4, w1, f1, c1, f2
    assert.equal(r.next30, 9); // + m1
  });

  it('splits the next 30 days by source', () => {
    assert.deepEqual(r.share, { jambaseOnly: 6, firstParty: 2, firstPartyAlsoInJamBase: 0, community: 1 });
  });

  it('counts tonight and this week by genre, and untagged shows', () => {
    assert.equal(r.tonight, 4);
    assert.deepEqual(r.genresTonight, { Rock: 3, Punk: 1 });
    assert.equal(r.untaggedTonight, 1);
    assert.equal(r.genresWeek.Rock, 3);
    assert.equal(r.genresWeek['Jazz & Improv'], 1);
  });

  it('says whether the notification minimums would be met', () => {
    assert.equal(r.notifications.typeB.met, true);
    assert.deepEqual(r.notifications.typeB.genresMeetingMinimum, ['Rock']);
    assert.equal(r.notifications.typeA.newSincePrevious, 6); // upcoming shows that were not in the earlier download
    assert.equal(r.notifications.typeA.met, true);
    const none = buildReadiness({ metro: { id: 'nyc', name: 'New York' }, now: NOW, jambase: jb, fpRows: [], community: [], venues: null, rejections: [] });
    assert.equal(none.notifications.typeA.met, null);
    const thin = buildReadiness({ metro: { id: 'nyc', name: 'New York' }, now: NOW, jambase: jb.slice(0, 2), fpRows: [], community: [], venues: null, rejections: [] });
    assert.equal(thin.notifications.typeB.met, false);
  });

  it('prints venues, rejection reasons and the minimums in plain words', () => {
    const text = renderReadiness([r], NOW);
    assert.match(text, /6 approved \(4 structured, 2 read by the model\)/);
    assert.match(text, /no_events_found 3, bot_wall 1/);
    assert.match(text, /"Shows tonight" notification \(needs 3\): minimum met/);
  });
});
