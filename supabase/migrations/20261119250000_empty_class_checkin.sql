-- Empty class check-in: when nobody is booked into a class, 5 minutes after it starts staff record
-- whether the guide stayed or left, with an optional note (for guide pay and follow-up).

create table if not exists public.empty_class_checkins (
  class_id uuid primary key references public.classes(id) on delete cascade,
  outcome text not null check (outcome in ('stayed', 'left')),
  note text,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now()
);

alter table public.empty_class_checkins enable row level security;

drop policy if exists empty_class_checkins_staff on public.empty_class_checkins;
create policy empty_class_checkins_staff on public.empty_class_checkins for all to authenticated
  using (public.has_any_role(array['director','management','front_desk','guide','boh','team']))
  with check (public.has_any_role(array['director','management','front_desk','guide','boh','team']));

grant select, insert, update on public.empty_class_checkins to authenticated;
grant all on public.empty_class_checkins to service_role;

-- Check: the table is there.
select count(*) as empty_class_records from public.empty_class_checkins;
