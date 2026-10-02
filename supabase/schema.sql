-- Pull Up crowd-submitted shows.
-- Run this whole file once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again; objects that already exist are left alone or replaced.
--
-- How it works
--   * People sign in with an email code (Supabase Auth). Nothing here stores passwords.
--   * Every write goes through the functions at the bottom (submit_show, confirm_submission,
--     report_submission, withdraw_submission). The tables themselves cannot be written to
--     directly from the app, so the rules below cannot be skipped.
--   * A new submission is "pending": only its author and signed-in people looking at the
--     confirm queue can see it. When a second person confirms it, it becomes "live" and
--     everyone sees it. Someone submitting the same show again counts as that confirmation.
--   * Accounts listed in trusted_users go live immediately. Accounts in banned_users cannot post.
--   * 3 different people reporting a show takes it down.

create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'live', 'removed')),
  metro         text not null check (char_length(metro) between 1 and 20),
  title         text check (title is null or char_length(title) <= 120),
  acts          jsonb not null check (jsonb_typeof(acts) = 'array' and jsonb_array_length(acts) between 0 and 12),
  venue_name    text not null check (char_length(venue_name) between 1 and 120),
  venue_area    text not null check (char_length(venue_area) between 1 and 80),
  venue_address text check (venue_address is null or char_length(venue_address) <= 200),
  -- Wall-clock start at the venue, "YYYY-MM-DDTHH:MM", plus the zone it was entered in.
  starts_local  text not null check (starts_local ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  tz            text not null,
  utc_offset_min integer not null,
  starts_at     timestamptz not null,
  price_min     numeric check (price_min is null or (price_min >= 0 and price_min <= 2000)),
  price_max     numeric check (price_max is null or (price_max >= 0 and price_max <= 2000)),
  is_free       boolean not null default false,
  age_policy    text not null default 'unknown' check (age_policy in ('all_ages', '18_plus', '21_plus', 'unknown')),
  genres        text[] not null default '{}' check (cardinality(genres) <= 3),
  ticket_url    text check (ticket_url is null or (ticket_url ~* '^https?://' and char_length(ticket_url) <= 500)),
  source_url    text check (source_url is null or (source_url ~* '^https?://' and char_length(source_url) <= 500)),
  confirm_count integer not null default 0,
  report_count  integer not null default 0,
  dup_key       text not null,
  check (jsonb_array_length(acts) > 0 or title is not null)
);

-- One active record per night + room + headliner.
create unique index if not exists submissions_dup_key_active
  on public.submissions (dup_key) where status in ('pending', 'live');
create index if not exists submissions_metro_status on public.submissions (metro, status, starts_at);
create index if not exists submissions_author on public.submissions (created_by, created_at desc);

create table if not exists public.confirmations (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (submission_id, user_id)
);

create table if not exists public.reports (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  reason        text check (reason is null or char_length(reason) <= 200),
  created_at    timestamptz not null default now(),
  primary key (submission_id, user_id)
);

-- Add rows by hand in the Table Editor. Trusted accounts skip the confirmation wait.
create table if not exists public.trusted_users (user_id uuid primary key references auth.users (id) on delete cascade);
create table if not exists public.banned_users (user_id uuid primary key references auth.users (id) on delete cascade);

alter table public.submissions   enable row level security;
alter table public.confirmations enable row level security;
alter table public.reports       enable row level security;
alter table public.trusted_users enable row level security;
alter table public.banned_users  enable row level security;

-- Reading. No insert/update/delete policies exist, so the app cannot write to these tables except through the functions.
drop policy if exists "read live, own, or queue" on public.submissions;
create policy "read live, own, or queue" on public.submissions for select using (
  (status = 'live' and starts_at > now() - interval '1 day')
  or created_by = auth.uid()
  or (status = 'pending' and auth.uid() is not null and starts_at > now())
);

drop policy if exists "read own confirmations" on public.confirmations;
create policy "read own confirmations" on public.confirmations for select using (user_id = auth.uid());
drop policy if exists "read own reports" on public.reports;
create policy "read own reports" on public.reports for select using (user_id = auth.uid());

revoke all on public.submissions, public.confirmations, public.reports, public.trusted_users, public.banned_users from anon, authenticated;
grant select on public.submissions to anon, authenticated;
grant select on public.confirmations, public.reports to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Functions

create or replace function public.pu_norm(t text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(t, '')), '^the ', ''), '[^a-z0-9]+', '', 'g')
$$;

