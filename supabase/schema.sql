-- Pull Up crowd-submitted shows.
-- Run this whole file once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again; objects that already exist are left alone or replaced.
--
-- How it works
--   * People sign in with an email code (Supabase Auth). Nothing here stores passwords.
--   * Every write goes through functions (submit_show, confirm_submission, report_submission, withdraw_submission,
--     block_user, report_user, accept_terms, delete_my_account). The tables themselves cannot be written to
--     directly from the app, so the rules below cannot be skipped.
--   * A new submission is "pending": only its author and signed-in people looking at the
--     confirm queue can see it. When a second person confirms it, it becomes "live" and
--     everyone sees it. Someone submitting the same show again counts as that confirmation.
--   * Accounts listed in trusted_users go live immediately. Accounts in banned_users cannot post.
--   * 3 different people reporting a show takes it down.

create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid references auth.users (id) on delete set null,  -- null after the author deletes their account (confirmed shows stay)
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

revoke all on function public.report_submission(uuid, text), public.withdraw_submission(uuid) from public, anon;
grant execute on function public.report_submission(uuid, text), public.withdraw_submission(uuid) to authenticated;

-- ===============================================================================================
-- Compliance layer: terms acceptance, blocking, user reports, input validation, account deletion.
-- ===============================================================================================

-- Terms of Use acceptance (version + timestamp). Bump pu_terms_version() when the Terms change in a
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
language sql immutable set search_path = public as $$ select '2026-10-04'::text $$;

-- Genres a submission may carry. Keep in step with ALL_GENRES in src/lib/types.ts.
create or replace function public.pu_allowed_genres() returns text[]
language sql immutable set search_path = public as $$
  select array['Punk','Hardcore','Screamo','Emo','Post-Punk','Darkwave','Industrial','Garage','Indie Rock',
    'Shoegaze','Noise Rock','Metal','Sludge & Doom','Psych','Folk','Pop','Experimental','Jazz & Improv','Electronic','Soul & Gospel',
    'Rock','Country','Blues','Hip-Hop','Classical','Latin','Reggae']::text[]
$$;
grant execute on function public.pu_allowed_genres() to anon, authenticated;

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
  allowed text[] := public.pu_allowed_genres();
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


-- =============================================================================================
-- Analytics and feedback (same as migrations/003_analytics_feedback.sql)
-- =============================================================================================
-- Anonymous usage analytics and in-app feedback. Run once in the Supabase SQL editor (safe to run twice).
-- Everything lives in the "ops" schema, which is not exposed through the API: only you (SQL editor / Table Editor, signed in
-- as the project owner) can read it. The app can only call three functions (log_events, submit_feedback, forget_install).

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create table if not exists ops.events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  install_id  uuid not null,              -- random id made on the phone; not linked to an account, email or device id
  session_id  uuid,
  name        text not null,
  props       jsonb not null default '{}'::jsonb,
  app_version text,
  os_version  text
);
create index if not exists events_at on ops.events (at);
create index if not exists events_install_at on ops.events (install_id, at);
create index if not exists events_name_at on ops.events (name, at);

create table if not exists ops.feedback (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  install_id    uuid,
  kind          text not null check (kind in ('bug', 'idea', 'other')),
  message       text not null check (char_length(message) between 1 and 2000),
  contact_email text check (contact_email is null or char_length(contact_email) <= 200),
  app_version   text,
  os_version    text,
  device_model  text,
  status        text not null default 'new' check (status in ('new', 'read', 'done'))
);
create index if not exists feedback_created on ops.feedback (created_at desc);

alter table ops.events   enable row level security;
alter table ops.feedback enable row level security;
revoke all on ops.events, ops.feedback from public, anon, authenticated;

-- Record a batch of events from one install. Unknown event names, oversized or non-scalar properties are dropped silently.
create or replace function public.log_events(batch jsonb) returns integer
language plpgsql security definer set search_path = public, ops as $$
declare
  allowed text[] := array['app_open','session_start','screen_view','decision','show_opened','filter_changed','city_changed',
    'calendar_added','community_action','share_received','permission','feedback_sent'];
  ev jsonb; pr jsonb; k text; v jsonb; nm text; ts timestamptz; ok boolean;
  inst uuid; sess uuid; ver text; osv text; n integer := 0;
