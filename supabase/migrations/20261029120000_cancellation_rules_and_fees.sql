-- Cancellation rules 1: late cancel, credit hold, no-show fees, booking block and booking window.

-- 1. Settings (all editable in Admin -> Settings). Existing values are kept.
insert into public.studio_settings (key, value) values
  ('late_cancel_fee_zar', '100'),
  ('no_show_fee_zar', '200'),
  ('late_cancel_window_minutes', '120'),
  ('credit_loss_window_minutes', '60'),
  ('late_fee_pay_hours', '24')
on conflict (key) do nothing;
-- Booking window: the existing "Days ahead bookings open" setting, set to 30 days.
insert into public.studio_settings (key, value) values ('booking_open_days_ahead', '30')
on conflict (key) do update set value = excluded.value;

create or replace function public.studio_setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(value), '')::numeric from public.studio_settings where key = p_key), p_default);
$$;

-- 2. Fees members owe (late cancels and no-shows).
create table if not exists public.member_fees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  credit_id uuid references public.user_credits (id) on delete set null,
  kind text not null check (kind in ('late_cancel', 'no_show')),
  amount_zar numeric(10, 2) not null,
  -- true = a credit pack credit is held and comes back when this fee is paid in time
  credit_held boolean not null default false,
  -- true = the member cannot book until this fee is paid (memberships)
  blocks_booking boolean not null default false,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'waived', 'expired')),
  due_by timestamptz,
  paid_at timestamptz,
  yoco_payment_id text,
  waived_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists member_fees_profile_status_idx on public.member_fees (profile_id, status);
alter table public.member_fees enable row level security;
drop policy if exists member_fees_select on public.member_fees;
create policy member_fees_select on public.member_fees for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['director', 'management', 'front_desk']));
drop policy if exists member_fees_staff_update on public.member_fees;
create policy member_fees_staff_update on public.member_fees for update to authenticated
  using (public.has_any_role(array['director', 'management', 'front_desk']))
  with check (public.has_any_role(array['director', 'management', 'front_desk']));
grant select, update on public.member_fees to authenticated;
grant all on public.member_fees to service_role;

alter table public.bookings add column if not exists no_show boolean not null default false;
alter table public.bookings add column if not exists no_show_checked_at timestamptz;

-- 3. Cancelling: credits only come back automatically when the cancel is on time.
create or replace function public.refund_credit_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'confirmed' and new.status = 'cancelled' and not coalesce(new.late_cancel, false) then
    if new.credit_id is not null then
      update public.user_credits
      set credits_remaining = credits_remaining + 1
      where id = new.credit_id and is_unlimited = false;
    end if;
    if new.payment_method = 'flow_points' and coalesce(new.flow_points_used, 0) > 0 then
      update public.profiles
      set flow_points = coalesce(flow_points, 0) + new.flow_points_used
      where id = new.profile_id;
    end if;
  end if;
  return new;
end $$;

