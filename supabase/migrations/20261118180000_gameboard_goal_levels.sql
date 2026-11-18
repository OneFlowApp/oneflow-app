-- Gameboard, part 3.
-- 1) Permissions the app needs on the new tables (missing from parts 1 and 2), and for the 16:00 guide email.
-- 2) Reward layers by weekly goal: 3, 4, 5, 6 and 7+ classes a week each have their own rewards and odds.
--    A member plays the layer for their weekly goal. If that layer has no rewards switched on,
--    the nearest lower layer is used (so the 3-a-week rewards are the fallback for everyone).

grant select, insert, update on public.gameboard_tiles to authenticated;
grant select, insert, update on public.gameboard_messages to authenticated;
grant select on public.gameboard_plays to authenticated;
grant all on public.gameboard_tiles, public.gameboard_messages, public.gameboard_plays to service_role;
grant all on public.guide_schedule_runs to service_role;

alter table public.gameboard_tiles add column if not exists goal_level integer not null default 3
  check (goal_level between 3 and 7);
alter table public.gameboard_plays add column if not exists goal_level integer;

-- Which layer a weekly goal plays: 3..7 (7 means 7 or more), falling back to a lower layer with rewards.
create or replace function public._gameboard_level(p_goal integer)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select max(goal_level) from public.gameboard_tiles
      where is_active and weight > 0 and goal_level <= least(7, greatest(3, coalesce(p_goal, 3)))),
    (select min(goal_level) from public.gameboard_tiles where is_active and weight > 0),
    3);
$$;

drop function if exists public._gameboard_draw_tile();
create or replace function public._gameboard_draw_tile(p_level integer)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_total int;
  v_r double precision;
  v_acc int := 0;
  t record;
begin
  select coalesce(sum(weight), 0) into v_total
  from public.gameboard_tiles where is_active and weight > 0 and goal_level = p_level;
  if v_total = 0 then raise exception 'The gameboard has no rewards switched on'; end if;
  v_r := random() * v_total;
  for t in select id, weight from public.gameboard_tiles
            where is_active and weight > 0 and goal_level = p_level order by sort_order, id loop
    v_acc := v_acc + t.weight;
    if v_r < v_acc then return t.id; end if;
  end loop;
  return t.id;
end;
$$;
revoke all on function public._gameboard_draw_tile(integer) from public, anon, authenticated;

create or replace function public.start_gameboard_play()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  s jsonb;
  v_week date;
  v_id uuid;
  v_no int;
  v_size int := greatest(3, least(25, public._gameboard_setting('gameboard_board_size', '9')::int));
  v_level int;
  v_layout uuid[] := '{}';
  i int;
begin
  select id into v_id from public.gameboard_plays where profile_id = v_uid and status = 'board' limit 1;
  if v_id is not null then return v_id; end if;

  s := public.my_gameboard();
  if not coalesce((s->>'ok')::boolean, false) then raise exception 'The gameboard isn''t available for this account'; end if;
  v_week := nullif(s->>'play_week', '')::date;
  if v_week is null then raise exception 'Reach your weekly goal to unlock a play'; end if;

  v_level := public._gameboard_level((s->>'goal')::int);
  for i in 1..v_size loop
    v_layout := v_layout || public._gameboard_draw_tile(v_level);
  end loop;

  select coalesce(max(play_no), 0) + 1 into v_no from public.gameboard_plays where profile_id = v_uid and week_start = v_week;
  insert into public.gameboard_plays (profile_id, week_start, play_no, layout, goal_level)
  values (v_uid, v_week, v_no, v_layout, v_level)
  returning id into v_id;
  return v_id;
end;
$$;

-- For the member page: the rewards on each layer (names only, no odds), and the member's own layer.
create or replace function public.gameboard_rewards_by_level()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'my_level', public._gameboard_level((select weekly_goal from public.profiles where id = auth.uid())),
    'levels', coalesce((
      select jsonb_agg(jsonb_build_object('level', l.goal_level, 'rewards', l.rewards) order by l.goal_level)
      from (
        select goal_level, jsonb_agg(distinct label) as rewards
        from public.gameboard_tiles
        where is_active and weight > 0
        group by goal_level
      ) l), '[]'::jsonb));
$$;
revoke all on function public.gameboard_rewards_by_level() from public, anon;
grant execute on function public.gameboard_rewards_by_level() to authenticated;

-- Check: rewards per layer.
select goal_level, count(*) filter (where is_active) as rewards_on, sum(weight) filter (where is_active) as total_weight
from public.gameboard_tiles group by goal_level order by goal_level;
