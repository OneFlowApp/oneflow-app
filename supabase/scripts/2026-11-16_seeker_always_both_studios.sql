-- The Seeker is always Access to: Longkloof & Green Point, wherever it was bought or loaded.
-- 1) Set The Seeker product(s) to both studios, so every new load and online purchase gets it.
-- 2) Fix Seeker packs already loaded as Longkloof only (all parts, still running).
-- Only changes the access. Credits, dates and payments stay as they are.

with fixed_products as (
  update public.products
     set access_scope = 'open_access'
   where name ilike '%seeker%'
     and access_scope is distinct from 'open_access'
  returning id
),
fixed_packs as (
  update public.user_credits c
     set access_scope = 'open_access'
   where (c.product_id in (select id from public.products where name ilike '%seeker%')
          or c.product_name ilike '%seeker%')
     and c.access_scope is distinct from 'open_access'
     and c.refunded_at is null
     and (c.expires_at is null or c.expires_at > now())
  returning c.profile_id, c.product_name
)
select coalesce(p.first_name || ' ' || coalesce(p.last_name, ''), '(product setting)') as member,
       f.product_name as pack_part_fixed
from fixed_packs f
join public.profiles p on p.id = f.profile_id
union all
select '(product setting)', count(*)::text || ' Seeker product(s) set to both studios'
from fixed_products
order by 1, 2;
