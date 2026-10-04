import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { METROS } from '../src/lib/metros';
import { runRetentionCheck, type CheckDeps } from '../src/lib/retention/orchestrate';
import {
  DEFAULT_PLAN,
  EMPTY_STATE,
  localClock,
  markSeen,
  MAX_SEEN_CITIES,
  MAX_SEEN_IDS,
  newShows,
  onAppOpened,
  onNotificationOpened,
  planRetention,
  recordScheduled,
  settle,
  templateA,
  templateB,
  type PlanInput,
  type RetentionState,
} from '../src/lib/retention/planner';
import { parseTapUrl, planTap } from '../src/lib/retention/tap';
import { DEFAULT_FILTERS, type Genre, type Show } from '../src/lib/types';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A show at the venue's own wall-clock time; `offset` is the venue's UTC offset on that date. */
const mk = (id: string, o: Partial<Show> & { metro?: string } = {}): Show => {
  const { metro = 'nyc', ...rest } = o;
  return {
    id, startsAt: '2026-10-14T20:00:00-04:00',
    venue: { name: 'Parkside Hall', neighborhood: '', area: '', metro, city: '', addressVisibility: 'public' },
    acts: [{ name: 'Velvet Automaton', order: 0 }], genres: [], price: {}, status: 'scheduled',
    source: { provider: 'jambase', url: 'https://jb.example/1', fetchedAt: '' }, updatedAt: '', ...rest,
  };
};
const many = (prefix: string, n: number, o: Partial<Show> & { metro?: string } = {}) => Array.from({ length: n }, (_, i) => mk(`${prefix}${i}`, o));

// Wed 14 Oct 2026, New York is on daylight time (UTC-4).
const at = (hhmm: string, tzOffset = '-04:00', date = '2026-10-14') => new Date(`${date}T${hhmm}:00${tzOffset}`);

const NYC = { id: 'nyc', name: 'New York' };
const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  now: at('17:00'),
  tz: 'America/New_York',
  city: NYC,
  enabled: { flag: true, metro: true, permission: true, typeA: true, typeB: true },
  state: { ...EMPTY_STATE, seen: { nyc: ['old1'] } },
  feedUpdatedAt: at('12:00').getTime(),
  shows: [],
  filters: { ...DEFAULT_FILTERS, place: null },
  decisions: {},
  ...o,
});
const upcoming = (n: number, day = '2026-10-20') => many('new', n, { startsAt: `${day}T20:00:00-04:00` });
const tonight = (n: number, o: Partial<Show> = {}) => many('tn', n, o);

describe('wording', () => {
  it('uses the exact templates', () => {
    assert.equal(templateA(7, 'New York').body, '7 new shows just added in New York, check them out!');
    assert.equal(templateB(4, 'New York', 'Rock').body, '4 Rock shows tonight near you, check them out!');
    assert.equal(templateB(4, 'Los Angeles', null).body, '4 shows tonight in Los Angeles, check them out!');
  });
});

describe('counts and minimums', () => {
  it('sends type A at 5 new shows and not at 4', () => {
    const p = planRetention(base({ enabled: { flag: true, metro: true, permission: true, typeA: true, typeB: false }, shows: upcoming(5) }));
    assert.equal(p.send, true);
    if (p.send) {
      assert.equal(p.type, 'A');
      assert.equal(p.n, 5);
      assert.equal(p.url, '/?rt=A');
    }
    const q = planRetention(base({ shows: upcoming(4) }));
    assert.equal(q.send, false);
    assert.equal(q.send === false && q.considered?.A, 'below_minimum:4');
  });

  it('sends type B at 3 shows tonight and not at 2', () => {
    const p = planRetention(base({ now: at('16:00'), shows: tonight(3) }));
    assert.equal(p.send && p.type, 'B');
    const q = planRetention(base({ now: at('16:00'), shows: tonight(2) }));
    assert.equal(q.send, false);
    assert.equal(q.send === false && q.considered?.B, 'below_minimum:2');
  });

  it('leaves out shows already swiped, cancelled, past, or in another city', () => {
    const shows = [...tonight(3), mk('c', { status: 'cancelled' }), mk('x', { metro: 'la' }), mk('past', { startsAt: '2026-10-14T09:00:00-04:00' })];
    const p = planRetention(base({ now: at('16:00'), shows, decisions: { tn0: { decision: 'passed', at: 1 } } }));
    assert.equal(p.send, false); // 2 left
  });

  it('counts a 1 AM show as tonight until the 5 AM rollover', () => {
    const shows = [mk('late', { startsAt: '2026-10-15T01:00:00-04:00' }), ...tonight(2)];
    const p = planRetention(base({ now: at('16:00'), shows }));
    assert.equal(p.send && p.n, 3);
    const after = planRetention(base({ now: at('16:00'), shows: [mk('next', { startsAt: '2026-10-15T06:00:00-04:00' }), ...tonight(2)] }));
    assert.equal(after.send, false);
  });
});

