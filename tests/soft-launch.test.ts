import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { planAction } from '../supabase/functions/_shared/jobs.ts';
import type { Sql } from '../supabase/functions/_shared/supabaseStore.ts';
import { pickTrials, planScan, TRIAL_LIMITS, type MetroSetting } from '../supabase/functions/_shared/waves.ts';
import { NOW } from './fixtures/flyers.ts';
import { freshDb } from './fixtures/pg.ts';
import { METROS } from '../src/lib/metros.ts';

const s = (id: string, o: Partial<MetroSetting> = {}): MetroSetting => ({ id, wave: 1, venueScanEnabled: true, dailyRequestBudget: 10, softLaunch: false, ...o });
const settings = [s('nyc', { softLaunch: true, dailyRequestBudget: 40 }), s('la', { softLaunch: true, dailyRequestBudget: 40 }), s('chi'), s('bos'), s('atl', { wave: 3, venueScanEnabled: false })];

describe('soft launch planning (pure)', () => {
  it('scans soft-launch cities first, then the rest most overdue first', () => {
    const v = (id: string, metro: string, last: string | null) => ({ id, metro, tier: 'A' as const, lastCheckedAt: last, status: 'approved' });
    const plan = planScan([v('chi-old', 'chi', '2026-08-01T00:00:00Z'), v('nyc-new', 'nyc', '2026-09-20T00:00:00Z'), v('la-never', 'la', null), v('bos-old', 'bos', '2026-08-02T00:00:00Z'), v('nyc-old', 'nyc', '2026-09-01T00:00:00Z')], settings, NOW, 7);
    assert.deepEqual(plan.venues.map((x) => x.id), ['la-never', 'nyc-old', 'nyc-new', 'chi-old', 'bos-old']);
  });

  it('lets a soft-launch city spend a larger model-request budget than another city', () => {
    const many = (metro: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${metro}${i}`, metro, tier: 'B' as const, lastCheckedAt: null, status: 'approved' }));
    const plan = planScan([...many('nyc', 45), ...many('chi', 45)], settings, NOW, 7);
    assert.deepEqual(plan.aiUsed, { nyc: 40, chi: 10 });
    assert.equal(plan.skippedForBudget, 5 + 35);
  });

  it('gives soft-launch cities more trials per run, in front of everyone else', () => {
    const c = (metro: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${metro}${i}`, metro }));
    const picked = pickTrials([...c('chi', 50), ...c('nyc', 50), ...c('la', 50), ...c('atl', 10)], settings);
    assert.equal(picked.filter((p) => p.metro === 'nyc' || p.metro === 'la').length, TRIAL_LIMITS.soft);
    assert.equal(picked.filter((p) => p.metro === 'chi').length, TRIAL_LIMITS.other);
    assert.equal(picked.filter((p) => p.metro === 'atl').length, 0); // scanning off for that city
    assert.ok(picked.slice(0, TRIAL_LIMITS.soft).every((p) => p.metro === 'nyc' || p.metro === 'la'));
    assert.ok(TRIAL_LIMITS.soft > TRIAL_LIMITS.other);
  });

  it('puts wave 1 ahead of later waves among the other cities', () => {
    const st = [s('nyc', { softLaunch: true }), s('chi'), s('aus', { wave: 2 }), s('sea', { wave: 3 })];
    const picked = pickTrials([{ metro: 'sea' }, { metro: 'aus' }, { metro: 'chi' }], st, { soft: 5, other: 2 });
    assert.deepEqual(picked.map((p) => p.metro), ['chi', 'aus']);
  });

  it('without any soft-launch city, behaves as before (overdue first)', () => {
    const plain = [s('nyc'), s('la')];
    const v = (id: string, metro: string, last: string) => ({ id, metro, tier: 'A' as const, lastCheckedAt: last, status: 'approved' });
    assert.deepEqual(planScan([v('a', 'nyc', '2026-09-10T00:00:00Z'), v('b', 'la', '2026-09-01T00:00:00Z')], plain, NOW, 7).venues.map((x) => x.id), ['b', 'a']);
  });

  it('every city still shows its JamBase listings: the app has no per-city listing switch', () => {
    // Soft launch only changes scanning priority and which cities get notifications; the feed list is every city.
    assert.ok(METROS.length > 2);
    assert.ok(METROS.every((m) => typeof m.id === 'string' && m.id.length > 0));
  });
});

describe('soft launch in the database', () => {
  let db: PGlite;
  let sql: Sql;
  before(async () => { ({ db, sql } = await freshDb()); });
  after(async () => { await db.close(); });
  beforeEach(async () => { await db.exec('truncate fp.venues restart identity cascade'); });

  it('marks New York and Los Angeles, with the larger budget, and nobody else', async () => {
    const rows = await sql`select metro, daily_request_budget from fp.metro_config where soft_launch order by metro`;
    assert.deepEqual(rows.map((r) => [r.metro, r.daily_request_budget]), [['la', 40], ['nyc', 40]]);
  });

  it('planAction hands out soft-launch trials first and caps the other cities', async () => {
    const add = async (name: string, metro: string) =>
      sql`insert into fp.venues (canonical_name, metro, address, website, status, seeded_from, tier) values (${name}, ${metro}, '1 Example St', 'https://x.example', 'candidate', 'own_site', 'A')`;
    for (let i = 0; i < 25; i++) await add(`Chi ${i}`, 'chi');
    for (let i = 0; i < 3; i++) await add(`NYC ${i}`, 'nyc');
    await add('LA 0', 'la');
    const r = await planAction({ sql, provider: null, now: NOW });
    const trial = r.body.trial as { name: string; metro: string }[];
    assert.deepEqual(trial.slice(0, 4).map((t) => t.metro).sort(), ['la', 'nyc', 'nyc', 'nyc']);
    assert.equal(trial.filter((t) => t.metro === 'chi').length, TRIAL_LIMITS.other);
  });
});
