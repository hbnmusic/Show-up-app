-- Functions for the first-party listings layer (see 005). Safe to run twice.

create or replace function public.pu_is_anonymous() returns boolean
language sql stable set search_path = public as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;
grant execute on function public.pu_is_anonymous() to anon, authenticated;

-- ---- reading ----------------------------------------------------------------------------------------------------------

-- Public first-party shows for one metro, plus the caller's own pending ones. No submitter ids are returned except an opaque
-- author for shows from people (so Block and Report work), and nothing from the licensed layer.
create or replace function public.fp_public_shows(p_metro text) returns jsonb
language sql stable security definer set search_path = public, fp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'key', s.key, 'metro', s.metro, 'venueId', s.venue_id, 'venueName', s.venue_name, 'city', s.city,
    'address', case when s.address_mode = 'registry' then s.address end, 'addressMode', s.address_mode,
    'localDate', s.local_date, 'startLocal', s.start_local, 'doorsLocal', s.doors_local,
    'headliner', s.headliner, 'supports', s.supports, 'price', s.price, 'ticketUrl', s.ticket_url, 'status', s.status,
    'genres', s.genres, 'agePolicy', s.age_policy, 'imageUrl', s.image_url, 'fieldSource', s.field_source,
    'conflicts', s.conflicts, 'sources', s.sources, 'unconfirmed', s.unconfirmed,
    'pending', s.visibility = 'pending', 'author', s.submitter
  ) order by s.local_date, s.start_local), '[]'::jsonb)
  from (
    select * from fp.shows
    where metro = p_metro and local_date >= current_date - 1 and visibility <> 'removed'
      and (visibility = 'public' or submitter = auth.uid())
      and (submitter is null or submitter = auth.uid() or not public.pu_blocked(submitter))
    order by local_date, start_local
    limit 1500
  ) s
$$;

-- Pending flyer shows other people can confirm (signed-in, non-anonymous people only).
create or replace function public.fp_confirm_queue(p_metro text) returns jsonb
language sql stable security definer set search_path = public, fp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'headliner', s.headliner, 'supports', s.supports, 'venueName', s.venue_name, 'city', s.city,
    'localDate', s.local_date, 'startLocal', s.start_local, 'author', s.submitter
  ) order by s.local_date), '[]'::jsonb)
  from (
    select * from fp.shows
    where metro = p_metro and visibility = 'pending' and local_date >= current_date
      and auth.uid() is not null and not public.pu_is_anonymous()
      and submitter is distinct from auth.uid() and not public.pu_blocked(submitter)
      and not exists (select 1 from fp.confirmations c where c.show_id = fp.shows.id and c.user_id = auth.uid())
    order by local_date limit 50
  ) s
$$;

-- The caller's flyer jobs from the last 30 days, for status and notifications.
create or replace function public.fp_my_flyer_jobs() returns jsonb
language sql stable security definer set search_path = public, fp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'status', j.status, 'result', j.result, 'reason', j.reason, 'createdAt', j.created_at,
    'finishedAt', j.finished_at, 'notified', j.notified,
    'shows', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'headliner', s.headliner, 'localDate', s.local_date, 'visibility', s.visibility)), '[]'::jsonb)
              from fp.shows s where s.id = any (j.show_ids))
  ) order by j.created_at desc), '[]'::jsonb)
  from fp.flyer_jobs j
  where j.submitter = auth.uid() and j.created_at > now() - interval '30 days'
$$;

create or replace function public.fp_mark_notified(ids uuid[]) returns void
language sql security definer set search_path = public, fp as $$
  update fp.flyer_jobs set notified = true where submitter = auth.uid() and id = any (ids)
$$;

-- ---- people acting on flyer shows ---------------------------------------------------------------------------------------

create or replace function public.fp_confirm_show(sid uuid) returns jsonb
language plpgsql security definer set search_path = public, fp as $$
declare
  uid uuid := auth.uid();
  s fp.shows;
begin
  if uid is null or public.pu_is_anonymous() then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  if exists (select 1 from banned_users where user_id = uid) then raise exception 'This account cannot post' using errcode = 'P0001'; end if;
  if not public.pu_accepted_terms(uid) then raise exception 'Accept the Terms of Use first' using errcode = 'P0001'; end if;
  select * into s from fp.shows where id = sid for update;
  if not found or s.visibility = 'removed' then raise exception 'That show is no longer listed' using errcode = 'P0001'; end if;
  if s.submitter = uid then raise exception 'You cannot confirm your own submission' using errcode = 'P0001'; end if;
  if public.pu_blocked(s.submitter) then raise exception 'That show is no longer listed' using errcode = 'P0001'; end if;
  insert into fp.confirmations (show_id, user_id) values (sid, uid) on conflict do nothing;
  if found then
    update fp.shows set confirm_count = confirm_count + 1, corroborated = true,
      visibility = case when visibility = 'pending' then 'public' else visibility end, updated_at = now()
    where id = sid;
  end if;
  return jsonb_build_object('result', 'ok');