describe('windows', () => {
  it('B only from 3:30 to 5:30 pm, A only from 5 to 7 pm (city time)', () => {
    const both = { shows: [...upcoming(6), ...tonight(3)] };
    const noA = { ...both, state: { ...EMPTY_STATE, seen: { nyc: ['old1', ...tonight(3).map((s) => s.id)] } } };
    // 15:29 is within the 4 h lookahead, so B is scheduled for just inside its window instead of being dropped.
    const early = planRetention(base({ now: at('15:29'), ...noA }));
    assert.equal(early.send && early.type, 'B');
    assert.equal(early.send && early.sendAt.getTime(), at('15:29').getTime() + 1 * 60_000 + 5 * 60_000);
    const afterB = planRetention(base({ now: at('17:31'), ...noA }));
    assert.equal(afterB.send && afterB.type, 'A'); // B's window is over, A's is open
    const late = planRetention(base({ now: at('19:00'), ...noA }));
    assert.equal(late.send, false);
    assert.equal(late.send === false && late.considered?.A, 'window_passed');
  });

  it('schedules ahead only inside the lookahead', () => {
    const p = planRetention(base({ now: at('10:00'), shows: tonight(3) }));
    assert.equal(p.send, false);
    assert.equal(p.send === false && p.reason, 'nothing_due');
    const q = planRetention(base({ now: at('12:00'), shows: tonight(3) }));
    assert.equal(q.send && q.sendAt.getTime(), at('15:35').getTime());
  });

  it('B wins when both are eligible', () => {
    const p = planRetention(base({ now: at('17:10'), shows: [...upcoming(8), ...tonight(3)] }));
    assert.equal(p.send && p.type, 'B');
  });

  it('A goes out when B has too few', () => {
    const p = planRetention(base({ now: at('17:10'), shows: [...upcoming(8), ...tonight(1)] }));
    assert.equal(p.send && p.type, 'A');
  });

  it('uses each city\'s own clock', () => {
    // 23:30 UTC is 7:30 pm in New York (type B window over) and 4:30 pm in Los Angeles.
    const now = new Date('2026-10-14T23:30:00Z');
    const la = planRetention(base({ now, tz: 'America/Los_Angeles', city: { id: 'la', name: 'Los Angeles' }, shows: many('la', 3, { metro: 'la', startsAt: '2026-10-14T20:00:00-07:00' }) }));
    assert.equal(la.send && la.type, 'B');
    const ny = planRetention(base({ now, shows: tonight(3) }));
    assert.equal(ny.send, false);
  });
});

