-- Membership perks: an optional web link and an optional discount code for online use.
alter table public.membership_perks add column if not exists link_url text;
alter table public.membership_perks add column if not exists discount_code text;
alter table public.membership_perks drop constraint if exists membership_perks_link_url_https;
alter table public.membership_perks add constraint membership_perks_link_url_https
  check (link_url is null or link_url ~* '^https://');

select title, link_url, discount_code from public.membership_perks order by sort_order;