begin
  if batch is null or jsonb_typeof(batch) <> 'object' then return 0; end if;
  begin inst := (batch ->> 'install_id')::uuid; exception when others then return 0; end;
  if inst is null then return 0; end if;
  begin sess := nullif(batch ->> 'session_id', '')::uuid; exception when others then sess := null; end;
  ver := left(batch ->> 'app_version', 20);
  osv := left(batch ->> 'os_version', 20);
  if jsonb_typeof(batch -> 'events') <> 'array' or jsonb_array_length(batch -> 'events') > 50 then return 0; end if;
  if (select count(*) from ops.events where install_id = inst and at > now() - interval '1 day') >= 2000 then return 0; end if;
  for ev in select * from jsonb_array_elements(batch -> 'events') loop
    nm := ev ->> 'name';
    if nm is null or not (nm = any (allowed)) then continue; end if;
    pr := coalesce(ev -> 'props', '{}'::jsonb);
    if jsonb_typeof(pr) <> 'object' or length(pr::text) > 400 then continue; end if;
    ok := true;
    for k, v in select * from jsonb_each(pr) loop
      if char_length(k) > 30 or jsonb_typeof(v) not in ('string', 'number', 'boolean')
         or (jsonb_typeof(v) = 'string' and char_length(v #>> '{}') > 60) then ok := false; exit; end if;
    end loop;
    if not ok then continue; end if;
    begin ts := (ev ->> 'at')::timestamptz; exception when others then ts := now(); end;
    if ts is null or ts > now() or ts < now() - interval '3 days' then ts := now(); end if;
    insert into ops.events (at, install_id, session_id, name, props, app_version, os_version)
      values (ts, inst, sess, nm, pr, ver, osv);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Store one feedback message. No sign-in needed. Limits: 5 per install per hour, 200 per hour in total.
create or replace function public.submit_feedback(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, ops as $$
declare
  inst uuid; k text; msg text; mail text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Invalid feedback' using errcode = 'P0001'; end if;
  begin inst := (p ->> 'install_id')::uuid; exception when others then inst := null; end;
  if inst is null then raise exception 'Invalid feedback' using errcode = 'P0001'; end if;
  k := p ->> 'kind';
  if k is null or k not in ('bug', 'idea', 'other') then raise exception 'Choose a type' using errcode = 'P0001'; end if;
  msg := btrim(coalesce(p ->> 'message', ''));
  if char_length(msg) not between 1 and 2000 then raise exception 'Message must be 1 to 2000 characters' using errcode = 'P0001'; end if;
  if public.pu_has_ctrl(msg) then raise exception 'Message contains characters that are not allowed' using errcode = 'P0001'; end if;
  mail := nullif(btrim(p ->> 'contact_email'), '');
  if mail is not null and (char_length(mail) > 200 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'That email address does not look right' using errcode = 'P0001';
  end if;
  if (select count(*) from ops.feedback where install_id = inst and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from ops.feedback where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many messages. Try again later.' using errcode = 'P0001';
  end if;
  insert into ops.feedback (install_id, kind, message, contact_email, app_version, os_version, device_model)
    values (inst, k, msg, mail, left(p ->> 'app_version', 20), left(p ->> 'os_version', 20), left(p ->> 'device_model', 60));
  return jsonb_build_object('result', 'ok');
end $$;

-- Delete every event from one install (the app calls this when someone turns analytics off).
create or replace function public.forget_install(install uuid) returns void
language sql security definer set search_path = public, ops as $$
  delete from ops.events where install_id = install
$$;

revoke all on function public.log_events(jsonb), public.submit_feedback(jsonb), public.forget_install(uuid) from public;
grant execute on function public.log_events(jsonb), public.submit_feedback(jsonb), public.forget_install(uuid) to anon, authenticated;

-- Retention: events 14 months, feedback 24 months. Scheduled daily with pg_cron (see the end of this file).
create or replace function ops.purge_events() returns void
language sql set search_path = ops as $$
  delete from ops.events where at < now() - interval '14 months'
$$;
create or replace function ops.purge_feedback() returns void
language sql set search_path = ops as $$
  delete from ops.feedback where created_at < now() - interval '24 months'
$$;
create or replace function ops.purge_old() returns void
language plpgsql set search_path = ops as $$
begin
  perform ops.purge_events();
  perform ops.purge_feedback();
end $$;
revoke all on function ops.purge_events(), ops.purge_feedback(), ops.purge_old() from public, anon, authenticated;

-- Dashboard views (days in New York time). Query them in the SQL editor; see supabase/ANALYTICS.md.
create or replace view ops.daily_active as
  select (at at time zone 'America/New_York')::date as day, count(distinct install_id) as active_installs, count(*) as events
  from ops.events group by 1 order by 1 desc;

create or replace view ops.new_installs as
  select first_day as day, count(*) as installs
  from (select install_id, (min(at) at time zone 'America/New_York')::date as first_day from ops.events group by 1) f
  group by 1 order by 1 desc;

create or replace view ops.retention as
  with first as (select install_id, (min(at) at time zone 'America/New_York')::date as d0 from ops.events group by 1),
       act as (select distinct install_id, (at at time zone 'America/New_York')::date as d from ops.events)
  select f.d0 as cohort, count(*) as installs,
    count(*) filter (where exists (select 1 from act a where a.install_id = f.install_id and a.d = f.d0 + 1))  as back_day_1,
    count(*) filter (where exists (select 1 from act a where a.install_id = f.install_id and a.d = f.d0 + 7))  as back_day_7,
    count(*) filter (where exists (select 1 from act a where a.install_id = f.install_id and a.d = f.d0 + 30)) as back_day_30
  from first f group by f.d0 order by f.d0 desc;

create or replace view ops.decisions_daily as
  select (at at time zone 'America/New_York')::date as day,
    count(*) filter (where props ->> 'd' = 'going') as going,
    count(*) filter (where props ->> 'd' = 'passed') as passed
  from ops.events where name = 'decision' group by 1 order by 1 desc;

create or replace view ops.top_cities as
  select props ->> 'metro' as metro, count(*) as times_chosen, count(distinct install_id) as installs
  from ops.events where name = 'city_changed' group by 1 order by 2 desc;

create or replace view ops.screens as
  select props ->> 'screen' as screen, count(*) as views, count(distinct install_id) as installs
  from ops.events where name = 'screen_view' group by 1 order by 2 desc;

create or replace view ops.community_actions as
  select props ->> 'action' as action, count(*) as times, count(distinct install_id) as installs
  from ops.events where name = 'community_action' group by 1 order by 2 desc;

create or replace view ops.versions as
  select app_version, count(distinct install_id) as installs, max(at) as last_seen
  from ops.events group by 1 order by 3 desc;

revoke all on all tables in schema ops from public, anon, authenticated;

-- Daily clean-up at 08:17 UTC. If pg_cron is not enabled in your project, enable it (Database > Extensions) or run
-- select ops.purge_old(); by hand now and then.
create extension if not exists pg_cron;
select cron.schedule('ops-purge-old', '17 8 * * *', 'select ops.purge_old()');


-- =============================================================================================
-- First-party listings layer: flyers shared by people and venues' own sites, kept apart from JamBase data.
-- Everything lives in the "fp" schema, which is not exposed through the API. The app reads and writes only through the
-- public.fp_* functions at the bottom; Edge Functions use the service role. Safe to run twice.

create schema if not exists fp;
revoke all on schema fp from public, anon, authenticated;
grant usage on schema fp to service_role;

-- Per-metro scan settings. Waves: 1 = hot metros, 2 = next largest by show volume, 3 = the rest.
create table if not exists fp.metro_config (
  metro text primary key,
  name text not null,
  state text not null,
  tz text not null,
  hot boolean not null default false,
  wave smallint not null default 3 check (wave in (1, 2, 3)),
  venue_scan_enabled boolean not null default false,   -- per-metro off flag
  daily_request_budget integer not null default 10 check (daily_request_budget >= 0),
  last_full_scan_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Venue registry. Seeded only from venues' own sites and Wikidata (CC0). Never from JamBase or OpenStreetMap.
create table if not exists fp.venues (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null check (char_length(canonical_name) between 1 and 160),
  aliases text[] not null default '{}',
  metro text not null references fp.metro_config (metro),
  address text,
  neighborhood text,
  lat double precision,
  lng double precision,
  website text,
  events_url text,
  publish_method text check (publish_method in ('jsonld', 'ical', 'rss', 'widget', 'ai', 'none')),
  robots_status text not null default 'unknown' check (robots_status in ('ok', 'disallowed', 'bot_wall', 'unknown')),
  tier text check (tier in ('A', 'B', 'C')),
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'rejected', 'quarantined', 'disabled')),
  status_reasons text[] not null default '{}',
  seeded_from text not null check (seeded_from in ('own_site', 'wikidata')),
  wikidata_id text,
  takedown boolean not null default false,
  content_hash text,
  etag text,
  last_modified text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fp_venues_metro_status on fp.venues (metro, status);
create unique index if not exists fp_venues_wikidata on fp.venues (wikidata_id) where wikidata_id is not null;

-- One row per scan of a venue: the health history behind auto-disable.
create table if not exists fp.venue_runs (
  id bigserial primary key,
  venue_id uuid not null references fp.venues (id) on delete cascade,
  at timestamptz not null default now(),
  fetch_ok boolean not null,
  tier text,
  extracted integer not null default 0,
  rejected integer not null default 0,
  note text
);
create index if not exists fp_venue_runs_venue on fp.venue_runs (venue_id, at desc);

-- The merged first-party show. Licensed data (JamBase) is never stored here.
create table if not exists fp.shows (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  metro text not null,
  venue_id uuid references fp.venues (id) on delete set null,
  venue_name text not null,
  city text,
  address text,
  address_mode text not null default 'withheld' check (address_mode in ('registry', 'withheld')),
  local_date date not null,
  start_local text,
  doors_local text,
  headliner text not null check (char_length(headliner) <= 160),
  supports jsonb not null default '[]',
  price jsonb,
  ticket_url text check (ticket_url is null or (ticket_url ~* '^https?://' and char_length(ticket_url) <= 500)),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'moved')),
  genres text[] not null default '{}' check (cardinality(genres) <= 3),
  age_policy text,
  image_url text check (image_url is null or image_url ~* '^https?://'),
  field_source jsonb not null default '{}',
  conflicts jsonb not null default '[]',
  sources jsonb not null default '[]',
  visibility text not null default 'pending' check (visibility in ('public', 'pending', 'removed')),
  unconfirmed boolean not null default false,     -- venue stopped listing it: shown as unconfirmed, never as cancelled
  submitter uuid references auth.users (id) on delete set null,
  confidence numeric,
  corroborated boolean not null default false,
  confirm_count integer not null default 0,
  report_count integer not null default 0,
  removed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fp_shows_metro_date on fp.shows (metro, local_date) where visibility <> 'removed';
create index if not exists fp_shows_key on fp.shows (key);
create index if not exists fp_shows_submitter on fp.shows (submitter);

-- Per-source records, kept as received and never rewritten. Only first-party sources can be stored here.
create table if not exists fp.source_records (
  id bigserial primary key,
  show_id uuid references fp.shows (id) on delete cascade,
  source_type text not null check (source_type in ('flyer', 'venue_site')),
  licence text not null default 'first_party' check (licence = 'first_party'),
  source_url text,
  fetched_at timestamptz not null,
  venue_id uuid references fp.venues (id) on delete set null,
  metro text,
  local_date date not null,
  submitter uuid references auth.users (id) on delete set null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists fp_source_records_show on fp.source_records (show_id);
create index if not exists fp_source_records_night on fp.source_records (metro, local_date);

create or replace function fp.no_rewrite() returns trigger language plpgsql as $$
begin
  if current_setting('fp.allow_purge', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'fp.source_records is append-only' using errcode = 'P0001';
end $$;
create or replace trigger fp_source_records_append_only before update or delete on fp.source_records
  for each row when (pg_trigger_depth() = 0) execute function fp.no_rewrite();

-- Links from a first-party show to the same show in a licensed feed. Ids only, no licensed content.
create table if not exists fp.licensed_links (
  show_id uuid not null references fp.shows (id) on delete cascade,
  source text not null check (source = 'jambase'),
  external_id text not null check (char_length(external_id) <= 120),
  created_at timestamptz not null default now(),
  primary key (show_id, source)
);

-- On/off switches for the licensed layer. Defaults keep today's behaviour.
create table if not exists fp.licensed_switches (
  family text primary key check (family = 'jambase_listings'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into fp.licensed_switches (family) values ('jambase_listings')
  on conflict do nothing;

-- Flyer jobs. Only redacted recognised text is stored; the image never leaves the phone.
create table if not exists fp.flyer_jobs (
  id uuid primary key default gen_random_uuid(),
  submitter uuid references auth.users (id) on delete cascade,
  anonymous boolean not null default false,
  origin text not null default 'image' check (origin in ('image', 'link')),
  metro_hint text,
  ocr_text text,          -- redacted on the phone and again on the server; cleared after retention
  layout text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'retry', 'done', 'failed')),
  result text check (result in ('published', 'pending', 'processing', 'rejected')),
  reason text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  show_ids uuid[] not null default '{}',
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists fp_flyer_jobs_due on fp.flyer_jobs (next_attempt_at) where status in ('queued', 'retry');
create index if not exists fp_flyer_jobs_submitter on fp.flyer_jobs (submitter, created_at desc);

create table if not exists fp.ai_usage (
  day date not null,
  kind text not null check (kind in ('flyer', 'venue')),
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  throttled integer not null default 0,
  primary key (day, kind)
);

create table if not exists fp.ai_config (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
insert into fp.ai_config (key, value) values
  ('provider', '"gemini"'),
  ('model', '"gemini-3.5-flash-lite"'),
  ('daily_cap', '200'),
  ('flyer_reserve_share', '0.3'),
  ('headroom', '0.7'),
  ('refresh_days', '7'),
  ('current_wave', '1')
  on conflict do nothing;

create table if not exists fp.widening_log (id bigserial primary key, at timestamptz not null default now(), decision jsonb not null);
create table if not exists fp.weekly_summaries (week date primary key, body text not null, created_at timestamptz not null default now());

create table if not exists fp.confirmations (
  show_id uuid not null references fp.shows (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (show_id, user_id)
);
create table if not exists fp.reports (
  show_id uuid not null references fp.shows (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (show_id, user_id)
);

-- Takedowns: what was removed, why, and what must not come back.
create table if not exists fp.takedowns (id bigserial primary key, at timestamptz not null default now(), kind text not null, ref text not null, note text);
create table if not exists fp.blocked_urls (url text primary key, reason text, created_at timestamptz not null default now());
create table if not exists fp.blocked_keys (key text primary key, reason text, created_at timestamptz not null default now());

-- Lock everything down: RLS on, no policies. Only the service role and the owner reach these tables.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'fp' loop
    execute format('alter table fp.%I enable row level security', t);
  end loop;
end $$;
grant all on all tables in schema fp to service_role;
grant all on all sequences in schema fp to service_role;
grant execute on all functions in schema fp to service_role;

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

-- Account deletion also removes flyer data: add the call at the top of pu_purge_user_content.
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
  if src <> 'jambase' then raise exception 'source must be jambase'; end if;
  select count(*) into n from fp.licensed_links where source = src;
  perform fp.delete_licensed_links(src);
  update fp.licensed_switches set enabled = false, updated_at = now()
    where family = 'jambase_listings';
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

-- Metro settings for the venue-site layer, seeded from src/lib/metros.ts (wave 1 = hot metros). Safe to run twice.
alter table fp.metro_config add column if not exists aliases text[] not null default '{}';

insert into fp.metro_config (metro, name, state, tz, hot, wave, venue_scan_enabled) values
('nyc', 'New York', 'NY', 'America/New_York', true, 1, true),
('la', 'Los Angeles', 'CA', 'America/Los_Angeles', true, 1, true),
('chi', 'Chicago', 'IL', 'America/Chicago', true, 1, true),
('sf', 'San Francisco Bay Area', 'CA', 'America/Los_Angeles', true, 1, true),
('tor', 'Toronto', 'ON', 'America/Toronto', true, 1, true),
('mtl', 'Montréal', 'QC', 'America/Toronto', true, 1, true),
('van', 'Vancouver', 'BC', 'America/Vancouver', true, 1, true),
('bos', 'Boston', 'MA', 'America/New_York', true, 1, true),
('dc', 'Washington', 'DC', 'America/New_York', true, 1, true),
('phl', 'Philadelphia', 'PA', 'America/New_York', true, 1, true),
('atl', 'Atlanta', 'GA', 'America/New_York', false, 3, false),
('mia', 'Miami', 'FL', 'America/New_York', false, 3, false),
('sea', 'Seattle', 'WA', 'America/Los_Angeles', false, 3, false),
('aus', 'Austin', 'TX', 'America/Chicago', false, 3, false),
('nash', 'Nashville', 'TN', 'America/Chicago', false, 3, false),
('den', 'Denver', 'CO', 'America/Denver', false, 3, false),
('dal', 'Dallas–Fort Worth', 'TX', 'America/Chicago', false, 3, false),
('hou', 'Houston', 'TX', 'America/Chicago', false, 3, false),
('phx', 'Phoenix', 'AZ', 'America/Phoenix', false, 3, false),
('sd', 'San Diego', 'CA', 'America/Los_Angeles', false, 3, false),
('por', 'Portland', 'OR', 'America/Los_Angeles', false, 3, false),
('lv', 'Las Vegas', 'NV', 'America/Los_Angeles', false, 3, false),
('msp', 'Minneapolis–St. Paul', 'MN', 'America/Chicago', false, 3, false),
('det', 'Detroit', 'MI', 'America/Detroit', false, 3, false),
('nola', 'New Orleans', 'LA', 'America/Chicago', false, 3, false),
('pit', 'Pittsburgh', 'PA', 'America/New_York', false, 3, false),
('bal', 'Baltimore', 'MD', 'America/New_York', false, 3, false),
('stl', 'St. Louis', 'MO', 'America/Chicago', false, 3, false),
('kc', 'Kansas City', 'MO', 'America/Chicago', false, 3, false),
('orl', 'Orlando', 'FL', 'America/New_York', false, 3, false),
('tpa', 'Tampa', 'FL', 'America/New_York', false, 3, false),
('clt', 'Charlotte', 'NC', 'America/New_York', false, 3, false),
('rdu', 'Raleigh–Durham', 'NC', 'America/New_York', false, 3, false),
('slc', 'Salt Lake City', 'UT', 'America/Denver', false, 3, false),
('cmh', 'Columbus', 'OH', 'America/New_York', false, 3, false),
('cle', 'Cleveland', 'OH', 'America/New_York', false, 3, false),
('cin', 'Cincinnati', 'OH', 'America/New_York', false, 3, false),
('ind', 'Indianapolis', 'IN', 'America/Indiana/Indianapolis', false, 3, false),
('mke', 'Milwaukee', 'WI', 'America/Chicago', false, 3, false),
('sat', 'San Antonio', 'TX', 'America/Chicago', false, 3, false),
('sac', 'Sacramento', 'CA', 'America/Los_Angeles', false, 3, false),
('cgy', 'Calgary', 'AB', 'America/Edmonton', false, 3, false),
('edm', 'Edmonton', 'AB', 'America/Edmonton', false, 3, false),
('ott', 'Ottawa', 'ON', 'America/Toronto', false, 3, false),
('wpg', 'Winnipeg', 'MB', 'America/Winnipeg', false, 3, false),
('yqb', 'Québec City', 'QC', 'America/Toronto', false, 3, false),
('hfx', 'Halifax', 'NS', 'America/Halifax', false, 3, false)
on conflict (metro) do update set name = excluded.name, state = excluded.state, tz = excluded.tz, hot = excluded.hot;

update fp.metro_config set aliases = case metro
  when 'nyc' then array['Brooklyn','Queens','Manhattan','Bronx','Staten Island','NYC','Jersey City','Hoboken']
  when 'sf' then array['San Francisco','Oakland','Berkeley','San Jose']
  when 'mtl' then array['Montreal']
  when 'la' then array['Hollywood','Pasadena','Long Beach','Santa Monica']
  when 'dc' then array['Washington DC','Arlington','Alexandria']
  when 'yqb' then array['Quebec City','Quebec']
  else aliases end
where metro in ('nyc','sf','mtl','la','dc','yqb');
-- When a retry worker picked a flyer job up, so a crashed worker's job can be put back in the queue. Safe to run twice.
alter table fp.flyer_jobs add column if not exists claimed_at timestamptz not null default now();
-- Scheduled work inside Supabase: retry queued flyers (only when something is due) and clear old data once a day.
-- The JOB_TOKEN is read from Supabase Vault (secret name fp_job_token). Add it once in the SQL editor:
--   select vault.create_secret('<the same value as the JOB_TOKEN function secret>', 'fp_job_token');
-- Until that exists, fp.retry_if_due() does nothing. Safe to run twice.

create extension if not exists pg_net with schema extensions;

insert into fp.ai_config (key, value) values ('job_url', '"https://ytybkywyygorfvflbxzk.supabase.co/functions/v1/fp-job"') on conflict do nothing;

create or replace function fp.call_job(act text) returns bigint
language plpgsql security definer set search_path = fp, public, extensions as $$
declare tok text; url text; req bigint;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'fp_job_token' limit 1;
  select value #>> '{}' into url from fp.ai_config where key = 'job_url';
  if tok is null or url is null then return null; end if;
  select net.http_post(url := url, headers := jsonb_build_object('content-type', 'application/json', 'x-job-token', tok), body := jsonb_build_object('action', act)) into req;
  return req;
end $$;

create or replace function fp.retry_if_due() returns void
language plpgsql security definer set search_path = fp, public, extensions as $$
begin
  if exists (select 1 from fp.flyer_jobs where status in ('queued', 'retry') and next_attempt_at <= now())
     or exists (select 1 from fp.flyer_jobs where status = 'processing' and finished_at is null and claimed_at < now() - interval '10 minutes') then
    perform fp.call_job('retry');
  end if;
end $$;

revoke all on function fp.call_job(text), fp.retry_if_due() from public, anon, authenticated;
grant execute on function fp.call_job(text), fp.retry_if_due() to service_role;

select cron.schedule('fp-flyer-retry', '* * * * *', 'select fp.retry_if_due()');
select cron.schedule('fp-purge-old', '23 8 * * *', 'select fp.purge_old()');
-- Public read of the licensed-layer switches (no secrets): the feed job and the app apply them.
create or replace function public.fp_licensed_switches()
returns jsonb
language sql
stable
security definer
set search_path = fp, public
as $$
  select coalesce(jsonb_object_agg(family, enabled), '{}'::jsonb) from fp.licensed_switches;
$$;
revoke all on function public.fp_licensed_switches() from public;
grant execute on function public.fp_licensed_switches() to anon, authenticated;
-- Allow the flyer analytics events in log_events (names only; properties are still checked as short scalars).
do $$
declare def text;
begin
  select pg_get_functiondef('public.log_events(jsonb)'::regprocedure) into def;
  if def not like '%flyer_shared%' then
    def := replace(def, '''feedback_sent''];', '''feedback_sent'',''flyer_shared'',''flyer_ocr'',''flyer_result'',''link_fetch'',''ai_quota''];');
    execute def;
  end if;
end $$;
-- ISO start/doors with the venue's UTC offset (the app reads the clock digits straight from the string and never parses time zones).
create or replace function fp.iso_local(d date, t text, tz text) returns text
language sql immutable set search_path = fp, public as $$
  select case when d is null or t is null or t !~ '^\d\d:\d\d' then null else
    to_char(d + substr(t, 1, 5)::time, 'YYYY-MM-DD"T"HH24:MI":00"')
    || (select case when o < 0 then '-' else '+' end || lpad((abs(o) / 60)::text, 2, '0') || ':' || lpad((abs(o) % 60)::text, 2, '0')
        from (select (extract(epoch from ((d + substr(t, 1, 5)::time) at time zone 'UTC') - ((d + substr(t, 1, 5)::time) at time zone tz))::int / 60)::int as o) x)
  end
$$;

create or replace function public.fp_public_shows(p_metro text) returns jsonb
language sql stable security definer set search_path = public, fp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'key', s.key, 'metro', s.metro, 'venueId', s.venue_id, 'venueName', s.venue_name, 'city', s.city,
    'address', case when s.address_mode = 'registry' then s.address end, 'addressMode', s.address_mode,
    'localDate', s.local_date, 'startLocal', s.start_local, 'doorsLocal', s.doors_local,
    'startsAt', fp.iso_local(s.local_date, coalesce(s.start_local, '20:00'), mc.tz),
    'doorsAt', fp.iso_local(s.local_date, s.doors_local, mc.tz),
    'timeTba', s.start_local is null,
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
  join fp.metro_config mc on mc.metro = s.metro
$$;
-- Add venue coordinates (from the registry) to the public show rows so the app can apply its distance filter.
do $$
declare def text;
begin
  select pg_get_functiondef('public.fp_public_shows(text)'::regprocedure) into def;
  if def not like '%''lat''%' then
    def := replace(def, '''timeTba'', ', '''lat'', v.lat, ''lng'', v.lng, ''timeTba'', ');
    def := replace(def, 'join fp.metro_config mc on mc.metro = s.metro', 'join fp.metro_config mc on mc.metro = s.metro left join fp.venues v on v.id = s.venue_id');
    execute def;
  end if;
end $$;
-- Shows read from a venue's site stay out of the public list until the venue is approved. Flyer shows (with a submitter) are unaffected.
do $$
declare def text;
begin
  select pg_get_functiondef('public.fp_public_shows(text)'::regprocedure) into def;
  if def not like '%v.status = ''approved''%' then
    def := replace(def, 'and (submitter is null or submitter = auth.uid() or not public.pu_blocked(submitter))',
      'and (submitter is null or submitter = auth.uid() or not public.pu_blocked(submitter))' || E'\n      and (submitter is not null or venue_id is null or exists (select 1 from fp.venues v where v.id = fp.shows.venue_id and v.status = ''approved''))');
    execute def;
  end if;
end $$;

-- ---- 015: venue and start time in the person's flyer list ----
create or replace function public.fp_my_flyer_jobs() returns jsonb
language sql stable security definer set search_path = public, fp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'status', j.status, 'result', j.result, 'reason', j.reason, 'createdAt', j.created_at,
    'finishedAt', j.finished_at, 'notified', j.notified,
    'shows', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'headliner', s.headliner, 'localDate', s.local_date, 'visibility', s.visibility,
                                                          'venueName', s.venue_name, 'startLocal', s.start_local)), '[]'::jsonb)
              from fp.shows s where s.id = any (j.show_ids))
  ) order by j.created_at desc), '[]'::jsonb)
  from fp.flyer_jobs j
  where j.submitter = auth.uid() and j.created_at > now() - interval '30 days'
$$;

-- ---- 016: the retired seller is gone from the licence layer (existing databases) ----
-- Run by hand in the SQL editor; the migration file 016_retire_seller_schema.sql has the same statements.
-- (A fresh database already has the tightened definitions above; these are no-ops there.)
delete from fp.licensed_switches where family <> 'jambase_listings';
delete from fp.licensed_links where source <> 'jambase';
alter table fp.licensed_switches drop constraint if exists licensed_switches_family_check;
alter table fp.licensed_switches add constraint licensed_switches_family_check check (family = 'jambase_listings');
alter table fp.licensed_links drop constraint if exists licensed_links_source_check;
alter table fp.licensed_links add constraint licensed_links_source_check check (source = 'jambase');

-- 019: notification analytics event names (names only; see migrations/019_notification_analytics_events.sql)
do $$
declare def text;
begin
  select pg_get_functiondef('public.log_events(jsonb)'::regprocedure) into def;
  if def not like '%notif_scheduled%' then
    def := replace(def, '''ai_quota''];', '''ai_quota'',''notif_scheduled'',''notif_opened'',''notif_setting_changed''];');
    execute def;
  end if;
end $$;

-- 020: soft launch (see migrations/020_soft_launch.sql)
alter table fp.metro_config add column if not exists soft_launch boolean not null default false;
update fp.metro_config set soft_launch = true, daily_request_budget = 40, updated_at = now() where metro in ('nyc', 'la') and (soft_launch = false or daily_request_budget < 40);

-- 021: anonymous "N going" counts (see migrations/021_going_counts.sql)
-- 021: anonymous "N going" counts.
-- Meaning: the number of distinct app installs (not people) that currently have a show marked Going.
-- A phone makes a random going_id, stored only on the phone, separate from the analytics install id and from any account.
-- Clients cannot read or write these tables. They can only call three functions: set_going, forget_my_going, get_going_counts.
-- get_going_counts returns a count only when it is at least going_count_min_display (16, i.e. "more than 15"); smaller counts never leave the server.
create schema if not exists going;
revoke all on schema going from public, anon, authenticated;

create table if not exists going.config (key text primary key, value text not null);
insert into going.config (key, value) values
  ('going_count_min_display', '16'),   -- display only if the count is at least this (more than 15)
  ('max_changes_per_day', '200'),      -- going changes accepted per going_id per day; the rest are ignored quietly
  ('purge_after_days', '7')            -- rows are deleted this many days after the show's date
  on conflict (key) do nothing;

-- One row per going_id per show. No names, no emails. show_date is the show's local date, sent by the phone, used only for the purge.
create table if not exists going.rows (
  show_id text not null check (char_length(show_id) between 1 and 120),
  going_id uuid not null,
  show_date date not null,
  created_at timestamptz not null default now(),
  primary key (show_id, going_id)
);
create index if not exists going_rows_going_id on going.rows (going_id);
create index if not exists going_rows_show_date on going.rows (show_date);

-- What reads come from: kept up to date by the writes, never by scanning rows.
create table if not exists going.counts (
  show_id text primary key,
  n integer not null check (n > 0),
  show_date date not null
);

-- Daily change counter per going_id (the abuse limit). Old days are purged.
create table if not exists going.limits (
  going_id uuid not null,
  day date not null,
  changes integer not null default 0,
  primary key (going_id, day)
);

-- Shows an operator has excluded (a spoofed count). get_going_counts never returns these.
create table if not exists going.excluded (show_id text primary key, added_at timestamptz not null default now());

alter table going.config enable row level security;
alter table going.rows enable row level security;
alter table going.counts enable row level security;
alter table going.limits enable row level security;
alter table going.excluded enable row level security;
revoke all on all tables in schema going from public, anon, authenticated;

create or replace function going.cfg(k text, d integer) returns integer
language sql stable as $$ select coalesce((select value::integer from going.config where key = k), d) $$;

-- The going_counts_enabled kill switch (a missing row means ON).
create or replace function going.flag_on() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.app_flags where key = 'going_counts_enabled'), true)
$$;

create or replace function going.recount(p_ids text[]) returns void
language plpgsql as $$
begin
  delete from going.counts where show_id = any (p_ids);
  insert into going.counts (show_id, n, show_date)
    select show_id, count(*)::integer, max(show_date) from going.rows where show_id = any (p_ids) group by show_id;
end $$;

-- Batched and idempotent: p_changes is [{"show_id": "...", "going": true|false, "date": "YYYY-MM-DD"}], at most 50 per call.
create or replace function public.set_going(p_going_id uuid, p_changes jsonb) returns void
language plpgsql security definer set search_path = going, public as $$
declare
  c jsonb; sid text; want boolean; d date; used integer; lim integer := going.cfg('max_changes_per_day', 200); k integer;
begin
  if not going.flag_on() then return; end if;
  if p_going_id is null or p_changes is null or jsonb_typeof(p_changes) <> 'array' then return; end if;
  insert into going.limits (going_id, day) values (p_going_id, current_date) on conflict do nothing;
  select changes into used from going.limits where going_id = p_going_id and day = current_date for update;
  for c in select * from jsonb_array_elements(p_changes) limit 50 loop
    exit when used >= lim;
    used := used + 1;
    sid := c ->> 'show_id';
    continue when sid is null or char_length(sid) not between 1 and 120;
    continue when jsonb_typeof(c -> 'going') is distinct from 'boolean';
    want := (c ->> 'going')::boolean;
    if want then
      begin
        d := (c ->> 'date')::date;
      exception when others then
        continue;
      end;
      continue when d is null or d < current_date - 2 or d > current_date + 540;
      insert into going.rows (show_id, going_id, show_date) values (sid, p_going_id, d) on conflict do nothing;
      get diagnostics k = row_count;
      if k = 1 then
        insert into going.counts (show_id, n, show_date) values (sid, 1, d)
          on conflict (show_id) do update set n = going.counts.n + 1, show_date = greatest(going.counts.show_date, excluded.show_date);
      end if;
    else
      delete from going.rows where show_id = sid and going_id = p_going_id;
      get diagnostics k = row_count;
      if k = 1 then
        update going.counts set n = n - 1 where show_id = sid;
        delete from going.counts where show_id = sid and n <= 0;
      end if;
    end if;
  end loop;
  update going.limits set changes = used where going_id = p_going_id and day = current_date;
end $$;

-- Deletes every row of this phone. Works even when the kill switch is off.
create or replace function public.forget_my_going(p_going_id uuid) returns void
language plpgsql security definer set search_path = going, public as $$
declare ids text[];
begin
  if p_going_id is null then return; end if;
  with d as (delete from going.rows where going_id = p_going_id returning show_id)
    select array_agg(distinct show_id) into ids from d;
  if ids is not null then perform going.recount(ids); end if;
end $$;

-- Counts for up to 50 shows. Only shows whose count is at least going_count_min_display appear; everything else is silently left out.
create or replace function public.get_going_counts(p_show_ids text[]) returns jsonb
language plpgsql stable security definer set search_path = going, public as $$
declare minn integer := going.cfg('going_count_min_display', 16);
begin
  if not going.flag_on() or p_show_ids is null then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(c.show_id, c.n) from going.counts c
    where c.show_id = any (p_show_ids[1:50]) and c.n >= minn
      and not exists (select 1 from going.excluded e where e.show_id = c.show_id)
  ), '{}'::jsonb);