describe('quiet hours, caps and skips', () => {
  const eligible = { shows: tonight(3) };
  it('sends nothing from 9 pm to 9 am', () => {
    for (const t of ['21:00', '23:30', '03:00', '08:59']) {
      const p = planRetention(base({ now: at(t), ...eligible }));
      assert.equal(p.send === false && p.reason, 'quiet_hours', t);
    }
  });

  it('at most one a day (a pending one counts)', () => {
    const state: RetentionState = { ...EMPTY_STATE, seen: { nyc: ['old1'] }, sent: [{ type: 'A', at: at('09:30').getTime(), pending: false }] };
    assert.equal(planRetention(base({ now: at('16:00'), state, ...eligible })).send === false, true);
    const yesterday: RetentionState = { ...state, sent: [{ type: 'A', at: at('17:30', '-04:00', '2026-10-13').getTime(), pending: false }] };
    assert.equal(planRetention(base({ now: at('16:00'), state: yesterday, ...eligible })).send, true);
    const pending: RetentionState = { ...state, sent: [{ type: 'B', at: at('16:30').getTime(), pending: true }] };
    const p = planRetention(base({ now: at('16:00'), state: pending, ...eligible }));
    assert.equal(p.send === false && p.reason, 'daily_cap');
  });

  it('at most four in any week', () => {
    const sent = [1, 2, 3, 4].map((d) => ({ type: 'B' as const, at: at('16:00', '-04:00', `2026-10-${String(14 - d).padStart(2, '0')}`).getTime(), pending: false }));
    const state: RetentionState = { ...EMPTY_STATE, seen: { nyc: ['old1'] }, sent };
    const p = planRetention(base({ now: at('16:00'), state, ...eligible }));
    assert.equal(p.send === false && p.reason, 'weekly_cap');
    const older: RetentionState = { ...state, sent: [{ ...sent[0], at: at('16:00', '-04:00', '2026-10-06').getTime() }, ...sent.slice(1)] };
    assert.equal(planRetention(base({ now: at('16:00'), state: older, ...eligible })).send, true);
  });

  it('type A at most once every 48 hours', () => {
    const only = { enabled: { flag: true, metro: true, permission: true, typeA: true, typeB: false }, shows: upcoming(6) };
    const recent: RetentionState = { ...EMPTY_STATE, seen: { nyc: ['old1'] }, sent: [{ type: 'A', at: at('17:30', '-04:00', '2026-10-13').getTime(), pending: false }] };
    const p = planRetention(base({ now: at('17:30'), state: recent, ...only }));
    assert.equal(p.send === false && p.considered?.A, 'sent_within_48h');
    const old: RetentionState = { ...recent, sent: [{ type: 'A', at: at('17:00', '-04:00', '2026-10-12').getTime() - 1 * HOUR, pending: false }] };
    assert.equal(planRetention(base({ now: at('17:30'), state: old, ...only })).send, true);
  });

  it('skips if the app was opened in the last 6 hours', () => {
    const open = (h: number): RetentionState => ({ ...EMPTY_STATE, seen: { nyc: ['old1'] }, lastAppOpenAt: at('16:00').getTime() - h * HOUR });
    const p = planRetention(base({ now: at('16:00'), state: open(5.9), shows: tonight(3) }));
    assert.equal(p.send === false && p.reason, 'recently_opened');
    assert.equal(planRetention(base({ now: at('16:00'), state: open(6.1), shows: tonight(3) })).send, true);
  });

  it('skips when the downloaded listings are older than 48 hours, or were never downloaded', () => {
    const now = at('16:00');
    assert.equal(planRetention(base({ now, feedUpdatedAt: now.getTime() - 49 * HOUR, shows: tonight(3) })).send === false, true);
    const stale = planRetention(base({ now, feedUpdatedAt: now.getTime() - 49 * HOUR, shows: tonight(3) }));
    assert.equal(stale.send === false && stale.reason, 'stale_feed');
    assert.equal(planRetention(base({ now, feedUpdatedAt: now.getTime() - 47 * HOUR, shows: tonight(3) })).send, true);
    const never = planRetention(base({ now, feedUpdatedAt: null, shows: tonight(3) }));
    assert.equal(never.send === false && never.reason, 'stale_feed');
  });

  it('respects the switches, the city setting and the permission', () => {
    const reason = (e: Partial<PlanInput['enabled']>) => {
      const p = planRetention(base({ now: at('16:00'), shows: tonight(3), enabled: { flag: true, metro: true, permission: true, typeA: true, typeB: true, ...e } }));
      return p.send ? 'send' : p.reason;
    };
    assert.equal(reason({}), 'send');
    assert.equal(reason({ flag: false }), 'switched_off');
    assert.equal(reason({ metro: false }), 'city_off');
    assert.equal(reason({ permission: false }), 'no_permission');
    assert.equal(reason({ typeA: false, typeB: false }), 'both_off');
    assert.equal(reason({ typeB: false }), 'nothing_due'); // B off, and A has no baseline news
  });

  it('with one toggle off, never sends that type', () => {
    const p = planRetention(base({ now: at('17:10'), shows: [...upcoming(8), ...tonight(3)], enabled: { flag: true, metro: true, permission: true, typeA: true, typeB: false } }));
    assert.equal(p.send && p.type, 'A');
    const q = planRetention(base({ now: at('17:10'), shows: [...upcoming(8), ...tonight(3)], enabled: { flag: true, metro: true, permission: true, typeA: false, typeB: true } }));
    assert.equal(q.send && q.type, 'B');
  });

  it('first run has no baseline, so type A waits', () => {
    const p = planRetention(base({ now: at('17:30'), state: EMPTY_STATE, shows: upcoming(9), enabled: { flag: true, metro: true, permission: true, typeA: true, typeB: false } }));
    assert.equal(p.send === false && p.considered?.A, 'no_baseline');
  });
});

