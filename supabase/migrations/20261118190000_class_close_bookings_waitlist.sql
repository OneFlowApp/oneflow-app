-- Master: close bookings and/or the waitlist for a class.
-- Members can't book a class with bookings closed, or join a waitlist that's closed.
-- Staff can still add people (walk-ins, bookings from the dashboard).

alter table public.classes add column if not exists bookings_closed boolean not null default false;
alter table public.classes add column if not exists waitlist_closed boolean not null default false;

create or replace function public.enforce_class_closed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_bk boolean;
  v_wl boolean;
begin
  -- Staff (and server jobs with no signed-in user) are never blocked.
  if auth.uid() is null
     or public.has_any_role(array['director','management','front_desk','guide','boh','team','marketing']) then
    return new;
  end if;
  select coalesce(bookings_closed, false), coalesce(waitlist_closed, false) into v_bk, v_wl
  from public.classes where id = new.class_id;
  if tg_table_name = 'bookings' then
    if v_bk then raise exception 'Bookings for this class are closed'; end if;
  else
    if v_bk or v_wl then raise exception 'The waitlist for this class is closed'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_enforce_class_closed on public.bookings;
create trigger aa_enforce_class_closed before insert on public.bookings
  for each row execute function public.enforce_class_closed();

drop trigger if exists aa_enforce_class_closed on public.waitlist_entries;
create trigger aa_enforce_class_closed before insert on public.waitlist_entries
  for each row execute function public.enforce_class_closed();

-- Check: should show both new columns.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'classes' and column_name in ('bookings_closed', 'waitlist_closed')
order by 1;