create or replace function public.cancel_my_booking(
  p_booking_id uuid,
  p_reason text default 'customer_cancelled',
  p_waive_late_fee boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_profile uuid; v_status text; v_starts timestamptz; v_credit uuid; v_unlimited boolean;
  v_minutes numeric; v_late_window numeric; v_loss_window numeric;
  v_late boolean := false; v_fee numeric := 0; v_held boolean := false; v_block boolean := false;
  v_lost boolean := false; v_waive boolean;
begin
  if v_uid is null then raise exception 'Please sign in'; end if;
  v_staff := public.has_any_role(array['director', 'management', 'team', 'front_desk', 'guide', 'boh']);

  select b.profile_id, b.status::text, c.starts_at, b.credit_id
    into v_profile, v_status, v_starts, v_credit
  from public.bookings b join public.classes c on c.id = b.class_id
  where b.id = p_booking_id
  for update of b;

  if not found then raise exception 'Booking not found'; end if;
  if not v_staff and v_profile is distinct from v_uid then raise exception 'You can only cancel your own bookings'; end if;
  if v_status = 'cancelled' then raise exception 'Booking already cancelled'; end if;

  select coalesce(is_unlimited, false) into v_unlimited from public.user_credits where id = v_credit;
  v_unlimited := coalesce(v_unlimited, false);
  v_minutes := extract(epoch from (v_starts - now())) / 60;
  v_late_window := public.studio_setting_num('late_cancel_window_minutes', 120);
  v_loss_window := public.studio_setting_num('credit_loss_window_minutes', 60);
  v_waive := v_staff and coalesce(p_waive_late_fee, false);

  if v_minutes <= v_late_window and not v_waive then
    v_late := true;
    if v_unlimited then
      -- Membership: late fee, no booking until it is paid.
      v_fee := public.studio_setting_num('late_cancel_fee_zar', 100);
      v_block := true;
    elsif v_minutes > v_loss_window then
      -- Credit pack, between the two windows: late fee; credit held until paid in time.
      v_fee := public.studio_setting_num('late_cancel_fee_zar', 100);
      v_held := v_credit is not null;
    else
      -- Credit pack, inside the last window: credit lost, no fee.
      v_lost := true;
    end if;
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = case when v_staff then coalesce(p_reason, 'customer_cancelled') else 'customer_cancelled' end,
      late_cancel = v_late
  where id = p_booking_id;

  if v_fee > 0 then
    insert into public.member_fees (profile_id, booking_id, credit_id, kind, amount_zar, credit_held, blocks_booking, due_by)
    values (v_profile, p_booking_id, case when v_held then v_credit end, 'late_cancel', v_fee, v_held, v_block,
            case when v_held then now() + make_interval(hours => public.studio_setting_num('late_fee_pay_hours', 24)::int) end);
  end if;

  return jsonb_build_object(
    'late_cancel', v_late, 'late_fee_applied', v_fee > 0, 'fee_zar', v_fee,
    'credit_held', v_held, 'credit_lost', v_lost, 'booking_blocked', v_block);
end $$;
grant execute on function public.cancel_my_booking(uuid, text, boolean) to authenticated;

-- 4. Staff waive a fee: a held credit comes back.
create or replace function public.waive_member_fee(p_fee_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if not public.has_any_role(array['director', 'management', 'front_desk']) then
    raise exception 'Only Director, Management or Front desk can waive fees';
  end if;
  select * into f from public.member_fees where id = p_fee_id for update;
  if not found or f.status <> 'unpaid' then raise exception 'This fee is not outstanding'; end if;
  update public.member_fees set status = 'waived', waived_by = auth.uid() where id = p_fee_id;
  if f.credit_held and f.credit_id is not null then
    update public.user_credits set credits_remaining = credits_remaining + 1
    where id = f.credit_id and is_unlimited = false;
  end if;
end $$;
grant execute on function public.waive_member_fee(uuid) to authenticated;

-- 5. Paying fees (called by the payment webhook): marks them paid and returns held credits.
create or replace function public.settle_member_fees(p_profile_id uuid, p_payment_id text, p_fee_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare f record; n integer := 0;
begin
  for f in select * from public.member_fees
           where profile_id = p_profile_id and status = 'unpaid'
             and (p_fee_ids is null or id = any (p_fee_ids))
           for update loop
    update public.member_fees set status = 'paid', paid_at = now(), yoco_payment_id = p_payment_id where id = f.id;
    if f.credit_held and f.credit_id is not null then
      update public.user_credits set credits_remaining = credits_remaining + 1
      where id = f.credit_id and is_unlimited = false;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.settle_member_fees(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.settle_member_fees(uuid, text, uuid[]) to service_role;

-- 6. Hourly: credit pack fees not paid in time expire (credit stays lost); no-shows get processed.
create or replace function public.process_member_fees()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_expired integer; v_noshows integer := 0; b record; v_fee numeric;
begin
  update public.member_fees set status = 'expired'
  where status = 'unpaid' and credit_held and due_by is not null and due_by < now();
  get diagnostics v_expired = row_count;

  v_fee := public.studio_setting_num('no_show_fee_zar', 200);
  for b in
    select bk.id, bk.profile_id, bk.credit_id, coalesce(uc.is_unlimited, false) as unlimited
    from public.bookings bk
    join public.classes c on c.id = bk.class_id
    left join public.user_credits uc on uc.id = bk.credit_id
    where bk.status::text = 'confirmed'
      and not coalesce(bk.checked_in, false)
      and bk.no_show_checked_at is null
      and not coalesce(c.is_cancelled, false)
      and coalesce(c.ends_at, c.starts_at + interval '1 hour') < now()
      and c.starts_at > now() - interval '7 days'
    for update of bk
  loop
    update public.bookings set no_show = true, no_show_checked_at = now() where id = b.id;
    -- Credit packs and drop-ins: the credit was used at booking, so it is simply lost.
    -- Memberships: no-show fee, no booking until it is paid.
    if b.unlimited and v_fee > 0 then
      insert into public.member_fees (profile_id, booking_id, kind, amount_zar, blocks_booking)
      values (b.profile_id, b.id, 'no_show', v_fee, true);
    end if;
    v_noshows := v_noshows + 1;
  end loop;

  return jsonb_build_object('expired', v_expired, 'no_shows', v_noshows);
end $$;
revoke all on function public.process_member_fees() from public, anon, authenticated;

-- Older bookings are not charged retroactively: mark everything already finished as checked.
update public.bookings bk set no_show_checked_at = now()
from public.classes c
where c.id = bk.class_id and bk.no_show_checked_at is null
  and coalesce(c.ends_at, c.starts_at + interval '1 hour') < now();

create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'process-member-fees';
select cron.schedule('process-member-fees', '5 * * * *', $cron$ select public.process_member_fees(); $cron$);

-- 7. Booking: unpaid membership fees block booking; classes open N days ahead.
create or replace function public.guard_booking_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_starts timestamptz; v_days numeric;
begin
  if auth.uid() is null then return new; end if;
  if public.has_any_role(array['director']) then return new; end if;
  -- Staff booking a member in skip the window, but not the fee block.
  if exists (select 1 from public.member_fees
             where profile_id = new.profile_id and status = 'unpaid' and blocks_booking) then
    raise exception 'There is an unpaid fee on this account. Please pay it before booking.';
  end if;
  if new.profile_id = auth.uid() then
    select starts_at into v_starts from public.classes where id = new.class_id;
    v_days := public.studio_setting_num('booking_open_days_ahead', 30);
    if v_starts > now() + make_interval(days => v_days::int) then
      raise exception 'Classes open for booking % days ahead.', v_days::int;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_booking_rules on public.bookings;
create trigger trg_guard_booking_rules before insert on public.bookings
  for each row execute function public.guard_booking_rules();

-- 8. The old single "fee pending" flag is replaced by member_fees.
update public.profiles set late_cancel_fee_pending = false where late_cancel_fee_pending;

select key, value from public.studio_settings
where key in ('late_cancel_fee_zar', 'no_show_fee_zar', 'late_cancel_window_minutes', 'credit_loss_window_minutes', 'late_fee_pay_hours', 'booking_open_days_ahead')
order by key;
