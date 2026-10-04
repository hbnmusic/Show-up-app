import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';

import type { Row, Sql } from '../../supabase/functions/_shared/supabaseStore.ts';

/** A real Postgres (PGlite, WASM) with the project's fp schema loaded from the migration files and minimal stand-ins for Supabase's auth and public tables. */
export async function freshDb(): Promise<{ db: PGlite; sql: Sql }> {
  const db = new PGlite();
  await db.exec(`
    create role service_role; create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create table public.banned_users (user_id uuid primary key references auth.users (id) on delete cascade);
    create table public.trusted_users (user_id uuid primary key references auth.users (id) on delete cascade);
  `);
  await db.exec(readFileSync(new URL('../../supabase/migrations/005_first_party_listings.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/007_seed_metro_config.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/008_flyer_jobs_claimed_at.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/018_app_flags.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/020_soft_launch.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/021_going_counts.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/022_going_flag_row.sql', import.meta.url), 'utf8'));
  await db.exec(`
    create table public.terms_acceptances (user_id uuid, version text);
    create function public.pu_terms_version() returns text language sql as $$ select '2026-10-04'::text $$;
    create function public.pu_accepted_terms(uid uuid) returns boolean language sql as $$ select exists (select 1 from public.terms_acceptances where user_id = uid and version = public.pu_terms_version()) $$;
  `);
  const sql: Sql = async (strings, ...values) => {
    let text = '';
    strings.forEach((s, i) => { text += s + (i < values.length ? `$${i + 1}` : ''); });
    const r = await db.query<Row>(text, values as unknown[]);
    return r.rows;
  };
  return { db, sql };
}