describe('back-off after unopened notifications', () => {
  const delivered = (n: number, from: number): RetentionState => ({
    ...EMPTY_STATE,
    seen: { nyc: ['old1'] },
    sent: Array.from({ length: n }, (_, i) => ({ type: 'B' as const, at: from - (n - i) * DAY, pending: false })),
    unopened: n,
  });
  it('pauses for 14 days after 5 in a row, then resumes', () => {
    const now = at('16:00');
    const s = settle(delivered(5, now.getTime() - 1 * DAY), now.getTime());
    assert.ok(s.pausedUntil && s.pausedUntil > now.getTime());
    const p = planRetention(base({ now, state: s, shows: tonight(3) }));
    assert.equal(p.send === false && p.reason, 'paused');
    // Just before the pause ends: still paused. At 4 pm on the day it ends: back to normal, with the count reset.
    const endDay = new Date(s.pausedUntil!).toISOString().slice(0, 10);
    const resumeAt = new Date(`${endDay}T16:00:00-04:00`);
    const shows = many('r', 3, { startsAt: `${endDay}T20:00:00-04:00` });
    const stillPaused = new Date(s.pausedUntil! - 1000);
    assert.equal(planRetention(base({ now: stillPaused, state: s, shows, feedUpdatedAt: stillPaused.getTime() - HOUR })).send, false);
    const r = planRetention(base({ now: resumeAt, state: { ...s, sent: [] }, shows, feedUpdatedAt: resumeAt.getTime() - HOUR }));
    assert.equal(r.send, true);
    assert.equal(settle(s, resumeAt.getTime()).unopened, 0);
  });
  it('4 unopened do not pause; a tap clears the count', () => {
    const now = at('16:00');
    assert.equal(settle(delivered(4, now.getTime() - DAY), now.getTime()).pausedUntil, null);
    const s = settle(delivered(5, now.getTime() - DAY), now.getTime());
    const t = onNotificationOpened(s, now.getTime());
    assert.equal(t.unopened, 0);
    assert.equal(t.pausedUntil, null);
  });
  it('counts a scheduled notification as delivered once it is due', () => {
    const now = at('18:00').getTime();
    const s = recordScheduled(EMPTY_STATE, 'A', now - HOUR);
    const settled = settle(s, now);
    assert.equal(settled.unopened, 1);
    assert.equal(settled.sent[0].pending, false);
  });
  it('opening the app drops a notification that has not fired and restarts the opened clock', () => {
    const now = at('16:00').getTime();
    const s = recordScheduled(EMPTY_STATE, 'B', now + HOUR);
    const r = onAppOpened(s, now);
    assert.equal(r.cancelPending, true);
    assert.equal(r.state.sent.length, 0);
    assert.equal(r.state.lastAppOpenAt, now);
    assert.equal(onAppOpened(EMPTY_STATE, now).cancelPending, false);
  });
});

