-- Complimentary Wellzone on Mat and Reformer classes.
--   Master: switch "+ Wellzone" on for a class. When a member is checked in to that class, they get one
--   free Wellzone session, usable only for a Wellzone session straight after the class: starting from
--   15 minutes before the class ends until 60 minutes after it ends (comp_wellzone_window_minutes).
--   Staff don't get it (same as other rewards). Undoing the check-in takes it back if it hasn't been used.
--   The Wellzone booked with it counts as a free class (no Flow Points).

alter table public.classes add column if not exists comp_wellzone boolean not null default false;

insert into public.studio_settings (key, value) values ('comp_wellzone_window_minutes', '60')
on conflict (key) do nothing;

-- Hidden product the free session hangs off (not on sale).
do $$
begin
  if not exists (select 1 from public.products where name = 'Complimentary Wellzone') then
    insert into public.products (name, description, category, price_zar, credit_count, validity_days,
                                 allowed_class_types, is_active, is_staff_only, is_addon, sort_order)
    values ('Complimentary Wellzone', 'Free Wellzone straight after a class', 'wellzone', 0, 1, 1,
            array['wellzone']::class_type[], false, false, false, 999);
  end if;
end $$;

create table if not exists public.comp_wellzone_grants (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  credit_id uuid not null references public.user_credits(id) on delete cascade,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.comp_wellzone_grants enable row level security;
drop policy if exists comp_wellzone_grants_read on public.comp_wellzone_grants;
create policy comp_wellzone_grants_read on public.comp_wellzone_grants for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['director','management','front_desk','guide','boh','team']));
grant select on public.comp_wellzone_grants to authenticated;
grant all on public.comp_wellzone_grants to service_role;

-- Check-in on a "+ Wellzone" class: give the free session. Undo the check-in: take it back if unused.
create or replace function public.grant_comp_wellzone()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_prod uuid;
  v_window int := coalesce(nullif((select value from public.studio_settings where key = 'comp_wellzone_window_minutes'), '')::int, 60);
  v_end timestamptz;
  v_credit uuid;
  g public.comp_wellzone_grants;
begin
  if new.status::text = 'attended' and (tg_op = 'INSERT' or old.status::text is distinct from 'attended') then
    select id, starts_at, ends_at, comp_wellzone into c from public.classes where id = new.class_id;
    if not coalesce(c.comp_wellzone, false) then return new; end if;
    if public.is_staff_profile(new.profile_id) then return new; end if;
    if exists (select 1 from public.comp_wellzone_grants where booking_id = new.id) then return new; end if;
    v_end := coalesce(c.ends_at, c.starts_at + interval '60 minutes');
    select id into v_prod from public.products where name = 'Complimentary Wellzone' limit 1;
    insert into public.user_credits (profile_id, product_id, product_name, category, allowed_class_types,
                                     credits_total, credits_remaining, is_unlimited, expires_at,
                                     yoco_payment_id, access_scope)
    values (new.profile_id, v_prod, 'Complimentary Wellzone', 'wellzone', array['wellzone']::class_type[],
            1, 1, false, v_end + make_interval(mins => v_window), 'comp_wellzone', 'longkloof')
    returning id into v_credit;
    insert into public.comp_wellzone_grants (booking_id, profile_id, class_id, credit_id, valid_from, valid_until)
    values (new.id, new.profile_id, new.class_id, v_credit,
            v_end - interval '15 minutes', v_end + make_interval(mins => v_window));
  elsif tg_op = 'UPDATE' and old.status::text = 'attended' and new.status::text is distinct from 'attended' then
    select * into g from public.comp_wellzone_grants where booking_id = new.id;
    if g.booking_id is not null
       and not exists (select 1 from public.bookings b where b.credit_id = g.credit_id and b.status::text <> 'cancelled') then
      delete from public.user_credits where id = g.credit_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_grant_comp_wellzone on public.bookings;
create trigger zz_grant_comp_wellzone after insert or update of status on public.bookings
  for each row execute function public.grant_comp_wellzone();

-- The free session only books a Wellzone straight after the class, and counts as a free class.
create or replace function public.enforce_comp_wellzone_window()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.comp_wellzone_grants;
  v_start timestamptz;
begin
  if new.credit_id is null then return new; end if;
  select * into g from public.comp_wellzone_grants where credit_id = new.credit_id;
  if g.credit_id is null then return new; end if;
  select starts_at into v_start from public.classes where id = new.class_id;
  if v_start < g.valid_from or v_start > g.valid_until then
    raise exception 'Your complimentary Wellzone is for a session straight after your class (by %)',
      to_char(g.valid_until at time zone 'Africa/Johannesburg', 'HH24:MI');
  end if;
  new.payment_method := 'free';
  return new;
end;
$$;

drop trigger if exists ab_enforce_comp_wellzone_window on public.bookings;
create trigger ab_enforce_comp_wellzone_window before insert on public.bookings
  for each row execute function public.enforce_comp_wellzone_window();

-- Check: the new class switch and the hidden product.
select (select count(*) from information_schema.columns where table_name = 'classes' and column_name = 'comp_wellzone') as switch_ready,
       (select count(*) from public.products where name = 'Complimentary Wellzone') as product_ready;
