-- Every guide is also tagged as a customer, so they can be found in Walk-in and booked into classes.
-- 1) Tag all current guides.  2) New guides get tagged automatically.
-- Guides still get no Flow Points or rewards (that block checks the guide role, not this tag).

create or replace function public.guide_also_customer()
returns trigger
language plpgsql
as $$
begin
  if (new.role::text = 'guide' or 'guide' = any(coalesce(new.secondary_roles, '{}')))
     and new.role::text <> 'customer'
     and not ('customer' = any(coalesce(new.secondary_roles, '{}'))) then
    new.secondary_roles := array_append(coalesce(new.secondary_roles, '{}'), 'customer');
  end if;
  return new;
end;
$$;

drop trigger if exists aa_guide_also_customer on public.profiles;
create trigger aa_guide_also_customer
  before insert or update of role, secondary_roles on public.profiles
  for each row execute function public.guide_also_customer();

-- A profile linked in Guides (active) counts as a guide too.
create or replace function public.guides_row_tag_customer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.is_active, true) and new.profile_id is not null then
    update public.profiles
       set secondary_roles = array_append(coalesce(secondary_roles, '{}'), 'customer')
     where id = new.profile_id
       and role::text <> 'customer'
       and not ('customer' = any(coalesce(secondary_roles, '{}')));
  end if;
  return new;
end;
$$;

drop trigger if exists guides_tag_customer on public.guides;
create trigger guides_tag_customer
  after insert or update of profile_id, is_active on public.guides
  for each row execute function public.guides_row_tag_customer();

-- Tag everyone who is a guide today.
with tagged as (
  update public.profiles p
     set secondary_roles = array_append(coalesce(p.secondary_roles, '{}'), 'customer')
   where (p.role::text = 'guide'
          or 'guide' = any(coalesce(p.secondary_roles, '{}'))
          or p.id in (select g.profile_id from public.guides g where coalesce(g.is_active, true)))
     and p.role::text <> 'customer'
     and not ('customer' = any(coalesce(p.secondary_roles, '{}')))
  returning p.first_name, p.last_name
)
select first_name || ' ' || coalesce(last_name, '') as guide_now_also_customer
from tagged order by 1;
