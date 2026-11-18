-- Remove every upcoming 11:00 class (Fri Sculpt: LIIT and Tue Pilates: Flow) from the schedule for good.
-- Same as Schedule → Cancel → "This and all future classes": classes are cancelled (hidden from members),
-- anyone booked gets their credit (or Flow Points) back and an in-app message from the studio.

begin;
drop table if exists _gone;
drop table if exists _booked;

create temp table _gone as
select c.id, c.name, c.starts_at
from public.classes c
where c.starts_at > now()
  and not coalesce(c.is_cancelled, false)
  and to_char(c.starts_at at time zone 'Africa/Johannesburg', 'HH24:MI') = '11:00';

create temp table _booked as
select b.id, b.profile_id, b.credit_id, b.payment_method, b.flow_points_used, g.name, g.starts_at
from public.bookings b
join _gone g on g.id = b.class_id
where b.status::text in ('confirmed', 'attended');

update public.bookings b
   set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'admin_cancelled', late_cancel = false
  from _booked x where b.id = x.id;

update public.user_credits u
   set credits_remaining = credits_remaining + 1
  from _booked x
 where u.id = x.credit_id and not coalesce(u.is_unlimited, false);

update public.profiles p
   set flow_points = coalesce(p.flow_points, 0) + x.flow_points_used
  from _booked x
 where p.id = x.profile_id and x.payment_method = 'flow_points' and coalesce(x.flow_points_used, 0) > 0;

update public.waitlist_entries w set status = 'cancelled'
  from _gone g where w.class_id = g.id and w.status = 'waiting';

update public.classes c set is_cancelled = true from _gone g where c.id = g.id;

insert into public.studio_messages (from_profile_id, to_profile_id, subject, body, message_type)
select (select id from public.profiles where role::text = 'director' limit 1),
       x.profile_id,
       'Class cancelled',
       'Hi ' || coalesce(p.first_name, 'there') || ', the ' || x.name || ' class on '
         || to_char(x.starts_at at time zone 'Africa/Johannesburg', 'FMDay FMDD Mon "at" HH24:MI')
         || ' has been taken off the schedule, so we''ve cancelled your booking and returned your credit. '
         || 'Sorry for the change, we hope to see you at another class soon!',
       'direct'
from _booked x join public.profiles p on p.id = x.profile_id;

commit;

select (select count(*) from _gone) as classes_removed,
       (select count(*) from _booked) as bookings_refunded,
       (select string_agg(p.first_name || ' ' || coalesce(p.last_name, '') || ' (' || x.name || ', '
                 || to_char(x.starts_at at time zone 'Africa/Johannesburg', 'DD Mon') || ')', '; ')
          from _booked x join public.profiles p on p.id = x.profile_id) as members_refunded;
