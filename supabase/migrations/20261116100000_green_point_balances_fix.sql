-- Green Point visit showed "No Longkloof & Green Point packs" for members who have them.
-- The pack list check compared the category (a fixed list in the database) with an empty text,
-- which fails instead of returning the packs. Compare as text, and return whole numbers safely.

drop function if exists public.green_point_balances(uuid);

create function public.green_point_balances(p_profile_id uuid)
returns table (credit_id uuid, pack text, is_unlimited boolean, credits_total integer,
               credits_remaining integer, expires_at timestamptz, visits_used integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_any_role(array['director','management','front_desk','guide','boh','team']) then
    raise exception 'Only studio staff can do this';
  end if;
  return query
  select c.id,
         coalesce(c.product_name, 'Pack')::text,
         coalesce(c.is_unlimited, false),
         c.credits_total::int,
         c.credits_remaining::int,
         c.expires_at,
         (select count(*)::int from public.green_point_visits v where v.credit_id = c.id)
  from public.user_credits c
  where c.profile_id = p_profile_id
    and c.access_scope::text = 'open_access'
    and c.refunded_at is null
    and (c.expires_at is null or c.expires_at > now())
    and (coalesce(c.is_unlimited, false) or coalesce(c.credits_remaining, 0) > 0)
    and coalesce(c.category::text, '') not in ('cafe', 'mat_towel')
  order by c.expires_at nulls last, c.product_name;
end;
$$;

revoke all on function public.green_point_balances(uuid) from public, anon;
grant execute on function public.green_point_balances(uuid) to authenticated;

-- Check: Julia's Seeker parts should be listed (3 rows). Run as yourself in the app to tick off;
-- here it only confirms the list works.
select c.product_name, c.access_scope::text, c.credits_remaining
from public.user_credits c
join public.profiles p on p.id = c.profile_id
where p.first_name ilike 'julia%' and p.last_name ilike 'christelis%'
  and c.access_scope::text = 'open_access'
  and coalesce(c.category::text, '') not in ('cafe', 'mat_towel');
