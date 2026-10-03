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
