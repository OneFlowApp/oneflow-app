-- Unpaid walk-ins: staff can check someone in who hasn't paid yet, then mark them paid later.
-- The class booking list shows a red "Unpaid" tag until then.

alter table public.bookings add column if not exists unpaid boolean not null default false;
alter table public.bookings add column if not exists paid_at timestamptz;
alter table public.bookings add column if not exists paid_where text;
alter table public.bookings add column if not exists paid_amount_zar numeric;
alter table public.bookings add column if not exists paid_by uuid;

create index if not exists bookings_unpaid_idx on public.bookings (unpaid) where unpaid;

-- Mark a booking unpaid (used right after a walk-in check-in).
create or replace function public.set_booking_unpaid(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_any_role(array['director','management','front_desk','guide','boh','team']) then
    raise exception 'Only studio staff can do this';
  end if;
  update public.bookings
     set unpaid = true, paid_at = null, paid_where = null, paid_amount_zar = null, paid_by = null
   where id = p_booking_id;
end;
$$;

-- Mark an unpaid booking as paid: where it was paid and how much.
create or replace function public.mark_booking_paid(p_booking_id uuid, p_paid_where text, p_amount numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_any_role(array['director','management','front_desk','guide','boh','team']) then
    raise exception 'Only studio staff can do this';
  end if;
  if coalesce(trim(p_paid_where), '') = '' then
    raise exception 'Choose where it was paid';
  end if;
  update public.bookings
     set unpaid = false, paid_at = now(), paid_where = trim(p_paid_where),
         paid_amount_zar = p_amount, paid_by = auth.uid()
   where id = p_booking_id and unpaid;
end;
$$;

revoke all on function public.set_booking_unpaid(uuid) from public, anon;
grant execute on function public.set_booking_unpaid(uuid) to authenticated;
revoke all on function public.mark_booking_paid(uuid, text, numeric) from public, anon;
grant execute on function public.mark_booking_paid(uuid, text, numeric) to authenticated;

-- Check: should list the 5 new columns.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'bookings'
  and column_name in ('unpaid', 'paid_at', 'paid_where', 'paid_amount_zar', 'paid_by')
order by column_name;
