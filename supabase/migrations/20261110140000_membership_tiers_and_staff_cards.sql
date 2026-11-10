-- Membership card for staff (with their staff packs) and reward tiers for everyone.
-- Tier = classes attended in the last 12 months: Green, Silver, Gold, Platinum.
-- Thresholds live in studio_settings (Admin → Settings → Membership tiers).
insert into public.studio_settings (key, value) values
  ('tier_silver_classes', '25'),
  ('tier_gold_classes', '75'),
  ('tier_platinum_classes', '150')
on conflict (key) do nothing;

drop function if exists public.my_membership();

create function public.my_membership()
returns table (
  is_member boolean,
  valid_until timestamptz,
  pack_names text[],
  is_staff boolean,
  staff_label text,
  tier text,
  classes_12m integer,
  next_tier text,
  classes_to_next integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_staff boolean := public.has_any_role(array['director','management','marketing','front_desk','guide','boh','team']);
  v_label text;
  v_silver int; v_gold int; v_plat int; v_n int;
begin
  v_label := case
    when public.has_any_role(array['guide']) then 'Guide'
    when public.has_any_role(array['director']) then 'Director'
    when public.has_any_role(array['management']) then 'Management'
    when v_staff then 'Team'
  end;

  select coalesce(max(case when key = 'tier_silver_classes' then nullif(value, '')::int end), 25),
         coalesce(max(case when key = 'tier_gold_classes' then nullif(value, '')::int end), 75),
         coalesce(max(case when key = 'tier_platinum_classes' then nullif(value, '')::int end), 150)
    into v_silver, v_gold, v_plat
  from public.studio_settings
  where key in ('tier_silver_classes', 'tier_gold_classes', 'tier_platinum_classes');

  select count(*) into v_n
  from public.bookings b
  join public.classes c on c.id = b.class_id
  where b.profile_id = auth.uid()
    and b.status::text = 'attended'
    and c.starts_at >= now() - interval '12 months'
    and c.starts_at <= now();

  return query
  with active as (
    select cr.expires_at, coalesce(p.name, cr.product_name) as pack
    from public.user_credits cr
    join public.products p on p.id = cr.product_id
    where cr.profile_id = auth.uid()
      and cr.refunded_at is null
      and (cr.expires_at is null or cr.expires_at > now())
      and (coalesce(cr.is_unlimited, false) or coalesce(cr.credits_remaining, 0) > 0
           or coalesce(cr.mat_access, false) or coalesce(cr.towel_access, false))
      and (
        v_staff
        or (coalesce(cr.entry_type, '') <> 'free'
            and coalesce(p.price_zar, 0) > 0
            and not coalesce(p.is_staff_only, false)
            and p.name not ilike '%staff%')
      )
  )
  select (count(*) > 0) or v_staff,
         max(a.expires_at),
         coalesce(array_agg(distinct a.pack) filter (where a.pack is not null), '{}'),
         v_staff,
         v_label,
         case when v_n >= v_plat then 'platinum' when v_n >= v_gold then 'gold'
              when v_n >= v_silver then 'silver' else 'green' end,
         v_n,
         case when v_n >= v_plat then null when v_n >= v_gold then 'platinum'
              when v_n >= v_silver then 'gold' else 'silver' end,
         case when v_n >= v_plat then 0 when v_n >= v_gold then v_plat - v_n
              when v_n >= v_silver then v_gold - v_n else v_silver - v_n end
  from active a;
end;
$$;

revoke all on function public.my_membership() from public, anon;
grant execute on function public.my_membership() to authenticated;
