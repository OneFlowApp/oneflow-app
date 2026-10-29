-- Delete (archive) a member: login removed, contact details wiped, records kept under "Deleted members".
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.profiles add column if not exists deleted_by uuid;

create or replace function public.archive_member(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_role text; v_short text := left(p_profile_id::text, 8);
begin
  if not public.has_any_role(array['director', 'management']) then
    raise exception 'Only Director or Management can delete members';
  end if;
  if p_profile_id = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  select lower(coalesce(role::text, 'customer')) into v_role from public.profiles where id = p_profile_id;
  if not found then raise exception 'Member not found'; end if;
  if v_role <> 'customer' then
    raise exception 'This person has a staff role. Change their role to Customer first.';
  end if;

  -- Future bookings are cancelled; waitlists and friendships removed.
  update public.bookings b set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'member_deleted'
  from public.classes c
  where c.id = b.class_id and b.profile_id = p_profile_id and b.status::text = 'confirmed' and c.starts_at > now();
  delete from public.waitlist_entries where profile_id = p_profile_id;
  delete from public.friendships where requester_id = p_profile_id or addressee_id = p_profile_id;

  -- Contact details wiped; name kept so payment and booking records still make sense.
  update public.profiles set
    email = 'deleted-' || v_short || '@deleted.invalid',
    phone = null,
    date_of_birth = null,
    avatar_url = null,
    notes = null,
    secondary_roles = '{}',
    is_active = false,
    is_searchable = false,
    deleted_at = now(),
    deleted_by = auth.uid()
  where id = p_profile_id;

  -- Login removed: they can no longer sign in, and their email is free to sign up again.
  update auth.users set
    email = 'deleted-' || v_short || '@deleted.invalid',
    phone = null,
    encrypted_password = null,
    banned_until = 'infinity'
  where id = p_profile_id;
  delete from auth.identities where user_id = p_profile_id;
  delete from auth.sessions where user_id = p_profile_id;
end $$;
revoke all on function public.archive_member(uuid) from public, anon;
grant execute on function public.archive_member(uuid) to authenticated;

select count(*) as deleted_members from public.profiles where deleted_at is not null;
