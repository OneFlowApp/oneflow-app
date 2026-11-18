-- Walk-ins on a pack weren't taking a session off.
-- The database only took a session when a booking was made as "confirmed". Walk-ins are created
-- already checked in ("attended"), so they were skipped. Now a session comes off for both, once,
-- when the booking is made. Checking someone in later still takes nothing extra.

create or replace function public.deduct_credit_on_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT'
     and new.status::text in ('confirmed', 'attended')
     and new.credit_id is not null then
    update public.user_credits
       set credits_remaining = credits_remaining - 1
     where id = new.credit_id
       and is_unlimited = false
       and (expires_at is null or expires_at > now());
  end if;
  return new;
end;
$$;

-- Check (read only): past walk-ins on a pack that never had their session taken off.
-- Nothing is changed for these yet. Send this list to Claude.
select p.first_name || ' ' || coalesce(p.last_name, '') as member,
       to_char(c.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') as class_time,
       c.name as class,
       cr.product_name as pack,
       cr.credits_remaining as left_now
from public.bookings b
join public.classes c on c.id = b.class_id
join public.profiles p on p.id = b.profile_id
join public.user_credits cr on cr.id = b.credit_id
where b.status::text = 'attended'
  and not coalesce(cr.is_unlimited, false)
  and b.checked_in_at is not null
  and abs(extract(epoch from (b.checked_in_at - b.created_at))) < 10
  and coalesce(b.paid_where, '') not like 'Paid with %'
order by c.starts_at;
