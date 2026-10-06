-- 023: closed-beta clean-up. Run by the owner in the Supabase SQL Editor (the assistant's connector refuses DROP statements).
-- Safe to run twice: every statement uses IF EXISTS or checks first. Run the whole block at once.
--
-- WHAT EACH PART DOES, IN PLAIN WORDS (row counts checked 2026-10-06):
--  A. Rewrites the public show feed function (public.fp_public_shows) so it no longer returns an "agePolicy" field. Must run before D.
--  B. Drops the 11 old prototype tables in schema public, plus their triggers, foreign keys and policies. The old "Allow all" policies
--     let anyone with the public app key read (and for 6 tables, write and delete) every row. Row counts that will be deleted:
--       profiles 4 (none linked to a sign-in: auth.users has 0 rows), invite_codes 3, events 322 (an old copy of listings),
--       venues 5 (this is public.venues, NOT fp.venues, which is untouched), event_attendance 25, user_swipes 5, matches 3,
--       chat_rooms 3, chat_members 6, potential_crews 8, messages 0, crew_opt_ins 0.   Total 384 rows of prototype test data.
--     The current app does not read or write any of these tables (searched src, scripts, supabase/functions, tests, workflows).
--     Your tables public.submissions, confirmations, reports, terms_acceptances, user_blocks, user_reports, trusted_users, banned_users,
--     app_flags, and everything in fp, going and ops are NOT touched.
--  C. Drops the 3 old prototype functions (handle_concert_swipe, check_and_create_dual_match, process_crew_opt_in).
--  D. Drops the unused age_policy column on public.submissions and fp.shows (both are empty or nearly: fp.shows had 1 value, submissions 0 rows).
--  E. Pins search_path on fp.no_rewrite, public.touch_app_flag and the five going.* functions (clears the security-advisor warnings).
--  F. Removes any policy named "Allow all ..." on realtime.messages. The 2026-10-06 check found none in that table (the "Allow all manage
--     messages" policy was on public.messages, which B drops), so this is a no-op safety net.

-- A. fp_public_shows without agePolicy
do $$
declare def text;
begin
  if to_regprocedure('public.fp_public_shows(text)') is null then return; end if;
  select pg_get_functiondef('public.fp_public_shows(text)'::regprocedure) into def;
  if def like '%agePolicy%' then
    def := replace(def, '''agePolicy'', s.age_policy, ', '');
    execute def;
  end if;
end $$;

-- B. Old prototype tables (CASCADE removes their triggers, foreign keys and policies)
drop table if exists public.user_swipes cascade;
drop table if exists public.event_attendance cascade;
drop table if exists public.messages cascade;
drop table if exists public.chat_members cascade;
drop table if exists public.matches cascade;
drop table if exists public.crew_opt_ins cascade;
drop table if exists public.potential_crews cascade;
drop table if exists public.chat_rooms cascade;
drop table if exists public.invite_codes cascade;
drop table if exists public.profiles cascade;
drop table if exists public.events cascade;
drop table if exists public.venues cascade;

-- C. Old prototype functions
drop function if exists public.handle_concert_swipe() cascade;
drop function if exists public.check_and_create_dual_match() cascade;
drop function if exists public.process_crew_opt_in() cascade;

-- D. Unused age_policy columns (their check constraint goes with the column)
alter table if exists public.submissions drop column if exists age_policy;
alter table if exists fp.shows drop column if exists age_policy;

-- E. Fixed search_path on the remaining functions the advisor flagged
do $$
begin
  if to_regprocedure('fp.no_rewrite()') is not null then alter function fp.no_rewrite() set search_path = fp, public; end if;
  if to_regprocedure('public.touch_app_flag()') is not null then alter function public.touch_app_flag() set search_path = public; end if;
  if to_regprocedure('going.cfg(text,integer)') is not null then alter function going.cfg(text, integer) set search_path = going, public; end if;
  if to_regprocedure('going.recount(text[])') is not null then alter function going.recount(text[]) set search_path = going, public; end if;
  if to_regprocedure('going.purge_old()') is not null then alter function going.purge_old() set search_path = going, public; end if;
  if to_regprocedure('going.purge_all()') is not null then alter function going.purge_all() set search_path = going, public; end if;
  if to_regprocedure('going.rekey_show(text,text)') is not null then alter function going.rekey_show(text, text) set search_path = going, public; end if;
end $$;

-- F. "Allow all" policies on realtime.messages (no-op if none exist or the SQL Editor role may not alter that table)
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname ilike 'allow all%' loop
    begin
      execute format('drop policy %I on realtime.messages', r.policyname);
    exception when insufficient_privilege then
      raise notice 'could not drop policy % on realtime.messages (not the owner); remove it in Dashboard > Realtime > Policies', r.policyname;
    end;
  end loop;
end $$;

-- Check after running (all should return the shown result):
--   select count(*) from information_schema.tables where table_schema = 'public' and table_name in
--     ('profiles','events','venues','messages','matches','chat_rooms','chat_members','invite_codes','user_swipes','event_attendance','potential_crews','crew_opt_ins');  -- 0
--   select count(*) from information_schema.columns where column_name = 'age_policy';                                                                           -- 0
--   select public.fp_public_shows('nyc') ->> 0 like '%agePolicy%';                                                                                              -- false
