-- Badges (and the stickers on the membership card) are awarded only once earned.
-- Before: the app tried to award "Classes attended" badges from the check-in screen, but only
-- Director and Management may write badges, so check-ins done by front desk or guides awarded
-- nothing, and "Streak (weeks)" badges were never awarded at all.
-- Now the database awards them itself whenever a booking is marked attended.
-- "Challenge complete" and "Manual award only" badges are still awarded in Admin → Badges.

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
  if p_profile_id is null then return 0; end if;

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

-- Catch up: give members the badges they have already earned.
select coalesce(sum(public.award_earned_badges(p.id)), 0) as badges_awarded_now
from public.profiles p
where exists (select 1 from public.bookings b where b.profile_id = p.id and b.status::text = 'attended');
