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
