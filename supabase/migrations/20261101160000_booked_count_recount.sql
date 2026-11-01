-- classes.booked_count was changed by four separate counters (bookings_update_count,
-- on_booking_insert, on_booking_cancel, sync_class_booked_count_trg), so it went up by more
-- than one per booking. Replaced by one trigger that recounts the class's bookings
-- (any status except cancelled) after every change. Run in the SQL Editor on 1 Nov 2026.
create or replace function public.recount_class_booked_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_ids uuid[];
begin
  v_ids := array_remove(array[
    case when tg_op <> 'INSERT' then old.class_id end,
    case when tg_op <> 'DELETE' then new.class_id end
  ], null);
  update public.classes c
  set booked_count = (select count(*) from public.bookings b
                      where b.class_id = c.id and coalesce(b.status::text, '') <> 'cancelled')
  where c.id = any (v_ids);
  return null;
end;
$$;

drop trigger if exists zz_recount_class_booked_count on public.bookings;
create trigger zz_recount_class_booked_count
  after insert or update or delete on public.bookings
  for each row execute function public.recount_class_booked_count();

drop trigger if exists bookings_update_count on public.bookings;
drop trigger if exists on_booking_insert on public.bookings;
drop trigger if exists on_booking_cancel on public.bookings;
drop trigger if exists sync_class_booked_count_trg on public.bookings;

update public.classes c
set booked_count = (select count(*) from public.bookings b
                    where b.class_id = c.id and coalesce(b.status::text, '') <> 'cancelled')
where c.starts_at >= now() - interval '1 day';
