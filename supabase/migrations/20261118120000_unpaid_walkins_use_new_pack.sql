-- Unpaid walk-ins pay with a pack bought afterwards.
-- When a pack is loaded (by staff) or bought (online), the member's unpaid class bookings that the pack
-- covers are paid from it automatically: oldest first, one session each, the red Unpaid tag goes away
-- and the booking shows the pack it used.

create or replace function public.link_unpaid_bookings_to_credit(p_credit_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cr public.user_credits;
  b record;
  v_before integer;
  v_after integer;
  v_linked integer := 0;
begin
  select * into cr from public.user_credits where id = p_credit_id;
  if cr.id is null or cr.refunded_at is not null then return 0; end if;
  if coalesce(cr.category::text, '') in ('cafe', 'mat_towel') then return 0; end if;

  for b in
    select bk.id, c.class_type
    from public.bookings bk
    join public.classes c on c.id = bk.class_id
    where bk.profile_id = cr.profile_id
      and bk.unpaid
      and bk.credit_id is null
      and coalesce(bk.status::text, '') in ('attended', 'confirmed')
      and (cr.allowed_class_types is null
           or coalesce(array_length(cr.allowed_class_types, 1), 0) = 0
           or c.class_type = any(cr.allowed_class_types))
    order by c.starts_at
  loop
    select credits_remaining into v_before from public.user_credits where id = cr.id for update;
    if not coalesce(cr.is_unlimited, false) and coalesce(v_before, 0) <= 0 then
      exit;
    end if;

    update public.bookings
       set credit_id = cr.id,
           payment_method = 'credit',
           unpaid = false,
           paid_at = now(),
           paid_where = 'Paid with ' || coalesce(cr.product_name, 'pack'),
           paid_by = auth.uid()
     where id = b.id;

    -- Take the session off the pack, unless a database rule already did when the booking changed.
    if not coalesce(cr.is_unlimited, false) then
      select credits_remaining into v_after from public.user_credits where id = cr.id;
      if v_after = v_before then
        update public.user_credits set credits_remaining = credits_remaining - 1 where id = cr.id;
      end if;
    end if;

    v_linked := v_linked + 1;
  end loop;

  return v_linked;
end;
$$;

revoke all on function public.link_unpaid_bookings_to_credit(uuid) from public, anon, authenticated;

create or replace function public.trg_link_unpaid_bookings()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.link_unpaid_bookings_to_credit(new.id);
  return new;
end;
$$;

drop trigger if exists zz_link_unpaid_bookings on public.user_credits;
create trigger zz_link_unpaid_bookings
  after insert on public.user_credits
  for each row execute function public.trg_link_unpaid_bookings();

-- Catch up: unpaid bookings for members who already have a pack loaded today or later.
with done as (
  select cr.profile_id, public.link_unpaid_bookings_to_credit(cr.id) as n
  from public.user_credits cr
  where cr.profile_id in (select profile_id from public.bookings where unpaid)
    and cr.refunded_at is null
    and (cr.expires_at is null or cr.expires_at > now())
  order by cr.created_at desc
)
select p.first_name || ' ' || coalesce(p.last_name, '') as member, sum(d.n) as classes_now_paid_from_pack
from done d join public.profiles p on p.id = d.profile_id
group by 1
having sum(d.n) > 0
order by 1;
