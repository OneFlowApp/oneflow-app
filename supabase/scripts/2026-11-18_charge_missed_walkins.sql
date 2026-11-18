-- Take the missed session off for today's 08:15 Reformer: LIIT walk-ins (Melanie Rhodes, Rita Pires).
-- Only packs that still have sessions; each booking once (marked so it can't be charged twice).

with missed as (
  select b.id as booking_id, b.credit_id
  from public.bookings b
  join public.classes c on c.id = b.class_id
  join public.profiles p on p.id = b.profile_id
  join public.user_credits cr on cr.id = b.credit_id
  where b.status::text = 'attended'
    and not coalesce(cr.is_unlimited, false)
    and coalesce(cr.credits_remaining, 0) > 0
    and abs(extract(epoch from (b.checked_in_at - b.created_at))) < 10
    and coalesce(b.paid_where, '') not like 'Paid with %'
    and coalesce(b.paid_where, '') <> 'Session taken off (walk-in fix)'
    and (c.starts_at at time zone 'Africa/Johannesburg')::date = '2026-11-18'
    and to_char(c.starts_at at time zone 'Africa/Johannesburg', 'HH24:MI') = '08:15'
    and ((p.first_name ilike 'melanie' and p.last_name ilike 'rhodes%')
      or (p.first_name ilike 'rita' and p.last_name ilike 'pires%'))
),
marked as (
  update public.bookings b set paid_where = 'Session taken off (walk-in fix)'
  from missed m where b.id = m.booking_id
  returning b.credit_id
),
charged as (
  update public.user_credits u set credits_remaining = credits_remaining - 1
  from marked m where u.id = m.credit_id
  returning u.profile_id, u.product_name, u.credits_remaining
)
select p.first_name || ' ' || coalesce(p.last_name, '') as member, c.product_name as pack, c.credits_remaining as left_now
from charged c join public.profiles p on p.id = c.profile_id
order by 1;
