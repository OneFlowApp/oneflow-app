-- Weekly Gameboard.
--   Members with a weekly goal of 3 or more who reach it get a play on the gameboard that week.
--   Gold members get 2 plays a week; Silver and Gold get a sneak peek before choosing.
--   9 hidden tiles: 4 gifts for a friend, 3 motivational messages, 2 Revive sachets.
--   Gifts and sachets expire 4 weeks after winning; members get in-app reminders 7 days and 1 day before.
--   Staff (guides and team) don't play, same as Flow Points and rewards.
-- Settings live in Admin → Settings (gameboard_*), tiles in gameboard_tiles, messages in gameboard_messages.

insert into public.studio_settings (key, value) values
  ('gameboard_min_goal', '3'),
  ('gameboard_expiry_days', '28'),
  ('gameboard_plays_gold', '2'),
  ('gameboard_peek_tiers', 'silver,gold')
on conflict (key) do nothing;

-- Hidden products used for gifted classes (not on sale, not shown in the shop).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('Gift: Reformer session', 'wellzone', array['reformer']),
      ('Gift: On The Mat class', 'yoga', array['yoga','sculpt','power','beginner','beginner_sculpt','pilates']),
      ('Gift: Wellzone session', 'wellzone', array['wellzone']),
      ('Gift: Sauna Journey', 'wellzone', array['sauna_journey'])
    ) as t(name, category, types)
  loop
    if not exists (select 1 from public.products where name = r.name) then
      execute format(
        'insert into public.products (name, description, category, price_zar, credit_count, validity_days,
                                      allowed_class_types, is_active, is_staff_only, is_addon, sort_order)
         values (%L, %L, %L, 0, 1, 28, %L::class_type[], false, false, false, 999)',
        r.name, 'Gameboard gift from a friend', r.category, r.types);
    end if;
  end loop;
end $$;

create table if not exists public.gameboard_tiles (
  id uuid primary key default gen_random_uuid(),
  sort_order integer not null default 0,
  label text not null,
  kind text not null check (kind in ('gift', 'message', 'sachet')),
  gift_product_id uuid references public.products(id),
  is_active boolean not null default true
);

create table if not exists public.gameboard_messages (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  is_active boolean not null default true
);

create table if not exists public.gameboard_plays (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  play_no integer not null,
  layout uuid[] not null,
  peeked_index integer,
  picked_index integer,
  tile_id uuid references public.gameboard_tiles(id),
  kind text,
  label text,
  message text,
  status text not null default 'board' check (status in ('board', 'won', 'used', 'expired')),
  won_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid,
  gift_token uuid not null default gen_random_uuid() unique,
  gift_claimed_by uuid references public.profiles(id),
  gift_credit_id uuid,
  reminded_7 boolean not null default false,
  reminded_1 boolean not null default false,
  created_at timestamptz not null default now(),
  unique (profile_id, week_start, play_no)
);

create index if not exists gameboard_plays_profile_idx on public.gameboard_plays (profile_id);
create index if not exists gameboard_plays_open_idx on public.gameboard_plays (status, expires_at) where status = 'won';

alter table public.gameboard_tiles enable row level security;
alter table public.gameboard_messages enable row level security;
alter table public.gameboard_plays enable row level security;

drop policy if exists gameboard_tiles_read on public.gameboard_tiles;
create policy gameboard_tiles_read on public.gameboard_tiles for select to authenticated using (true);
drop policy if exists gameboard_tiles_admin on public.gameboard_tiles;
create policy gameboard_tiles_admin on public.gameboard_tiles for all to authenticated
  using (public.is_admin_role()) with check (public.is_admin_role());

drop policy if exists gameboard_messages_admin on public.gameboard_messages;
create policy gameboard_messages_admin on public.gameboard_messages for all to authenticated
  using (public.is_admin_role()) with check (public.is_admin_role());

drop policy if exists gameboard_plays_read on public.gameboard_plays;
create policy gameboard_plays_read on public.gameboard_plays for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['director', 'management', 'front_desk']));

