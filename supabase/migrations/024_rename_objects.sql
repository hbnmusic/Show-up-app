-- 024: rename the old-name database functions to setnik_* and bump the Terms version to 2026-10-09.
-- Run by the owner in the Supabase SQL Editor, the whole block at once. Safe to run twice (a second run changes nothing).
-- Contains no DROP and no DELETE. It changes no table and no row.
-- ORDER: run this BEFORE you dispatch "Deploy Supabase functions" (the new fp-job function calls public.setnik_accepted_terms).
--
-- WHAT EACH PART DOES, IN PLAIN WORDS
--  A. Renames the 11 functions in schema public whose names start with the old prefix to the same name starting with "setnik_"
--     (norm, terms_version, allowed_genres, blocked, has_ctrl, accepted_terms, unblock, remove_pending, purge_user_content,
--     remove_auth_user, is_anonymous). Permissions, the security-definer setting, and every policy and trigger that uses them follow the
--     rename automatically. A function is skipped if the new name already exists.
--  B. Sets the Terms version to 2026-10-09 (public.setnik_terms_version()). People who accepted an older version are asked again
--     the next time they add or confirm a show. The new app sends 2026-10-09, so the old app version stops being accepted (no old app is in use).
--  C. Rewrites the text inside the 12 other functions (accept_terms, submit_show, confirm_submission, report_submission, report_user,
--     unblock_user, submit_feedback, admin_delete_user, fp_confirm_queue, fp_confirm_show, fp_public_shows, fp_report_show) so they call the
--     new names. Only the old-prefix words inside them change; the logic is identical.

-- A. Rename functions (schemas public, fp, going, ops)
do $$
declare r record; newname text;
begin
  for r in
    select n.nspname as sch, p.proname as fname, oidvectortypes(p.proargtypes) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'fp', 'going', 'ops') and p.proname like 'pu\_%' escape '\'
  loop
    newname := 'setnik_' || substr(r.fname, 4);
    if to_regprocedure(format('%I.%I(%s)', r.sch, newname, r.args)) is null then
      execute format('alter function %I.%I(%s) rename to %I', r.sch, r.fname, r.args, newname);
    else
      raise notice 'skipped %.% : % already exists', r.sch, r.fname, newname;
    end if;
  end loop;
end $$;

-- B. Terms version
create or replace function public.setnik_terms_version() returns text
language sql immutable set search_path = public as $$ select '2026-10-09'::text $$;

-- C. Point the other functions at the new names
do $$
declare r record; def text;
begin
  for r in
    select p.oid as fid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'fp', 'going', 'ops') and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~ '(^|[^A-Za-z0-9])pu_[a-z]'
  loop
    def := regexp_replace(pg_get_functiondef(r.fid), '(^|[^A-Za-z0-9])pu_(?=[a-z])', '\1setnik_', 'g');
    execute def;
  end loop;
end $$;

-- Check after running (expected results shown):
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname in ('public','fp','going','ops') and (p.proname like 'pu\_%' escape '\' or pg_get_functiondef(p.oid) ~ '(^|[^A-Za-z0-9])pu_[a-z]');   -- 0
--   select public.setnik_terms_version();                                                                                                                -- 2026-10-09
