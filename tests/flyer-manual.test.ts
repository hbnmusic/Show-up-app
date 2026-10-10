import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { needsManualEntry, type Outcome } from '../src/lib/flyer/share.ts';
import { canAddByHand } from '../src/lib/flyer/status.ts';

const submitted = (result: string | undefined, reason?: string | null, status = 'done'): Outcome => ({ kind: 'submitted', reply: { result, reason, status } });

describe('offer to type the details in by hand', () => {
  it('is offered when nothing readable or no flyer was found', () => {
    for (const k of ['link_failed', 'no_text', 'too_long', 'unavailable'] as const) assert.equal(needsManualEntry({ kind: k }), true, k);
  });
  it('is offered when the reader says it is not a flyer or found no show', () => {
    assert.equal(needsManualEntry(submitted('rejected', 'not_a_flyer')), true);
    assert.equal(needsManualEntry(submitted('rejected', 'no_events')), true);
    assert.equal(needsManualEntry(submitted('rejected', 'weekday_mismatch')), true);
    assert.equal(needsManualEntry(submitted('rejected', null)), true);
  });
  it('is not offered when it would not help: past date, blocked account, unsafe content, accepted flyers, pauses, network errors', () => {
    for (const r of ['past_date', 'banned', 'unsafe', 'removed_or_blocked', 'too_far']) assert.equal(needsManualEntry(submitted('rejected', r)), false, r);
    assert.equal(needsManualEntry(submitted('published')), false);
    assert.equal(needsManualEntry(submitted('pending')), false);
    assert.equal(needsManualEntry(submitted('processing')), false);
    assert.equal(needsManualEntry(submitted('rejected', 'not_a_flyer', 'paused')), false);
    assert.equal(needsManualEntry({ kind: 'error', code: 'network', message: 'x' }), false);
  });
  it('the My flyers list uses the same reason rule', () => {
    assert.equal(canAddByHand('not_a_flyer'), true);
    assert.equal(canAddByHand('past_date'), false);
    assert.equal(canAddByHand(null), true);
  });
});
