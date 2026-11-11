-- Membership card tiers, version 2.
--   Earn a tier on LIFETIME classes attended: Green 40, Bronze 100, Silver 250, Gold 500.
--   Keep it with a rolling yearly review: classes in the last 12 months must reach the tier's
--   "keep" number (Green 20, Bronze 40, Silver 75, Gold 100), otherwise the card shows the tier below.
--   No class for 60 days drops the card one tier. 4 classes after coming back restores it.
--   Director and Management can pause the 60 day rule for a member (injury, pregnancy, travel).
-- All numbers live in Admin → Settings → Membership tiers.

insert into public.studio_settings (key, value) values
  ('tier_green_classes', '40'),
  ('tier_bronze_classes', '100'),
  ('tier_silver_classes', '250'),
  ('tier_gold_classes', '500'),
  ('tier_green_keep', '20'),
  ('tier_bronze_keep', '40'),
  ('tier_silver_keep', '75'),
  ('tier_gold_keep', '100'),
  ('tier_inactive_days', '60'),
  ('tier_restore_classes', '4')
on conflict (key) do update set value = excluded.value, updated_at = now();

delete from public.studio_settings where key = 'tier_platinum_classes';

alter table public.profiles add column if not exists tier_paused_from date;
alter table public.profiles add column if not exists tier_paused_until date;

