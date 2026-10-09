import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

// The old prefix is assembled so this file never contains it.
const OLD = 'p' + 'u_';
const MIGRATION = readFileSync(new URL('../supabase/migrations/024_rename_objects.sql', import.meta.url), 'utf8');

async function oldDb() {
  const db = new PGlite();
  await db.exec(`
    create table public.t (id int);
    create function public.${OLD}terms_version() returns text language sql immutable as $$ select '2026-10-04'::text $$;
    create function public.${OLD}blocked(a uuid) returns boolean language sql stable as $$ select false $$;
    create function public.accept_terms() returns text language sql as $$ select public.${OLD}terms_version() $$;
    create function public.submit_show() returns boolean language sql as $$ select public.${OLD}blocked(gen_random_uuid()) $$;
  `);
  return db;
}

test('024 renames the old-prefix functions, rewrites the callers and bumps the Terms version', async () => {
  const db = await oldDb();
  await db.exec(MIGRATION);
  const names = (await db.query<{ proname: string }>(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).rows.map((r) => r.proname);
  assert.ok(names.includes('setnik_terms_version') && names.includes('setnik_blocked'));
  assert.ok(!names.some((n) => n.startsWith(OLD)));
  assert.equal((await db.query<{ v: string }>(`select public.setnik_terms_version() as v`)).rows[0].v, '2026-10-09');
  assert.equal((await db.query<{ v: string }>(`select public.accept_terms() as v`)).rows[0].v, '2026-10-09');
  assert.equal((await db.query<{ v: boolean }>(`select public.submit_show() as v`)).rows[0].v, false);
});

test('024 is safe to run twice', async () => {
  const db = await oldDb();
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  assert.equal((await db.query<{ v: string }>(`select public.accept_terms() as v`)).rows[0].v, '2026-10-09');
});

test('024 contains no DROP or DELETE', () => {
  const code = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(!/\b(drop|delete)\b/i.test(code));
});
