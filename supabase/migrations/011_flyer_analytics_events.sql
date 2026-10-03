-- Allow the flyer analytics events in log_events (names only; properties are still checked as short scalars).
do $$
declare def text;
begin
  select pg_get_functiondef('public.log_events(jsonb)'::regprocedure) into def;
  if def not like '%flyer_shared%' then
    def := replace(def, '''feedback_sent''];', '''feedback_sent'',''flyer_shared'',''flyer_ocr'',''flyer_result'',''link_fetch'',''ai_quota''];');
    execute def;
  end if;
end $$;
