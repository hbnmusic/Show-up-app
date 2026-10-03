-- First-party listings layer: flyers shared by people and venues' own sites, kept apart from JamBase and Ticketmaster data.
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

-- Venue registry. Seeded only from venues' own sites and Wikidata (CC0). Never from JamBase, Ticketmaster or OpenStreetMap.
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

-- The merged first-party show. Licensed data (JamBase, Ticketmaster) is never stored here.
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
  source text not null check (source in ('jambase', 'ticketmaster')),
  external_id text not null check (char_length(external_id) <= 120),
  created_at timestamptz not null default now(),
  primary key (show_id, source)
);

-- On/off switches for the licensed layer. Defaults keep today's behaviour.
create table if not exists fp.licensed_switches (
  family text primary key check (family in ('jambase_listings', 'ticketmaster_price', 'ticketmaster_photo', 'ticketmaster_link')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into fp.licensed_switches (family) values ('jambase_listings'), ('ticketmaster_price'), ('ticketmaster_photo'), ('ticketmaster_link')
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
