-- Promo codes can be limited to any mix of pricing sections, class types and single products
-- (applies_to = 'custom'). 'all', 'yoga' and 'wellzone' keep working for existing codes.

alter table public.promotions add column if not exists applies_section_ids uuid[] not null default '{}';
alter table public.promotions add column if not exists applies_class_types text[] not null default '{}';
alter table public.promotions add column if not exists applies_product_ids uuid[] not null default '{}';

-- Check: should say promo_target_columns = 3
select count(*) as promo_target_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'promotions'
  and column_name in ('applies_section_ids', 'applies_class_types', 'applies_product_ids');
