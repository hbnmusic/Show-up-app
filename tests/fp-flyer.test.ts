import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseModelOutput } from '../supabase/functions/_shared/flyerSchema.ts';
import { decidePublish, pendingReason } from '../supabase/functions/_shared/publish.ts';
import { redactText } from '../supabase/functions/_shared/redact.ts';
import { validateFlyer, type ValidationContext } from '../supabase/functions/_shared/validate.ts';
import { BASEMENT, BROOKLYN, METROS, MONTREAL_FR, NOW, REGISTRY, TOUR, UNSUPPORTED_FIELDS, WRONG_WEEKDAY, ev, f, resp } from './fixtures/flyers.ts';

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({ metros: METROS, registry: REGISTRY, now: NOW, fetchedAt: NOW.toISOString(), hintMetro: 'nyc', ...over });
const run = (fx: { ocr: string; model: unknown }, over: Partial<ValidationContext> = {}) => validateFlyer(parseModelOutput(fx.model, fx.ocr), ctx(over));

describe('flyer extraction', () => {
  it('reads a normal English flyer into one candidate with the registry address', () => {
    const r = run(BROOKLYN);
    assert.equal(r.outcome, 'ok');
    const c = r.candidates[0];
    assert.equal(c.headliner, 'Velvet Automaton');
    assert.deepEqual(c.supports, ['Gentle Moth', 'Tin Orchard']);
    assert.equal(c.venueId, 'v-parkside');
    assert.equal(c.localDate, '2026-10-16');
    assert.equal(c.doorsLocal, '19:00');
    assert.equal(c.startLocal, '20:00');
    assert.deepEqual(c.price, { min: 15, max: 18 });
    assert.equal(c.agePolicy, 'ALL AGES');
    assert.equal(c.ticketUrl, 'https://parksidehall.example/velvet');
    assert.equal(c.address, '100 Example Ave, Brooklyn, NY');
    assert.equal(c.addressMode, 'registry');
    assert.equal(c.inferredYear, true);
    assert.equal(c.sourceType, 'flyer');
    assert.equal(c.licence, 'first_party');
    assert.deepEqual(c.genres, []); // none stated: nothing guessed
  });

  it('reads a French Montréal flyer (weekday, month, "20 h", dollars after the number)', () => {
    const r = run(MONTREAL_FR, { hintMetro: null });
    assert.equal(r.outcome, 'ok');
    const c = r.candidates[0];
    assert.equal(c.metro, 'mtl');
    assert.equal(c.localDate, '2026-10-16');
    assert.equal(c.doorsLocal, '20:00');
    assert.equal(c.startLocal, '21:30');
    assert.deepEqual(c.price, { min: 15, max: 20 });
  });

  it('splits a tour flyer per date, keeps covered metros and drops the others with a reason', () => {
    const r = run(TOUR);
    assert.deepEqual(r.candidates.map((c) => [c.metro, c.localDate]), [['nyc', '2026-10-16'], ['chi', '2026-10-17'], ['tor', '2026-10-20']]);
    assert.deepEqual(r.rejects.map((x) => x.reason), ['not_covered']); // Denver is not a covered metro
    assert.equal(r.candidates[2].addressMode, 'withheld'); // Toronto venue is not in the registry
  });

  it('shows no street address when the venue is not in the registry or the flyer says to ask', () => {
    const r = run(BASEMENT);
    assert.equal(r.outcome, 'ok');
    const c = r.candidates[0];
    assert.equal(c.venueId, null);
    assert.equal(c.address, undefined);
    assert.equal(c.addressMode, 'withheld');
    assert.equal(c.city, 'Brooklyn');
    // A resolved venue whose flyer says "DM for address" also gets no address.
    const asked = { ocr: `PARKSIDE HALL\nOWL CLUB\nFRI OCT 16\nask for address`, model: resp([ev({ headliner: f('Owl Club', 'OWL CLUB'), venue: f('Parkside Hall', 'PARKSIDE HALL'), address: f('ask for address', 'ask for address'), date: f('FRI OCT 16', 'FRI OCT 16') })]) };
    const c2 = run(asked).candidates[0];
    assert.equal(c2.venueId, 'v-parkside');
    assert.equal(c2.addressMode, 'withheld');
  });

  it('rejects a weekday that does not match the printed date', () => {
    const r = run(WRONG_WEEKDAY);
    assert.equal(r.outcome, 'no_events');
    assert.equal(r.rejects[0].reason, 'weekday_mismatch');
  });

  it('rejects past dates', () => {
    const past = { ocr: `PARKSIDE HALL\nOLD NEWS\nSEPT 12 2026`, model: resp([ev({ headliner: f('Old News', 'OLD NEWS'), venue: f('Parkside Hall', 'PARKSIDE HALL'), date: f('SEPT 12 2026', 'SEPT 12 2026') })]) };
    assert.equal(run(past).rejects[0].reason, 'past');
  });

  it('drops model fields whose quoted text is not on the flyer', () => {
    const r = run(UNSUPPORTED_FIELDS);
    const c = r.candidates[0];
    assert.equal(c.price, undefined);
    assert.deepEqual(c.genres, []);
    assert.equal(c.headliner, 'Honey Radio');
  });

  it('discards non-flyers, unsafe content and unparseable model output', () => {
    assert.equal(run({ ocr: 'grocery list', model: resp([], { is_flyer: false }) }).outcome, 'not_flyer');
    assert.equal(run({ ocr: 'x', model: resp([], { is_safe: false }) }).outcome, 'unsafe');
    assert.equal(run({ ocr: 'x', model: 'not json{' }).outcome, 'not_flyer');
    assert.equal(run({ ocr: 'x', model: null }).outcome, 'not_flyer');
  });

  it('does not guess between two similarly named venues', () => {
    const twins = [...REGISTRY, { id: 'v-parkside2', name: 'Parkside Hall', aliases: [], metro: 'nyc' }];
    const r = run(BROOKLYN, { registry: twins });
    assert.equal(r.candidates[0].venueId, null);
  });
});

describe('publishing rule', () => {
  it('publishes only when confidence is high and corroborated or trusted', () => {
    assert.equal(decidePublish({ confidence: 0.95, corroborated: true, trusted: false }), 'publish');
    assert.equal(decidePublish({ confidence: 0.95, corroborated: false, trusted: true }), 'publish');
    assert.equal(decidePublish({ confidence: 0.95, corroborated: false, trusted: false }), 'pending');
    assert.equal(decidePublish({ confidence: 0.6, corroborated: true, trusted: true }), 'pending');
    assert.equal(pendingReason({ confidence: 0.6, corroborated: true, trusted: true }), 'low_confidence');
    assert.equal(pendingReason({ confidence: 0.95, corroborated: false, trusted: false }), 'needs_confirmation');
    assert.equal(pendingReason({ confidence: 0.95, corroborated: true, trusted: false }), null);
  });
});

describe('redaction', () => {
  it('removes emails, phones, handles and social links but keeps ticket links', () => {
    const out = redactText('Book: dj@example.com or (212) 555-0147 / 212.555.0148 · IG @velvetautomaton · instagram.com/velvet · tix parksidehall.example/velvet · $15 8PM');
    assert.ok(!/dj@example|555|@velvet|instagram/.test(out), out);
    assert.ok(out.includes('parksidehall.example/velvet'));
    assert.ok(out.includes('$15 8PM'));
  });
});