end $$;

-- Daily clean-up: rows 7 days after the show's date, and old limit counters. No history of counts is kept.
create or replace function going.purge_old() returns void
language plpgsql as $$
declare ids text[];
begin
  with d as (delete from going.rows where show_date < current_date - going.cfg('purge_after_days', 7) returning show_id)
    select array_agg(distinct show_id) into ids from d;
  if ids is not null then perform going.recount(ids); end if;
  delete from going.limits where day < current_date - 2;
end $$;

-- The kill-switch purge: deletes every going row and count (run by the owner; see supabase/KILL_SWITCHES.md).
create or replace function going.purge_all() returns void
language sql as $$ delete from going.rows; delete from going.counts; delete from going.limits; $$;

-- A show's canonical id changed (a venue-page show was matched to a JamBase listing): move its rows and count to the new id.
-- A phone that already had the new id keeps one row only.
create or replace function going.rekey_show(p_old text, p_new text) returns void
language plpgsql as $$
begin
  if p_old is null or p_new is null or p_old = p_new then return; end if;
  delete from going.rows r using going.rows keep where r.show_id = p_old and keep.show_id = p_new and keep.going_id = r.going_id;
  update going.rows set show_id = p_new where show_id = p_old;
  insert into going.excluded (show_id) select p_new where exists (select 1 from going.excluded where show_id = p_old) on conflict do nothing;
  perform going.recount(array[p_old, p_new]);
