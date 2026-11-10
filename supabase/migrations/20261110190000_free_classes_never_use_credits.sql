-- Free classes were bookable with a pack credit (members with a pack were shown "Select credit"),
-- which skipped the one free class per service per day rule and used up a credit.
-- Now a booking for a free class is always a free booking: no credit is taken and the limit applies.
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

  -- A free class is always booked free, whatever the member picked.
  if coalesce(v_free, false) then
    new.credit_id := null;
    new.payment_method := 'free';
  end if;

  if new.credit_id is not null then
    new.payment_method := 'credit';
    new.flow_points_used := 0;
    return new;
  end if;

  if new.payment_method = 'free' then
    if not coalesce(v_free, false) then raise exception 'This class needs a pack or Flow Points'; end if;

    select count(*) into v_taken
    from public.bookings b
    join public.classes c2 on c2.id = b.class_id
    left join public.class_types ct2 on ct2.id = c2.class_type_id
    left join public.class_categories cat2 on cat2.id = ct2.category_id
    where b.profile_id = new.profile_id
      and coalesce(b.status::text, '') <> 'cancelled'
      and (c2.starts_at at time zone 'Africa/Johannesburg')::date = v_day
      and coalesce(cat2.parent_group, cat2.name, c2.class_type::text) = v_service
      and (
        b.payment_method = 'free'
        or coalesce(c2.is_free, false)
        or c2.class_type::text in ('beginner', 'beginner_sculpt')
        or coalesce(ct2.is_free_intro, false)
      );
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

-- Members who already hold more than one free class of the same service on the same day.
select p.first_name || ' ' || coalesce(p.last_name, '') as member,
       to_char((c.starts_at at time zone 'Africa/Johannesburg')::date, 'Dy DD Mon') as day,
       coalesce(cat.parent_group, cat.name) as service,
       count(*) as free_classes,
       count(*) filter (where b.credit_id is not null) as booked_with_a_credit
from public.bookings b
join public.classes c on c.id = b.class_id
join public.profiles p on p.id = b.profile_id
left join public.class_types ct on ct.id = c.class_type_id
left join public.class_categories cat on cat.id = ct.category_id
where coalesce(b.status::text, '') <> 'cancelled'
  and c.starts_at >= now() - interval '1 day'
  and (coalesce(c.is_free, false) or coalesce(ct.is_free_intro, false) or c.class_type::text in ('beginner', 'beginner_sculpt'))
group by 1, 2, 3, (c.starts_at at time zone 'Africa/Johannesburg')::date
having count(*) > 1
order by (c.starts_at at time zone 'Africa/Johannesburg')::date, 1;