-- Create a submission. Returns {result: 'created'|'confirmed', id, status}.
create or replace function public.submit_show(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  trusted boolean;
  recent integer;
  limit_per_day integer;
  acts jsonb := coalesce(p -> 'acts', '[]'::jsonb);
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
  if not exists (select 1 from pg_timezone_names where name = tzname) then
    raise exception 'Unknown time zone' using errcode = 'P0001';
  end if;

  trusted := exists (select 1 from trusted_users where user_id = uid);
  limit_per_day := case when trusted then 30 else 5 end;
  select count(*) into recent from submissions where created_by = uid and created_at > now() - interval '24 hours';
  if recent >= limit_per_day then
    raise exception 'Daily limit reached. Try again tomorrow.' using errcode = 'P0001';
  end if;

  local_ts := (p ->> 'starts_local')::timestamp;
  utc := local_ts at time zone tzname;
  offset_min := (extract(epoch from (local_ts - (utc at time zone 'UTC'))) / 60)::integer;
  if utc < now() - interval '2 hours' then raise exception 'That date has passed' using errcode = 'P0001'; end if;
  if utc > now() + interval '400 days' then raise exception 'That date is too far away' using errcode = 'P0001'; end if;

  headliner := coalesce(acts -> 0 ->> 'name', p ->> 'title', '');
  key := (p ->> 'metro') || '|' || left(p ->> 'starts_local', 10) || '|' || pu_norm(p ->> 'venue_name') || '|' || pu_norm(headliner);

  select * into existing from submissions where dup_key = key and status in ('pending', 'live') limit 1;
  if found then
    if existing.created_by = uid then raise exception 'You already submitted this show' using errcode = 'P0001'; end if;
    -- Someone else posting the same show is a second person vouching for it.
    perform public.confirm_submission(existing.id);
    return jsonb_build_object('result', 'confirmed', 'id', existing.id);
  end if;

  insert into submissions (
    created_by, status, metro, title, acts, venue_name, venue_area, venue_address, starts_local, tz, utc_offset_min,
    starts_at, price_min, price_max, is_free, age_policy, genres, ticket_url, source_url, dup_key
  ) values (
    uid, case when trusted then 'live' else 'pending' end, p ->> 'metro', nullif(trim(p ->> 'title'), ''), acts,
    trim(p ->> 'venue_name'), trim(p ->> 'venue_area'), nullif(trim(p ->> 'venue_address'), ''), p ->> 'starts_local',
    tzname, offset_min, utc, nullif(p ->> 'price_min', '')::numeric, nullif(p ->> 'price_max', '')::numeric,
    coalesce((p ->> 'is_free')::boolean, false), coalesce(p ->> 'age_policy', 'unknown'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'genres', '[]'::jsonb))), '{}'),
    nullif(trim(p ->> 'ticket_url'), ''), nullif(trim(p ->> 'source_url'), ''), key
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
  select * into s from submissions where id = sid for update;
  if not found or s.status = 'removed' then raise exception 'That show is no longer listed' using errcode = 'P0001'; end if;
  if s.created_by = uid then raise exception 'You cannot confirm your own submission' using errcode = 'P0001'; end if;
  insert into confirmations (submission_id, user_id) values (sid, uid) on conflict do nothing;
  if found then
    update submissions set confirm_count = confirm_count + 1,
      status = case when status = 'pending' then 'live' else status end
    where id = sid;
  end if;
  return jsonb_build_object('result', 'ok');
end $$;

-- Flag a show as wrong or spam. Three different people take it down.
create or replace function public.report_submission(sid uuid, why text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  insert into reports (submission_id, user_id, reason) values (sid, uid, left(why, 200)) on conflict do nothing;
  if found then
    update submissions set report_count = report_count + 1 where id = sid returning report_count into n;
    if n >= 3 then update submissions set status = 'removed' where id = sid; end if;
  end if;
  return jsonb_build_object('result', 'ok');
end $$;

-- The author takes their own submission down.
create or replace function public.withdraw_submission(sid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  update submissions set status = 'removed' where id = sid and created_by = auth.uid();
  return jsonb_build_object('result', 'ok');
end $$;

revoke all on function public.submit_show(jsonb), public.confirm_submission(uuid),
  public.report_submission(uuid, text), public.withdraw_submission(uuid) from public, anon;
grant execute on function public.submit_show(jsonb), public.confirm_submission(uuid),
  public.report_submission(uuid, text), public.withdraw_submission(uuid) to authenticated;
