-- One Flow Longkloof timetable: 15 Nov 2026 for 26 weeks.
-- 1) Cancels upcoming mat, reformer and guided sauna journey classes from 15 Nov that have no bookings
--    (Unguided Wellzone sessions, Guided Series and Events are left alone).
-- 2) Loads the new weekly timetable. Guides are matched by first name to active guides in the app;
--    names with no match are stored as text so they still show.
-- 3) Returns a summary.
drop table if exists tt_slot, tt_types, tt_kept, tt_made, tt_summary;
create temp table tt_slot (
  dow int, start_time time, cat text, type_name text, guide text, alt_guide text, from_date date
);

insert into tt_slot values
-- Mat: Monday (1)
(1,'05:30','Sculpt','HIIT','Georgie',null,null),
(1,'06:45','Sculpt','LIIT','Roch',null,null),
(1,'08:00','Yoga','Power','Dom',null,null),
(1,'09:15','Pilates','Flow','Hannah',null,null),
(1,'11:00','Sculpt','LIIT','Kesh',null,null),
(1,'16:00','Yoga','Power','Lara',null,null),
(1,'17:15','Sculpt','Kettle Bell','Ciara',null,null),
(1,'18:30','Yoga','Warm Vinyasa','Lara',null,null),
-- Tuesday (2)
(2,'05:30','Sculpt','Kettle Bell','Cam',null,null),
(2,'06:45','Sculpt','HIIT','Roch',null,null),
(2,'08:00','Yoga','Power','Kesh',null,null),
(2,'09:15','Sculpt','LIIT','Tara',null,null),
(2,'11:00','Pilates','Flow','Dom',null,null),
(2,'16:00','Sculpt','HIIT','Tahir',null,null),
(2,'17:15','Yoga','Power','Dom',null,null),
(2,'18:30','Yoga','Stretch and Recovery','Lebone',null,null),
-- Wednesday (3)
(3,'05:30','Sculpt','HIIT','Tahir',null,null),
(3,'06:45','Sculpt','LIIT','Reece',null,null),
(3,'08:00','Yoga','Power','Rox',null,null),
(3,'09:15','Pilates','Flow','Ciara',null,null),
(3,'11:00','Sculpt','LIIT','Dom',null,null),
(3,'16:00','Yoga','Power','Jeanae',null,null),
(3,'17:15','Sculpt','Kettle Bell','Stella',null,null),
(3,'18:30','Yoga','Warm Vinyasa','Darja',null,null),
-- Thursday (4)
(4,'05:30','Sculpt','Kettle Bell','Cam',null,null),
(4,'06:45','Sculpt','HIIT','Naomi',null,null),
(4,'08:00','Yoga','Power','Naomi',null,null),
(4,'09:15','Sculpt','LIIT','Roch',null,null),
(4,'11:00','Pilates','Flow','Kesh',null,null),
(4,'16:00','Sculpt','HIIT','Kesh',null,null),
(4,'17:15','Yoga','Power','Tara',null,null),
(4,'18:30','Yoga','Beginners','Stacy',null,null),
-- Friday (5)
(5,'05:30','Sculpt','HIIT','Mel',null,null),
(5,'06:45','Sculpt','LIIT','Georgie',null,null),
(5,'08:00','Yoga','Power','Tara',null,null),
(5,'09:15','Pilates','Flow','Roch',null,null),
(5,'11:00','Sculpt','LIIT','Eleni',null,null),
-- Saturday (6)
(6,'07:30','Sculpt','LIIT','Mel',null,null),
(6,'09:00','Yoga','Power','Kesh',null,null),
-- Sunday (0)
(0,'07:30','Sculpt','Kettle Bell','Stella',null,null),
(0,'09:00','Yoga','Power','Tara',null,null),
(0,'17:15','Yoga','Power','Lebone',null,null),
-- Sauna Journeys
(1,'17:45','Wellzone','Guided Sauna Journey','Stacy',null,null),
(2,'17:45','Wellzone','Guided Sauna Journey','Parisha',null,null),
(3,'17:45','Wellzone','Guided Sauna Journey','Jeanae',null,null),
(4,'17:45','Wellzone','Guided Sauna Journey','Kylie',null,null),
(0,'09:15','Wellzone','Guided Sauna Journey','Stacy',null,null),
-- Reformer: Monday
(1,'07:00','Reformer','Pilates Flow','Tam',null,null),
(1,'08:15','Reformer','LIIT','Kesh',null,null),
(1,'09:30','Reformer','Strength & HIIT','Dom',null,null),
(1,'16:15','Reformer','Strength & HIIT','Eleni',null,null),
(1,'17:30','Reformer','Pilates Flow','Eleni',null,null),
-- Tuesday
(2,'07:00','Reformer','LIIT','Tara',null,null),
(2,'08:15','Reformer','Strength & HIIT','Roch',null,null),
(2,'09:30','Reformer','Pilates Flow','Kesh',null,null),
(2,'16:15','Reformer','Pilates Flow','Eleni',null,null),
(2,'17:30','Reformer','LIIT','Reece',null,null),
-- Wednesday
(3,'07:00','Reformer','Pilates Flow','Ciara',null,null),
(3,'08:15','Reformer','LIIT','Jeanae',null,null),
(3,'09:30','Reformer','Strength & HIIT','Jeanae',null,null),
(3,'16:15','Reformer','Strength & HIIT','Reece',null,null),
(3,'17:30','Reformer','Pilates Flow','Eleni',null,null),
-- Thursday
(4,'07:00','Reformer','LIIT','PK',null,null),
(4,'08:15','Reformer','Strength & HIIT','Reece',null,null),
(4,'09:30','Reformer','Pilates Flow','Jane',null,null),
(4,'16:15','Reformer','Pilates Flow','Eleni',null,null),
(4,'17:30','Reformer','LIIT','Ciara',null,null),
-- Friday
(5,'07:00','Reformer','Pilates Flow','Tam',null,null),
(5,'08:15','Reformer','LIIT','Dom',null,null),
(5,'09:30','Reformer','Strength & HIIT','Jeanae',null,null),
-- Saturday
(6,'08:15','Reformer','Strength & HIIT','PK',null,null),
(6,'09:30','Reformer','Pilates Flow','Ciara',null,null),
-- Sunday (8:15 alternates Jane, then Roch)
(0,'08:15','Reformer','LIIT','Jane','Roch',null),
(0,'09:30','Reformer','Strength & HIIT','Tam',null,null),
(0,'17:30','Reformer','Pilates Flow',null,null,'2027-01-03');

