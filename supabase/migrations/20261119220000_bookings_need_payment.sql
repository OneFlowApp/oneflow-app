-- Closing the gaps found on 19 Nov:
-- 1) Every booking records who made it (booked_by). Members booking themselves = themselves;
--    staff walk-ins = the staff member. Shown on the class list.
-- 2) The database refuses any booking a member makes for themselves with no pack, no Flow Points
--    and not a free class. Only staff can add someone without a pack (as Not paid yet, or a comp).
-- 3) Elgin Rating, Emma Jane Robson and Niso Smith's Friday bookings (made with no pack) are marked Not paid yet.

alter table public.bookings add column if not exists booked_by uuid;
-- Default set separately, so existing bookings stay blank (unknown) instead of being stamped with today's user.
alter table public.bookings alter column booked_by set default auth.uid();

create or replace function public.enforce_booking_has_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Staff, and server jobs with no signed-in user, can add people without a pack.
  if auth.uid() is null
     or public.has_any_role(array['director','management','front_desk','guide','boh','team','marketing']) then
    return new;
  end if;
  if new.status::text in ('confirmed', 'attended')
     and new.credit_id is null
     and coalesce(new.payment_method, '') not in ('free', 'flow_points') then
    raise exception 'Please choose a pass to book this class';
  end if;
  return new;
end;
$$;

drop trigger if exists aa_enforce_booking_has_payment on public.bookings;
create trigger aa_enforce_booking_has_payment before insert on public.bookings
  for each row execute function public.enforce_booking_has_payment();

-- Friday's no-pack bookings: mark Not paid yet (red tag; paid automatically when a pack is loaded).
with fixed as (
  update public.bookings b
     set unpaid = true
    from public.profiles p, public.classes c
   where p.id = b.profile_id and c.id = b.class_id
     and b.status::text = 'confirmed'
     and b.credit_id is null
     and b.payment_method = 'cash'
     and not b.unpaid
     and c.starts_at > now()
     and ((p.first_name ilike 'elgin%' and p.last_name ilike 'rating%')
       or (p.first_name ilike 'emma%' and p.last_name ilike 'robson%')
       or (p.first_name ilike 'niso%' and p.last_name ilike 'smith%'))
  returning p.first_name || ' ' || coalesce(p.last_name, '') as member, c.name, c.starts_at
)
select member, name as class,
       to_char(starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') as class_time
from fixed order by 1;
