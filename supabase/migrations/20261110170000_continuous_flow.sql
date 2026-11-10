-- Continuous Flow: products ticked "Continuous Flow" keep their price only while renewed with no
-- gap of more than one day. After a longer gap, they can't be bought again for 12 months
-- (Director or Management can restore early). Renewals start when the current one ends.
alter table public.products add column if not exists is_continuous boolean not null default false;
alter table public.profiles add column if not exists continuous_flow_restored_at timestamptz;

create or replace function public.continuous_flow_status(p_profile_id uuid default null)
returns table (
  product_id uuid,
  product_name text,
  active_until timestamptz,
  eligible boolean,
  blocked_until timestamptz,
  renew_due boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_pid uuid := coalesce(p_profile_id, auth.uid());
  v_end timestamptz; v_prod uuid; v_name text; v_restored timestamptz;
begin
  if v_pid is null then return; end if;
  -- Members see only their own; staff and the app's server functions can check anyone.
  if auth.uid() is not null and v_pid <> auth.uid()
     and not public.has_any_role(array['director','management','marketing','front_desk','guide','boh','team']) then
    raise exception 'Not allowed';
  end if;

  select c.expires_at, c.product_id, p.name
    into v_end, v_prod, v_name
  from public.user_credits c
  join public.products p on p.id = c.product_id
  where c.profile_id = v_pid and p.is_continuous and c.refunded_at is null and c.expires_at is not null
  order by c.expires_at desc
  limit 1;

  select pr.continuous_flow_restored_at into v_restored from public.profiles pr where pr.id = v_pid;

  if v_end is null then
    return query select null::uuid, null::text, null::timestamptz, true, null::timestamptz, false;
    return;
  end if;

  return query select
    v_prod,
    v_name,
    v_end,
    (now() <= v_end + interval '1 day')
      or (now() >= v_end + interval '12 months')
      or (v_restored is not null and v_restored > v_end),
    case when now() > v_end + interval '1 day'
              and now() < v_end + interval '12 months'
              and not (v_restored is not null and v_restored > v_end)
         then v_end + interval '12 months' end,
    now() >= v_end - interval '1 day' and now() <= v_end + interval '1 day';
end;
$$;

-- Director / Management: give Continuous Flow back early (illness, travel and so on).
create or replace function public.restore_continuous_flow(p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_any_role(array['director','management']) then
    raise exception 'Only Director or Management can do this';
  end if;
  update public.profiles set continuous_flow_restored_at = now() where id = p_profile_id;
end;
$$;

revoke all on function public.continuous_flow_status(uuid) from public, anon;
revoke all on function public.restore_continuous_flow(uuid) from public, anon;
grant execute on function public.continuous_flow_status(uuid) to authenticated, service_role;
grant execute on function public.restore_continuous_flow(uuid) to authenticated;
