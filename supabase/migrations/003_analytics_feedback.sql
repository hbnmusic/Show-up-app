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
