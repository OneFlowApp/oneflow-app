-- Bookings failed with "null value in column body of relation notifications": the live
-- notifications.body is NOT NULL, but the referral bonus (and some other notices) insert a
-- title only. Fill a missing body with an empty string so the notice saves and the booking
-- goes through. Run in the SQL Editor on 7 Nov 2026.
create or replace function public.notifications_fill_body()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.body is null then
    new.body := '';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_fill_body on public.notifications;
create trigger notifications_fill_body
  before insert or update on public.notifications
  for each row execute function public.notifications_fill_body();
