-- Gift a pass you already have to a friend (Me → Passes → "Gift to a friend").
--   Only passes that haven't been used at all: unused packages and drop-ins.
--   Must have been paid for (online or at a desk with an amount). Not Continuous Flow, comps, staff or free passes.
--   No classes booked on it, not paused, no Green Point visits on it.
--   The friend gets it with the SAME end date. Until they claim it, it's off the giver's profile;
--   the giver can take it back any time before it's claimed.
--   The original purchase stays in Transactions (once claimed, it shows under the friend).

alter table public.pack_gifts add column if not exists kind text not null default 'purchase'
  check (kind in ('purchase', 'transfer'));
alter table public.pack_gifts add column if not exists credit_ids uuid[];
alter table public.pack_gifts drop constraint if exists pack_gifts_status_check;
alter table public.pack_gifts add constraint pack_gifts_status_check
  check (status in ('open', 'claimed', 'refunded', 'cancelled'));

create or replace function public.gift_my_pass(p_credit_id uuid, p_recipient text default null, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  c public.user_credits;
  v_ids uuid[];
  v_rows jsonb;
  v_end timestamptz;
  v_bad int;
  v_token uuid;
  v_name text;
begin
  select * into c from public.user_credits where id = p_credit_id;
  if c.id is null or c.profile_id is distinct from v_uid then raise exception 'Pass not found'; end if;

  select array_agg(x) into v_ids from public._purchase_credit_ids(c.id) as x;

  -- Every part must be unused, paid for, active and giftable.
  select count(*) into v_bad
  from public.user_credits u
  left join public.products p on p.id = u.product_id
  where u.id = any(v_ids)
    and (u.refunded_at is not null
         or (u.expires_at is not null and u.expires_at <= now())
         or (not coalesce(u.is_unlimited, false) and coalesce(u.credits_remaining, 0) < coalesce(u.credits_total, 0))
         or coalesce(p.is_continuous, false)
         or coalesce(p.is_staff_only, false)
         or coalesce(p.price_zar, 0) <= 0
         or coalesce(u.entry_type, '') = 'free');
  -- The purchase must have been paid for: online, or at a desk with an amount.
  if not exists (
    select 1 from public.user_credits u
    where u.id = any(v_ids)
      and ((coalesce(u.yoco_payment_id, '') <> ''
            and u.yoco_payment_id not in ('yoco_checkout', 'manual_assignment', 'free_intro', 'manual_component',
                                          'manual_green_point', 'manual_studio', 'gameboard_gift'))
           or coalesce(u.amount_paid_zar, 0) > 0)) then
    v_bad := v_bad + 1;
  end if;
  if v_bad > 0 then
    raise exception 'Only unused, paid passes can be gifted (not part-used, Continuous Flow, comps or free passes)';
  end if;

  if exists (select 1 from public.bookings b where b.credit_id = any(v_ids) and b.status::text <> 'cancelled') then
    raise exception 'This pass has classes booked on it. Cancel them first, then gift it';
  end if;
  if exists (select 1 from public.green_point_visits v where v.credit_id = any(v_ids)) then
    raise exception 'This pass has been used at Green Point, so it can''t be gifted';
  end if;
  if exists (select 1 from public.credit_pauses x where x.purchase_key = public._purchase_key(c) and x.status = 'active') then
    raise exception 'A paused pass can''t be gifted';
  end if;

  select min(u.expires_at), jsonb_agg(jsonb_build_object('id', u.id, 'expires_at', u.expires_at))
    into v_end, v_rows
  from public.user_credits u where u.id = any(v_ids);
  if v_end is null then v_end := now() + interval '90 days'; end if;

  select coalesce(p.name, c.product_name, 'Pass') into v_name from public.products p where p.id = c.product_id;

  insert into public.pack_gifts (kind, buyer_id, product_id, product_name, credit_ids, credit_rows,
                                 recipient_name, message, paid_at, claim_by)
  values ('transfer', v_uid, c.product_id, coalesce(v_name, c.product_name, 'Pass'), v_ids, v_rows,
          nullif(trim(coalesce(p_recipient, '')), ''), nullif(trim(coalesce(p_message, '')), ''),
          coalesce(c.purchased_at, c.created_at, now()), v_end)
  returning token into v_token;

  -- Off the giver's profile until it's claimed (or taken back): ended for now, real end date kept on the gift.
  update public.user_credits set expires_at = now() - interval '1 second' where id = any(v_ids);

  return v_token;
end;
$$;
revoke all on function public.gift_my_pass(uuid, text, text) from public, anon;
grant execute on function public.gift_my_pass(uuid, text, text) to authenticated;

-- Take a gifted pass back before the friend claims it.
create or replace function public.cancel_pass_gift(p_gift_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g public.pack_gifts;
  r jsonb;
begin
  select * into g from public.pack_gifts where id = p_gift_id for update;
  if g.id is null or g.buyer_id is distinct from auth.uid() or g.kind <> 'transfer' then
    raise exception 'Gift not found';
  end if;
  if g.status <> 'open' then raise exception 'This gift has already been claimed'; end if;
  for r in select value from jsonb_array_elements(g.credit_rows) loop
    update public.user_credits set expires_at = nullif(r->>'expires_at', '')::timestamptz
     where id = (r->>'id')::uuid and profile_id = g.buyer_id;
  end loop;
  update public.pack_gifts set status = 'cancelled' where id = g.id;
end;
$$;
revoke all on function public.cancel_pass_gift(uuid) from public, anon;
grant execute on function public.cancel_pass_gift(uuid) to authenticated;

-- Claim: a bought gift adds a new pass; a gifted pass moves over with its original end date.
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

  if g.kind = 'transfer' then
    for r in select value from jsonb_array_elements(g.credit_rows) loop
      update public.user_credits
         set profile_id = v_uid,
             expires_at = nullif(r->>'expires_at', '')::timestamptz,
             payment_note = trim(coalesce(payment_note, '') || ' Gift from ' || v_buyer)
       where id = (r->>'id')::uuid and profile_id = g.buyer_id;
    end loop;
  else
    for r in select value from jsonb_array_elements(g.credit_rows) loop
      v_exp := null;
      if r ? 'expires_at' and nullif(r->>'expires_at', '') is not null then
        v_exp := now() + ((r->>'expires_at')::timestamptz - g.paid_at);
      end if;
      v_row := (r - 'id' - 'created_at')
        || jsonb_build_object('profile_id', v_uid, 'purchased_at', g.paid_at, 'payment_note', 'Gift from ' || v_buyer)
        || case when v_exp is not null then jsonb_build_object('expires_at', v_exp) else '{}'::jsonb end;
      select string_agg(quote_ident(k), ', ') into v_cols
      from jsonb_object_keys(v_row) as k
      where exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'user_credits' and c.column_name = k);
      execute format('insert into public.user_credits (%s) select %s from jsonb_populate_record(null::public.user_credits, $1)',
                     v_cols, v_cols)
        using v_row;
    end loop;
  end if;

  update public.pack_gifts set status = 'claimed', claimed_by = v_uid, claimed_at = now() where id = g.id;
  return g.product_name;
end;
$$;

-- The buyer's gifts now say which kind they are.
drop function if exists public.my_pack_gifts();
create function public.my_pack_gifts()
returns table (id uuid, token uuid, kind text, product_name text, amount_paid_zar numeric, recipient_name text,
               status text, paid_at timestamptz, claim_by timestamptz, claimed_at timestamptz, claimed_by_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select g.id, g.token, g.kind, g.product_name, g.amount_paid_zar, g.recipient_name,
         case when g.status = 'open' and g.claim_by is not null and g.claim_by <= now() then 'expired' else g.status end,
         g.paid_at, g.claim_by, g.claimed_at,
         nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
  from public.pack_gifts g
  left join public.profiles p on p.id = g.claimed_by
  where g.buyer_id = auth.uid() and g.status <> 'cancelled'
  order by g.created_at desc;
$$;
revoke all on function public.my_pack_gifts() from public, anon;
grant execute on function public.my_pack_gifts() to authenticated;

-- Check: the gift-a-pass functions are in.
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('gift_my_pass', 'cancel_pass_gift', 'claim_pack_gift', 'my_pack_gifts')
order by 1;
