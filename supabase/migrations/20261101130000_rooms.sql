-- Rooms: Studio 1 → Mat Room, Studio 2 → Reformer Room.
-- Each class type has a home room (Master → Class types → Room), used when scheduling.
update public.classes set location = 'Mat Room' where location = 'Studio 1';
update public.classes set location = 'Reformer Room' where location = 'Studio 2';

alter table public.class_types add column if not exists default_location text;

update public.class_types
set default_location = case
  when legacy_class_type::text = 'reformer' then 'Reformer Room'
  when legacy_class_type::text in ('wellzone', 'sauna_journey') then 'Wellzone'
  else 'Mat Room'
end
where default_location is null;

-- Upcoming classes move to their class's room (Sauna classes stay in the Sauna).
update public.classes c
set location = t.default_location
from public.class_types t
where c.class_type_id = t.id
  and c.starts_at >= now()
  and c.location is distinct from t.default_location
  and not (t.default_location = 'Wellzone' and c.location = 'Sauna');

select t.name as class, t.default_location as room,
       count(c.id) filter (where c.starts_at >= now() and not coalesce(c.is_cancelled, false)) as upcoming_classes
from public.class_types t
left join public.classes c on c.class_type_id = t.id
where t.deleted_at is null
group by t.name, t.default_location
order by t.default_location, t.name;
