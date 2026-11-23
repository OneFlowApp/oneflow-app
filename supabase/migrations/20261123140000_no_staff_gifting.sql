-- Team members (guides and all staff) can't gift passes they hold: those are staff passes or
-- bought at staff prices. Also never gift a pass whose product is a staff product by name.
-- Members are unaffected.

create or replace function public.guard_gift_my_pass()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.kind = 'transfer' then
    if public.is_staff_profile(new.buyer_id) then
      raise exception 'Team members can''t gift passes';
    end if;
    if exists (select 1 from public.products p where p.id = new.product_id and p.name ilike '%staff%') then
      raise exception 'Staff passes can''t be gifted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_guard_gift_my_pass on public.pack_gifts;
create trigger aa_guard_gift_my_pass before insert on public.pack_gifts
  for each row execute function public.guard_gift_my_pass();

-- Check (read only): passes team members have already gifted on, so you can decide what to do.
select coalesce(trim(gp.first_name || ' ' || coalesce(gp.last_name, '')), '?') as gifted_by,
       g.product_name as pass,
       g.status,
       coalesce(trim(cp.first_name || ' ' || coalesce(cp.last_name, '')), '(not claimed yet)') as claimed_by,
       to_char(g.created_at at time zone 'Africa/Johannesburg', 'DD Mon HH24:MI') as gifted_at
from public.pack_gifts g
join public.profiles gp on gp.id = g.buyer_id
left join public.profiles cp on cp.id = g.claimed_by
where g.kind = 'transfer' and public.is_staff_profile(g.buyer_id)
order by g.created_at;
