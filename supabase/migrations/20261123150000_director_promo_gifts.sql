-- Directors are the exception to "team members can't gift passes":
--   one pass a month each (South African calendar month), worth up to R2 000 (the pass's price on the
--   Products page), for promo / marketing. The pass doesn't need to have been paid for.
--   A gift taken back before it's claimed doesn't count towards the month.
-- Every other team member still can't gift. Members are unaffected.

create or replace function public.gift_my_pass(p_credit_id uuid, p_recipient text default null, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  c public.user_credits;
  v_ids uuid[];
  v_rows jsonb;
  v_end timestamptz;
  v_bad int;
  v_token uuid;
  v_name text;
  v_director boolean;
  v_price numeric;
begin
  -- Directors may gift one pass a month, worth up to R2 000, for promo / marketing.
  -- Every other team member can't gift passes (see guard_gift_my_pass).
  select (p.role::text = 'director' or 'director' = any(coalesce(p.secondary_roles::text[], '{}')))
    into v_director from public.profiles p where p.id = v_uid;
  v_director := coalesce(v_director, false);
  select * into c from public.user_credits where id = p_credit_id;
  if c.id is null or c.profile_id is distinct from v_uid then raise exception 'Pass not found'; end if;

  select array_agg(x) into v_ids from public._purchase_credit_ids(c.id) as x;

  -- Every part must be unused, paid for, active and giftable.
  select count(*) into v_bad
  from public.user_credits u
  left join public.products p on p.id = u.product_id
  where u.id = any(v_ids)
    and (u.refunded_at is not null
         or (u.expires_at is not null and u.expires_at <= now())
         or (not coalesce(u.is_unlimited, false) and coalesce(u.credits_remaining, 0) < coalesce(u.credits_total, 0))
         or coalesce(p.is_continuous, false)
         or coalesce(p.is_staff_only, false)
         or (not v_director and coalesce(p.price_zar, 0) <= 0)
         or (not v_director and coalesce(u.entry_type, '') = 'free'));
  -- The purchase must have been paid for: online, or at a desk with an amount.
  if not v_director and not exists (
    select 1 from public.user_credits u
    where u.id = any(v_ids)
      and ((coalesce(u.yoco_payment_id, '') <> ''
            and u.yoco_payment_id not in ('yoco_checkout', 'manual_assignment', 'free_intro', 'manual_component',
                                          'manual_green_point', 'manual_studio', 'gameboard_gift'))
           or coalesce(u.amount_paid_zar, 0) > 0)) then
    v_bad := v_bad + 1;
  end if;
  if v_bad > 0 then
    raise exception 'Only unused, paid passes can be gifted (not part-used, Continuous Flow, comps or free passes)';
  end if;

  if v_director then
    select coalesce(p.price_zar, 0) into v_price from public.products p where p.id = c.product_id;
    if coalesce(v_price, 0) > 2000 then
      raise exception 'Promo gifts can be worth up to R2 000. This pass is R%', v_price;
    end if;
    if exists (
      select 1 from public.pack_gifts g
      where g.kind = 'transfer' and g.buyer_id = v_uid and g.status <> 'cancelled'
        and date_trunc('month', g.created_at at time zone 'Africa/Johannesburg')
          = date_trunc('month', now() at time zone 'Africa/Johannesburg')) then
      raise exception 'You''ve already gifted a promo pass this month. You can gift another from the 1st';
    end if;
  end if;

  if exists (select 1 from public.bookings b where b.credit_id = any(v_ids) and b.status::text <> 'cancelled') then
    raise exception 'This pass has classes booked on it. Cancel them first, then gift it';
  end if;
  if exists (select 1 from public.green_point_visits v where v.credit_id = any(v_ids)) then
    raise exception 'This pass has been used at Green Point, so it can''t be gifted';
  end if;
  if exists (select 1 from public.credit_pauses x where x.purchase_key = public._purchase_key(c) and x.status = 'active') then
    raise exception 'A paused pass can''t be gifted';
  end if;

  select min(u.expires_at), jsonb_agg(jsonb_build_object('id', u.id, 'expires_at', u.expires_at))
    into v_end, v_rows
  from public.user_credits u where u.id = any(v_ids);
  if v_end is null then v_end := now() + interval '90 days'; end if;

  select coalesce(p.name, c.product_name, 'Pass') into v_name from public.products p where p.id = c.product_id;

  insert into public.pack_gifts (kind, buyer_id, product_id, product_name, credit_ids, credit_rows,
                                 recipient_name, message, paid_at, claim_by)
  values ('transfer', v_uid, c.product_id, coalesce(v_name, c.product_name, 'Pass'), v_ids, v_rows,
          nullif(trim(coalesce(p_recipient, '')), ''), nullif(trim(coalesce(p_message, '')), ''),
          coalesce(c.purchased_at, c.created_at, now()), v_end)
  returning token into v_token;

  -- Off the giver's profile until it's claimed (or taken back): ended for now, real end date kept on the gift.
  update public.user_credits set expires_at = now() - interval '1 second' where id = any(v_ids);

  return v_token;
end;
$$;
revoke all on function public.gift_my_pass(uuid, text, text) from public, anon;
grant execute on function public.gift_my_pass(uuid, text, text) to authenticated;

create or replace function public.guard_gift_my_pass()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_director boolean;
begin
  if new.kind = 'transfer' then
    select (p.role::text = 'director' or 'director' = any(coalesce(p.secondary_roles::text[], '{}')))
      into v_director from public.profiles p where p.id = new.buyer_id;
    if public.is_staff_profile(new.buyer_id) and not coalesce(v_director, false) then
      raise exception 'Team members can''t gift passes';
    end if;
    if exists (select 1 from public.products p where p.id = new.product_id and p.name ilike '%staff%') then
      raise exception 'Staff passes can''t be gifted';
    end if;
    if coalesce(v_director, false) then
      if exists (select 1 from public.products p where p.id = new.product_id and coalesce(p.price_zar, 0) > 2000) then
        raise exception 'Promo gifts can be worth up to R2 000';
      end if;
      if exists (
        select 1 from public.pack_gifts g
        where g.kind = 'transfer' and g.buyer_id = new.buyer_id and g.status <> 'cancelled'
          and date_trunc('month', g.created_at at time zone 'Africa/Johannesburg')
            = date_trunc('month', now() at time zone 'Africa/Johannesburg')) then
        raise exception 'Only one promo gift a month';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Check: should say director_promo_gifts_ready = 1
select count(*) as director_promo_gifts_ready
from pg_proc where proname = 'gift_my_pass' and prosrc like '%v_director%';
