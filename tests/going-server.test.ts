import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { freshDb } from './fixtures/pg.ts';

let db: PGlite;
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

before(async () => { ({ db } = await freshDb()); });
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('delete from going.rows; delete from going.counts; delete from going.limits; delete from going.excluded; update public.app_flags set enabled = true where key = \'going_counts_enabled\';');
});

const set = (id: string, show: string, going = true, date = day(10)) =>
  db.query('select public.set_going($1::uuid, $2::jsonb)', [id, JSON.stringify([{ show_id: show, going, date }])]);
const fill = async (show: string, n: number, base = 100) => { for (let i = 0; i < n; i++) await set(U(base + i), show); };
const counts = async (...ids: string[]) => (await db.query<{ r: Record<string, number> }>('select public.get_going_counts($1::text[]) as r', [ids])).rows[0].r;
const internal = async (show: string) => (await db.query<{ n: number }>('select n from going.counts where show_id = $1', [show])).rows[0]?.n ?? 0;

describe('going counts (server)', () => {
  it('shows no count at exactly 15 and a count at 16', async () => {
    await fill('s1', 15);
    assert.deepEqual(await counts('s1'), {});
    await set(U(999), 's1');
    assert.deepEqual(await counts('s1'), { s1: 16 });
  });

  it('removing one drops a shown count back to hidden', async () => {
    await fill('s1', 16);
    await set(U(100), 's1', false);
    assert.deepEqual(await counts('s1'), {});
    assert.equal(await internal('s1'), 15);
  });

  it('counts duplicate calls once and two ids twice', async () => {
    await set(U(1), 's1'); await set(U(1), 's1'); await set(U(1), 's1');
    assert.equal(await internal('s1'), 1);
    await set(U(2), 's1');
    assert.equal(await internal('s1'), 2);
    await set(U(2), 's1', false); await set(U(2), 's1', false);
    assert.equal(await internal('s1'), 1);
  });

  it('batches several shows in one call', async () => {
    await db.query('select public.set_going($1::uuid, $2::jsonb)', [U(1), JSON.stringify([{ show_id: 'a', going: true, date: day(5) }, { show_id: 'b', going: true, date: day(6) }])]);
    assert.equal(await internal('a'), 1);
    assert.equal(await internal('b'), 1);
  });

  it('returns only counts over the threshold, for up to 50 ids, and never a smaller number', async () => {
    await fill('big', 16); await fill('small', 3, 500);
    assert.deepEqual(await counts('big', 'small', 'missing'), { big: 16 });
    const many = Array.from({ length: 60 }, (_, i) => `x${i}`);
    assert.deepEqual(await counts(...many, 'big'), {}); // 'big' is past the 50 allowed ids
    // The threshold lives in config: raising it hides the count again.
    await db.exec("update going.config set value = '20' where key = 'going_count_min_display'");
    assert.deepEqual(await counts('big'), {});
    await db.exec("update going.config set value = '16' where key = 'going_count_min_display'");
  });

  it('ignores changes over 200 a day, quietly', async () => {
    const changes = Array.from({ length: 50 }, (_, i) => ({ show_id: `d${i}`, going: true, date: day(5) }));
    for (let i = 0; i < 5; i++) await db.query('select public.set_going($1::uuid, $2::jsonb)', [U(7), JSON.stringify(changes.map((c) => ({ ...c, show_id: `${c.show_id}-${i}` })))]);
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from going.rows where going_id = $1', [U(7)])).rows[0].n, 200);
    await set(U(7), 'one-more'); // no error, no row
    assert.equal(await internal('one-more'), 0);
    await set(U(8), 'one-more'); // another phone is not affected
    assert.equal(await internal('one-more'), 1);
  });

  it('ignores bad input without an error', async () => {
    await db.query('select public.set_going($1::uuid, $2::jsonb)', [U(1), JSON.stringify([{ going: true, date: day(1) }, { show_id: 'x'.repeat(200), going: true, date: day(1) }, { show_id: 'ok', going: 'yes', date: day(1) }, { show_id: 'ok', going: true, date: 'not a date' }, { show_id: 'ok', going: true, date: '1999-01-01' }])]);
    await db.query('select public.set_going($1::uuid, $2::jsonb)', [U(1), '"nope"']);
    await db.query('select public.set_going(null, $1::jsonb)', ['[]']);
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from going.rows')).rows[0].n, 0);
  });

  it('deletes rows 7 days after the show date and keeps no history', async () => {
    await db.exec(`insert into going.rows (show_id, going_id, show_date) values ('old', '${U(1)}', current_date - 8), ('recent', '${U(1)}', current_date - 6), ('future', '${U(1)}', current_date + 3);
      insert into going.counts (show_id, n, show_date) values ('old', 1, current_date - 8), ('recent', 1, current_date - 6), ('future', 1, current_date + 3);
      insert into going.limits (going_id, day, changes) values ('${U(1)}', current_date - 5, 4);`);
    await db.exec('select going.purge_old()');
    assert.deepEqual((await db.query<{ show_id: string }>('select show_id from going.rows order by 1')).rows.map((r) => r.show_id), ['future', 'recent']);
    assert.equal(await internal('old'), 0);
    assert.equal((await db.query('select 1 from going.limits where day < current_date - 2')).rows.length, 0);
  });

  it('forget_my_going deletes this phone only and updates counts', async () => {
    await set(U(1), 'a'); await set(U(1), 'b'); await set(U(2), 'a');
    await db.query('select public.forget_my_going($1::uuid)', [U(1)]);
    assert.equal((await db.query('select 1 from going.rows where going_id = $1', [U(1)])).rows.length, 0);
    assert.equal(await internal('a'), 1);
    assert.equal(await internal('b'), 0);
  });

  it('with the switch off, returns nothing and stops writes; forget still works; the purge command empties everything', async () => {
    await fill('s1', 16);
    await db.exec("update public.app_flags set enabled = false where key = 'going_counts_enabled'");
    assert.deepEqual(await counts('s1'), {});
    await set(U(900), 's1');
    assert.equal(await internal('s1'), 16);
    await db.query('select public.forget_my_going($1::uuid)', [U(100)]);
    assert.equal(await internal('s1'), 15);
    await db.exec('select going.purge_all()');
    assert.equal((await db.query('select 1 from going.rows')).rows.length + (await db.query('select 1 from going.counts')).rows.length, 0);
  });

  it('an excluded show returns no count, and a re-keyed show keeps one row per phone', async () => {
    await fill('s1', 16);
    await db.exec("insert into going.excluded (show_id) values ('s1')");
    assert.deepEqual(await counts('s1'), {});
    await db.exec("delete from going.excluded");
    await set(U(1), 'fp:abc'); await set(U(2), 'fp:abc'); await set(U(2), 'jb-9'); await set(U(3), 'jb-9');
    await db.exec("select going.rekey_show('fp:abc', 'jb-9')");
    assert.equal(await internal('jb-9'), 3);
    assert.equal(await internal('fp:abc'), 0);
  });

  it('a missing flag row counts as ON (before migration 022 is run)', async () => {
    await db.exec("delete from public.app_flags where key = 'going_counts_enabled'");
    await fill('s1', 16);
    assert.deepEqual(await counts('s1'), { s1: 16 });
    await db.exec("insert into public.app_flags (key) values ('going_counts_enabled')");
  });

  it('clients cannot read or write the tables, but can call the three functions', async () => {
    await set(U(1), 's1');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(() => db.query('select * from going.rows'));
        await assert.rejects(() => db.query('select * from going.counts'));
        await assert.rejects(() => db.query("insert into going.rows (show_id, going_id, show_date) values ('x', gen_random_uuid(), current_date)"));
        await assert.rejects(() => db.query('select going.purge_all()'));
        await db.query('select public.get_going_counts($1::text[])', [['s1']]);
        await db.query('select public.set_going($1::uuid, $2::jsonb)', [U(5), '[]']);
        await db.query('select public.forget_my_going($1::uuid)', [U(5)]);
      } finally {
        await db.exec('reset role');
      }
    }
  });
});