do $$
declare
  v_from date := date '2026-11-15';
  v_weeks int := 26;
  v_tz text := 'Africa/Johannesburg';
  s record; t record; d date; wk int; v_start timestamptz; v_guide text; v_gid uuid; v_gname text;
  v_group uuid; v_cap int; v_mins int; v_room public.class_location;
begin
  -- Which existing classes to replace.
  create temp table tt_types as
  select ct.id
  from public.class_types ct join public.class_categories cat on cat.id = ct.category_id
  where ct.deleted_at is null
    and (cat.name in ('Yoga', 'Sculpt', 'Pilates', 'Reformer') or ct.name = 'Guided Sauna Journey');

  create temp table tt_kept as
  select c.id, c.name, c.starts_at, c.location
  from public.classes c
  where c.class_type_id in (select id from tt_types)
    and c.starts_at >= (v_from::timestamp at time zone v_tz)
    and coalesce(c.is_cancelled, false) = false
    and exists (select 1 from public.bookings b where b.class_id = c.id and coalesce(b.status::text, '') <> 'cancelled');

  update public.classes c set is_cancelled = true
  where c.class_type_id in (select id from tt_types)
    and c.starts_at >= (v_from::timestamp at time zone v_tz)
    and coalesce(c.is_cancelled, false) = false
    and c.id not in (select id from tt_kept);

  create temp table tt_made (slot text, guide text, matched boolean);

  for s in select * from tt_slot loop
    select ct.id, ct.name as type_name, cat.name as cat_name,
           coalesce(ct.legacy_class_type::text, cat.legacy_class_type::text) as legacy,
           ct.default_location, ct.category_id
      into t
    from public.class_types ct join public.class_categories cat on cat.id = ct.category_id
    where ct.deleted_at is null and cat.name = s.cat and ct.name = s.type_name
    limit 1;
    if t.id is null then
      raise exception 'Class not found in Master: % / %', s.cat, s.type_name;
    end if;

    -- Capacity and length: what this class usually has, else its category, else 20 and 60 minutes.
    select mode() within group (order by c.capacity),
           mode() within group (order by round(extract(epoch from (c.ends_at - c.starts_at)) / 60))
      into v_cap, v_mins
    from public.classes c where c.class_type_id = t.id and c.capacity > 0;
    if v_cap is null then
      select mode() within group (order by c.capacity) into v_cap
      from public.classes c join public.class_types x on x.id = c.class_type_id
      where x.category_id = t.category_id and c.capacity > 0;
    end if;
    v_cap := coalesce(v_cap, 20);
    v_mins := coalesce(v_mins, 60);
    v_room := coalesce(t.default_location, 'Mat Room'::public.class_location);
    v_group := gen_random_uuid();

    for wk in 0 .. v_weeks - 1 loop
      d := v_from + ((s.dow - extract(dow from v_from)::int + 7) % 7) + wk * 7;
      continue when s.from_date is not null and d < s.from_date;
      continue when d >= v_from + v_weeks * 7;
      v_start := (d + s.start_time) at time zone v_tz;

      -- A booked class already sits here: keep it, don't double up.
      continue when exists (select 1 from tt_kept k where k.starts_at = v_start and k.location = v_room);

      v_guide := case when s.alt_guide is not null and wk % 2 = 1 then s.alt_guide else s.guide end;
      v_gid := null; v_gname := v_guide;
      if v_guide is not null then
        select g.id into v_gid
        from public.guides g join public.profiles p on p.id = g.profile_id
        where coalesce(g.is_active, true)
          and (lower(p.first_name) = lower(v_guide)
               or (length(v_guide) >= 3 and lower(p.first_name) like lower(v_guide) || '%'))
        group by g.id
        having count(*) = 1
        limit 1;
        if (select count(distinct g.id)
              from public.guides g join public.profiles p on p.id = g.profile_id
             where coalesce(g.is_active, true)
               and (lower(p.first_name) = lower(v_guide)
                    or (length(v_guide) >= 3 and lower(p.first_name) like lower(v_guide) || '%'))) <> 1 then
          v_gid := null;
        end if;
      end if;

      insert into public.classes
        (name, class_type, class_type_id, location, starts_at, ends_at, capacity, booked_count,
         guide_id, guide_name, recurring_group_id, is_cancelled, credit_covered, is_free)
      values
        (t.cat_name || ': ' || t.type_name, t.legacy::public.class_type, t.id, v_room, v_start,
         v_start + make_interval(mins => v_mins), v_cap, 0,
         v_gid, v_gname, v_group, false, true, false);

      insert into tt_made values (s.cat || ' ' || s.type_name, v_guide, v_gid is not null);
    end loop;
  end loop;

  create temp table tt_summary as
  select 'Classes created' as item, count(*)::text as detail from tt_made
  union all
  select 'Guide not found in app (name shown, not linked)', string_agg(distinct guide, ', ' order by guide)
    from tt_made where guide is not null and not matched
  union all
  select 'Booked classes kept (check these)', count(*)::text from tt_kept;
end $$;

select * from tt_summary;
