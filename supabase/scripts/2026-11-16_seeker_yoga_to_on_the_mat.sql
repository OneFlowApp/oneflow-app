-- The Seeker: the "Yoga" part is called "On The Mat".
-- 1) The pack setting, so new Seekers get the right name.
-- 2) Seekers already loaded or bought.

with fixed_setting as (
  update public.product_allowances a
     set label = 'On The Mat'
    from public.products p
   where p.id = a.product_id
     and p.name ilike '%seeker%'
     and a.label ilike 'yoga'
  returning a.id
),
fixed_packs as (
  update public.user_credits
     set product_name = regexp_replace(product_name, '\s*-\s*Yoga$', ' - On The Mat', 'i')
   where product_name ~* 'seeker\s*-\s*yoga$'
  returning id
)
select (select count(*) from fixed_setting) as seeker_setting_renamed,
       (select count(*) from fixed_packs) as member_packs_renamed;
