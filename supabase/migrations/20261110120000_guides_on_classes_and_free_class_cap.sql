-- 1) Classes always carry their guide's current name (filters and "by …" use classes.guide_name).
--    classes.guide_id may point at guides.id or, on older rows, profiles.id; both are handled.
create or replace function public.guide_display_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
  from public.profiles p
  where p.id = coalesce((select g.profile_id from public.guides g where g.id = p_id), p_id)
$$;

create or replace function public.classes_sync_guide_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.guide_id is not null then
    new.guide_name := coalesce(public.guide_display_name(new.guide_id), new.guide_name);
  elsif tg_op = 'UPDATE' and old.guide_id is not null then
    new.guide_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists classes_sync_guide_name on public.classes;
create trigger classes_sync_guide_name
  before insert or update of guide_id on public.classes
  for each row execute function public.classes_sync_guide_name();

update public.classes c
set guide_name = public.guide_display_name(c.guide_id)
where c.guide_id is not null
  and c.starts_at >= now() - interval '1 day'
  and public.guide_display_name(c.guide_id) is not null
  and c.guide_name is distinct from public.guide_display_name(c.guide_id);

-- 2) A guide switched off or removed comes off every upcoming class.
create or replace function public.guides_clear_from_classes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'DELETE' or (coalesce(new.is_active, true) = false and coalesce(old.is_active, true) = true) then
    update public.classes
    set guide_id = null, guide_name = null
    where starts_at >= now()
      and guide_id in (r.id, r.profile_id);
  end if;
  return null;
end;
$$;

drop trigger if exists guides_clear_from_classes on public.guides;
create trigger guides_clear_from_classes
  after update of is_active or delete on public.guides
  for each row execute function public.guides_clear_from_classes();

-- Guides already switched off: take them off upcoming classes now.
update public.classes c
set guide_id = null, guide_name = null
from public.guides g
where g.is_active = false
  and c.starts_at >= now()
  and c.guide_id in (g.id, g.profile_id);

-- 3) Members may book only one free class per day (studio time).
create or replace function public.guard_member_booking_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_points integer; v_free boolean; v_day date; v_taken integer;
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
           (c.starts_at at time zone 'Africa/Johannesburg')::date
      into v_free, v_day
    from public.classes c left join public.class_types ct on ct.id = c.class_type_id
    where c.id = new.class_id;
    if not coalesce(v_free, false) then raise exception 'This class needs a pack or Flow Points'; end if;

    select count(*) into v_taken
    from public.bookings b
    join public.classes c2 on c2.id = b.class_id
    where b.profile_id = new.profile_id
      and b.payment_method = 'free'
      and coalesce(b.status::text, '') <> 'cancelled'
      and (c2.starts_at at time zone 'Africa/Johannesburg')::date = v_day;
    if v_taken > 0 then
      raise exception 'You can book one free class per day. You already have a free class on this day.';
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
