-- Hotfix: checking a member in failed with 'column "longest_streak" does not exist'.
-- The badge award read profiles.longest_streak, which this database doesn't have.
-- Read it safely instead: no streak column simply means no streak badges yet.
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

  select coalesce(nullif(to_jsonb(p) ->> 'longest_streak', '')::int, 0) into v_streak
  from public.profiles p where p.id = p_profile_id;

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