describe('genre choice for type B', () => {
  const g = (...gs: Genre[]) => gs;
  const going = (ids: string[], days = 1) => Object.fromEntries(ids.map((id) => [id, { decision: 'going' as const, at: at('12:00').getTime() - days * DAY }]));
  const past = (id: string, genres: Genre[]) => mk(id, { genres, startsAt: '2026-09-30T20:00:00-04:00' });
  const run = (o: Partial<PlanInput>) => planRetention(base({ now: at('16:00'), ...o }));

  it('uses the genre filter when there is one', () => {
    const shows = [...tonight(4, { genres: g('Rock') }), ...many('pk', 3, { genres: g('Punk') })];
    const p = run({ shows, filters: { ...DEFAULT_FILTERS, genres: ['Punk'] } });
    assert.equal(p.send && p.genre, 'Punk');
    assert.equal(p.send && p.n, 3);
    assert.equal(p.send && p.body, '3 Punk shows tonight near you, check them out!');
    assert.equal(p.send && p.url, '/?rt=B&g=Punk');
  });

  it('with several genres in the filter, picks the one with the most Going swipes', () => {
    const shows = [...many('r', 3, { genres: g('Rock') }), ...many('p', 3, { genres: g('Punk') }), past('h1', g('Punk')), past('h2', g('Punk')), past('h3', g('Rock'))];
    const p = run({ shows, filters: { ...DEFAULT_FILTERS, genres: ['Rock', 'Punk'] }, decisions: going(['h1', 'h2', 'h3']) });
    assert.equal(p.send && p.genre, 'Punk');
  });

  it('with no filter, picks the most Going genre from the last 60 days if it has at least 3', () => {
    const hist = [past('h1', g('Jazz & Improv')), past('h2', g('Jazz & Improv')), past('h3', g('Jazz & Improv')), past('h4', g('Metal'))];
    const shows = [...many('j', 3, { genres: g('Jazz & Improv') }), ...many('x', 3, { genres: g('Metal') }), ...hist];
    const p = run({ shows, decisions: going(['h1', 'h2', 'h3', 'h4']) });
    assert.equal(p.send && p.genre, 'Jazz & Improv');
    assert.equal(p.send && p.n, 3);
  });

  it('falls back to the generic wording below 3 Going swipes, or when they are older than 60 days', () => {
    const shows = [...tonight(3, { genres: g('Rock') }), past('h1', g('Rock')), past('h2', g('Rock'))];
    const p = run({ shows, decisions: going(['h1', 'h2']) });
    assert.equal(p.send && p.genre, null);
    assert.equal(p.send && p.body, '3 shows tonight in New York, check them out!');
    const old = [past('h1', g('Rock')), past('h2', g('Rock')), past('h3', g('Rock'))];
    const q = run({ shows: [...tonight(3, { genres: g('Rock') }), ...old], decisions: going(['h1', 'h2', 'h3'], 61) });
    assert.equal(q.send && q.genre, null);
  });

  it('ignores untagged shows in the Going history and in tonight\'s genre count', () => {
    const untagged = [past('u1', []), past('u2', []), past('u3', [])];
    const p = run({ shows: [...tonight(3), ...untagged], decisions: going(['u1', 'u2', 'u3']) });
    assert.equal(p.send && p.genre, null);
    // Genre chosen, but only tagged shows tonight count towards N.
    const hist = [past('h1', g('Rock')), past('h2', g('Rock')), past('h3', g('Rock'))];
    const onlyB = { flag: true, metro: true, permission: true, typeA: false, typeB: true };
    const q = run({ enabled: onlyB, shows: [...tonight(2, { genres: g('Rock') }), ...tonight(5).map((s, i) => ({ ...s, id: `u${i}` })), ...hist], decisions: going(['h1', 'h2', 'h3']) });
    assert.equal(q.send, false);
    assert.equal(q.send === false && q.considered?.B, 'below_minimum:2');
  });

  it('breaks a tie by the number of shows tonight', () => {
    const hist = [past('h1', g('Rock')), past('h2', g('Rock')), past('h3', g('Rock')), past('h4', g('Folk')), past('h5', g('Folk')), past('h6', g('Folk'))];
    const shows = [...many('r', 3, { genres: g('Rock') }), ...many('f', 4, { genres: g('Folk') }), ...hist];
    const p = run({ shows, decisions: going(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) });
    assert.equal(p.send && p.genre, 'Folk');
  });
});

