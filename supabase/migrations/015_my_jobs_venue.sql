-- 015: the person's own flyer list also returns each show's venue and start time, for the Submitted tab.
create or replace function public.fp_my_flyer_jobs() returns jsonb
language sql stable security definer set search_path = public, fp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'status', j.status, 'result', j.result, 'reason', j.reason, 'createdAt', j.created_at,
    'finishedAt', j.finished_at, 'notified', j.notified,
    'shows', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'headliner', s.headliner, 'localDate', s.local_date, 'visibility', s.visibility,
                                                          'venueName', s.venue_name, 'startLocal', s.start_local)), '[]'::jsonb)
              from fp.shows s where s.id = any (j.show_ids))
  ) order by j.created_at desc), '[]'::jsonb)
  from fp.flyer_jobs j
  where j.submitter = auth.uid() and j.created_at > now() - interval '30 days'
$$;
