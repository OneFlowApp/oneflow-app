-- Catch-up: two earlier database updates were never run on the live database.
--   1. Streaks (Goals page and streak badges): current_streak, longest_streak, and the trigger that keeps them up to date.
--   2. profiles.unread_notification_count, used when a class invite is sent to a member.
-- Left out on purpose: bookings.cafe_addon (the café doesn't run through the app),
-- deduct_credit_on_booking_insert (replaced later), and the old two-a-day challenge check-in limit.

alter table public.profiles add column if not exists unread_notification_count integer not null default 0;

alter table public.profiles
  add column if not exists current_streak integer not null default 0;

alter table public.profiles
  add column if not exists longest_streak integer not null default 0;

create or replace function public.recalculate_profile_streaks(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer := 0;
  v_longest integer := 0;
begin
  if p_profile_id is null then
    return;
  end if;

  with attended_weeks as (
    select distinct date_trunc('week', c.starts_at)::date as week_start
    from public.bookings b
    join public.classes c on c.id = b.class_id
    where b.profile_id = p_profile_id
      and b.status = 'attended'
      and c.starts_at is not null
  ),
  runs as (
    select
      week_start,
      week_start - (row_number() over (order by week_start))::int * interval '1 week' as grp
    from attended_weeks
  ),
  run_lengths as (
    select count(*)::int as run_len
    from runs
    group by grp
  ),
  current_chain as (
    with recursive r as (
      select date_trunc('week', now())::date as week_start, 0::int as weeks
      union all
      select (r.week_start - interval '1 week')::date, r.weeks + 1
      from r
      where exists (select 1 from attended_weeks aw where aw.week_start = r.week_start)
    )
    select max(weeks)::int as streak from r
  )
  select
    coalesce((select streak from current_chain), 0),
    coalesce((select max(run_len) from run_lengths), 0)
  into v_current, v_longest;

  update public.profiles
  set
    current_streak = greatest(0, coalesce(v_current, 0)),
    longest_streak = greatest(0, coalesce(v_longest, 0))
  where id = p_profile_id;
end;
$$;

create or replace function public.on_booking_streak_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_profile_streaks(new.profile_id);
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.recalculate_profile_streaks(new.profile_id);
    if old.profile_id is distinct from new.profile_id then
      perform public.recalculate_profile_streaks(old.profile_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.recalculate_profile_streaks(old.profile_id);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_booking_streak_change on public.bookings;

create trigger trg_booking_streak_change
after insert or update of status, class_id, profile_id or delete
on public.bookings
for each row
execute function public.on_booking_streak_change();

-- Backfill all existing members.
do $$
declare
  r record;
begin
  for r in select id from public.profiles loop
    perform public.recalculate_profile_streaks(r.id);
  end loop;
end;
$$;


-- Check: members with the longest streaks.
select p.first_name || ' ' || coalesce(p.last_name, '') as member, p.current_streak, p.longest_streak
from public.profiles p
where p.longest_streak > 0
order by p.longest_streak desc
limit 10;
