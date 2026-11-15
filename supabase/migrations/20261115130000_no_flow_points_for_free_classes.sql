-- Free classes don't earn Flow Points (booked free, a class ticked "free", or a free intro type).
create or replace function public.award_flow_points_on_attend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free boolean;
begin
  select coalesce(new.payment_method = 'free', false)
      or coalesce(c.is_free, false)
      or c.class_type::text in ('beginner', 'beginner_sculpt')
      or coalesce(ct.is_free_intro, false)
    into v_free
  from public.classes c
  left join public.class_types ct on ct.id = c.class_type_id
  where c.id = new.class_id;
  v_free := coalesce(v_free, new.payment_method = 'free', false);

  if new.profile_id is not null
     and new.status = 'attended'
     and (tg_op = 'INSERT' or old.status is distinct from 'attended')
     and not v_free
     and public.profile_earns_flow_points(new.profile_id) then
    update public.profiles
    set flow_points = coalesce(flow_points, 0) + 10
    where id = new.profile_id;
  end if;

  if tg_op = 'UPDATE'
     and old.profile_id is not null
     and old.status = 'attended'
     and new.status is distinct from 'attended'
     and not v_free
     and public.profile_earns_flow_points(old.profile_id) then
    update public.profiles
    set flow_points = greatest(0, coalesce(flow_points, 0) - 10)
    where id = old.profile_id;
  end if;

  return new;
end;
$$;
