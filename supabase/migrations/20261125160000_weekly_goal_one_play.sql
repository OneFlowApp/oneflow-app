-- Weekly goals are set per week, and everyone gets one gameboard play a week.
--   A goal change made during a week applies from the next week; the week already under way
--   keeps the goal it started with (so a goal can't be lowered mid-week to unlock a play).
--   One play per goal week for every member (Gold no longer gets 2).

create table if not exists public.weekly_goal_weeks (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  goal integer not null,
  primary key (profile_id, week_start)
);
alter table public.weekly_goal_weeks enable row level security;
drop policy if exists weekly_goal_weeks_own on public.weekly_goal_weeks;
create policy weekly_goal_weeks_own on public.weekly_goal_weeks for select to authenticated
  using (profile_id = auth.uid() or public.is_admin_role());
grant select on public.weekly_goal_weeks to authenticated;
grant all on public.weekly_goal_weeks to service_role;

-- When a member changes their goal, keep the old goal for the week already under way.
create or replace function public.keep_weekly_goal_for_this_week()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.weekly_goal is not null and new.weekly_goal is distinct from old.weekly_goal then
    insert into public.weekly_goal_weeks (profile_id, week_start, goal)
    values (old.id, public._studio_week_start((now() at time zone 'Africa/Johannesburg')::date), old.weekly_goal)
    on conflict (profile_id, week_start) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists keep_weekly_goal_for_this_week on public.profiles;
create trigger keep_weekly_goal_for_this_week
  before update of weekly_goal on public.profiles
  for each row execute function public.keep_weekly_goal_for_this_week();

-- The goal in force for a week: the value kept when it was changed that week or later,
-- otherwise the member's current goal.
create or replace function public._goal_for_week(p_profile_id uuid, p_week_start date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select g.goal from public.weekly_goal_weeks g
      where g.profile_id = p_profile_id and g.week_start >= p_week_start
      order by g.week_start limit 1),
    (select weekly_goal from public.profiles where id = p_profile_id),
    3);
$$;

create or replace function public.my_gameboard()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_goal int;
  v_min int := public._gameboard_setting('gameboard_min_goal', '3')::int;
  v_tier text;
  v_plays int;
  v_peek boolean;
  v_weeks jsonb := '[]'::jsonb;
  w date;
  v_att int;
  v_used int;
  v_open record;
  v_play_week date;
  v_wgoal int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if public.is_staff_profile(v_uid) then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;

  -- The goal that counts is the one set for that week; a change made mid-week starts next week.
  v_goal := public._goal_for_week(v_uid, public._studio_week_start(v_today));
  select tier into v_tier from public.member_tier(v_uid);
  v_tier := coalesce(v_tier, 'member');
  -- One play a week for everyone.
  v_plays := 1;
  v_peek := v_tier = any(string_to_array(replace(public._gameboard_setting('gameboard_peek_tiers', 'silver,gold'), ' ', ''), ','));

  -- Last week (so Sunday classes still count on Monday) and this week.
  foreach w in array array[public._studio_week_start(v_today) - 7, public._studio_week_start(v_today)] loop
    v_att := public._gameboard_attended(v_uid, w);
    v_wgoal := public._goal_for_week(v_uid, w);
    select count(*) into v_used from public.gameboard_plays
      where profile_id = v_uid and week_start = w and status <> 'board';
    v_weeks := v_weeks || jsonb_build_object(
      'week_start', w,
      'attended', v_att,
      'goal', v_wgoal,
      'goal_met', v_wgoal >= v_min and v_att >= v_wgoal,
      'plays_left', case when v_wgoal >= v_min and v_att >= v_wgoal then greatest(0, v_plays - v_used) else 0 end);
    if v_play_week is null and v_wgoal >= v_min and v_att >= v_wgoal and v_used < v_plays then
      v_play_week := w;
    end if;
  end loop;

  select id, peeked_index into v_open from public.gameboard_plays
   where profile_id = v_uid and status = 'board' order by created_at limit 1;

  return jsonb_build_object(
    'ok', true,
    'tier', v_tier,
    'goal', v_goal,
    'next_week_goal', (select coalesce(weekly_goal, 3) from public.profiles where id = v_uid),
    'min_goal', v_min,
    'plays_per_week', v_plays,
    'can_peek', v_peek,
    'play_week', v_play_week,
    'weeks', v_weeks,
    'open_play_id', v_open.id,
    'open_play_peeked', v_open.peeked_index,
    'tiles', (select count(*) from public.gameboard_tiles where is_active),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'kind', g.kind, 'label', g.label, 'message', g.message, 'status',
        case when g.status = 'won' and g.expires_at <= now() then 'expired' else g.status end,
        'won_at', g.won_at, 'expires_at', g.expires_at, 'used_at', g.used_at,
        'gift_token', case when g.kind = 'gift' then g.gift_token end,
        'gift_claimed', g.gift_claimed_by is not null)
        order by g.won_at desc)
      from public.gameboard_plays g
      where g.profile_id = v_uid and g.status <> 'board'), '[]'::jsonb)
  );
end;
$$;

-- Check: should say goal_weeks_ready = 1, one_play_a_week = 1
select (select count(*) from pg_trigger where tgname = 'keep_weekly_goal_for_this_week') as goal_weeks_ready,
       (select count(*) from pg_proc where proname = 'my_gameboard' and prosrc like '%v_plays := 1;%') as one_play_a_week;
