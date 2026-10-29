-- Duplicate members: find likely duplicates and merge two accounts into one.
alter table public.profiles add column if not exists merged_into uuid;

-- Likely duplicates: same email, same phone (last 9 digits) or same first + last name.
create or replace function public.find_possible_duplicates()
returns table (keep_id uuid, other_id uuid, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_any_role(array['director', 'management']) then
    raise exception 'Only Director or Management can see duplicates';
  end if;
  return query
  with p as (
    select id, created_at,
           nullif(lower(trim(email)), '') as em,
           nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9), '') as ph,
           nullif(lower(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))), '') as nm
    from public.profiles
    where deleted_at is null
  ), pairs as (
    select a.id as a_id, b.id as b_id, a.created_at as a_created, b.created_at as b_created,
           concat_ws(', ',
             case when a.em = b.em then 'same email' end,
             case when a.ph is not null and length(a.ph) = 9 and a.ph = b.ph then 'same phone' end,
             case when a.nm = b.nm then 'same name' end) as why
    from p a join p b on a.id < b.id
    where a.em = b.em or (a.ph is not null and length(a.ph) = 9 and a.ph = b.ph) or a.nm = b.nm
  )
  select case when a_created <= b_created then a_id else b_id end,
         case when a_created <= b_created then b_id else a_id end,
         why
  from pairs;
end $$;
grant execute on function public.find_possible_duplicates() to authenticated;

-- Merge: everything belonging to p_remove moves to p_keep; p_remove is then deleted (archived).
create or replace function public.merge_members(p_keep uuid, p_remove uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  r record; n_moved integer := 0; n_dropped integer := 0; row_ctid tid;
  v_role text;
begin
  if not public.has_any_role(array['director', 'management']) then
    raise exception 'Only Director or Management can merge members';
  end if;
  if p_keep = p_remove then raise exception 'Choose two different accounts'; end if;
  if not exists (select 1 from public.profiles where id = p_keep and deleted_at is null) then
    raise exception 'The account to keep was not found';
  end if;
  select lower(coalesce(role::text, 'customer')) into v_role from public.profiles where id = p_remove and deleted_at is null;
  if not found then raise exception 'The account to merge was not found'; end if;
  if v_role <> 'customer' then
    raise exception 'The account being merged away has a staff role. Keep that one instead, or change its role to Customer first.';
  end if;

  -- Every column that points at a member: foreign keys to profiles, plus known member columns.
  for r in
    select distinct tbl, col from (
      select cl.relname::text as tbl, att.attname::text as col
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      join unnest(con.conkey) k(attnum) on true
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
      where con.contype = 'f' and con.confrelid = 'public.profiles'::regclass
      union
      select c.table_name::text, c.column_name::text
      from information_schema.columns c
      where c.table_schema = 'public'
        and (c.table_name, c.column_name) in (
          ('friendships', 'requester_id'), ('friendships', 'addressee_id'),
          ('class_invites', 'inviter_id'), ('class_invites', 'invitee_id'),
          ('studio_messages', 'to_profile_id'), ('studio_messages', 'from_profile_id'),
          ('guide_invoices', 'guide_id'), ('member_fees', 'profile_id'))
    ) s
    where tbl <> 'profiles'
  loop
    begin
      execute format('update public.%I set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_remove;
      get diagnostics n_dropped = row_count;  -- reused below; counts moved rows here
      n_moved := n_moved + n_dropped;
    exception when unique_violation then
      -- Some rows already exist for the kept account (e.g. same class, same badge): move one by one,
      -- and drop the duplicate copy when it clashes.
      for row_ctid in execute format('select ctid from public.%I where %I = $1', r.tbl, r.col) using p_remove loop
        begin
          execute format('update public.%I set %I = $1 where ctid = $2', r.tbl, r.col) using p_keep, row_ctid;
          n_moved := n_moved + 1;
        exception when unique_violation then
          execute format('delete from public.%I where ctid = $1', r.tbl) using row_ctid;
        end;
      end loop;
    end;
  end loop;
  -- A member cannot be friends with themselves.
  delete from public.friendships where requester_id = addressee_id;

  -- Combine Flow Points; fill in details the kept account is missing.
  update public.profiles k set
    flow_points = coalesce(k.flow_points, 0) + coalesce(x.flow_points, 0),
    phone = coalesce(k.phone, x.phone),
    date_of_birth = coalesce(k.date_of_birth, x.date_of_birth),
    avatar_url = coalesce(k.avatar_url, x.avatar_url),
    waiver_accepted_at = coalesce(k.waiver_accepted_at, x.waiver_accepted_at)
  from public.profiles x
  where k.id = p_keep and x.id = p_remove;
  update public.profiles set flow_points = 0, merged_into = p_keep where id = p_remove;

  -- The merged-away account is deleted (login removed), and listed under Deleted members.
  perform public.archive_member(p_remove);

  return jsonb_build_object('moved_rows', n_moved);
end $$;
revoke all on function public.merge_members(uuid, uuid) from public, anon;
grant execute on function public.merge_members(uuid, uuid) to authenticated;

select count(*) as possible_duplicate_pairs from (
  select 1 from public.profiles a join public.profiles b on a.id < b.id
  where a.deleted_at is null and b.deleted_at is null
    and (lower(a.email) = lower(b.email)
         or lower(trim(coalesce(a.first_name,'') || ' ' || coalesce(a.last_name,''))) = lower(trim(coalesce(b.first_name,'') || ' ' || coalesce(b.last_name,''))))
) d;
