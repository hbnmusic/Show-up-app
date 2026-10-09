-- Phase 1 of the first-party listings work: 18+ Terms version, more genres, shared genre list.
-- Already applied to the live project as 004a and 004b. Safe to run again.
create or replace function public.pu_allowed_genres() returns text[]
language sql immutable set search_path = public as $$
  select array['Punk','Hardcore','Screamo','Emo','Post-Punk','Darkwave','Industrial','Garage','Indie Rock',
    'Shoegaze','Noise Rock','Metal','Sludge & Doom','Psych','Folk','Pop','Experimental','Jazz & Improv','Electronic','Soul & Gospel',
    'Rock','Country','Blues','Hip-Hop','Classical','Latin','Reggae']::text[]
$$;
grant execute on function public.pu_allowed_genres() to anon, authenticated;

create or replace function public.pu_terms_version() returns text
language sql immutable set search_path = public as $$ select '2026-10-04'::text $$;

-- submit_show: replace its inline genre list with setnik_allowed_genres(). (Full function body is in schema.sql.)
do $m$
declare
  def text;
  old text := $o$allowed text[] := array['Punk','Hardcore','Screamo','Emo','Post-Punk','Darkwave','Industrial','Garage','Indie Rock',
    'Shoegaze','Noise Rock','Metal','Sludge & Doom','Psych','Folk','Pop','Experimental','Jazz & Improv','Electronic','Soul & Gospel'];$o$;
begin
  select pg_get_functiondef('public.submit_show(jsonb)'::regprocedure) into def;
  if position(old in def) > 0 then
    execute replace(def, old, 'allowed text[] := public.pu_allowed_genres();');
  end if;
end
$m$;
