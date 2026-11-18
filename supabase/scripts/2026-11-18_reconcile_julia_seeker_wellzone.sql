-- Julia Christelis, The Seeker - Wellzone: make "sessions left" match what she has actually used.
-- Used = Wellzone classes booked on this pack (booked, attended, or late-cancelled) + Green Point visits.
-- Only ever lowers the number (never gives sessions back), so it is safe to run more than once.

with pack as (
  select cr.id, cr.credits_total, cr.credits_remaining
  from public.user_credits cr
  join public.profiles p on p.id = cr.profile_id
  where p.first_name ilike 'julia' and p.last_name ilike 'christelis%'
    and cr.product_name ilike 'the seeker%wellzone%'
    and cr.refunded_at is null
),
used as (
  select pk.id,
         (select count(*) from public.bookings b
           where b.credit_id = pk.id
             and (b.status::text in ('confirmed', 'attended')
                  or (b.status::text = 'cancelled' and coalesce(b.late_cancel, false)))) as classes,
         (select count(*) from public.green_point_visits v where v.credit_id = pk.id) as green_point
  from pack pk
),
fixed as (
  update public.user_credits u
     set credits_remaining = greatest(0, pk.credits_total - x.classes - x.green_point)
    from pack pk join used x on x.id = pk.id
   where u.id = pk.id
     and u.credits_remaining > greatest(0, pk.credits_total - x.classes - x.green_point)
  returning u.id, u.credits_remaining
)
select pk.credits_total as pack_total,
       x.classes as classes_used,
       x.green_point as green_point_used,
       pk.credits_remaining as left_before,
       coalesce(f.credits_remaining, pk.credits_remaining) as left_now
from pack pk join used x on x.id = pk.id left join fixed f on f.id = pk.id;
