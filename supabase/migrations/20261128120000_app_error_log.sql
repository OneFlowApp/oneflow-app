-- Error pop-ups are logged, and a daily email lists yesterday's errors.
--   app_errors: one row each time someone sees a red error pop-up in the app (member or admin).
--   Every day at 07:30 Cape Town time the send-error-digest function emails yesterday's errors to the
--   address in studio_settings 'error_digest_email'. No errors, no email.
--   send-error-digest must be deployed with Verify JWT OFF.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid default auth.uid() references public.profiles(id) on delete set null,
  message text not null check (char_length(message) <= 500),
  path text check (char_length(path) <= 200),
  activity text check (char_length(activity) <= 200),
  user_agent text check (char_length(user_agent) <= 300)
);
create index if not exists app_errors_created_at on public.app_errors (created_at);
alter table public.app_errors enable row level security;

drop policy if exists app_errors_insert on public.app_errors;
create policy app_errors_insert on public.app_errors for insert to anon, authenticated
  with check (profile_id is null or profile_id = auth.uid());
drop policy if exists app_errors_read on public.app_errors;
create policy app_errors_read on public.app_errors for select to authenticated
  using (public.has_any_role(array['director']));
grant insert on public.app_errors to anon, authenticated;
grant select on public.app_errors to authenticated;
grant all on public.app_errors to service_role;

create table if not exists public.error_digest_runs (
  run_day date primary key,
  errors_count integer,
  created_at timestamptz not null default now()
);
alter table public.error_digest_runs enable row level security;
grant all on public.error_digest_runs to service_role;

insert into public.studio_settings (key, value) values ('error_digest_email', 'jeanae@oneflow.co.za')
on conflict (key) do nothing;

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname = 'send-error-digest' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end $$;

-- 05:30 UTC = 07:30 in Cape Town.
select cron.schedule(
  'send-error-digest',
  '30 5 * * *',
  $$
  select net.http_post(
    url := 'https://ubseyvrnravzwiqfxacz.supabase.co/functions/v1/send-error-digest',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);

select jobname, schedule from cron.job where jobname = 'send-error-digest';
