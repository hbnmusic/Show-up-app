-- Upgrade an existing Setnik project (one that already ran the first schema.sql) to the compliance layer.
-- Run once in the Supabase SQL editor. Safe to run twice. Fresh projects should run schema.sql instead.

-- Authorship survives account deletion for confirmed shows.
alter table public.submissions alter column created_by drop not null;
alter table public.submissions drop constraint if exists submissions_created_by_fkey;
alter table public.submissions
  add constraint submissions_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

-- ===============================================================================================
-- Compliance layer: terms acceptance, blocking, user reports, input validation, account deletion.
-- ===============================================================================================

-- Terms of Use acceptance (version + timestamp). Bump setnik_terms_version() when the Terms change in a
-- way people must re-accept; the app's TERMS_VERSION constant (src/lib/legal.ts) must match.
create table if not exists public.terms_acceptances (
  user_id     uuid not null references auth.users (id) on delete cascade,
  version     text not null check (char_length(version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

-- People a user has blocked. The blocker no longer sees the blocked person's shows.
create table if not exists public.user_blocks (
  blocker    uuid not null references auth.users (id) on delete cascade,
  blocked    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- Reports about a person (spam, harassment, fake listings). Read these in the dashboard; see supabase/MODERATION.md.
create table if not exists public.user_reports (
  id            uuid primary key default gen_random_uuid(),
  reporter      uuid not null references auth.users (id) on delete cascade,
  target        uuid not null references auth.users (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete set null,
  reason        text check (reason is null or char_length(reason) <= 200),
  created_at    timestamptz not null default now(),
  unique (reporter, target),
  check (reporter <> target)
);
create index if not exists user_reports_target on public.user_reports (target);

alter table public.terms_acceptances enable row level security;
alter table public.user_blocks       enable row level security;
alter table public.user_reports      enable row level security;

revoke all on public.terms_acceptances, public.user_blocks, public.user_reports from anon, authenticated;
grant select on public.terms_acceptances, public.user_blocks to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'terms_acceptances' and policyname = 'read own terms acceptances') then
    create policy "read own terms acceptances" on public.terms_acceptances for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_blocks' and policyname = 'read own blocks') then
    create policy "read own blocks" on public.user_blocks for select using (blocker = auth.uid());
  end if;
end $$;
-- user_reports has no policy on purpose: nobody can read it through the API, only you in the dashboard.

create or replace function public.pu_terms_version() returns text
language sql immutable set search_path = public as $$ select '2026-10-02'::text $$;

-- True when the signed-in caller has blocked this author. Used by the read rule below; runs as owner so the
-- rule works for people who cannot read user_blocks directly.
create or replace function public.pu_blocked(author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select author is not null and exists (select 1 from public.user_blocks b where b.blocker = auth.uid() and b.blocked = author)
$$;
revoke all on function public.pu_blocked(uuid) from public;
grant execute on function public.pu_blocked(uuid) to anon, authenticated;

-- Hide blocked people's shows from the blocker (their own shows always stay visible to them).
alter policy "read live, own, or queue" on public.submissions using (
  created_by = auth.uid()
  or (
    not public.pu_blocked(created_by)
    and (
      (status = 'live' and starts_at > now() - interval '1 day')
      or (status = 'pending' and auth.uid() is not null and starts_at > now())
    )
  )
);

create or replace function public.pu_has_ctrl(t text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(t ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', false)
$$;

create or replace function public.accept_terms(v text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  if v is distinct from public.pu_terms_version() then
    raise exception 'These Terms are out of date. Update the app.' using errcode = 'P0001';
  end if;
  insert into terms_acceptances (user_id, version) values (auth.uid(), v) on conflict do nothing;
  return jsonb_build_object('result', 'ok', 'version', v);
end $$;

create or replace function public.pu_accepted_terms(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from terms_acceptances where user_id = uid and version = public.pu_terms_version())
$$;
revoke all on function public.pu_accepted_terms(uuid) from public, anon, authenticated;

-- Create a submission, with every field checked. Returns {result: 'created'|'confirmed', id, status}.
create or replace function public.submit_show(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  trusted boolean;
  recent integer;
  open_pending integer;
  limit_per_day integer;
  raw_acts jsonb;
  acts jsonb := '[]'::jsonb;
  a jsonb;
  nm text;
  genres text[] := '{}';
  g text;
  allowed text[] := array['Punk','Hardcore','Screamo','Emo','Post-Punk','Darkwave','Industrial','Garage','Indie Rock',
    'Shoegaze','Noise Rock','Metal','Sludge & Doom','Psych','Folk','Pop','Experimental','Jazz & Improv','Electronic','Soul & Gospel'];
  metro_id text;
  title_t text;
  venue_t text;
  area_t text;
  addr_t text;
  ticket_t text;
  source_t text;
  pmin numeric;
  pmax numeric;
  free boolean;
  headliner text;
  local_ts timestamp;
  utc timestamptz;
  offset_min integer;
  key text;
  existing public.submissions;
  new_row public.submissions;
  tzname text := p ->> 'tz';
begin
  if uid is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  if exists (select 1 from banned_users where user_id = uid) then
    raise exception 'This account cannot post' using errcode = 'P0001';
  end if;
  if not public.pu_accepted_terms(uid) then
    raise exception 'Accept the Terms of Use first' using errcode = 'P0001';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Invalid submission' using errcode = 'P0001'; end if;

  -- Field checks
  metro_id := p ->> 'metro';
  if metro_id is null or metro_id !~ '^[a-z0-9]{2,10}$' then raise exception 'Choose a listed city' using errcode = 'P0001'; end if;
  if tzname is null or not exists (select 1 from pg_timezone_names where name = tzname) then
    raise exception 'Unknown time zone' using errcode = 'P0001';
  end if;
  title_t := nullif(btrim(p ->> 'title'), '');
  venue_t := btrim(coalesce(p ->> 'venue_name', ''));
  area_t := btrim(coalesce(p ->> 'venue_area', ''));
  addr_t := nullif(btrim(p ->> 'venue_address'), '');
  ticket_t := nullif(btrim(p ->> 'ticket_url'), '');
  source_t := nullif(btrim(p ->> 'source_url'), '');
  if char_length(venue_t) not between 1 and 120 then raise exception 'Venue name must be 1 to 120 characters' using errcode = 'P0001'; end if;
  if char_length(area_t) not between 1 and 80 then raise exception 'Neighborhood must be 1 to 80 characters' using errcode = 'P0001'; end if;
  if title_t is not null and char_length(title_t) > 120 then raise exception 'Event name is too long' using errcode = 'P0001'; end if;
  if addr_t is not null and char_length(addr_t) > 200 then raise exception 'Address is too long' using errcode = 'P0001'; end if;
  if public.pu_has_ctrl(venue_t) or public.pu_has_ctrl(area_t) or public.pu_has_ctrl(title_t) or public.pu_has_ctrl(addr_t) then
    raise exception 'Text contains characters that are not allowed' using errcode = 'P0001';
  end if;
  if ticket_t is not null and (ticket_t !~* '^https?://[^[:space:]]+$' or char_length(ticket_t) > 500) then
    raise exception 'Ticket link must be a web address' using errcode = 'P0001';
  end if;
  if source_t is not null and (source_t !~* '^https?://[^[:space:]]+$' or char_length(source_t) > 500) then
    raise exception 'Post link must be a web address' using errcode = 'P0001';
  end if;

  raw_acts := coalesce(p -> 'acts', '[]'::jsonb);
  if jsonb_typeof(raw_acts) <> 'array' or jsonb_array_length(raw_acts) > 12 then
    raise exception 'A show can list up to 12 bands' using errcode = 'P0001';
  end if;
  for a in select * from jsonb_array_elements(raw_acts) loop
    nm := btrim(case when jsonb_typeof(a) = 'object' then a ->> 'name' else null end);
    if nm is null or char_length(nm) not between 1 and 100 or public.pu_has_ctrl(nm) then
      raise exception 'Each band name must be 1 to 100 characters' using errcode = 'P0001';
    end if;
    acts := acts || jsonb_build_array(jsonb_build_object('name', nm));
  end loop;
  if jsonb_array_length(acts) = 0 and title_t is null then
    raise exception 'Add at least one band or a name for the night' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p -> 'genres', '[]'::jsonb)) <> 'array' then raise exception 'Invalid genres' using errcode = 'P0001'; end if;
  for g in select jsonb_array_elements_text(coalesce(p -> 'genres', '[]'::jsonb)) loop
    if not (g = any (allowed)) then raise exception 'Unknown genre' using errcode = 'P0001'; end if;
    if not (g = any (genres)) then genres := genres || g; end if;
  end loop;
  if cardinality(genres) > 3 then raise exception 'Pick up to 3 genres' using errcode = 'P0001'; end if;

  begin
    free := coalesce((p ->> 'is_free')::boolean, false);
    pmin := nullif(p ->> 'price_min', '')::numeric;
    pmax := nullif(p ->> 'price_max', '')::numeric;
  exception when others then
    raise exception 'Invalid price' using errcode = 'P0001';
  end;
  if free then pmin := null; pmax := null; end if;
  if pmin is not null and (pmin < 0 or pmin > 2000) or pmax is not null and (pmax < 0 or pmax > 2000) then
    raise exception 'Price must be between 0 and 2000' using errcode = 'P0001';
  end if;
  if pmin is not null and pmax is not null and pmax < pmin then raise exception 'Invalid price range' using errcode = 'P0001'; end if;

  -- Date and time
  begin
    local_ts := (p ->> 'starts_local')::timestamp;
  exception when others then
    raise exception 'Invalid date or time' using errcode = 'P0001';
  end;
  if (p ->> 'starts_local') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then raise exception 'Invalid date or time' using errcode = 'P0001'; end if;
  utc := local_ts at time zone tzname;
  offset_min := (extract(epoch from (local_ts - (utc at time zone 'UTC'))) / 60)::integer;
  if utc < now() - interval '2 hours' then raise exception 'That date has passed' using errcode = 'P0001'; end if;
  if utc > now() + interval '400 days' then raise exception 'That date is too far away' using errcode = 'P0001'; end if;

  -- Limits
  trusted := exists (select 1 from trusted_users where user_id = uid);
  limit_per_day := case when trusted then 30 else 5 end;
  select count(*) into recent from submissions where created_by = uid and created_at > now() - interval '24 hours';
  if recent >= limit_per_day then
    raise exception 'Daily limit reached. Try again tomorrow.' using errcode = 'P0001';
  end if;
  select count(*) into open_pending from submissions where created_by = uid and status = 'pending';
  if open_pending >= 10 and not trusted then
    raise exception 'You have 10 shows waiting for confirmation. Wait for them to be confirmed.' using errcode = 'P0001';
  end if;

  headliner := coalesce(acts -> 0 ->> 'name', title_t, '');
  key := metro_id || '|' || left(p ->> 'starts_local', 10) || '|' || pu_norm(venue_t) || '|' || pu_norm(headliner);

  select * into existing from submissions where dup_key = key and status in ('pending', 'live') limit 1;
  if found then
    if existing.created_by = uid then raise exception 'You already submitted this show' using errcode = 'P0001'; end if;
    -- Someone else posting the same show is a second person vouching for it.
    perform public.confirm_submission(existing.id);
    return jsonb_build_object('result', 'confirmed', 'id', existing.id);
  end if;

  insert into submissions (
    created_by, status, metro, title, acts, venue_name, venue_area, venue_address, starts_local, tz, utc_offset_min,
    starts_at, price_min, price_max, is_free, genres, ticket_url, source_url, dup_key
  ) values (
    uid, case when trusted then 'live' else 'pending' end, metro_id, title_t, acts, venue_t, area_t, addr_t,
    p ->> 'starts_local', tzname, offset_min, utc, pmin, pmax, free, genres, ticket_t, source_t, key
  ) returning * into new_row;

  return jsonb_build_object('result', 'created', 'id', new_row.id, 'status', new_row.status);
end $$;

-- A different signed-in person vouches for a pending show; it goes live.
create or replace function public.confirm_submission(sid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.submissions;
begin
  if uid is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  if exists (select 1 from banned_users where user_id = uid) then
    raise exception 'This account cannot post' using errcode = 'P0001';
  end if;
  if not public.pu_accepted_terms(uid) then
    raise exception 'Accept the Terms of Use first' using errcode = 'P0001';
  end if;
  select * into s from submissions where id = sid for update;
  if not found or s.status = 'removed' then raise exception 'That show is no longer listed' using errcode = 'P0001'; end if;
  if s.created_by = uid then raise exception 'You cannot confirm your own submission' using errcode = 'P0001'; end if;
  if public.pu_blocked(s.created_by) then raise exception 'That show is no longer listed' using errcode = 'P0001'; end if;
  insert into confirmations (submission_id, user_id) values (sid, uid) on conflict do nothing;
  if found then
    update submissions set confirm_count = confirm_count + 1,
      status = case when status = 'pending' then 'live' else status end
    where id = sid;
  end if;
  return jsonb_build_object('result', 'ok');
end $$;

-- Block someone: their shows disappear for you.
create or replace function public.block_user(target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  if target is null or target = auth.uid() then raise exception 'You cannot block yourself' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = target) then raise exception 'That user no longer exists' using errcode = 'P0001'; end if;
  insert into user_blocks (blocker, blocked) values (auth.uid(), target) on conflict do nothing;
  return jsonb_build_object('result', 'ok');
end $$;

create or replace function public.unblock_user(target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  perform public.pu_unblock(auth.uid(), target);
  return jsonb_build_object('result', 'ok');
end $$;

create or replace function public.pu_unblock(a uuid, b uuid) returns void
language sql security definer set search_path = public as $$
  delete from user_blocks where blocker = a and blocked = b
$$;

create or replace function public.pu_remove_pending(target uuid) returns void
language sql security definer set search_path = public as $$
  update submissions set status = 'removed' where created_by = target and status = 'pending'
$$;

-- Report a person. Three different reporters remove that person's waiting (unconfirmed) shows; everything else
-- is for you to review (see supabase/MODERATION.md).
create or replace function public.report_user(target uuid, why text default null, sid uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  if target is null or target = auth.uid() then raise exception 'You cannot report yourself' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = target) then raise exception 'That user no longer exists' using errcode = 'P0001'; end if;
  insert into user_reports (reporter, target, submission_id, reason)
    values (auth.uid(), target, sid, left(why, 200)) on conflict do nothing;
  if found then
    select count(*) into n from user_reports where user_reports.target = report_user.target;
    if n >= 3 then
      perform public.pu_remove_pending(report_user.target);
    end if;
  end if;
  return jsonb_build_object('result', 'ok');
end $$;

-- Delete an account and its data. Used by the in-app button (delete_my_account) and, for web/email requests,
-- run by you in the SQL editor (admin_delete_user). What happens to content:
--   * shows that are not live, or that nobody else confirmed, are deleted;
--   * live shows that someone else confirmed stay, with the author removed (they describe a public event, and others
--     relied on them);
--   * confirmations, reports, blocks, terms records, trusted/banned rows and the sign-in account are deleted.
create or replace function public.admin_delete_user(uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if uid is null then raise exception 'No user given' using errcode = 'P0001'; end if;
  perform public.pu_purge_user_content(uid);
  perform public.pu_remove_auth_user(uid);
  return jsonb_build_object('result', 'ok');
end $$;

create or replace function public.pu_purge_user_content(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from submissions where created_by = uid and not (status = 'live' and confirm_count > 0);
  update submissions set created_by = null where created_by = uid;
end $$;

create or replace function public.pu_remove_auth_user(uid uuid) returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = uid
$$;

create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  return public.admin_delete_user(auth.uid());
end $$;

revoke all on function
  public.accept_terms(text), public.submit_show(jsonb), public.confirm_submission(uuid), public.block_user(uuid),
  public.unblock_user(uuid), public.report_user(uuid, text, uuid), public.delete_my_account(), public.admin_delete_user(uuid),
  public.pu_remove_pending(uuid), public.pu_unblock(uuid, uuid), public.pu_purge_user_content(uuid), public.pu_remove_auth_user(uuid)
  from public, anon, authenticated;
grant execute on function
  public.accept_terms(text), public.submit_show(jsonb), public.confirm_submission(uuid), public.block_user(uuid),
  public.unblock_user(uuid), public.report_user(uuid, text, uuid), public.delete_my_account()
  to authenticated;
-- admin_delete_user stays callable only by the database owner (you, in the SQL editor).
grant execute on function public.pu_terms_version() to anon, authenticated;
