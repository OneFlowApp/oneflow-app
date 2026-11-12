-- Studios, step 1: the app learns there is more than one studio.
-- Nothing changes for Longkloof today: every existing class and pack is tagged Longkloof.
--
--   studios          one row per location (details, payment account, live or not)
--   classes.studio_id    which studio a class runs at
--   products.studio_id   which studio sells the pack (whose bank account is paid)
--   product_studios      where a pack can be used (Longkloof, Green Point, or both)
--   staff_studios        which studios a staff member works at
-- A booking with a pack credit is refused if the pack can't be used at that class's studio.
-- Members, history, Flow Points, tiers and badges stay per person, across all studios.

create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  address text,
  phone text,
  whatsapp text,
  email text,
  report_email text,
  is_live boolean not null default false,
  live_from date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.studios.code is
  'Short code. The studio''s Yoco keys live in Supabase secrets as YOCO_SECRET_KEY_<CODE> and YOCO_WEBHOOK_SECRET_<CODE>.';

drop trigger if exists studios_touch_updated_at on public.studios;
create trigger studios_touch_updated_at before update on public.studios
  for each row execute function public.touch_updated_at();

alter table public.studios enable row level security;

drop policy if exists studios_read on public.studios;
create policy studios_read on public.studios for select to anon, authenticated using (true);

drop policy if exists studios_director_write on public.studios;
create policy studios_director_write on public.studios for all to authenticated
  using (public.has_any_role(array['director']))
  with check (public.has_any_role(array['director']));

insert into public.studios (code, name, is_live, sort_order, report_email)
values ('longkloof', 'Longkloof', true, 1, 'deeds@oneflow.co.za'),
       ('green_point', 'Green Point', false, 2, 'deeds@oneflow.co.za')
on conflict (code) do nothing;

create or replace function public.default_studio_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from public.studios where code = 'longkloof';
$$;

-- Classes belong to a studio.
alter table public.classes add column if not exists studio_id uuid references public.studios(id);
update public.classes set studio_id = public.default_studio_id() where studio_id is null;
alter table public.classes alter column studio_id set default public.default_studio_id();
alter table public.classes alter column studio_id set not null;
create index if not exists classes_studio_starts_idx on public.classes (studio_id, starts_at);

-- Packs: who sells them, and where they can be used.
alter table public.products add column if not exists studio_id uuid references public.studios(id);
update public.products set studio_id = public.default_studio_id() where studio_id is null;
alter table public.products alter column studio_id set default public.default_studio_id();
alter table public.products alter column studio_id set not null;

create table if not exists public.product_studios (
  product_id uuid not null references public.products(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  primary key (product_id, studio_id)
);

alter table public.product_studios enable row level security;

drop policy if exists product_studios_read on public.product_studios;
create policy product_studios_read on public.product_studios for select to anon, authenticated using (true);

drop policy if exists product_studios_write on public.product_studios;
create policy product_studios_write on public.product_studios for all to authenticated
  using (public.has_any_role(array['director', 'management']))
  with check (public.has_any_role(array['director', 'management']));

-- Every existing pack works at Longkloof; "Access to: Longkloof & Green Point" packs also at Green Point.
insert into public.product_studios (product_id, studio_id)
select p.id, public.default_studio_id() from public.products p
on conflict do nothing;

insert into public.product_studios (product_id, studio_id)
select p.id, s.id
from public.products p, public.studios s
where s.code = 'green_point' and p.access_scope::text = 'open_access'
on conflict do nothing;

-- New packs work at the studio that sells them, until changed in Products.
create or replace function public.product_default_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.product_studios (product_id, studio_id)
  values (new.id, coalesce(new.studio_id, public.default_studio_id()))
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists product_default_studio on public.products;
create trigger product_default_studio after insert on public.products
  for each row execute function public.product_default_studio();

-- Staff work at one or more studios. Director and Management see every studio.
create table if not exists public.staff_studios (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  primary key (profile_id, studio_id)
);

alter table public.staff_studios enable row level security;

drop policy if exists staff_studios_read on public.staff_studios;
create policy staff_studios_read on public.staff_studios for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['director', 'management', 'front_desk']));

drop policy if exists staff_studios_write on public.staff_studios;
create policy staff_studios_write on public.staff_studios for all to authenticated
  using (public.has_any_role(array['director', 'management']))
  with check (public.has_any_role(array['director', 'management']));

insert into public.staff_studios (profile_id, studio_id)
select p.id, public.default_studio_id()
from public.profiles p
where public.is_staff_profile(p.id)
on conflict do nothing;

-- Can this pack credit be used at this studio? (An upgraded credit works everywhere.)
create or replace function public.credit_usable_at_studio(p_credit_id uuid, p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.user_credits c
    where c.id = p_credit_id
      and (
        c.access_scope::text = 'open_access'
        or c.product_id is null
        or exists (select 1 from public.product_studios ps
                   where ps.product_id = c.product_id and ps.studio_id = p_studio_id)
      )
  );
$$;

-- The studios a member's active packs can be used at (for the Customers list and profile).
create or replace function public.member_studio_access(p_profile_id uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct s.name order by s.name), '{}')
  from public.user_credits c
  join public.studios s on (
    c.access_scope::text = 'open_access'
    or exists (select 1 from public.product_studios ps where ps.product_id = c.product_id and ps.studio_id = s.id)
  )
  where c.profile_id = p_profile_id
    and c.refunded_at is null
    and (c.expires_at is null or c.expires_at > now())
    and (coalesce(c.is_unlimited, false) or coalesce(c.credits_remaining, 0) > 0)
    and (p_profile_id = auth.uid() or public.has_any_role(array['director', 'management', 'front_desk', 'marketing']));
$$;

-- Members with an active pack that works at more than one studio.
create or replace function public.multi_studio_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.profile_id
  from public.user_credits c
  join public.studios s on (
    c.access_scope::text = 'open_access'
    or exists (select 1 from public.product_studios ps where ps.product_id = c.product_id and ps.studio_id = s.id)
  )
  where public.has_any_role(array['director', 'management', 'front_desk', 'marketing'])
    and c.refunded_at is null
    and (c.expires_at is null or c.expires_at > now())
    and (coalesce(c.is_unlimited, false) or coalesce(c.credits_remaining, 0) > 0)
  group by c.profile_id
  having count(distinct s.id) > 1;
$$;

revoke all on function public.member_studio_access(uuid) from public, anon;
revoke all on function public.multi_studio_member_ids() from public, anon;
grant execute on function public.member_studio_access(uuid) to authenticated;
grant execute on function public.multi_studio_member_ids() to authenticated;

-- A pack credit can only book classes at a studio the pack covers.
create or replace function public.enforce_credit_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_studio uuid;
  v_name text;
begin
  if new.credit_id is null then return new; end if;
  select c.studio_id, s.name into v_studio, v_name
  from public.classes c join public.studios s on s.id = c.studio_id
  where c.id = new.class_id;
  if v_studio is not null and not public.credit_usable_at_studio(new.credit_id, v_studio) then
    raise exception 'This pack can''t be used at %. Choose another pack or upgrade for access to both studios.', v_name;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_enforce_credit_studio on public.bookings;
create trigger zz_enforce_credit_studio before insert on public.bookings
  for each row execute function public.enforce_credit_studio();

-- Check
select s.name as studio, s.is_live,
       (select count(*) from public.classes c where c.studio_id = s.id) as classes,
       (select count(*) from public.product_studios ps where ps.studio_id = s.id) as packs_usable_here,
       (select count(*) from public.staff_studios ss where ss.studio_id = s.id) as staff
from public.studios s order by s.sort_order;
