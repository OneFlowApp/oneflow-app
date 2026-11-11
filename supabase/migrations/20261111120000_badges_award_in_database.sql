-- Badges awarded once earned, and staff excluded from all rewards.
-- Badges (and the stickers on the membership card) are awarded only once earned.
-- Before: the app tried to award "Classes attended" badges from the check-in screen, but only
-- Director and Management may write badges, so check-ins done by front desk or guides awarded
-- nothing, and "Streak (weeks)" badges were never awarded at all.
-- Now the database awards them itself whenever a booking is marked attended.
-- "Challenge complete" and "Manual award only" badges are still awarded in Admin → Badges.

-- Staff (Director, Management, Marketing, Front desk, Guide, BOH, Team) get no rewards:
-- no Flow Points from any source and no automatic badges. Checks their main role and extra roles.
create or replace function public.is_staff_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and (
        lower(coalesce(p.role::text, '')) in ('director', 'management', 'marketing', 'front_desk', 'guide', 'boh', 'team')
        or coalesce(p.secondary_roles, '{}') && array['director', 'management', 'marketing', 'front_desk', 'guide', 'boh', 'team']
      )
  );
$$;

create or replace function public.profile_earns_flow_points(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and lower(coalesce(p.role::text, '')) = 'customer'
  ) and not public.is_staff_profile(p_profile_id);
$$;

-- Safety net for every other route (referral bonus, refunds, manual edits): a staff member's
-- Flow Points can never go up, and no points are logged for them.
create or replace function public.block_staff_flow_points()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.is_staff_profile(new.id) and coalesce(new.flow_points, 0) > coalesce(old.flow_points, 0) then
    new.flow_points := old.flow_points;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_block_staff_flow_points on public.profiles;
create trigger aa_block_staff_flow_points
before update of flow_points on public.profiles
for each row execute function public.block_staff_flow_points();

create or replace function public.block_staff_flow_points_log()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.points, 0) > 0 and public.is_staff_profile(new.profile_id) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_block_staff_flow_points_log on public.flow_points;
create trigger aa_block_staff_flow_points_log
before insert on public.flow_points
for each row execute function public.block_staff_flow_points_log();

create or replace function public.award_earned_badges(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_attended int;
  v_streak int;
  v_added int;
begin
  if p_profile_id is null or public.is_staff_profile(p_profile_id) then return 0; end if;

  select count(*) into v_attended
  from public.bookings where profile_id = p_profile_id and status::text = 'attended';

  select coalesce(longest_streak, 0) into v_streak from public.profiles where id = p_profile_id;

  insert into public.member_badges (profile_id, badge_id, awarded_at, notes)
  select p_profile_id, b.id, now(), 'Earned automatically'
  from public.badges b
  where b.is_active
    and b.criteria_value is not null
    and (
      (b.criteria_type = 'classes_attended' and v_attended >= b.criteria_value)
      or (b.criteria_type = 'streak_weeks' and coalesce(v_streak, 0) >= b.criteria_value)
    )
  on conflict (profile_id, badge_id) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke all on function public.award_earned_badges(uuid) from public, anon, authenticated;

create or replace function public.trg_award_badges_on_attend()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status::text = 'attended' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.award_earned_badges(new.profile_id);
  end if;
  return new;
end;
$$;

-- Named "zz_" so it runs after the streak is recalculated.
drop trigger if exists zz_award_badges_on_attend on public.bookings;
create trigger zz_award_badges_on_attend
after insert or update of status on public.bookings
for each row execute function public.trg_award_badges_on_attend();

-- If an earlier run of this script gave staff automatic badges, take those back.
delete from public.member_badges
where notes = 'Earned automatically' and public.is_staff_profile(profile_id);

-- Catch up: give members the badges they have already earned.
select coalesce(sum(public.award_earned_badges(p.id)), 0) as badges_awarded_now
from public.profiles p
where exists (select 1 from public.bookings b where b.profile_id = p.id and b.status::text = 'attended');

-- Staff who still hold Flow Points (cleared in the next step, once checked).
select p.first_name || ' ' || coalesce(p.last_name, '') as staff_member, p.role::text as role, p.flow_points
from public.profiles p
where public.is_staff_profile(p.id) and coalesce(p.flow_points, 0) > 0
order by p.flow_points desc;
