-- Guides get one email at 16:00 Cape Town time with their classes for tomorrow.
-- Runs the send-guide-schedule function (deployed with Verify JWT OFF).
-- guide_schedule_runs makes sure it only sends once a day, even if it is called twice.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.guide_schedule_runs (
  run_day date primary key,
  emails_sent integer,
  created_at timestamptz not null default now()
);
alter table public.guide_schedule_runs enable row level security;
-- No policies: only the server function reads and writes it.

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname = 'send-guide-schedule' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end $$;

-- 14:00 UTC = 16:00 in Cape Town.
select cron.schedule(
  'send-guide-schedule',
  '0 14 * * *',
  $$
  select net.http_post(
    url := 'https://ubseyvrnravzwiqfxacz.supabase.co/functions/v1/send-guide-schedule',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

-- Check: one row, the 16:00 guide schedule.
select jobname, schedule from cron.job where jobname = 'send-guide-schedule';
