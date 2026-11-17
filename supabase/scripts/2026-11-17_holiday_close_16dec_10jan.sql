-- Holiday closure: 16 Dec 2026 to 10 Jan 2027 (both days included, Cape Town time).
-- Cancels every class in that period that nobody is booked into. Classes are cancelled, not deleted,
-- so they can be brought back. Any class someone has booked since the check is left alone and listed.

with holiday as (
  select c.id
  from public.classes c
  where (c.starts_at at time zone 'Africa/Johannesburg')::date between '2026-12-16' and '2027-01-10'
    and not coalesce(c.is_cancelled, false)
),
booked as (
  select distinct b.class_id
  from public.bookings b
  join holiday h on h.id = b.class_id
  where coalesce(b.status::text, '') <> 'cancelled'
),
cancelled as (
  update public.classes c
     set is_cancelled = true
   where c.id in (select id from holiday)
     and c.id not in (select class_id from booked)
  returning c.id
)
select (select count(*) from cancelled) as classes_cancelled,
       (select count(*) from booked) as left_alone_because_booked;
