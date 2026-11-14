-- Upgrade a member's existing pack to "Access to: Longkloof & Green Point" from the dashboard,
-- recording where it was paid (De Waterkant, Longkloof desk, or no charge) and how much.
create table if not exists public.credit_access_upgrades (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  credit_id uuid not null references public.user_credits(id) on delete cascade,
  product_name text,
  paid_where text not null check (paid_where in ('green_point', 'studio', 'none')),
  amount_zar numeric not null default 0,
  reference text,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.credit_access_upgrades enable row level security;

drop policy if exists credit_access_upgrades_read on public.credit_access_upgrades;
create policy credit_access_upgrades_read on public.credit_access_upgrades for select to authenticated
  using (profile_id = auth.uid() or public.has_any_role(array['director', 'management', 'front_desk']));

create or replace function public.upgrade_credit_access(
  p_credit_id uuid, p_paid_where text, p_amount_zar numeric, p_reference text
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.user_credits;
  v_rows int;
begin
  if not public.has_any_role(array['director', 'management', 'front_desk']) then
    raise exception 'Only Director, Management and front desk can upgrade a pack';
  end if;
  if p_paid_where not in ('green_point', 'studio', 'none') then
    raise exception 'Choose where it was paid';
  end if;
  if p_paid_where <> 'none' and coalesce(p_amount_zar, 0) <= 0 then
    raise exception 'Enter the amount paid';
  end if;
  select * into c from public.user_credits where id = p_credit_id;
  if c.id is null then raise exception 'Pack not found'; end if;

  -- The whole purchase (all parts of a multi-part pack) gets both-studio access.
  update public.user_credits u
     set access_scope = 'open_access'
   where u.profile_id = c.profile_id
     and coalesce(u.product_id::text, '') = coalesce(c.product_id::text, '')
     and coalesce(nullif(u.yoco_payment_id, ''), u.id::text) = coalesce(nullif(c.yoco_payment_id, ''), c.id::text)
     and (coalesce(u.yoco_payment_id, '') not like 'manual%' or u.purchased_at is not distinct from c.purchased_at)
     and (u.expires_at is null or u.expires_at > now());
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    update public.user_credits set access_scope = 'open_access' where id = c.id;
    v_rows := 1;
  end if;

  insert into public.credit_access_upgrades (profile_id, credit_id, product_name, paid_where, amount_zar, reference, created_by)
  values (c.profile_id, c.id, c.product_name, p_paid_where,
          case when p_paid_where = 'none' then 0 else p_amount_zar end,
          nullif(trim(coalesce(p_reference, '')), ''), auth.uid());
  return v_rows;
end;
$$;

revoke all on function public.upgrade_credit_access(uuid, text, numeric, text) from public, anon;
grant execute on function public.upgrade_credit_access(uuid, text, numeric, text) to authenticated;
