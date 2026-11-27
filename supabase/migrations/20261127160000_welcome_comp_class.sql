-- Welcome offer: everyone who finishes signing up in the app gets one free class.
--   Given once per account, the moment onboarding is completed. Staff don't get it.
--   Valid until the end date in studio_settings 'welcome_comp_until' (Johannesburg time, end of that day).
--   Sign-ups after that date get nothing; change or extend the date there.
--   Which classes it covers: the "Welcome Comp Class" product's class types (Admin → Products, hidden).

insert into public.studio_settings (key, value) values ('welcome_comp_until', '2026-12-31')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from public.products where name = 'Welcome Comp Class') then
    insert into public.products (name, description, category, price_zar, credit_count, validity_days,
                                 allowed_class_types, is_active, is_staff_only, is_addon, sort_order)
    values ('Welcome Comp Class', 'Free class for new app sign-ups (not on sale)', 'yoga', 0, 1, null,
            array['yoga', 'sculpt', 'pilates', 'power', 'beginner', 'beginner_sculpt']::class_type[],
            false, false, false, 999);
  end if;
end $$;

create or replace function public.grant_welcome_comp()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_until date;
  v_expires timestamptz;
  pr public.products;
begin
  if not coalesce(new.onboarding_complete, false) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.onboarding_complete, false) then return new; end if;
  if public.is_staff_profile(new.id) then return new; end if;

  v_until := nullif((select value from public.studio_settings where key = 'welcome_comp_until'), '')::date;
  if v_until is null then return new; end if;
  v_expires := ((v_until + 1)::timestamp at time zone 'Africa/Johannesburg') - interval '1 millisecond';
  if now() > v_expires then return new; end if;

  if exists (select 1 from public.user_credits where profile_id = new.id and yoco_payment_id = 'welcome_comp') then
    return new;
  end if;

  select * into pr from public.products where name = 'Welcome Comp Class' limit 1;
  if pr.id is null then return new; end if;

  insert into public.user_credits (profile_id, product_id, product_name, category, allowed_class_types,
                                   credits_total, credits_remaining, is_unlimited, expires_at,
                                   yoco_payment_id, mat_access, towel_access, purchased_at, access_scope)
  values (new.id, pr.id, pr.name, pr.category, pr.allowed_class_types,
          1, 1, false, v_expires,
          'welcome_comp', false, false, now(), 'longkloof');
  return new;
exception when others then
  -- Never block someone finishing sign-up because of the offer.
  raise warning 'grant_welcome_comp failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists zz_grant_welcome_comp on public.profiles;
create trigger zz_grant_welcome_comp after insert or update of onboarding_complete on public.profiles
  for each row execute function public.grant_welcome_comp();
