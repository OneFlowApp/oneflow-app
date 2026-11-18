-- "forbidden" when Management cancelled classes in Schedule.
-- The app lets anyone with Director or Management as their main OR extra role manage the schedule,
-- but the database only checked the main role. Now both agree.

create or replace function public.is_admin_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        lower(coalesce(p.role::text, '')) in ('director', 'management')
        or coalesce(p.secondary_roles, '{}') && array['director', 'management']
      )
  );
$$;

-- Check: everyone the database now treats as Director or Management.
select p.first_name || ' ' || coalesce(p.last_name, '') as name, p.role::text as main_role, p.secondary_roles
from public.profiles p
where lower(coalesce(p.role::text, '')) in ('director', 'management')
   or coalesce(p.secondary_roles, '{}') && array['director', 'management']
order by 1;
