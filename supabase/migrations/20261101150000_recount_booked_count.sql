-- Recount classes.booked_count from the bookings themselves (any status except cancelled),
-- for upcoming classes. Shows which classes were out of step before fixing them.
with real as (
  select c.id, c.booked_count as stored,
         (select count(*) from public.bookings b
           where b.class_id = c.id and coalesce(b.status::text, '') <> 'cancelled')::int as actual
  from public.classes c
  where c.starts_at >= now() - interval '1 day'
),
fixed as (
  update public.classes c
  set booked_count = r.actual
  from real r
  where c.id = r.id and c.booked_count is distinct from r.actual
  returning c.id, c.name, c.starts_at, r.stored, r.actual
)
select name, starts_at, stored as was, actual as now from fixed order by starts_at limit 50;
