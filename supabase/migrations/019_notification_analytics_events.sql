-- Allow the three notification analytics events in log_events. Names only: the type is "A" or "B" and the state is "on" or "off".
-- No show, city, genre or count is sent.
do $$
declare def text;
begin
  select pg_get_functiondef('public.log_events(jsonb)'::regprocedure) into def;
  if def not like '%notif_scheduled%' then
    def := replace(def, '''ai_quota''];', '''ai_quota'',''notif_scheduled'',''notif_opened'',''notif_setting_changed''];');
    execute def;
  end if;
end $$;
