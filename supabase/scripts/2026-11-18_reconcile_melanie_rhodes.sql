-- Melanie Rhodes: her two walk-ins on Mon 16 Nov (Wellzone 08:30, Pilates: Flow 09:15) were checked in
-- as cash before her Double Flow pack was loaded on Tue 17 Nov. Link both to the Double Flow pack.
-- Double Flow is unlimited, so no sessions come off it.

with m as (
  select id from public.profiles where first_name ilike 'melanie' and last_name ilike 'rhodes%'
),
pack as (
  select cr.id, cr.product_name
  from public.user_credits cr
  where cr.profile_id in (select id from m)
    and cr.product_name ilike 'double flow%'
    and cr.refunded_at is null
    and (cr.expires_at is null or cr.expires_at > now())
  order by cr.created_at desc
  limit 1
),
fixed as (
  update public.bookings b
     set credit_id = (select id from pack),
         payment_method = 'credit',
         unpaid = false,
         paid_at = now(),
         paid_where = 'Paid with ' || (select product_name from pack)
    from public.classes c
   where c.id = b.class_id
     and b.profile_id in (select id from m)
     and b.credit_id is null
     and b.status::text = 'attended'
     and (c.starts_at at time zone 'Africa/Johannesburg')::date = '2026-11-16'
     and (select id from pack) is not null
  returning c.name, c.starts_at
)
select name as class_now_on_double_flow,
       to_char(starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') as when_
from fixed order by starts_at;