describe('daylight saving time', () => {
  it('reads the city clock across both clock changes', () => {
    const before = localClock(new Date('2026-10-31T20:30:00Z'), 'America/New_York'); // EDT
    const after = localClock(new Date('2026-11-01T21:30:00Z'), 'America/New_York'); // EST, the day the clocks went back
    assert.equal(before.minutes, 16 * 60 + 30);
    assert.equal(after.minutes, 16 * 60 + 30);
    assert.equal(after.dateKey, '2026-11-01');
    const spring = localClock(new Date('2026-03-08T19:30:00Z'), 'America/New_York'); // EDT, the day the clocks went forward
    assert.equal(spring.minutes, 15 * 60 + 30);
    // 07:30 UTC on 8 March is 2:30 EST, before the change at 2:00 -> 3:00.
    assert.equal(localClock(new Date('2026-03-08T06:59:00Z'), 'America/New_York').minutes, 1 * 60 + 59);
    assert.equal(localClock(new Date('2026-03-08T07:00:00Z'), 'America/New_York').minutes, 3 * 60);
  });

  it('plans a type B the day clocks go back, and lands the scheduled time inside the window', () => {
    const now = new Date('2026-11-01T19:00:00Z'); // 2:00 pm EST
    const shows = many('d', 3, { startsAt: '2026-11-01T20:00:00-05:00' });
    const p = planRetention(base({ now, shows, feedUpdatedAt: now.getTime() - HOUR }));
    assert.equal(p.send && p.type, 'B');
    if (p.send) {
      const c = localClock(p.sendAt, 'America/New_York');
      assert.ok(c.minutes >= DEFAULT_PLAN.windowB[0] && c.minutes < DEFAULT_PLAN.windowB[1]);
    }
  });

  it('counts the day the clocks went forward as one day for the daily cap', () => {
    const now = new Date('2026-03-08T20:00:00Z'); // 4:00 pm EDT
    const sentEarlier = new Date('2026-03-08T12:00:00Z').getTime(); // 8:00 am EDT, same local day
    const state: RetentionState = { ...EMPTY_STATE, seen: { nyc: ['old1'] }, sent: [{ type: 'B', at: sentEarlier, pending: false }] };
    const p = planRetention(base({ now, state, feedUpdatedAt: now.getTime() - HOUR, shows: many('s', 3, { startsAt: '2026-03-08T20:00:00-04:00' }) }));
    assert.equal(p.send === false && p.reason, 'daily_cap');
  });
});