-- The 9 tiles (only seeded once).
insert into public.gameboard_tiles (sort_order, label, kind, gift_product_id)
select x.sort_order, x.label, x.kind, (select id from public.products where name = x.product limit 1)
from (values
  (1, 'Gift a Reformer session to a friend', 'gift', 'Gift: Reformer session'),
  (2, 'Gift a class On The Mat to a friend', 'gift', 'Gift: On The Mat class'),
  (3, 'Gift a Wellzone session to a friend', 'gift', 'Gift: Wellzone session'),
  (4, 'Gift a Sauna Journey to a friend', 'gift', 'Gift: Sauna Journey'),
  (5, 'A Motivational Message', 'message', null),
  (6, 'A Motivational Message', 'message', null),
  (7, 'A Complimentary Revive Sachet', 'sachet', null),
  (8, 'A Motivational Message', 'message', null),
  (9, 'A Complimentary Revive Sachet', 'sachet', null)
) as x(sort_order, label, kind, product)
where not exists (select 1 from public.gameboard_tiles);

insert into public.gameboard_messages (body)
select m from unnest(array[
  'You showed up for yourself this week. That''s the whole practice.',
  'Consistency is quiet strength. Keep flowing.',
  'Every class is a vote for the person you''re becoming.',
  'Your body hears everything your mind says. Speak kindly.',
  'Small steps, every week. Look how far they''ve carried you.',
  'Breathe in what you''ve built. Breathe out what you don''t need.',
  'Strong isn''t a look. It''s a habit, and you''re building it.',
  'You kept the promise you made to yourself. Be proud of that.',
  'Rest is part of the work. Honour it as much as the effort.',
  'The mat doesn''t care how you arrived. It''s just glad you came.',
  'Progress, not perfection. See you next week.',
  'You are the one who decides how this week ends. You chose well.'
]) as m
where not exists (select 1 from public.gameboard_messages);

-- ---------------------------------------------------------------------------------------------
-- Helpers

create or replace function public._gameboard_setting(p_key text, p_default text)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((select nullif(value, '') from public.studio_settings where key = p_key), p_default);
$$;

-- Sunday that starts the studio week containing p_day.
create or replace function public._studio_week_start(p_day date)
returns date language sql immutable as $$
  select p_day - extract(dow from p_day)::int;
$$;

create or replace function public._gameboard_attended(p_profile_id uuid, p_week_start date)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(*)::int
  from public.bookings b
  join public.classes c on c.id = b.class_id
  where b.profile_id = p_profile_id
    and b.status::text = 'attended'
    and (c.starts_at at time zone 'Africa/Johannesburg')::date >= p_week_start
    and (c.starts_at at time zone 'Africa/Johannesburg')::date < p_week_start + 7;
$$;

