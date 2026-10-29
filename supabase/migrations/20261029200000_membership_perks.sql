-- Membership perks (edited in Admin -> Settings) and "am I a member?" for the digital membership card.
create table if not exists public.membership_perks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.membership_perks enable row level security;
drop policy if exists membership_perks_read on public.membership_perks;
create policy membership_perks_read on public.membership_perks for select to authenticated using (true);
drop policy if exists membership_perks_staff_write on public.membership_perks;
create policy membership_perks_staff_write on public.membership_perks for all to authenticated
  using (public.has_any_role(array['director', 'management', 'marketing']))
  with check (public.has_any_role(array['director', 'management', 'marketing']));
grant select, insert, update, delete on public.membership_perks to authenticated;
grant all on public.membership_perks to service_role;

insert into public.membership_perks (title, description, sort_order)
select '10% off Famke items', 'Show your membership card at the counter.', 10
where not exists (select 1 from public.membership_perks);

-- A member holds a valid paid package: not expired, not refunded, sessions left or unlimited,
-- not free and not a staff pack. Same rule as the member price at checkout.
create or replace function public.my_membership()
returns table (is_member boolean, valid_until timestamptz, pack_names text[])
language sql stable security definer set search_path = public as $$
  with active as (
    select c.expires_at, coalesce(p.name, c.product_name) as pack
    from public.user_credits c
    join public.products p on p.id = c.product_id
    where c.profile_id = auth.uid()
      and c.refunded_at is null
      and coalesce(c.entry_type, '') <> 'free'
      and (c.expires_at is null or c.expires_at > now())
      and (coalesce(c.is_unlimited, false) or coalesce(c.credits_remaining, 0) > 0)
      and coalesce(p.price_zar, 0) > 0
      and not coalesce(p.is_staff_only, false)
      and p.name not ilike '%staff%'
  )
  select count(*) > 0,
         max(expires_at),
         coalesce(array_agg(distinct pack) filter (where pack is not null), '{}')
  from active;
$$;
grant execute on function public.my_membership() to authenticated;

select title from public.membership_perks order by sort_order;
