/// <reference types="node" />
/**
 * Going counts on the phone: queue batching and retry, cache and refresh timing, hidden counts, the Settings switch, the
 * one-time note, the chip text, and Going staying local when the network is down. No network and no phone are used.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffGoing, localDate, queueChanges, shouldShowNote, switchOff, switchOn, type GoingLocal } from '../src/lib/going/core';
import { afterFailure, afterSuccess, enqueue, EMPTY_QUEUE, isDue, MAX_BATCH, MAX_PENDING, takeBatch, toChanges } from '../src/lib/going/queue';
import {
  COUNTS_BATCH,
  COUNTS_REFRESH_MS,
  COUNTS_RETRY_MS,
  EMPTY_COUNTS,
  flushGoing,
  parseCounts,
  refreshCounts,
  type CountsCache,
  type FlushDeps,
} from '../src/lib/going/sync';
import { formatGoing } from '../src/lib/shareText';

const base = (over: Partial<GoingLocal> = {}): GoingLocal => ({ goingId: 'id-1', include: true, noteShown: false, queue: EMPTY_QUEUE, ...over });
const dateOf = (id: string) => (id.startsWith('nodate') ? null : '2026-10-17');

function harness(opts: { flag?: boolean; include?: boolean; fail?: number } = {}) {
  let q = EMPTY_QUEUE;
  let t = 1_000_000;
  const sent: { show_id: string; going: boolean; date: string }[][] = [];
  let fail = opts.fail ?? 0;
  const deps: FlushDeps = {
    now: () => t,
    flagOn: () => opts.flag !== false,
    includeOn: () => opts.include !== false,
    getQueue: () => q,
    setQueue: (n) => void (q = n),
    send: async (c) => {
      if (fail > 0) {
        fail--;
        return false;
      }
      sent.push(c);
      return true;
    },
  };
  return { deps, sent, queue: () => q, set: (n: typeof q) => void (q = n), tick: (ms: number) => void (t += ms), now: () => t };
}

describe('queue', () => {
  it('keeps only the latest change per show (idempotent)', () => {
    let q = enqueue(EMPTY_QUEUE, 'a', true, '2026-10-17', 1);
    q = enqueue(q, 'a', false, '2026-10-17', 2);
    assert.equal(Object.keys(q.pending).length, 1);
    assert.equal(q.pending.a.going, false);
  });
  it('sends in batches of at most 50, oldest first', async () => {
    const h = harness();
    let q = EMPTY_QUEUE;
    for (let i = 0; i < 120; i++) q = enqueue(q, `s${i}`, true, '2026-10-17', i);
    h.set(q);
    assert.equal(await flushGoing(h.deps), 3);
    assert.deepEqual(h.sent.map((b) => b.length), [50, 50, 20]);
    assert.equal(h.sent[0][0].show_id, 's0');
    assert.equal(Object.keys(h.queue().pending).length, 0);
    assert.equal(MAX_BATCH, 50);
  });
  it('caps the queue and drops the oldest first', () => {
    let q = EMPTY_QUEUE;
    for (let i = 0; i < MAX_PENDING + 5; i++) q = enqueue(q, `s${i}`, true, '2026-10-17', i);
    assert.equal(Object.keys(q.pending).length, MAX_PENDING);
    assert.ok(!q.pending.s0 && q.pending[`s${MAX_PENDING + 4}`]);
  });
  it('keeps a change made while the request was in flight', () => {
    const q = enqueue(EMPTY_QUEUE, 'a', true, 'd', 1);
    const batch = takeBatch(q);
    const changed = enqueue(q, 'a', false, 'd', 2);
    assert.equal(afterSuccess(changed, batch).pending.a.going, false);
  });
  it('retries after a failure with a growing wait, and recovers', async () => {
    const h = harness({ fail: 2 });
    h.set(enqueue(EMPTY_QUEUE, 'a', true, '2026-10-17', 1));
    assert.equal(await flushGoing(h.deps), 0); // fails
    assert.equal(h.queue().failures, 1);
    assert.ok(!isDue(h.queue(), h.now()));
    assert.equal(await flushGoing(h.deps), 0); // not due: no call
    h.tick(31_000);
    assert.equal(await flushGoing(h.deps), 0); // fails again, wait doubles
    assert.equal(h.queue().failures, 2);
    const wait2 = (h.queue().retryAt ?? 0) - h.now();
    assert.equal(wait2, 60_000);
    h.tick(61_000);
    assert.equal(await flushGoing(h.deps), 1);
    assert.equal(h.queue().failures, 0);
    assert.equal(Object.keys(h.queue().pending).length, 0);
    assert.equal(h.sent.length, 1);
  });
  it('caps the retry wait at one hour', () => {
    let q = enqueue(EMPTY_QUEUE, 'a', true, 'd', 1);
    for (let i = 0; i < 20; i++) q = afterFailure(q, 0);
    assert.equal(q.retryAt, 3_600_000);
  });
  it('a send that throws counts as a failure and never reaches the caller', async () => {
    const h = harness();
    h.set(enqueue(EMPTY_QUEUE, 'a', true, 'd', 1));
    h.deps.send = async () => {
      throw new Error('offline');
    };
    assert.equal(await flushGoing(h.deps), 0);
    assert.equal(h.queue().failures, 1);
    assert.equal(Object.keys(h.queue().pending).length, 1); // still queued
  });
  it('sends nothing while the kill switch or the Settings switch is off', async () => {
    for (const o of [{ flag: false }, { include: false }]) {
      const h = harness(o);
      h.set(enqueue(EMPTY_QUEUE, 'a', true, 'd', 1));
      assert.equal(await flushGoing(h.deps), 0);
      assert.equal(h.sent.length, 0);
    }
  });
  it('the body carries only show id, going and the show date', () => {
    const c = toChanges(takeBatch(enqueue(EMPTY_QUEUE, 'jb-1', true, '2026-10-17', 1)));
    assert.deepEqual(c, [{ show_id: 'jb-1', going: true, date: '2026-10-17' }]);
  });
});

describe('Going changes', () => {
  it('finds adds and removals only', () => {
    const prev = { a: { decision: 'going' }, b: { decision: 'passed' }, c: { decision: 'going' } };
    const next = { a: { decision: 'passed' }, b: { decision: 'going' }, c: { decision: 'going' }, d: { decision: 'going' }, e: { decision: 'passed' } };
    assert.deepEqual(
      diffGoing(prev, next).sort((x, y) => x.showId.localeCompare(y.showId)),
      [
        { showId: 'a', going: false },
        { showId: 'b', going: true },
        { showId: 'd', going: true },
      ],
    );
    assert.deepEqual(diffGoing(next, next), []);
  });
  it('queues nothing when a switch is off or the date is unknown', () => {
    const ch = [{ showId: 'a', going: true }, { showId: 'nodate-b', going: true }];
    assert.equal(Object.keys(queueChanges(base(), ch, dateOf, 1, true).queue.pending).join(), 'a');
    assert.equal(queueChanges(base({ include: false }), ch, dateOf, 1, true).queue.pending.a, undefined);
    assert.equal(queueChanges(base(), ch, dateOf, 1, false).queue.pending.a, undefined);
  });
  it('Going stays fully local when the network is down: queueing and flushing never throw and the list is untouched', async () => {
    const h = harness();
    h.deps.send = async () => {
      throw new Error('network down');
    };
    const local = { a: { decision: 'going' } };
    const s = queueChanges(base(), diffGoing({}, local), dateOf, 1, true);
    h.set(s.queue);
    await flushGoing(h.deps);
    assert.equal(local.a.decision, 'going');
    assert.equal(Object.keys(h.queue().pending).length, 1);
  });
});

describe('Settings switch', () => {
  it('OFF empties the queue and stops sending', async () => {
    const s = switchOff(queueChanges(base(), [{ showId: 'a', going: true }], dateOf, 1, true));
    assert.equal(s.include, false);
    assert.equal(Object.keys(s.queue.pending).length, 0);
    assert.equal(Object.keys(queueChanges(s, [{ showId: 'b', going: true }], dateOf, 2, true).queue.pending).length, 0);
  });
  it('ON re-sends the current Going list, skipping shows that already happened', () => {
    const dates: Record<string, string> = { a: '2026-10-17', old: '2026-09-01', today: '2026-10-04' };
    const s = switchOn(switchOff(base()), ['a', 'old', 'today', 'nodate'], (id) => dates[id] ?? null, 5, '2026-10-04');
    assert.equal(s.include, true);
    assert.deepEqual(Object.keys(s.queue.pending).sort(), ['a', 'today']);
    assert.ok(Object.values(s.queue.pending).every((e) => e.going));
  });
});

describe('one-time note', () => {
  it('shows on the first Going only, and never for a removal or when sharing is off', () => {
    assert.equal(shouldShowNote(base(), [{ showId: 'a', going: true }]), true);
    assert.equal(shouldShowNote(base(), [{ showId: 'a', going: false }]), false);
    assert.equal(shouldShowNote(base({ noteShown: true }), [{ showId: 'a', going: true }]), false);
    assert.equal(shouldShowNote(base({ include: false }), [{ showId: 'a', going: true }]), false);
  });
});

describe('counts fetch and cache', () => {
  function ch(reply: (ids: string[]) => unknown | null | Promise<unknown>, flag = true) {
    let cache: CountsCache = EMPTY_COUNTS;
    let t = 5_000_000;
    const calls: string[][] = [];
    return {
      deps: {
        now: () => t,
        flagOn: () => flag,
        get: () => cache,
        set: (c: CountsCache) => void (cache = c),
        fetch: async (ids: string[]) => {
          calls.push(ids);
          return reply(ids);
        },
      },
      calls,
      cache: () => cache,
      tick: (ms: number) => void (t += ms),
    };
  }
  it('stores only what the server returns; shows missing from the reply are hidden', async () => {
    const h = ch(() => ({ a: 16, b: 40 }));
    assert.equal(await refreshCounts(h.deps, 'deck', ['a', 'b', 'c']), true);
    assert.deepEqual(h.cache().byId, { a: 16, b: 40 });
    assert.equal(h.cache().byId.c, undefined);
  });
  it('fetches a list at most once every 15 minutes', async () => {
    const h = ch(() => ({}));
    await refreshCounts(h.deps, 'deck', ['a']);
    h.tick(COUNTS_REFRESH_MS - 1000);
    assert.equal(await refreshCounts(h.deps, 'deck', ['a']), false);
    assert.equal(h.calls.length, 1);
    h.tick(2000);
    assert.equal(await refreshCounts(h.deps, 'deck', ['a']), true);
    assert.equal(h.calls.length, 2);
  });
  it('the two lists have separate timers', async () => {
    const h = ch(() => ({}));
    await refreshCounts(h.deps, 'deck', ['a']);
    await refreshCounts(h.deps, 'going', ['a']);
    assert.equal(h.calls.length, 2);
  });
  it('batches 50 ids at a time', async () => {
    const h = ch(() => ({}));
    const ids = Array.from({ length: 120 }, (_, i) => `s${i}`);
    await refreshCounts(h.deps, 'deck', ids);
    assert.deepEqual(h.calls.map((c) => c.length), [50, 50, 20]);
    assert.equal(COUNTS_BATCH, 50);
  });
  it('a failure shows nothing new, keeps the cache, and waits a minute before retrying', async () => {
    let fail = false;
    const h = ch(() => (fail ? null : { a: 20 }));
    await refreshCounts(h.deps, 'deck', ['a']);
    h.tick(COUNTS_REFRESH_MS + 1);
    fail = true;
    assert.equal(await refreshCounts(h.deps, 'deck', ['a']), false);
    assert.deepEqual(h.cache().byId, { a: 20 });
    assert.equal(await refreshCounts(h.deps, 'deck', ['a']), false); // inside the retry wait: no call
    assert.equal(h.calls.length, 2);
    h.tick(COUNTS_RETRY_MS + 1);
    fail = false;
    assert.equal(await refreshCounts(h.deps, 'deck', ['a']), true);
  });
  it('a thrown fetch is a failure too', async () => {
    const h = ch(() => {
      throw new Error('offline');
    });
    assert.equal(await refreshCounts(h.deps, 'deck', ['a']), false);
    assert.deepEqual(h.cache().byId, {});
  });
  it('with the kill switch off nothing is fetched and the cache is cleared', async () => {
    const h = ch(() => ({ a: 30 }));
    await refreshCounts(h.deps, 'deck', ['a']);
    const off = { ...h.deps, flagOn: () => false };
    assert.equal(await refreshCounts(off, 'deck', ['a']), false);
    assert.deepEqual(h.cache().byId, {});
    assert.equal(h.calls.length, 1);
  });
  it('ignores zero, negative, fractional and non-number values, so "0 going" cannot appear', () => {
    assert.deepEqual(parseCounts({ a: 0, b: -3, c: 2.5, d: '16', e: null, f: 17 }), { f: 17 });
    assert.equal(parseCounts([1, 2]), null);
    assert.equal(parseCounts('x'), null);
  });
  it('does not add to the count locally: the cache changes only through a fetch', async () => {
    const h = ch(() => ({ a: 16 }));
    await refreshCounts(h.deps, 'deck', ['a']);
    // Marking the show Going queues a change but touches no cached number.
    const s = queueChanges(base(), [{ showId: 'a', going: true }], dateOf, 1, true);
    assert.equal(Object.keys(s.queue.pending).length, 1);
    assert.equal(h.cache().byId.a, 16);
  });
});

describe('chip text and dates', () => {
  it('formats "N going"', () => {
    assert.equal(formatGoing(16), '16 going');
  });
  it('uses the show\'s own local date', () => {
    assert.equal(localDate(new Date(2026, 9, 7, 23, 30)), '2026-10-07');
    assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
  });
});
