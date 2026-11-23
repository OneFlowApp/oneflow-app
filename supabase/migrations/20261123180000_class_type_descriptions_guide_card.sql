-- 1. A description per class type (Master → Class types), shown to members when a class has no
--    description of its own.
-- 2. guide_card(class_id): what a member sees when they tap the guide's name on the schedule —
--    name, photo, bio, average rating and the most recent written reviews for that guide.
--    Reviews show the rating, comment and date only, never who wrote them.

alter table public.class_types add column if not exists description text;

create or replace function public.guide_card(p_class_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gid uuid;
  v_gname text;
  v_gu_id uuid;
  v_gu_profile uuid;
  v_bio text;
  v_photo text;
  v_disc jsonb;
  v_profile uuid;
  v_name text;
  v_avg numeric;
  v_count int;
  v_reviews jsonb;
begin
  select c.guide_id, c.guide_name into v_gid, v_gname from public.classes c where c.id = p_class_id;
  if v_gid is null then return null; end if;

  -- classes.guide_id points at either guides.id or the guide's profile id.
  select gu.id, gu.profile_id, gu.bio, gu.photo_url, to_jsonb(gu.disciplines)
    into v_gu_id, v_gu_profile, v_bio, v_photo, v_disc
    from public.guides gu
    where gu.id = v_gid or gu.profile_id = v_gid
    limit 1;
  v_profile := coalesce(v_gu_profile, v_gid);

  select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
    into v_name from public.profiles p where p.id = v_profile;

  select round(avg(r.rating)::numeric, 1), count(*)
    into v_avg, v_count
    from public.class_reviews r
    join public.classes c on c.id = r.class_id
    where c.guide_id in (v_gid, v_profile, coalesce(v_gu_id, v_gid));

  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into v_reviews
  from (
    select jsonb_build_object(
             'rating', r.rating,
             'comment', r.comment,
             'at', r.created_at,
             'class_name', c.name) as x
    from public.class_reviews r
    join public.classes c on c.id = r.class_id
    where c.guide_id in (v_gid, v_profile, coalesce(v_gu_id, v_gid))
      and nullif(trim(coalesce(r.comment, '')), '') is not null
    order by r.created_at desc
    limit 5
  ) s;

  return jsonb_build_object(
    'name', coalesce(v_name, v_gname),
    'bio', v_bio,
    'photo_url', v_photo,
    'disciplines', v_disc,
    'avg_rating', v_avg,
    'review_count', coalesce(v_count, 0),
    'reviews', v_reviews
  );
end;
$$;

grant execute on function public.guide_card(uuid) to authenticated, anon;

-- Check: should say description_column = 1, guide_card_ready = 1
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'class_types' and column_name = 'description') as description_column,
       (select count(*) from pg_proc where proname = 'guide_card') as guide_card_ready;
