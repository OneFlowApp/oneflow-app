-- Green Point visit: staff choose the date the session was used (default today), so visits booked
-- in Mindbody can be loaded afterwards. Still takes one credit from the pack part chosen.

drop function if exists public.use_credit_at_green_point(uuid, text);

create or replace function public.use_credit_at_green_point(
  p_credit_id uuid,
  p_note text default null,
  p_used_on date default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_day date := coalesce(p_used_on, v_today);
  v_at timestamptz;
begin
  if not public.has_any_role(array['director','management','front_desk','guide','boh','team']) then
    raise exception 'Only studio staff can do this';
  end if;
  if v_day > v_today then
    raise exception 'The date can''t be in the future';
  end if;
  select * into c from public.user_credits where id = p_credit_id for update;
  if not found then raise exception 'Pack not found'; end if;
  if c.access_scope is distinct from 'open_access' then
    raise exception 'This pack is for Longkloof only';
  end if;
  if c.refunded_at is not null or (c.expires_at is not null and c.expires_at <= now()) then
    raise exception 'This pack has expired';
  end if;
  if v_day < v_today - 90 then
    raise exception 'The date is more than 90 days ago. Check the date and try again';
  end if;
  if not coalesce(c.is_unlimited, false) then
    if coalesce(c.credits_remaining, 0) <= 0 then raise exception 'No credits left on this pack'; end if;
    update public.user_credits set credits_remaining = credits_remaining - 1 where id = c.id;
  end if;
  -- Today keeps the real time; an earlier day is stored at midday Cape Town time.
  v_at := case when v_day = v_today then now()
               else (v_day + time '12:00') at time zone 'Africa/Johannesburg' end;
  insert into public.green_point_visits (credit_id, profile_id, used_by, used_at, note)
  values (c.id, c.profile_id, auth.uid(), v_at, nullif(trim(coalesce(p_note, '')), ''));
  return case when coalesce(c.is_unlimited, false) then null else c.credits_remaining - 1 end;
end;
$$;

revoke all on function public.use_credit_at_green_point(uuid, text, date) from public, anon;
grant execute on function public.use_credit_at_green_point(uuid, text, date) to authenticated;

-- Check: should show one row, with three inputs.
select p.proname, pg_get_function_arguments(p.oid) as inputs
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'use_credit_at_green_point';
