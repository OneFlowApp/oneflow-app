-- One row per member for the Customers page: last visit, visits in the last 30 days, total visits,
-- and whether they've ever booked. Worked out in the database, so it isn't cut off at 1,000 bookings.
-- A visit = a class they attended, or a confirmed booking for a class that has already started.
-- Team only.

create or replace function public.customer_activity()
returns table (
  profile_id uuid,
  last_visit timestamptz,
  visits_30d integer,
  visits_total integer,
  has_booking boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select b.profile_id,
         max(c.starts_at) filter (
           where b.status::text = 'attended' or (b.status::text = 'confirmed' and c.starts_at <= now())
         ) as last_visit,
         (count(*) filter (
           where (b.status::text = 'attended' or (b.status::text = 'confirmed' and c.starts_at <= now()))
             and c.starts_at > now() - interval '30 days'
         ))::int as visits_30d,
         (count(*) filter (
           where b.status::text = 'attended' or (b.status::text = 'confirmed' and c.starts_at <= now())
         ))::int as visits_total,
         true as has_booking
  from public.bookings b
  join public.classes c on c.id = b.class_id
  where public.is_staff_profile(auth.uid())
  group by b.profile_id;
$$;

grant execute on function public.customer_activity() to authenticated;

-- Check: should say customer_activity_ready = 1
select count(*) as customer_activity_ready from pg_proc where proname = 'customer_activity';
