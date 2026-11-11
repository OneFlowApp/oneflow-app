-- The studio WhatsApp number is set in Admin → Settings ("WhatsApp number") and used by
-- every WhatsApp button in the app, including on the sign in page before members log in.
create or replace function public.studio_whatsapp_number()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select nullif(trim(value), '') from public.studio_settings where key = 'studio_whatsapp' limit 1;
$$;

revoke all on function public.studio_whatsapp_number() from public;
grant execute on function public.studio_whatsapp_number() to anon, authenticated;

-- Shows what's saved now (empty means the app uses +27 82 553 3033).
select public.studio_whatsapp_number() as whatsapp_number_saved;
