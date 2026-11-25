-- Packs can limit how often a member books with them: up to X classes a week (Monday to Sunday)
-- and/or Y a day, by the class date (South African time). Blank = no limit.
-- Set in Admin → Products. Staff adding someone (walk-ins, bookings page) aren't limited.

alter table public.products add column if not exists max_bookings_per_week integer;
alter table public.products add column if not exists max_bookings_per_day integer;

create or replace function public.enforce_pack_booking_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
  v_name text;
  v_week int;
  v_day int;
  v_start timestamptz;
  v_local timestamp;
  v_count int;
begin
  if new.credit_id is null then return new; end if;
  if coalesce(new.status::text, '') not in ('confirmed', 'attended') then return new; end if;
  -- Staff adding or checking someone in aren't held to the limit.
  if auth.uid() is not null and public.is_staff_profile(auth.uid()) then return new; end if;
  if new.booked_by is not null and new.booked_by <> new.profile_id
     and public.is_staff_profile(new.booked_by) then return new; end if;

  select uc.product_id, p.name, p.max_bookings_per_week, p.max_bookings_per_day
    into v_product, v_name, v_week, v_day
    from public.user_credits uc
    join public.products p on p.id = uc.product_id
    where uc.id = new.credit_id;
  if v_product is null or (v_week is null and v_day is null) then return new; end if;

  select c.starts_at into v_start from public.classes c where c.id = new.class_id;
  if v_start is null then return new; end if;
  v_local := v_start at time zone 'Africa/Johannesburg';

  if v_week is not null then
    select count(*) into v_count
      from public.bookings b
      join public.user_credits uc on uc.id = b.credit_id
      join public.classes c on c.id = b.class_id
      where b.profile_id = new.profile_id
        and uc.product_id = v_product
        and b.status::text in ('confirmed', 'attended')
        and date_trunc('week', c.starts_at at time zone 'Africa/Johannesburg') = date_trunc('week', v_local);
    if v_count >= v_week then
      raise exception 'Your % allows % class% a week, and you''ve booked % for the week of %.',
        v_name, v_week, case when v_week = 1 then '' else 'es' end, v_count,
        to_char(date_trunc('week', v_local), 'DD Mon');
    end if;
  end if;

  if v_day is not null then
    select count(*) into v_count
      from public.bookings b
      join public.user_credits uc on uc.id = b.credit_id
      join public.classes c on c.id = b.class_id
      where b.profile_id = new.profile_id
        and uc.product_id = v_product
        and b.status::text in ('confirmed', 'attended')
        and (c.starts_at at time zone 'Africa/Johannesburg')::date = v_local::date;
    if v_count >= v_day then
      raise exception 'Your % allows % class% a day, and you''ve booked % on %.',
        v_name, v_day, case when v_day = 1 then '' else 'es' end, v_count,
        to_char(v_local, 'DD Mon');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ab_enforce_pack_booking_limits on public.bookings;
create trigger ab_enforce_pack_booking_limits
  before insert on public.bookings
  for each row execute function public.enforce_pack_booking_limits();

-- Check: should say limit_columns = 2, limit_rule_on = 1
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'products'
          and column_name in ('max_bookings_per_week', 'max_bookings_per_day')) as limit_columns,
       (select count(*) from pg_trigger where tgname = 'ab_enforce_pack_booking_limits') as limit_rule_on;