describe('last-seen ids', () => {
  it('finds shows that were not in the last-seen set', () => {
    const state = markSeen(EMPTY_STATE, 'nyc', ['a', 'b']);
    const shows = [mk('a', { startsAt: '2026-10-20T20:00:00-04:00' }), mk('b', { startsAt: '2026-10-20T20:00:00-04:00' }), mk('c', { startsAt: '2026-10-20T20:00:00-04:00' })];
    assert.deepEqual(newShows(base({ state, shows }))!.map((s) => s.id), ['c']);
    assert.equal(newShows(base({ state: EMPTY_STATE, shows })), null);
  });

  it('keeps a separate set per city and bounds both', () => {
    let s = EMPTY_STATE;
    for (let i = 0; i < MAX_SEEN_CITIES + 3; i++) s = markSeen(s, `city${i}`, [`x${i}`]);
    assert.equal(Object.keys(s.seen).length, MAX_SEEN_CITIES);
    assert.ok(s.seen[`city${MAX_SEEN_CITIES + 2}`]);
    assert.equal(s.seen.city0, undefined);
    const big = markSeen(EMPTY_STATE, 'nyc', Array.from({ length: MAX_SEEN_IDS + 500 }, (_, i) => `id${i}`));
    assert.equal(big.seen.nyc.length, MAX_SEEN_IDS);
    assert.equal(big.seen.nyc.at(-1), `id${MAX_SEEN_IDS + 499}`);
    assert.equal(markSeen(EMPTY_STATE, 'nyc', ['a', 'a', 'b']).seen.nyc.length, 2);
  });

  it('a show that has left the feed and comes back is not "new" while its id is remembered', () => {
    const state = markSeen(EMPTY_STATE, 'nyc', ['a']);
    assert.deepEqual(newShows(base({ state, shows: [mk('a', { startsAt: '2026-10-20T20:00:00-04:00' })] })), []);
  });
});

describe('tapping a notification', () => {
  const filters = { ...DEFAULT_FILTERS, when: 'tonight' as const, genres: ['Rock'] as Genre[], price: 'free' as const };
  it('A: limits the deck to the new shows and remembers the filters to put back', () => {
    const t = planTap('A', null, ['a', 'b'], filters);
    assert.deepEqual(t.onlyIds, ['a', 'b']);
    assert.deepEqual(t.restore, { when: 'tonight', genres: ['Rock'], price: 'free' });
    assert.deepEqual(t.filters, { when: 'all', genres: [], price: 'any' });
  });
  it('A with nothing new changes nothing', () => {
    assert.deepEqual(planTap('A', null, [], filters), { filters: {}, restore: null, onlyIds: null });
  });
  it('B: filters to tonight and the genre', () => {
    assert.deepEqual(planTap('B', 'Punk', [], filters).filters, { when: 'tonight', genres: ['Punk'], price: 'any' });
    assert.deepEqual(planTap('B', null, [], filters).filters, { when: 'tonight', genres: [], price: 'any' });
  });
  it('reads the link', () => {
    assert.deepEqual(parseTapUrl('/?rt=B&g=Hip-Hop'), { type: 'B', genre: 'Hip-Hop' });
    assert.deepEqual(parseTapUrl('/?rt=A'), { type: 'A', genre: null });
    assert.equal(parseTapUrl('/show/1'), null);
    assert.equal(parseTapUrl(undefined), null);
    assert.equal(parseTapUrl('/?rt=Z'), null);
  });
});

