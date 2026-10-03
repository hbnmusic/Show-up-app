/// <reference types="node" />
/** Analytics and feedback rules that run without a phone: property cleaning, ids, queue limits, the event sink, form checks. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanProps, enqueue, EVENT_NAMES, MAX_QUEUE, setSink, track, UUID_RE, uuid, type AnalyticsEvent } from '../src/lib/analyticsCore';
import { feedbackErrors, FEEDBACK_MAX } from '../src/lib/feedbackCore';

const ev = (n: number): AnalyticsEvent => ({ name: 'app_open', props: { n }, at: new Date(n).toISOString() });

describe('analytics properties', () => {
  it('keeps short scalars and drops everything else', () => {
    const p = cleanProps({ d: 'going', n: 3, ok: true, long: 'x'.repeat(61), obj: { a: 1 }, arr: [1], nan: NaN, nil: null, ['k'.repeat(31)]: 'a' });
    assert.deepEqual(p, { d: 'going', n: 3, ok: true });
  });
  it('keeps at most 8 properties', () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]));
    assert.equal(Object.keys(cleanProps(many)).length, 8);
  });
  it('handles missing input', () => {
    assert.deepEqual(cleanProps(undefined), {});
  });
});

describe('install ids', () => {
  it('look like version-4 uuids and differ', () => {
    const a = uuid();
    assert.match(a, UUID_RE);
    assert.notEqual(a, uuid());
  });
});

describe('event queue', () => {
  it('drops the oldest events past the limit', () => {
    let q: AnalyticsEvent[] = [];
    for (let i = 0; i < MAX_QUEUE + 5; i++) q = enqueue(q, ev(i));
    assert.equal(q.length, MAX_QUEUE);
    assert.equal(q[0].props.n, 5);
  });
  it('lists only events that contain no free text', () => {
    assert.ok(EVENT_NAMES.includes('decision'));
    assert.ok(!(EVENT_NAMES as readonly string[]).includes('search_query'));
  });
});

describe('track', () => {
  it('sends cleaned properties to the sink and never throws', () => {
    const seen: { name: string; props: unknown }[] = [];
    setSink((name, props) => seen.push({ name, props }));
    track('decision', { d: 'going', secret: { a: 1 } });
    setSink(() => {
      throw new Error('boom');
    });
    assert.doesNotThrow(() => track('app_open'));
    setSink(null);
    assert.deepEqual(seen, [{ name: 'decision', props: { d: 'going' } }]);
  });
});

describe('feedback form', () => {
  it('needs a message', () => {
    assert.equal(feedbackErrors('  ', '').length, 1);
    assert.equal(feedbackErrors('It crashed', '').length, 0);
  });
  it('limits the message and checks an optional email', () => {
    assert.equal(feedbackErrors('x'.repeat(FEEDBACK_MAX + 1), '').length, 1);
    assert.equal(feedbackErrors('hi', 'not-an-email').length, 1);
    assert.equal(feedbackErrors('hi', 'a@b.co').length, 0);
  });
});
