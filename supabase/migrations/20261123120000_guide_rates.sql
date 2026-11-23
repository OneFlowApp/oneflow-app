-- Guide rates (Payouts → Guide rates, Directors only): each guide's pay rules,
-- e.g. Reformer, attendance 0 to 3: R250; 4 or more: R350.

create table if not exists public.guide_rates (
  id uuid primary key default gen_random_uuid(),
  guide_profile_id uuid not null references public.profiles(id) on delete cascade,
  class_group text not null default 'all'
    check (class_group in ('all', 'mat', 'reformer', 'wellzone', 'sauna_journey', 'event')),
  min_attendance integer not null default 0 check (min_attendance >= 0),
  max_attendance integer check (max_attendance is null or max_attendance >= 0),
  rate_zar numeric not null default 0 check (rate_zar >= 0),
  note text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists guide_rates_guide_idx on public.guide_rates (guide_profile_id);

alter table public.guide_rates enable row level security;
drop policy if exists guide_rates_directors on public.guide_rates;
create policy guide_rates_directors on public.guide_rates for all to authenticated
  using (public.has_any_role(array['director']))
  with check (public.has_any_role(array['director']));

grant select, insert, update, delete on public.guide_rates to authenticated;
grant all on public.guide_rates to service_role;

-- Check: the table is there.
select count(*) as guide_rate_rules from public.guide_rates;
