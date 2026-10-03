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
