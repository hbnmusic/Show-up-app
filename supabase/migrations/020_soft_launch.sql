-- Soft launch: New York and Los Angeles are scanned first, with a higher daily model-request budget and more trials per run.
-- Every other city keeps working (lower priority) and every city still shows its JamBase listings.
alter table fp.metro_config add column if not exists soft_launch boolean not null default false;
update fp.metro_config set soft_launch = true, daily_request_budget = 40, updated_at = now() where metro in ('nyc', 'la') and (soft_launch = false or daily_request_budget < 40);
