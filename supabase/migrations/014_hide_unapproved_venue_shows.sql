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
