-- Members can pause a pack from Me → Passes.
--   Only packs ticked "Members can pause" in Products (never Continuous Flow).
--   1 to 4 weeks, once per pack, for a R300 fee (all three set in Admin → Settings).
--   The pause starts once the fee is paid; the pack's end date moves out by the weeks paused.
--   It can't cover classes the member has booked with that pack: they cancel those first.
--   The studio gets an email; Director and Management can undo a pause.

alter table public.products add column if not exists can_pause boolean not null default false;

insert into public.studio_settings (key, value) values
  ('pause_fee_zar', '300'),
  ('pause_min_weeks', '1'),
  ('pause_max_weeks', '4')
on conflict (key) do nothing;

create table if not exists public.credit_pauses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  credit_id uuid not null references public.user_credits(id) on delete cascade,
  product_id uuid,
  product_name text,
  purchase_key text not null,
  starts_on date not null,
  ends_on date not null,
  weeks integer not null check (weeks between 1 and 12),
  fee_zar numeric not null default 0,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'cancelled')),
  yoco_payment_id text,
  days_added integer not null default 0,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid
);

create index if not exists credit_pauses_profile_idx on public.credit_pauses (profile_id);
create index if not exists credit_pauses_purchase_idx on public.credit_pauses (purchase_key);

alter table public.credit_pauses enable row level security;

drop policy if exists credit_pauses_read on public.credit_pauses;
create policy credit_pauses_read on public.credit_pauses for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['director', 'management', 'front_desk']));

-- One purchase can be several credit rows (a pack with Reformer + Wellzone parts): they pause together.
create or replace function public._purchase_key(c public.user_credits)
returns text
language sql
immutable
as $$
  select coalesce(nullif(c.yoco_payment_id, ''), c.id::text) || '|' || coalesce(c.product_id::text, '');
$$;