-- What this member can do on the gameboard right now.
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
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if public.is_staff_profile(v_uid) then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;

  select coalesce(weekly_goal, 3) into v_goal from public.profiles where id = v_uid;
  select tier into v_tier from public.member_tier(v_uid);
  v_tier := coalesce(v_tier, 'member');
  v_plays := case when v_tier = 'gold' then public._gameboard_setting('gameboard_plays_gold', '2')::int else 1 end;
  v_peek := v_tier = any(string_to_array(replace(public._gameboard_setting('gameboard_peek_tiers', 'silver,gold'), ' ', ''), ','));

  -- Last week (so Sunday classes still count on Monday) and this week.
  foreach w in array array[public._studio_week_start(v_today) - 7, public._studio_week_start(v_today)] loop
    v_att := public._gameboard_attended(v_uid, w);
    select count(*) into v_used from public.gameboard_plays
      where profile_id = v_uid and week_start = w and status <> 'board';
    v_weeks := v_weeks || jsonb_build_object(
      'week_start', w,
      'attended', v_att,
      'goal', v_goal,
      'goal_met', v_goal >= v_min and v_att >= v_goal,
      'plays_left', case when v_goal >= v_min and v_att >= v_goal then greatest(0, v_plays - v_used) else 0 end);
    if v_play_week is null and v_goal >= v_min and v_att >= v_goal and v_used < v_plays then
      v_play_week := w;
    end if;
  end loop;

  select id, peeked_index into v_open from public.gameboard_plays
   where profile_id = v_uid and status = 'board' order by created_at limit 1;

  return jsonb_build_object(
    'ok', true,
    'tier', v_tier,
    'goal', v_goal,
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

-- Start (or continue) a play: the 9 tiles are shuffled and hidden.
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
begin
  select id into v_id from public.gameboard_plays where profile_id = v_uid and status = 'board' limit 1;
  if v_id is not null then return v_id; end if;

  s := public.my_gameboard();
  if not coalesce((s->>'ok')::boolean, false) then raise exception 'The gameboard isn''t available for this account'; end if;
  v_week := nullif(s->>'play_week', '')::date;
  if v_week is null then raise exception 'Reach your weekly goal to unlock a play'; end if;

  select coalesce(max(play_no), 0) + 1 into v_no from public.gameboard_plays where profile_id = v_uid and week_start = v_week;
  insert into public.gameboard_plays (profile_id, week_start, play_no, layout)
  values (v_uid, v_week, v_no,
          (select array_agg(id order by random()) from public.gameboard_tiles where is_active))
  returning id into v_id;
  return v_id;
end;
$$;

-- Sneak peek (Silver and Gold): see what's under one tile, once per play.
create or replace function public.peek_gameboard_tile(p_play_id uuid, p_index integer)
returns text
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
  return (select label from public.gameboard_tiles where id = g.layout[p_index]);
end;
$$;

-- Pick a tile: the reward is saved, and the whole board is revealed.
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
    'board', (select jsonb_agg(x.label order by x.ord)
                from (select gt.label, u.ord
                        from unnest(g.layout) with ordinality as u(tile_id, ord)
                        join public.gameboard_tiles gt on gt.id = u.tile_id) x));
end;
$$;

-- Public: what a gift link holds (works before signing in).
create or replace function public.gameboard_gift_preview(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select jsonb_build_object(
      'ok', true,
      'from', coalesce(nullif(trim(p.first_name), ''), 'A friend'),
      'label', g.label,
      'expires_at', g.expires_at,
      'state', case when g.gift_claimed_by is not null then 'claimed'
                    when g.status <> 'won' or g.expires_at <= now() then 'expired'
                    else 'open' end)
    from public.gameboard_plays g
    join public.profiles p on p.id = g.profile_id
    where g.gift_token = p_token and g.kind = 'gift'), jsonb_build_object('ok', false));
$$;

