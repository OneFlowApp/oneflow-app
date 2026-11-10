-- 1) A class can never take more bookings than its capacity. Checked in the database, with the
--    class row locked, so two people booking the last spot at the same moment can't both get it.
--    Applies to everyone, including staff walk-ins. Cancelled bookings don't count.
create or replace function public.enforce_class_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cap int; v_taken int;
begin
  if coalesce(new.status::text, '') = 'cancelled' then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.status::text, '') <> 'cancelled'
     and old.class_id is not distinct from new.class_id then
    return new;  -- already holding a spot
  end if;

  select c.capacity into v_cap from public.classes c where c.id = new.class_id for update;
  if v_cap is null or v_cap <= 0 then return new; end if;

  select count(*) into v_taken
  from public.bookings b
  where b.class_id = new.class_id
    and coalesce(b.status::text, '') <> 'cancelled'
    and b.id <> new.id;

  if v_taken >= v_cap then
    raise exception 'This class is full (% of % spots taken).', v_taken, v_cap;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_enforce_class_capacity on public.bookings;
create trigger aa_enforce_class_capacity
  before insert or update of status, class_id on public.bookings
  for each row execute function public.enforce_class_capacity();

-- 2) Free classes: one per day for each service (On The Mat, Reformer, Wellzone, Events),
--    so a member can have a free mat class and a free sauna on the same day, but not two of either.
create or replace function public.guard_member_booking_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_points integer; v_free boolean; v_day date; v_service text; v_taken integer;
begin
  if auth.uid() is null then return new; end if;
  if public.has_any_role(array['director']) then return new; end if;
  if coalesce(public.get_my_role(), '') in ('director', 'management', 'team', 'front_desk', 'guide', 'boh', 'marketing')
     and new.profile_id is distinct from auth.uid() then
    return new;
  end if;
  if new.profile_id is distinct from auth.uid() then raise exception 'You can only book for yourself'; end if;
  if new.status::text <> 'confirmed' then raise exception 'New bookings must be confirmed bookings'; end if;

  if new.credit_id is not null then
    new.payment_method := 'credit';
    new.flow_points_used := 0;
    return new;
  end if;

  if new.payment_method = 'free' then
    select coalesce(c.is_free, false)
        or (c.class_type::text in ('beginner', 'beginner_sculpt'))
        or coalesce(ct.is_free_intro, false),
           (c.starts_at at time zone 'Africa/Johannesburg')::date,
           coalesce(cat.parent_group, cat.name, c.class_type::text)
      into v_free, v_day, v_service
    from public.classes c
    left join public.class_types ct on ct.id = c.class_type_id
    left join public.class_categories cat on cat.id = ct.category_id
    where c.id = new.class_id;
    if not coalesce(v_free, false) then raise exception 'This class needs a pack or Flow Points'; end if;

    select count(*) into v_taken
    from public.bookings b
    join public.classes c2 on c2.id = b.class_id
    left join public.class_types ct2 on ct2.id = c2.class_type_id
    left join public.class_categories cat2 on cat2.id = ct2.category_id
    where b.profile_id = new.profile_id
      and b.payment_method = 'free'
      and coalesce(b.status::text, '') <> 'cancelled'
      and (c2.starts_at at time zone 'Africa/Johannesburg')::date = v_day
      and coalesce(cat2.parent_group, cat2.name, c2.class_type::text) = v_service;
    if v_taken > 0 then
      raise exception 'You can book one free % class per day. You already have one on this day.', v_service;
    end if;

    new.flow_points_used := 0;
    return new;
  end if;

  if new.payment_method = 'flow_points' then
    select coalesce(flow_points, 0) into v_points from public.profiles where id = new.profile_id for update;
    if v_points < 100 then raise exception 'You need 100 Flow Points to book with points'; end if;
    update public.profiles set flow_points = flow_points - 100 where id = new.profile_id;
    new.flow_points_used := 100;
    return new;
  end if;

  raise exception 'Please choose a pack or Flow Points to book this class';
end $function$;

-- Classes that are already over capacity (for you to sort out).
select to_char(c.starts_at at time zone 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') as "when",
       c.name, c.capacity,
       (select count(*) from public.bookings b where b.class_id = c.id and coalesce(b.status::text, '') <> 'cancelled') as booked
from public.classes c
where c.starts_at >= now() - interval '1 day'
  and not coalesce(c.is_cancelled, false)
  and c.capacity > 0
  and (select count(*) from public.bookings b where b.class_id = c.id and coalesce(b.status::text, '') <> 'cancelled') > c.capacity
order by c.starts_at;