create or replace function public._purchase_credit_ids(p_credit_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select c2.id
  from public.user_credits c1
  join public.user_credits c2
    on c2.profile_id = c1.profile_id
   and public._purchase_key(c2) = public._purchase_key(c1)
  where c1.id = p_credit_id;
$$;

-- Turn a paid pause on: move the pack's end date out by the weeks paused. Safe to call twice.
create or replace function public.activate_credit_pause(p_pause_id uuid, p_payment_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.credit_pauses;
  v_days int;
begin
  select * into p from public.credit_pauses where id = p_pause_id for update;
  if p.id is null or p.status <> 'pending_payment' then return; end if;
  -- Already paused once (e.g. two payments for the same pass): keep the first, record this one.
  if exists (select 1 from public.credit_pauses x where x.purchase_key = p.purchase_key and x.status = 'active') then
    update public.credit_pauses
       set status = 'cancelled', cancelled_at = now(), yoco_payment_id = p_payment_id
     where id = p.id;
    return;
  end if;
  v_days := p.weeks * 7;
  update public.user_credits
     set expires_at = expires_at + make_interval(days => v_days)
   where id in (select public._purchase_credit_ids(p.credit_id))
     and expires_at is not null;
  update public.credit_pauses
     set status = 'active', paid_at = now(), yoco_payment_id = p_payment_id, days_added = v_days
   where id = p.id;
end;
$$;

revoke all on function public.activate_credit_pause(uuid, text) from public, anon, authenticated;

-- Member asks to pause. Returns the pause id and the fee to pay (0 = already active).
create or replace function public.request_credit_pause(p_credit_id uuid, p_starts_on date, p_weeks integer)
returns table (pause_id uuid, fee_zar numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.user_credits;
  prod record;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_fee numeric;
  v_min int;
  v_max int;
  v_key text;
  v_ends date;
  v_booked int;
  v_id uuid;
begin
  select * into c from public.user_credits where id = p_credit_id;
  if c.id is null or c.profile_id is distinct from auth.uid() then
    raise exception 'Pass not found';
  end if;
  if c.refunded_at is not null or (c.expires_at is not null and c.expires_at <= now()) then
    raise exception 'This pass has ended, so it can''t be paused';
  end if;

  select p.can_pause, coalesce(p.is_continuous, false) as is_continuous, p.name into prod
  from public.products p where p.id = c.product_id;
  if not coalesce(prod.can_pause, false) or prod.is_continuous then
    raise exception 'This pass can''t be paused';
  end if;

  select coalesce(nullif(max(value) filter (where key = 'pause_fee_zar'), '')::numeric, 300),
         coalesce(nullif(max(value) filter (where key = 'pause_min_weeks'), '')::int, 1),
         coalesce(nullif(max(value) filter (where key = 'pause_max_weeks'), '')::int, 4)
    into v_fee, v_min, v_max
  from public.studio_settings where key in ('pause_fee_zar', 'pause_min_weeks', 'pause_max_weeks');

  if p_weeks is null or p_weeks < v_min or p_weeks > v_max then
    raise exception 'A pause can be % to % weeks', v_min, v_max;
  end if;
  if p_starts_on is null or p_starts_on < v_today then
    raise exception 'Choose a start date from today onwards';
  end if;
  if c.expires_at is not null and p_starts_on > (c.expires_at at time zone 'Africa/Johannesburg')::date then
    raise exception 'The pause has to start before your pass ends';
  end if;

  v_key := public._purchase_key(c);
  if exists (select 1 from public.credit_pauses x
             where x.purchase_key = v_key
               and x.status = 'active') then
    raise exception 'This pass has already been paused once';
  end if;

  v_ends := p_starts_on + p_weeks * 7 - 1;

  select count(*) into v_booked
  from public.bookings b
  join public.classes cl on cl.id = b.class_id
  where b.profile_id = c.profile_id
    and b.credit_id in (select public._purchase_credit_ids(c.id))
    and coalesce(b.status::text, '') = 'confirmed'
    and (cl.starts_at at time zone 'Africa/Johannesburg')::date between p_starts_on and v_ends;
  if v_booked > 0 then
    raise exception 'You have % class% booked with this pass between those dates. Please cancel them first.',
      v_booked, case when v_booked = 1 then '' else 'es' end;
  end if;

  -- Drop any unpaid request for this pass before making a new one.
  delete from public.credit_pauses where purchase_key = v_key and status = 'pending_payment';

  insert into public.credit_pauses (profile_id, credit_id, product_id, product_name, purchase_key,
                                    starts_on, ends_on, weeks, fee_zar)
  values (c.profile_id, c.id, c.product_id, prod.name, v_key, p_starts_on, v_ends, p_weeks, v_fee)
  returning id into v_id;

  if v_fee <= 0 then
    perform public.activate_credit_pause(v_id, null);
  end if;

  return query select v_id, v_fee;
end;
$$;

revoke all on function public.request_credit_pause(uuid, date, integer) from public, anon;
grant execute on function public.request_credit_pause(uuid, date, integer) to authenticated;

-- Director and Management: undo a pause (the end date moves back).
create or replace function public.cancel_credit_pause(p_pause_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.credit_pauses;
begin
  if not public.has_any_role(array['director', 'management']) then
    raise exception 'Only Director and Management can undo a pause';
  end if;
  select * into p from public.credit_pauses where id = p_pause_id for update;
  if p.id is null or p.status = 'cancelled' then return; end if;
  if p.status = 'active' and p.days_added > 0 then
    update public.user_credits
       set expires_at = expires_at - make_interval(days => p.days_added)
     where id in (select public._purchase_credit_ids(p.credit_id))
       and expires_at is not null;
  end if;
  update public.credit_pauses
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
   where id = p.id;
end;
$$;

revoke all on function public.cancel_credit_pause(uuid) from public, anon;
grant execute on function public.cancel_credit_pause(uuid) to authenticated;

-- A paused pack can't book classes inside its pause dates.
create or replace function public.enforce_credit_pause()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_day date;
  v_until date;
begin
  if new.credit_id is null then return new; end if;
  select (starts_at at time zone 'Africa/Johannesburg')::date into v_day from public.classes where id = new.class_id;
  select x.ends_on into v_until
  from public.credit_pauses x
  join public.user_credits c on c.id = new.credit_id
  where x.status = 'active'
    and x.purchase_key = public._purchase_key(c)
    and v_day between x.starts_on and x.ends_on
  limit 1;
  if v_until is not null then
    raise exception 'This pass is paused until %. Choose a class after that date.', to_char(v_until, 'FMDD Mon');
  end if;
  return new;
end;
$$;

drop trigger if exists zz_enforce_credit_pause on public.bookings;
create trigger zz_enforce_credit_pause before insert on public.bookings
  for each row execute function public.enforce_credit_pause();

-- Tick "Members can pause" on the packs listed by the Director (never Continuous Flow or add-ons).
update public.products p
   set can_pause = true
 where not coalesce(p.is_continuous, false)
   and not coalesce(p.is_addon, false)
   and (
     p.name ilike '1 month%on the mat%'
     or p.name ilike '1 month%wellzone%'
     or p.name ilike '%reformer%'
     or p.name ilike '6 pack%'
     or p.name ilike '12 pack%'
     or p.name ilike '%double flow%'
     or p.name ilike '%seeker%'
     or p.name ilike 'the kloof%'
   );

-- Check: every pack, and whether members can pause it. Fix any wrong ones in Products.
select p.name, p.can_pause as members_can_pause, coalesce(p.is_continuous, false) as continuous
from public.products p
where coalesce(p.is_active, true) and not coalesce(p.is_addon, false)
order by p.can_pause desc, p.name;
