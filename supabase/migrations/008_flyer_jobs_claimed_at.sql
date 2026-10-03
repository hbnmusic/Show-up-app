-- When a retry worker picked a flyer job up, so a crashed worker's job can be put back in the queue. Safe to run twice.
alter table fp.flyer_jobs add column if not exists claimed_at timestamptz not null default now();
