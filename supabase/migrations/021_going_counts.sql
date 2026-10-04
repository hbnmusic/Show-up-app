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
