-- 022: add the going_counts_enabled kill switch to app_flags. Run by the owner in the SQL editor (it replaces a CHECK constraint,
-- which the assistant's database connector will not run). Until this runs, a missing flag row counts as ON.
alter table public.app_flags drop constraint if exists app_flags_key_check;
alter table public.app_flags add constraint app_flags_key_check
  check (key in ('jambase_enabled', 'deezer_enabled', 'ai_extraction_enabled', 'flyer_intake_enabled', 'venue_scan_enabled', 'notifications_enabled', 'going_counts_enabled'));
insert into public.app_flags (key) values ('going_counts_enabled') on conflict (key) do nothing;
