-- Fix: member bookings failed with 'invalid input value for enum payment_method: ""'.
-- The no-pass rule compared the payment type (a fixed list in the database) with empty text. Compare as text.
create or replace function public.enforce_booking_has_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null
     or public.has_any_role(array['director','management','front_desk','guide','boh','team','marketing']) then
    return new;
  end if;
  if new.status::text in ('confirmed', 'attended')
     and new.credit_id is null
     and coalesce(new.payment_method::text, '') not in ('free', 'flow_points') then
    raise exception 'Please choose a pass to book this class';
  end if;
  return new;
end;
$$;
