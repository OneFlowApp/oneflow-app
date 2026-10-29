-- "Friends going" on the member schedule.
-- Members opt in with "Show friends the classes I book". You only see friends' bookings
-- when you share your own, and only friends who also share appear.
alter table public.profiles
  add column if not exists share_bookings_with_friends boolean not null default false;

create or replace function public.friends_booked(p_class_ids uuid[])
returns table (class_id uuid, friend_id uuid, first_name text, last_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select b.class_id, p.id, p.first_name, p.last_name, p.avatar_url
  from public.bookings b
  join public.profiles p on p.id = b.profile_id
  where auth.uid() is not null
    and cardinality(p_class_ids) <= 200
    and b.class_id = any (p_class_ids)
    and b.status::text = 'confirmed'
    and b.profile_id <> auth.uid()
    and p.share_bookings_with_friends
    and p.deleted_at is null
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.share_bookings_with_friends
    )
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = b.profile_id)
          or (f.addressee_id = auth.uid() and f.requester_id = b.profile_id))
    )
  order by b.class_id, p.first_name;
$$;

revoke all on function public.friends_booked(uuid[]) from public, anon;
grant execute on function public.friends_booked(uuid[]) to authenticated;