end $$;

revoke all on all functions in schema going from public, anon, authenticated;
revoke all on function public.set_going(uuid, jsonb), public.forget_my_going(uuid), public.get_going_counts(text[]) from public;
grant execute on function public.set_going(uuid, jsonb), public.forget_my_going(uuid), public.get_going_counts(text[]) to anon, authenticated;

-- Daily purge at 08:37 UTC (the analytics purge runs at 08:17). Skipped where pg_cron is not available; run select going.purge_old(); by hand then.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('going-purge', '37 8 * * *', 'select going.purge_old()');
  end if;
end $$;

-- show_shared analytics event (names only; the props are "details" or "going" and true or false).
do $$
declare def text;
begin
  if to_regprocedure('public.log_events(jsonb)') is null then return; end if;
  select pg_get_functiondef('public.log_events(jsonb)'::regprocedure) into def;
  if def not like '%show_shared%' then
    def := replace(def, '''notif_setting_changed''];', '''notif_setting_changed'',''show_shared''];');
    execute def;
  end if;
end $$;

-- 022: going_counts_enabled flag (see migrations/022_going_flag_row.sql)
-- 022: add the going_counts_enabled kill switch to app_flags. Run by the owner in the SQL editor (it replaces a CHECK constraint,
-- which the assistant's database connector will not run). Until this runs, a missing flag row counts as ON.
alter table public.app_flags drop constraint if exists app_flags_key_check;
alter table public.app_flags add constraint app_flags_key_check
  check (key in ('jambase_enabled', 'deezer_enabled', 'ai_extraction_enabled', 'flyer_intake_enabled', 'venue_scan_enabled', 'notifications_enabled', 'going_counts_enabled'));
insert into public.app_flags (key) values ('going_counts_enabled') on conflict (key) do nothing;
