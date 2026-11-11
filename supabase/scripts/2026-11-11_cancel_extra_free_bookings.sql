-- Cancels free bookings that break the daily rules (upcoming classes only), keeping each member's
-- earliest bookings, and sends each member an in-app message explaining why.
-- Rules: one free On The Mat or Reformer class, one free Wellzone, max 2 free a day.
with free_upcoming as (
  select b.id, b.profile_id, b.created_at, c.title, c.starts_at,
         (c.starts_at at time zone 'Africa/Johannesburg')::date as day,
         case when coalesce(cat.parent_group, cat.name, c.class_type::text) in ('Wellzone', 'Events')
              then coalesce(cat.parent_group, cat.name) else 'Studio' end as bucket
  from public.bookings b
  join public.classes c on c.id = b.class_id
  left join public.class_types ct on ct.id = c.class_type_id
  left join public.class_categories cat on cat.id = ct.category_id
  where coalesce(b.status::text, '') <> 'cancelled'
    and c.starts_at > now()
    and (b.payment_method = 'free' or coalesce(c.is_free, false)
         or c.class_type::text in ('beginner', 'beginner_sculpt') or coalesce(ct.is_free_intro, false))
),
first_per_bucket as (
  select *, row_number() over (partition by profile_id, day, bucket order by created_at) as rn_bucket
  from free_upcoming
),
ranked as (
  select *, row_number() over (partition by profile_id, day, (rn_bucket = 1) order by created_at) as rn_day
  from first_per_bucket
),
extra as (
  select * from ranked where rn_bucket > 1 or rn_day > 2
),
cancelled as (
  update public.bookings b
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'free_class_daily_limit'
    from extra e
   where b.id = e.id
  returning e.profile_id, e.title, e.starts_at
),
messaged as (
  insert into public.studio_messages (from_profile_id, to_profile_id, subject, body, message_type)
  select (select id from public.profiles where role::text = 'director' limit 1),
         x.profile_id,
         'Your free class booking',
         'Hi ' || coalesce(p.first_name, 'there') || ', we''ve cancelled your booking for ' || x.title || ' on '
           || to_char(x.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon "at" HH24:MI')
           || '. Free classes are limited to one On The Mat or Reformer class and one Wellzone session per day, '
           || 'and you already have a free class booked that day. Your other booking stays as it is. See you soon!',
         'direct'
  from cancelled x
  join public.profiles p on p.id = x.profile_id
  returning to_profile_id
)
select p.first_name || ' ' || coalesce(p.last_name, '') as member,
       to_char(c.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') as cancelled_class,
       c.title,
       (select count(*) from messaged) as messages_sent
from cancelled c
join public.profiles p on p.id = c.profile_id
order by 1, c.starts_at;
