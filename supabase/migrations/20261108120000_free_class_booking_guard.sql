-- guard_member_booking_insert only allowed free bookings for beginner and free intro types,
-- so classes ticked "Free / complimentary" in Master were refused ("This class needs a pack or
-- Flow Points"). Now classes.is_free also counts. Run in the SQL Editor on 8 Nov 2026.
create or replace function public.guard_member_booking_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_points integer; v_free boolean;
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
        or coalesce(ct.is_free_intro, false)
      into v_free
    from public.classes c left join public.class_types ct on ct.id = c.class_type_id
    where c.id = new.class_id;
    if not coalesce(v_free, false) then raise exception 'This class needs a pack or Flow Points'; end if;
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
