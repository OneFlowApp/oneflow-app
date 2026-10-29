-- Monthly add-ons are offered per product, not per pricing section.
-- Existing section ticks are converted to every product in those sections.
alter table public.products
  add column if not exists offer_with_product_ids uuid[] not null default '{}';

update public.products a
set offer_with_product_ids = coalesce((
  select array_agg(p.id order by p.name)
  from public.products p
  where p.pricing_section_id = any (a.offer_with_section_ids)
    and p.id <> a.id
    and coalesce(p.is_staff_only, false) = false
    and cardinality(p.offer_with_section_ids) = 0
), '{}')
where cardinality(a.offer_with_section_ids) > 0
  and cardinality(a.offer_with_product_ids) = 0;

select a.name as add_on,
       (select string_agg(p.name, ', ' order by p.name)
          from public.products p where p.id = any (a.offer_with_product_ids)) as offered_with
from public.products a
where cardinality(a.offer_with_product_ids) > 0;