-- The friend claims the gift: 1 free class of that type lands on their profile.
create or replace function public.claim_gameboard_gift(p_token uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  g public.gameboard_plays;
  pr public.products;
  v_days int := public._gameboard_setting('gameboard_expiry_days', '28')::int;
  v_credit uuid;
begin
  if v_uid is null then raise exception 'Sign in to claim your gift'; end if;
  select * into g from public.gameboard_plays where gift_token = p_token and kind = 'gift' for update;
  if g.id is null then raise exception 'This gift link isn''t valid'; end if;
  if g.profile_id = v_uid then raise exception 'This gift is for a friend. Share the link with them'; end if;
  if g.gift_claimed_by is not null then raise exception 'This gift has already been claimed'; end if;
  if g.status <> 'won' or g.expires_at <= now() then raise exception 'This gift has expired'; end if;

  select p.* into pr from public.products p
    join public.gameboard_tiles t on t.gift_product_id = p.id
   where t.id = g.tile_id;
  if pr.id is null then raise exception 'This gift isn''t set up yet. Please contact the studio'; end if;

  insert into public.user_credits (profile_id, product_id, product_name, category, allowed_class_types,
                                   credits_total, credits_remaining, is_unlimited, expires_at,
                                   yoco_payment_id, mat_access, towel_access, purchased_at, access_scope)
  values (v_uid, pr.id, pr.name, pr.category, pr.allowed_class_types,
          1, 1, false, now() + make_interval(days => v_days),
          'gameboard_gift', false, false, now(), 'longkloof')
  returning id into v_credit;

  update public.gameboard_plays
     set gift_claimed_by = v_uid, gift_credit_id = v_credit, status = 'used', used_at = now()
   where id = g.id;

  return pr.name;
end;
$$;

-- Staff: mark a sachet (or any reward) as collected at the desk.
create or replace function public.use_gameboard_reward(p_play_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_any_role(array['director', 'management', 'front_desk', 'team', 'boh']) then
    raise exception 'Only studio staff can do this';
  end if;
  update public.gameboard_plays
     set status = 'used', used_at = now(), used_by = auth.uid()
   where id = p_play_id and status = 'won' and expires_at > now();
  if not found then raise exception 'This reward has already been used or has expired'; end if;
end;
$$;

-- Daily: expire old rewards and remind members 7 days and 1 day before.
create or replace function public.gameboard_daily()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_from uuid := (select id from public.profiles where role::text = 'director' limit 1);
begin
  update public.gameboard_plays set status = 'expired' where status = 'won' and expires_at <= now();

  insert into public.studio_messages (from_profile_id, to_profile_id, subject, body, message_type)
  select v_from, g.profile_id, 'Your gameboard reward expires soon',
         'Hi ' || coalesce(p.first_name, 'there') || ', your reward "' || g.label || '" expires on '
           || to_char(g.expires_at at time zone 'Africa/Johannesburg', 'FMDay FMDD Mon')
           || case when g.kind = 'gift' then '. Share your gift link with a friend from the Gameboard page before then.'
                   else '. Collect it at the front desk before then.' end,
         'direct'
  from public.gameboard_plays g join public.profiles p on p.id = g.profile_id
  where g.status = 'won' and not g.reminded_7
    and g.expires_at > now() and g.expires_at <= now() + interval '7 days';
  update public.gameboard_plays set reminded_7 = true
   where status = 'won' and not reminded_7 and expires_at > now() and expires_at <= now() + interval '7 days';

  insert into public.studio_messages (from_profile_id, to_profile_id, subject, body, message_type)
  select v_from, g.profile_id, 'Last day for your gameboard reward',
         'Hi ' || coalesce(p.first_name, 'there') || ', your reward "' || g.label || '" expires tomorrow. '
           || case when g.kind = 'gift' then 'Send your gift link to a friend today!'
                   else 'Pop in and collect it at the front desk!' end,
         'direct'
  from public.gameboard_plays g join public.profiles p on p.id = g.profile_id
  where g.status = 'won' and not g.reminded_1
    and g.expires_at > now() and g.expires_at <= now() + interval '1 day';
  update public.gameboard_plays set reminded_1 = true, reminded_7 = true
   where status = 'won' and not reminded_1 and expires_at > now() and expires_at <= now() + interval '1 day';
end;
$$;

revoke all on function public._gameboard_setting(text, text) from public, anon;
revoke all on function public._gameboard_attended(uuid, date) from public, anon, authenticated;
revoke all on function public.gameboard_daily() from public, anon, authenticated;
revoke all on function public.my_gameboard() from public, anon;
grant execute on function public.my_gameboard() to authenticated;
revoke all on function public.start_gameboard_play() from public, anon;
grant execute on function public.start_gameboard_play() to authenticated;
revoke all on function public.peek_gameboard_tile(uuid, integer) from public, anon;
grant execute on function public.peek_gameboard_tile(uuid, integer) to authenticated;
revoke all on function public.pick_gameboard_tile(uuid, integer) from public, anon;
grant execute on function public.pick_gameboard_tile(uuid, integer) to authenticated;
grant execute on function public.gameboard_gift_preview(uuid) to anon, authenticated;
revoke all on function public.claim_gameboard_gift(uuid) from public, anon;
grant execute on function public.claim_gameboard_gift(uuid) to authenticated;
revoke all on function public.use_gameboard_reward(uuid) from public, anon;
grant execute on function public.use_gameboard_reward(uuid) to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname = 'gameboard-daily' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end $$;
-- 07:00 UTC = 09:00 in Cape Town.
select cron.schedule('gameboard-daily', '0 7 * * *', $$ select public.gameboard_daily(); $$);

-- Check: the 9 tiles, and whether each gift is linked to its hidden product.
select t.sort_order, t.label, t.kind, (t.kind <> 'gift' or t.gift_product_id is not null) as ready
from public.gameboard_tiles t order by t.sort_order;
