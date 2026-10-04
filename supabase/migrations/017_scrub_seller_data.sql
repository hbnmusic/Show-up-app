-- Venue-scan records whose event link or photo pointed at the retired seller: drop the photo, repoint the source link at the venue's own site.
-- fp.source_records is append-only; purges set fp.allow_purge for the transaction.
do $$ begin
  perform set_config('fp.allow_purge', 'on', true);
  update fp.source_records sr
     set payload = (sr.payload - 'imageUrl') || jsonb_build_object('sourceUrl', coalesce(v.events_url, v.website, '')),
         source_url = coalesce(v.events_url, v.website, '')
    from fp.venues v
   where v.id = sr.venue_id and (sr.source_url ~* 'ticketm' or sr.payload::text ~* 'ticketm');
end $$;

update fp.shows s
   set image_url = null,
       field_source = s.field_source - 'image',
       sources = (select coalesce(jsonb_agg(case when e->>'url' ~* 'ticketm' then jsonb_set(e, '{url}', to_jsonb(coalesce(v.events_url, v.website, ''))) else e end), '[]'::jsonb) from jsonb_array_elements(s.sources) e)
  from fp.venues v
 where v.id = s.venue_id and (s.image_url ~* 'ticketm' or s.sources::text ~* 'ticketm');
