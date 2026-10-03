-- Scheduled work inside Supabase: retry queued flyers (only when something is due) and clear old data once a day.
-- The JOB_TOKEN is read from Supabase Vault (secret name fp_job_token). Add it once in the SQL editor:
--   select vault.create_secret('<the same value as the JOB_TOKEN function secret>', 'fp_job_token');
-- Until that exists, fp.retry_if_due() does nothing. Safe to run twice.

create extension if not exists pg_net with schema extensions;

insert into fp.ai_config (key, value) values ('job_url', '"https://ytybkywyygorfvflbxzk.supabase.co/functions/v1/fp-job"') on conflict do nothing;

create or replace function fp.call_job(act text) returns bigint
language plpgsql security definer set search_path = fp, public, extensions as $$
declare tok text; url text; req bigint;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'fp_job_token' limit 1;
  select value #>> '{}' into url from fp.ai_config where key = 'job_url';
  if tok is null or url is null then return null; end if;
  select net.http_post(url := url, headers := jsonb_build_object('content-type', 'application/json', 'x-job-token', tok), body := jsonb_build_object('action', act)) into req;
  return req;
end $$;

create or replace function fp.retry_if_due() returns void
language plpgsql security definer set search_path = fp, public, extensions as $$
begin
  if exists (select 1 from fp.flyer_jobs where status in ('queued', 'retry') and next_attempt_at <= now())
     or exists (select 1 from fp.flyer_jobs where status = 'processing' and finished_at is null and claimed_at < now() - interval '10 minutes') then
    perform fp.call_job('retry');
  end if;
end $$;

revoke all on function fp.call_job(text), fp.retry_if_due() from public, anon, authenticated;
grant execute on function fp.call_job(text), fp.retry_if_due() to service_role;

select cron.schedule('fp-flyer-retry', '* * * * *', 'select fp.retry_if_due()');
select cron.schedule('fp-purge-old', '23 8 * * *', 'select fp.purge_old()');
