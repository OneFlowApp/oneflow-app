-- Gameboard: the board shows one tile per reward switched on (for the member's goal layer),
-- instead of a fixed number. Each tile is still drawn using the Chance odds, so repeats can happen.

create or replace function public._gameboard_size(p_level integer)
returns integer language sql stable security definer set search_path to 'public' as $$
  select greatest(1, count(*)::int) from public.gameboard_tiles
  where is_active and weight > 0 and goal_level = p_level;
$$;
revoke all on function public._gameboard_size(integer) from public, anon, authenticated;

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
  v_level int;
  v_size int;
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
  v_size := public._gameboard_size(v_level);
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

-- Board size for the member page: an open play keeps its own size, otherwise their layer's rewards.
create or replace function public.gameboard_board_size()
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select array_length(layout, 1) from public.gameboard_plays where profile_id = auth.uid() and status = 'board' limit 1),
    public._gameboard_size(public._gameboard_level((select weekly_goal from public.profiles where id = auth.uid()))));
$$;
grant execute on function public.gameboard_board_size() to authenticated;

-- Check: tiles each goal layer shows.
select goal_level, public._gameboard_size(goal_level) as tiles_on_board
from (select distinct goal_level from public.gameboard_tiles) l order by 1;
