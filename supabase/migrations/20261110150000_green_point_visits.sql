-- Green Point (Mindbody) has no link to the app. Members with "Access to: Longkloof & Green Point"
-- show their card at Green Point and the front desk ticks off a session here.
create table if not exists public.green_point_visits (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.user_credits(id) on delete cascade,
  profile_id uuid not null,
  used_by uuid,
  used_at timestamptz not null default now(),
  note text
);
create index if not exists green_point_visits_profile_idx on public.green_point_visits (profile_id, used_at desc);

alter table public.green_point_visits enable row level security;

drop policy if exists green_point_visits_select on public.green_point_visits;
create policy green_point_visits_select on public.green_point_visits
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.has_any_role(array['director','management','marketing','front_desk','guide','boh','team'])
  );
-- No insert/update/delete policies: visits are only written by the function below.

grant select on public.green_point_visits to authenticated;

-- Balances a member may use at Green Point (active, Longkloof & Green Point), for the front desk.
create or replace function public.green_point_balances(p_profile_id uuid)
returns table (credit_id uuid, pack text, is_unlimited boolean, credits_total integer,
               credits_remaining integer, expires_at timestamptz, visits_used integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_any_role(array['director','management','front_desk','guide','boh','team']) then
    raise exception 'Only studio staff can do this';
  end if;
  return query
  select c.id, coalesce(c.product_name, 'Pack'), coalesce(c.is_unlimited, false),
         c.credits_total, c.credits_remaining, c.expires_at,
         (select count(*)::int from public.green_point_visits v where v.credit_id = c.id)
  from public.user_credits c
  where c.profile_id = p_profile_id
    and c.access_scope = 'open_access'
    and c.refunded_at is null
    and (c.expires_at is null or c.expires_at > now())
    and (coalesce(c.is_unlimited, false) or coalesce(c.credits_remaining, 0) > 0)
    and coalesce(c.category, '') not in ('cafe', 'mat_towel')
  order by c.expires_at nulls last;
end;
$$;

-- Tick off one session at Green Point: takes one credit (none for unlimited) and logs the visit.
create or replace function public.use_credit_at_green_point(p_credit_id uuid, p_note text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.has_any_role(array['director','management','front_desk','guide','boh','team']) then
    raise exception 'Only studio staff can do this';
  end if;
  select * into c from public.user_credits where id = p_credit_id for update;
  if not found then raise exception 'Pack not found'; end if;
  if c.access_scope is distinct from 'open_access' then
    raise exception 'This pack is for Longkloof only';
  end if;
  if c.refunded_at is not null or (c.expires_at is not null and c.expires_at <= now()) then
    raise exception 'This pack has expired';
  end if;
  if not coalesce(c.is_unlimited, false) then
    if coalesce(c.credits_remaining, 0) <= 0 then raise exception 'No credits left on this pack'; end if;
    update public.user_credits set credits_remaining = credits_remaining - 1 where id = c.id;
  end if;
  insert into public.green_point_visits (credit_id, profile_id, used_by, note)
  values (c.id, c.profile_id, auth.uid(), nullif(trim(coalesce(p_note, '')), ''));
  return case when coalesce(c.is_unlimited, false) then null else c.credits_remaining - 1 end;
end;
$$;

revoke all on function public.green_point_balances(uuid) from public, anon;
revoke all on function public.use_credit_at_green_point(uuid, text) from public, anon;
grant execute on function public.green_point_balances(uuid) to authenticated;
grant execute on function public.use_credit_at_green_point(uuid, text) to authenticated;
