-- Master → Class types: each category (Yoga, Sculpt, Pilates…) sits under a top level group
-- (On The Mat, Reformer, Wellzone, Events). Member titles are unchanged ("Sculpt: LIIT").
alter table public.class_categories add column if not exists parent_group text;

update public.class_categories
set parent_group = case
  when slug ilike '%reformer%' or name ilike '%reformer%' or legacy_class_type::text = 'reformer' then 'Reformer'
  when legacy_class_type::text in ('wellzone', 'sauna_journey') or slug ilike '%wellzone%' then 'Wellzone'
  when legacy_class_type::text = 'event' or slug ilike '%event%' then 'Events'
  else 'On The Mat'
end
where parent_group is null;

select c.parent_group as "group", c.name as category,
       string_agg(t.name, ', ' order by t.sort_order, t.name) as classes
from public.class_categories c
left join public.class_types t on t.category_id = c.id and t.deleted_at is null
group by c.parent_group, c.name, c.sort_order
order by c.parent_group, c.sort_order;
