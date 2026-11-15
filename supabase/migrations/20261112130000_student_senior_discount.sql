-- Student and senior discount (10%, on any pack, offered at checkout only).
--   The member uploads a photo of their ID (seniors, 65+) or student card / registration letter.
--   The verify-concession function reads it automatically and decides. The photo is never stored.
--   Approval lasts 6 months. One check per 6 months (an unreadable photo doesn't count).
--   Director and Management see every check in Admin → Student & senior and can revoke an approval.
-- All numbers live in Admin → Settings → Student & senior discount.

insert into public.studio_settings (key, value) values
  ('concession_discount_percent', '10'),
  ('concession_valid_months', '6'),
  ('concession_retry_months', '6'),
  ('concession_senior_age', '65')
on conflict (key) do nothing;

create table if not exists public.concession_checks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('student', 'senior')),
  result text not null check (result in ('approved', 'declined', 'unreadable')),
  reason text,
  document_summary text,
  valid_until date,
  checked_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid
);

create index if not exists concession_checks_profile_idx on public.concession_checks (profile_id, checked_at desc);

alter table public.concession_checks enable row level security;

drop policy if exists concession_checks_read on public.concession_checks;
create policy concession_checks_read on public.concession_checks for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['director', 'management']));
-- Rows are only written by the verify-concession function (service role).

-- The member's current discount, and when they may check again.
create or replace function public.my_concession(p_profile_id uuid default auth.uid())
returns table (kind text, valid_until date, discount_percent numeric, next_check_on date, last_result text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_pct numeric;
  v_retry int;
  a record;
  l record;
begin
  if p_profile_id is distinct from auth.uid() and not public.has_any_role(array['director', 'management']) then
    raise exception 'Not allowed';
  end if;
  select coalesce(nullif(max(value) filter (where key = 'concession_discount_percent'), '')::numeric, 10),
         coalesce(nullif(max(value) filter (where key = 'concession_retry_months'), '')::int, 6)
    into v_pct, v_retry
  from public.studio_settings where key like 'concession\_%';

  select c.kind, c.valid_until into a
  from public.concession_checks c
  where c.profile_id = p_profile_id and c.result = 'approved' and c.revoked_at is null
    and c.valid_until >= v_today
  order by c.valid_until desc limit 1;

  select c.result, c.checked_at into l
  from public.concession_checks c
  where c.profile_id = p_profile_id and c.result in ('approved', 'declined')
  order by c.checked_at desc limit 1;

  return query select
    a.kind,
    a.valid_until,
    case when a.kind is not null then v_pct end,
    case when l.checked_at is null then v_today
         else greatest(v_today, ((l.checked_at at time zone 'Africa/Johannesburg')::date + make_interval(months => v_retry))::date) end,
    l.result;
end;
$$;

revoke all on function public.my_concession(uuid) from public, anon;
grant execute on function public.my_concession(uuid) to authenticated;

create or replace function public.revoke_concession(p_check_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_any_role(array['director', 'management']) then
    raise exception 'Only Director and Management can revoke a discount';
  end if;
  update public.concession_checks
     set revoked_at = now(), revoked_by = auth.uid()
   where id = p_check_id and revoked_at is null;
end;
$$;

revoke all on function public.revoke_concession(uuid) from public, anon;
grant execute on function public.revoke_concession(uuid) to authenticated;

-- Check
select key, value from public.studio_settings where key like 'concession\_%' order by key;