create or replace function public.member_tier(p_profile_id uuid default auth.uid())
returns table (
  tier text,
  base_tier text,
  classes_lifetime integer,
  classes_12m integer,
  keep_target integer,
  next_tier text,
  classes_to_next integer,
  dropped boolean,
  restore_needed integer,
  last_class date,
  keep_by date,
  paused_from date,
  paused_until date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  s jsonb;
  e_green int; e_bronze int; e_silver int; e_gold int;
  k_green int; k_bronze int; k_silver int; k_gold int;
  v_inactive int; v_restore int;
  v_dates date[];
  v_n int; v_12 int;
  v_base text; v_tier text; v_next text; v_to_next int; v_keep int;
  v_dropped boolean := false; v_need int := 0;
  v_pf date; v_pu date;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_last date; v_keep_by date;
  i int;
begin
  if p_profile_id is null then return; end if;
  if p_profile_id is distinct from auth.uid()
     and not public.has_any_role(array['director', 'management', 'front_desk', 'marketing']) then
    raise exception 'Not allowed';
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into s
  from public.studio_settings where key like 'tier\_%';

  e_green  := coalesce(nullif(s->>'tier_green_classes', '')::int, 40);
  e_bronze := coalesce(nullif(s->>'tier_bronze_classes', '')::int, 100);
  e_silver := coalesce(nullif(s->>'tier_silver_classes', '')::int, 250);
  e_gold   := coalesce(nullif(s->>'tier_gold_classes', '')::int, 500);
  k_green  := coalesce(nullif(s->>'tier_green_keep', '')::int, 20);
  k_bronze := coalesce(nullif(s->>'tier_bronze_keep', '')::int, 40);
  k_silver := coalesce(nullif(s->>'tier_silver_keep', '')::int, 75);
  k_gold   := coalesce(nullif(s->>'tier_gold_keep', '')::int, 100);
  v_inactive := coalesce(nullif(s->>'tier_inactive_days', '')::int, 60);
  v_restore  := coalesce(nullif(s->>'tier_restore_classes', '')::int, 4);

  select p.tier_paused_from, p.tier_paused_until into v_pf, v_pu
  from public.profiles p where p.id = p_profile_id;

  select coalesce(array_agg(d order by d), '{}') into v_dates
  from (
    select (c.starts_at at time zone 'Africa/Johannesburg')::date as d
    from public.bookings b
    join public.classes c on c.id = b.class_id
    where b.profile_id = p_profile_id
      and b.status::text = 'attended'
      and c.starts_at <= now()
  ) x;

  v_n := coalesce(array_length(v_dates, 1), 0);
  select count(*) into v_12 from unnest(v_dates) d where d > v_today - interval '12 months';
  v_last := case when v_n > 0 then v_dates[v_n] end;

  v_base := case
    when v_n >= e_gold and v_12 >= k_gold then 'gold'
    when v_n >= e_silver and v_12 >= k_silver then 'silver'
    when v_n >= e_bronze and v_12 >= k_bronze then 'bronze'
    when v_n >= e_green and v_12 >= k_green then 'green'
    else 'member'
  end;
  v_keep := case v_base when 'gold' then k_gold when 'silver' then k_silver
                        when 'bronze' then k_bronze when 'green' then k_green end;

  -- 60 day rule. Days inside a pause don't count towards a gap.
  if v_n > 0 and v_base <> 'member' then
    if public._tier_gap_days(v_last, v_today, v_pf, v_pu) > v_inactive then
      v_dropped := true;
      v_need := v_restore;
    else
      for i in reverse v_n .. 2 loop
        if public._tier_gap_days(v_dates[i - 1], v_dates[i], v_pf, v_pu) > v_inactive then
          if v_n - i + 1 < v_restore then
            v_dropped := true;
            v_need := v_restore - (v_n - i + 1);
          end if;
          exit;
        end if;
      end loop;
    end if;
  end if;

  v_tier := case when not v_dropped then v_base
                 else case v_base when 'gold' then 'silver' when 'silver' then 'bronze'
                                  when 'bronze' then 'green' else 'member' end end;

  v_next := case v_base when 'member' then 'green' when 'green' then 'bronze'
                        when 'bronze' then 'silver' when 'silver' then 'gold' end;
  -- Classes still needed for the next tier: lifetime total and this year's count both have to reach it.
  v_to_next := greatest(
    case v_next when 'green' then e_green when 'bronze' then e_bronze
                when 'silver' then e_silver when 'gold' then e_gold end - v_n,
    case v_next when 'green' then k_green when 'bronze' then k_bronze
                when 'silver' then k_silver when 'gold' then k_gold end - v_12,
    0);

  if v_last is not null and not (v_pu is not null and v_today <= v_pu and v_today >= coalesce(v_pf, v_today)) then
    v_keep_by := v_last + v_inactive
      + greatest(0, least(coalesce(v_pu, v_last), v_last + v_inactive) - greatest(coalesce(v_pf, v_last), v_last));
  end if;

  return query select v_tier, v_base, v_n, v_12, v_keep, v_next, v_to_next, v_dropped, v_need,
                      v_last, v_keep_by, v_pf, v_pu;
end;
$$;

-- Days between two classes, not counting days inside the member's pause.
create or replace function public._tier_gap_days(d1 date, d2 date, pf date, pu date)
returns integer
language sql
immutable
as $$
  select (d2 - d1)
    - case when pu is null then 0
           else greatest(0, least(d2, pu) - greatest(d1, coalesce(pf, d1))) end;
$$;

revoke all on function public.member_tier(uuid) from public, anon;
grant execute on function public.member_tier(uuid) to authenticated;

-- Director and Management: pause or clear a member's 60 day rule.
create or replace function public.set_tier_pause(p_profile_id uuid, p_until date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_any_role(array['director', 'management']) then
    raise exception 'Only Director and Management can pause a tier';
  end if;
  update public.profiles
     set tier_paused_from = case when p_until is null then null
                                 else coalesce(tier_paused_from, (now() at time zone 'Africa/Johannesburg')::date) end,
         tier_paused_until = p_until
   where id = p_profile_id;
end;
$$;

revoke all on function public.set_tier_pause(uuid, date) from public, anon;
grant execute on function public.set_tier_pause(uuid, date) to authenticated;

drop function if exists public.my_membership();

create function public.my_membership()
returns table (
  is_member boolean,
  valid_until timestamptz,
  pack_names text[],
  is_staff boolean,
  staff_label text,
  tier text,
  classes_lifetime integer,
  classes_12m integer,
  keep_target integer,
  next_tier text,
  classes_to_next integer,
  dropped boolean,
  restore_needed integer,
  keep_by date,
  paused_until date
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_staff boolean := public.has_any_role(array['director','management','marketing','front_desk','guide','boh','team']);
  v_label text;
  t record;
begin
  v_label := case
    when public.has_any_role(array['director']) then 'Director'
    when public.has_any_role(array['management']) then 'Management'
    when public.has_any_role(array['guide']) then 'Guide'
    when v_staff then 'Team'
  end;

  select * into t from public.member_tier(auth.uid());

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
         t.tier, t.classes_lifetime, t.classes_12m, t.keep_target, t.next_tier, t.classes_to_next,
         t.dropped, t.restore_needed, t.keep_by, t.paused_until
  from active a;
end;
$$;

revoke all on function public.my_membership() from public, anon;
grant execute on function public.my_membership() to authenticated;

-- Check: the new tier numbers.
select key, value from public.studio_settings where key like 'tier\_%' order by key;