describe('the background check, with fakes', () => {
  type Calls = { refreshed: string[]; scheduled: string[]; cancelled: number; saved: RetentionState[] };
  const make = (o: { flag?: boolean; gathered?: PlanInput | null; permission?: boolean; state?: RetentionState } = {}) => {
    const calls: Calls = { refreshed: [], scheduled: [], cancelled: 0, saved: [] };
    const input = o.gathered === undefined ? base({ now: at('16:00'), shows: tonight(3) }) : o.gathered;
    const g = input && { tz: input.tz, city: input.city, enabled: { metro: input.enabled.metro, typeA: input.enabled.typeA, typeB: input.enabled.typeB }, feedUpdatedAt: input.feedUpdatedAt, shows: input.shows, filters: input.filters, decisions: input.decisions };
    const deps: CheckDeps = {
      now: () => at('16:00'),
      notificationsFlagOn: async () => o.flag ?? true,
      gather: async () => g,
      refreshFeed: async (c) => void calls.refreshed.push(c),
      gatherAfterRefresh: async () => g,
      permissionGranted: async () => o.permission ?? true,
      loadState: async () => o.state ?? { ...EMPTY_STATE, seen: { nyc: ['old1'] } },
      saveState: async (s) => void calls.saved.push(s),
      schedule: async (p) => void calls.scheduled.push(`${p.type}:${p.n}`),
      cancelAll: async () => void calls.cancelled++,
    };
    return { deps, calls };
  };

  it('schedules one notification and records it', async () => {
    const { deps, calls } = make();
    const r = await runRetentionCheck(deps);
    assert.deepEqual(r, { outcome: 'scheduled', type: 'B', n: 3 });
    assert.deepEqual(calls.scheduled, ['B:3']);
    assert.deepEqual(calls.refreshed, ['nyc']);
    assert.equal(calls.saved.at(-1)!.sent.length, 1);
    assert.equal(calls.saved.at(-1)!.sent[0].pending, true);
    assert.deepEqual(calls.saved.at(-1)!.unreported, ['B']);
  });

  it('the kill switch off: cancels, downloads nothing, schedules nothing', async () => {
    const { deps, calls } = make({ flag: false });
    assert.deepEqual(await runRetentionCheck(deps), { outcome: 'skipped', reason: 'switched_off' });
    assert.equal(calls.cancelled, 1);
    assert.equal(calls.refreshed.length, 0);
    assert.equal(calls.scheduled.length, 0);
  });

  it('no city selected: nothing happens', async () => {
    const { deps, calls } = make({ gathered: null });
    assert.deepEqual(await runRetentionCheck(deps), { outcome: 'skipped', reason: 'no_city' });
    assert.equal(calls.scheduled.length, 0);
  });

  it('a city that is switched off, or both toggles off: no download and everything scheduled is cancelled', async () => {
    const off = make({ gathered: base({ now: at('16:00'), shows: tonight(3), enabled: { flag: true, metro: false, permission: true, typeA: true, typeB: true } }) });
    assert.deepEqual(await runRetentionCheck(off.deps), { outcome: 'skipped', reason: 'city_off' });
    assert.equal(off.calls.refreshed.length, 0);
    assert.equal(off.calls.cancelled, 1);
    const both = make({ gathered: base({ now: at('16:00'), shows: tonight(3), enabled: { flag: true, metro: true, permission: true, typeA: false, typeB: false } }) });
    assert.deepEqual(await runRetentionCheck(both.deps), { outcome: 'skipped', reason: 'both_off' });
    assert.equal(both.calls.refreshed.length, 0);
  });

  it('no permission: cancels and schedules nothing', async () => {
    const { deps, calls } = make({ permission: false });
    assert.deepEqual(await runRetentionCheck(deps), { outcome: 'skipped', reason: 'no_permission' });
    assert.equal(calls.cancelled, 1);
  });

  it('a skipped check still saves the settled state', async () => {
    const delivered: RetentionState = { ...EMPTY_STATE, seen: { nyc: ['old1'] }, sent: [{ type: 'A', at: at('15:00').getTime() - 20 * HOUR, pending: true }] };
    const { deps, calls } = make({ state: delivered, gathered: base({ now: at('16:00'), shows: tonight(1) }) });
    const r = await runRetentionCheck(deps);
    assert.equal(r.outcome, 'skipped');
    assert.equal(calls.saved.at(-1)!.sent[0].pending, false);
    assert.equal(calls.saved.at(-1)!.unopened, 1);
  });

  it('a feed that could not be refreshed and is too old sends nothing', async () => {
    const { deps, calls } = make({ gathered: base({ now: at('16:00'), shows: tonight(3), feedUpdatedAt: at('16:00').getTime() - 60 * HOUR }) });
    assert.deepEqual(await runRetentionCheck(deps), { outcome: 'skipped', reason: 'stale_feed' });
    assert.equal(calls.scheduled.length, 0);
  });
});

describe('cities', () => {
  it('notifications are on for New York and Los Angeles only', () => {
    assert.deepEqual(METROS.filter((m) => m.notificationsEnabled).map((m) => m.id).sort(), ['la', 'nyc']);
    assert.deepEqual(METROS.filter((m) => m.softLaunch).map((m) => m.id).sort(), ['la', 'nyc']);
  });
});
