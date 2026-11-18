-- Gameboard, part 2: rewards and odds are edited in Admin → Gameboard.
--   Each reward has a "chance" weight. Every tile on the board is drawn using those weights,
--   so a reward with weight 2 turns up twice as often as one with weight 1. The board can show repeats.
--   Board size is a setting (gameboard_board_size, default 9).
-- Run after 20261118150000_weekly_gameboard.sql.

alter table public.gameboard_tiles add column if not exists weight integer not null default 1
  check (weight >= 0 and weight <= 1000);

insert into public.studio_settings (key, value) values ('gameboard_board_size', '9')
on conflict (key) do nothing;

-- Draw one reward using the weights.
create or replace function public._gameboard_draw_tile()
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
  select coalesce(sum(weight), 0) into v_total from public.gameboard_tiles where is_active and weight > 0;
  if v_total = 0 then raise exception 'The gameboard has no rewards switched on'; end if;
  v_r := random() * v_total;
  for t in select id, weight from public.gameboard_tiles where is_active and weight > 0 order by sort_order, id loop
    v_acc := v_acc + t.weight;
    if v_r < v_acc then return t.id; end if;
  end loop;
  return t.id;
end;
$$;
revoke all on function public._gameboard_draw_tile() from public, anon, authenticated;

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
  v_layout uuid[] := '{}';
  i int;
begin
  select id into v_id from public.gameboard_plays where profile_id = v_uid and status = 'board' limit 1;
  if v_id is not null then return v_id; end if;

  s := public.my_gameboard();
  if not coalesce((s->>'ok')::boolean, false) then raise exception 'The gameboard isn''t available for this account'; end if;
  v_week := nullif(s->>'play_week', '')::date;
  if v_week is null then raise exception 'Reach your weekly goal to unlock a play'; end if;

  for i in 1..v_size loop
    v_layout := v_layout || public._gameboard_draw_tile();
  end loop;

  select coalesce(max(play_no), 0) + 1 into v_no from public.gameboard_plays where profile_id = v_uid and week_start = v_week;
  insert into public.gameboard_plays (profile_id, week_start, play_no, layout)
  values (v_uid, v_week, v_no, v_layout)
  returning id into v_id;
  return v_id;
end;
$$;

-- Board size for the member page (an open play keeps its own size).
create or replace function public.gameboard_board_size()
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select array_length(layout, 1) from public.gameboard_plays where profile_id = auth.uid() and status = 'board' limit 1),
    greatest(3, least(25, public._gameboard_setting('gameboard_board_size', '9')::int)));
$$;
grant execute on function public.gameboard_board_size() to authenticated;

-- Peek now also says what kind of reward it is.
drop function if exists public.peek_gameboard_tile(uuid, integer);
create function public.peek_gameboard_tile(p_play_id uuid, p_index integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.gameboard_plays;
begin
  select * into g from public.gameboard_plays where id = p_play_id for update;
  if g.id is null or g.profile_id is distinct from auth.uid() or g.status <> 'board' then
    raise exception 'This play isn''t open';
  end if;
  if not coalesce((public.my_gameboard()->>'can_peek')::boolean, false) then
    raise exception 'Sneak peeks are for Silver and Gold cards';
  end if;
  if g.peeked_index is not null then raise exception 'You''ve already used your sneak peek'; end if;
  if p_index < 1 or p_index > array_length(g.layout, 1) then raise exception 'Pick a tile on the board'; end if;
  update public.gameboard_plays set peeked_index = p_index where id = g.id;
  return (select jsonb_build_object('label', label, 'kind', kind) from public.gameboard_tiles where id = g.layout[p_index]);
end;
$$;
revoke all on function public.peek_gameboard_tile(uuid, integer) from public, anon;
grant execute on function public.peek_gameboard_tile(uuid, integer) to authenticated;

-- Pick: the revealed board now carries each tile's kind too.
create or replace function public.pick_gameboard_tile(p_play_id uuid, p_index integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.gameboard_plays;
  t public.gameboard_tiles;
  v_msg text;
  v_days int := public._gameboard_setting('gameboard_expiry_days', '28')::int;
begin
  select * into g from public.gameboard_plays where id = p_play_id for update;
  if g.id is null or g.profile_id is distinct from auth.uid() or g.status <> 'board' then
    raise exception 'This play isn''t open';
  end if;
  if p_index < 1 or p_index > array_length(g.layout, 1) then raise exception 'Pick a tile on the board'; end if;
  select * into t from public.gameboard_tiles where id = g.layout[p_index];

  if t.kind = 'message' then
    select body into v_msg from public.gameboard_messages where is_active order by random() limit 1;
  end if;

  update public.gameboard_plays
     set picked_index = p_index, tile_id = t.id, kind = t.kind, label = t.label, message = v_msg,
         status = case when t.kind = 'message' then 'used' else 'won' end,
         won_at = now(),
         used_at = case when t.kind = 'message' then now() end,
         expires_at = case when t.kind = 'message' then null else now() + make_interval(days => v_days) end
   where id = g.id;

  return jsonb_build_object(
    'id', g.id, 'kind', t.kind, 'label', t.label, 'message', v_msg,
    'expires_at', case when t.kind = 'message' then null else now() + make_interval(days => v_days) end,
    'gift_token', case when t.kind = 'gift' then g.gift_token end,
    'board', (select jsonb_agg(jsonb_build_object('label', gt.label, 'kind', gt.kind) order by u.ord)
                from unnest(g.layout) with ordinality as u(tile_id, ord)
                join public.gameboard_tiles gt on gt.id = u.tile_id));
end;
$$;

-- Check: each reward and its chance on any one tile.
select label, kind, weight,
       round(100.0 * weight / nullif(sum(weight) filter (where is_active) over (), 0), 1) as chance_pct,
       is_active
from public.gameboard_tiles order by sort_order;