end $$;

create or replace function public.fp_report_show(sid uuid, why text default null) returns jsonb
language plpgsql security definer set search_path = public, fp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  if why is not null and (char_length(why) > 200 or public.pu_has_ctrl(why)) then raise exception 'Reason is too long' using errcode = 'P0001'; end if;
  insert into fp.reports (show_id, user_id, reason) values (sid, uid, why) on conflict do nothing;
  if found then
    update fp.shows set report_count = report_count + 1,
      visibility = case when report_count + 1 >= 3 and submitter is not null then 'removed' else visibility end,
      removed_reason = case when report_count + 1 >= 3 and submitter is not null then 'reports' else removed_reason end
    where id = sid;
  end if;
  return jsonb_build_object('result', 'ok');
end $$;

create or replace function public.fp_withdraw_show(sid uuid) returns jsonb
language plpgsql security definer set search_path = public, fp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  update fp.shows set visibility = 'removed', removed_reason = 'withdrawn', updated_at = now()
    where id = sid and submitter = auth.uid() and visibility <> 'removed';
  return jsonb_build_object('result', 'ok');
end $$;

revoke all on function public.fp_public_shows(text), public.fp_confirm_queue(text), public.fp_my_flyer_jobs(), public.fp_mark_notified(uuid[]),
  public.fp_confirm_show(uuid), public.fp_report_show(uuid, text), public.fp_withdraw_show(uuid) from public, anon, authenticated;
grant execute on function public.fp_public_shows(text) to anon, authenticated;
grant execute on function public.fp_confirm_queue(text), public.fp_my_flyer_jobs(), public.fp_mark_notified(uuid[]),
  public.fp_confirm_show(uuid), public.fp_report_show(uuid, text), public.fp_withdraw_show(uuid) to authenticated;

-- ---- account deletion ---------------------------------------------------------------------------------------------------
-- Small single-purpose delete helpers (the SQL connector refuses migrations that mix several deletes).

create or replace function fp.delete_user_jobs(uid uuid) returns void
language sql security definer set search_path = fp, public as $$ delete from fp.flyer_jobs where submitter = uid $$;
create or replace function fp.delete_user_unpublished(uid uuid) returns void
language sql security definer set search_path = fp, public as $$ delete from fp.shows where submitter = uid and visibility <> 'public' $$;
create or replace function fp.delete_licensed_links(src text) returns void
language sql security definer set search_path = fp, public as $$ delete from fp.licensed_links where source = src $$;
create or replace function fp.delete_old_rows() returns void
language sql security definer set search_path = fp, public as $$ delete from fp.flyer_jobs where finished_at < now() - interval '90 days' $$;
create or replace function fp.delete_old_runs() returns void
language sql security definer set search_path = fp, public as $$ delete from fp.venue_runs where at < now() - interval '90 days' $$;
create or replace function fp.delete_old_removed() returns void
language sql security definer set search_path = fp, public as $$ delete from fp.shows where local_date < current_date - 30 and visibility = 'removed' $$;

create or replace function fp.purge_user(uid uuid) returns void
language plpgsql security definer set search_path = fp, public as $$
begin
  perform fp.delete_user_jobs(uid);
  perform fp.delete_user_unpublished(uid);
  update fp.shows set submitter = null where submitter = uid;
  update fp.source_records set submitter = null where submitter = uid;
end $$;

-- Account deletion also removes flyer data: add the call at the top of setnik_purge_user_content.
do $m$
declare def text;
begin
  select pg_get_functiondef('public.pu_purge_user_content(uuid)'::regprocedure) into def;
  if position('fp.purge_user' in def) = 0 then
    def := replace(def, E'begin\n', E'begin\n  perform fp.purge_user(uid);\n');
    execute def;
  end if;
end
$m$;

