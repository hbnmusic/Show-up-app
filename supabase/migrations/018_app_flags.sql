-- 018: remote kill switches. One row per flag; all default ON. Only the project owner changes them, by SQL (see supabase/KILL_SWITCHES.md).
-- The app, the Edge Functions and the scheduled jobs read them through get_flags(), which returns the flags and nothing else.
create table if not exists public.app_flags (
  key text primary key check (key in ('jambase_enabled', 'deezer_enabled', 'ai_extraction_enabled', 'flyer_intake_enabled', 'venue_scan_enabled', 'notifications_enabled')),
  enabled boolean not null default true,
  message text check (message is null or char_length(message) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;  -- no policies: nobody reads or writes the table through the API; get_flags() is the only way in
revoke all on public.app_flags from anon, authenticated;

insert into public.app_flags (key) values ('jambase_enabled'), ('deezer_enabled'), ('ai_extraction_enabled'), ('flyer_intake_enabled'), ('venue_scan_enabled'), ('notifications_enabled')
  on conflict (key) do nothing;

create or replace function public.touch_app_flag() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger app_flags_touch before update on public.app_flags for each row execute function public.touch_app_flag();

create or replace function public.get_flags() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'enabled', enabled, 'message', message) order by key), '[]'::jsonb) from public.app_flags;
$$;
revoke all on function public.get_flags() from public;
grant execute on function public.get_flags() to anon, authenticated;
