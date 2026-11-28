-- Payment failures on our side email straight away (to studio_settings 'error_digest_email').
--   Logged as app_errors with kind = 'payment':
--     * the app couldn't start a payment (checkout function unreachable, crashed, or Yoco refused);
--     * Yoco took the money but the pass couldn't be added (yoco-webhook).
--   Each one calls send-error-digest with instant_id, which emails it at once. The same error within
--   15 minutes is not emailed again (it still shows in the 07:30 daily email).

alter table public.app_errors add column if not exists kind text not null default 'popup';
alter table public.app_errors add column if not exists details jsonb;
alter table public.app_errors add column if not exists emailed_at timestamptz;
create index if not exists app_errors_kind_created on public.app_errors (kind, created_at);

drop policy if exists app_errors_insert on public.app_errors;
create policy app_errors_insert on public.app_errors for insert to anon, authenticated
  with check ((profile_id is null or profile_id = auth.uid())
              and kind in ('popup', 'payment')
              and emailed_at is null
              and (details is null or pg_column_size(details) <= 4000));

create or replace function public.alert_payment_error()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.kind = 'payment' then
    perform net.http_post(
      url := 'https://ubseyvrnravzwiqfxacz.supabase.co/functions/v1/send-error-digest',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('instant_id', new.id),
      timeout_milliseconds := 30000
    );
  end if;
  return new;
exception when others then
  raise warning 'alert_payment_error failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists app_errors_payment_alert on public.app_errors;
create trigger app_errors_payment_alert after insert on public.app_errors
  for each row execute function public.alert_payment_error();