-- Anonymous sign-ins (used only for sharing flyers) must not post, confirm or report in the community.
do $m$
declare
  f regprocedure;
  def text;
  fns regprocedure[] := array[
    'public.submit_show(jsonb)'::regprocedure, 'public.confirm_submission(uuid)'::regprocedure,
    'public.report_submission(uuid,text)'::regprocedure, 'public.fp_report_show(uuid,text)'::regprocedure
  ];
begin
  foreach f in array fns loop
    select pg_get_functiondef(f) into def;
    if position('pu_is_anonymous' in def) = 0 then
      def := replace(def, 'if uid is null then raise exception ''Sign in first''', 'if uid is null or public.pu_is_anonymous() then raise exception ''Sign in first''');
      execute def;
    end if;
  end loop;
  select pg_get_functiondef('public.report_user(uuid,text,uuid)'::regprocedure) into def;
  if position('pu_is_anonymous' in def) = 0 then
    def := replace(def, 'if auth.uid() is null then raise exception ''Sign in first''', 'if auth.uid() is null or public.pu_is_anonymous() then raise exception ''Sign in first''');
    execute def;
  end if;
end
$m$;

-- ---- moderation (run in the SQL editor as the owner; see supabase/MODERATION.md) -----------------------------------------

create or replace function fp.takedown_show(sid uuid, note text default null) returns void
language plpgsql security definer set search_path = fp, public as $$
declare s fp.shows;
begin
  select * into s from fp.shows where id = sid;
  if not found then raise exception 'No such show'; end if;
  update fp.shows set visibility = 'removed', image_url = null, removed_reason = 'takedown', updated_at = now() where id = sid;
  insert into fp.blocked_keys (key, reason) values (s.key, coalesce(note, 'takedown')) on conflict do nothing;
  insert into fp.takedowns (kind, ref, note) values ('show', sid::text, note);
end $$;

create or replace function fp.takedown_image(img text, note text default null) returns integer
language plpgsql security definer set search_path = fp, public as $$
declare n integer;
begin
  update fp.shows set image_url = null, updated_at = now() where image_url = img;
  get diagnostics n = row_count;
  insert into fp.blocked_urls (url, reason) values (img, coalesce(note, 'takedown')) on conflict do nothing;
  insert into fp.takedowns (kind, ref, note) values ('image', img, note);
  return n;
end $$;

create or replace function fp.takedown_venue(vid uuid, note text default null) returns void
language plpgsql security definer set search_path = fp, public as $$
begin
  update fp.venues set status = 'disabled', takedown = true, status_reasons = array['takedown'], updated_at = now() where id = vid;
  update fp.shows set visibility = 'removed', removed_reason = 'takedown', updated_at = now() where venue_id = vid and visibility <> 'removed';
  insert into fp.takedowns (kind, ref, note) values ('venue', vid::text, note);
end $$;

-- Repeat infringers: ban the account from posting.
create or replace function fp.ban_user(uid uuid, note text default null) returns void
language plpgsql security definer set search_path = fp, public as $$
begin
  insert into public.banned_users (user_id) values (uid) on conflict do nothing;
  update fp.shows set visibility = 'removed', removed_reason = 'banned', updated_at = now() where submitter = uid and visibility <> 'removed';
  insert into fp.takedowns (kind, ref, note) values ('ban', uid::text, note);
end $$;

-- Licensed layer: turn a source off and delete the ids linked to it. Feed files are cleaned by scripts/purge-licensed.ts.
create or replace function fp.purge_licensed(src text) returns integer
language plpgsql security definer set search_path = fp, public as $$
declare n integer;
begin
  if src not in ('jambase', 'ticketmaster') then raise exception 'source must be jambase or ticketmaster'; end if;
  select count(*) into n from fp.licensed_links where source = src;
  perform fp.delete_licensed_links(src);
  update fp.licensed_switches set enabled = false, updated_at = now()
    where (src = 'jambase' and family = 'jambase_listings') or (src = 'ticketmaster' and family like 'ticketmaster_%');
  insert into fp.takedowns (kind, ref, note) values ('purge_licensed', src, null);
  return n;
end $$;

-- Retention: recognised text is kept 14 days after a job finishes, then cleared. Finished jobs go after 90 days.
create or replace function fp.purge_old() returns void
language plpgsql security definer set search_path = fp, public as $$
begin
  update fp.flyer_jobs set ocr_text = null, layout = null where ocr_text is not null and finished_at < now() - interval '14 days';
  perform fp.delete_old_rows();
  perform fp.delete_old_runs();
  perform fp.delete_old_removed();
end $$;

revoke all on all functions in schema fp from public, anon, authenticated;
grant execute on all functions in schema fp to service_role;
