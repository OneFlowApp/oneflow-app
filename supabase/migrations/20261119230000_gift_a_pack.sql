-- Gift a pack: a member buys a pack in the app and sends it to a friend.
--   The payment goes through Yoco as normal. Instead of landing on the buyer's profile, the pack is held
--   as a gift with a link. The friend opens the link, signs in or signs up, and claims it:
--   the pack lands on their profile and its validity starts from the day they claim it.
--   Unclaimed gifts can be claimed for 90 days (setting gift_pack_claim_days).

insert into public.studio_settings (key, value) values ('gift_pack_claim_days', '90')
on conflict (key) do nothing;

create table if not exists public.pack_gifts (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid() unique,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid references public.products(id),
  product_name text,
  yoco_payment_id text unique,
  amount_paid_zar numeric,
  credit_rows jsonb not null,
  recipient_name text,
  message text,
  status text not null default 'open' check (status in ('open', 'claimed', 'refunded')),
  paid_at timestamptz not null default now(),
  claim_by timestamptz,
  claimed_by uuid references public.profiles(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pack_gifts_buyer_idx on public.pack_gifts (buyer_id);

alter table public.pack_gifts enable row level security;
drop policy if exists pack_gifts_read on public.pack_gifts;
create policy pack_gifts_read on public.pack_gifts for select to authenticated
  using (buyer_id = auth.uid() or claimed_by = auth.uid()
         or public.has_any_role(array['director', 'management', 'front_desk']));

grant select on public.pack_gifts to authenticated;
grant all on public.pack_gifts to service_role;

-- The buyer's gifts (for the Gifts page).
create or replace function public.my_pack_gifts()
returns table (id uuid, token uuid, product_name text, amount_paid_zar numeric, recipient_name text,
               status text, paid_at timestamptz, claim_by timestamptz, claimed_at timestamptz, claimed_by_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select g.id, g.token, g.product_name, g.amount_paid_zar, g.recipient_name,
         case when g.status = 'open' and g.claim_by is not null and g.claim_by <= now() then 'expired' else g.status end,
         g.paid_at, g.claim_by, g.claimed_at,
         nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
  from public.pack_gifts g
  left join public.profiles p on p.id = g.claimed_by
  where g.buyer_id = auth.uid()
  order by g.paid_at desc;
$$;
revoke all on function public.my_pack_gifts() from public, anon;
grant execute on function public.my_pack_gifts() to authenticated;

-- Public: what a gift link holds (works before signing in).
create or replace function public.pack_gift_preview(p_token uuid)
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
      'pack', g.product_name,
      'message', g.message,
      'claim_by', g.claim_by,
      'state', case when g.status = 'claimed' then 'claimed'
                    when g.status <> 'open' or (g.claim_by is not null and g.claim_by <= now()) then 'expired'
                    else 'open' end)
    from public.pack_gifts g
    join public.profiles p on p.id = g.buyer_id
    where g.token = p_token), jsonb_build_object('ok', false));
$$;
grant execute on function public.pack_gift_preview(uuid) to anon, authenticated;

-- The friend claims it: the pack's parts are added to their profile, validity starting today.
create or replace function public.claim_pack_gift(p_token uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  g public.pack_gifts;
  r jsonb;
  v_row jsonb;
  v_cols text;
  v_buyer text;
  v_exp timestamptz;
begin
  if v_uid is null then raise exception 'Sign in to claim your gift'; end if;
  select * into g from public.pack_gifts where token = p_token for update;
  if g.id is null then raise exception 'This gift link isn''t valid'; end if;
  if g.buyer_id = v_uid then raise exception 'This gift is for a friend. Share the link with them'; end if;
  if g.status = 'claimed' then raise exception 'This gift has already been claimed'; end if;
  if g.status <> 'open' or (g.claim_by is not null and g.claim_by <= now()) then
    raise exception 'This gift has expired. Please contact the studio';
  end if;

  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), 'a friend')
    into v_buyer from public.profiles where id = g.buyer_id;

  for r in select value from jsonb_array_elements(g.credit_rows) loop
    v_exp := null;
    if r ? 'expires_at' and nullif(r->>'expires_at', '') is not null then
      -- Same length of validity, starting from today.
      v_exp := now() + ((r->>'expires_at')::timestamptz - g.paid_at);
    end if;
    v_row := (r - 'id' - 'created_at')
      || jsonb_build_object(
           'profile_id', v_uid,
           'purchased_at', g.paid_at,
           'payment_note', 'Gift from ' || v_buyer)
      || case when v_exp is not null then jsonb_build_object('expires_at', v_exp) else '{}'::jsonb end;
    select string_agg(quote_ident(k), ', ') into v_cols
    from jsonb_object_keys(v_row) as k
    where exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'user_credits' and c.column_name = k);
    execute format('insert into public.user_credits (%s) select %s from jsonb_populate_record(null::public.user_credits, $1)',
                   v_cols, v_cols)
      using v_row;
  end loop;

  update public.pack_gifts set status = 'claimed', claimed_by = v_uid, claimed_at = now() where id = g.id;
  return g.product_name;
end;
$$;
revoke all on function public.claim_pack_gift(uuid) from public, anon;
grant execute on function public.claim_pack_gift(uuid) to authenticated;

-- Check: the new table is there (0 gifts so far).
select count(*) as gifts from public.pack_gifts;
