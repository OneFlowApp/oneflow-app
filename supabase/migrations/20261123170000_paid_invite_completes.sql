-- A paid class invite ("pay for a friend") now shows as completed once the friend's booking exists.
-- Before, it stayed "pending" after the booking was made. Also tidies existing paid invites.

create or replace function public.record_paid_class_invite(
  p_class_invite_id uuid,
  p_yoco_payment_id text,
  p_checkout_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_existing_booking uuid;
begin
  update public.class_invites
    set yoco_payment_id = p_yoco_payment_id,
        checkout_id = p_checkout_id,
        status = case
                   when status::text = 'pending_payment' then 'pending'
                   else status
                 end
    where id = p_class_invite_id
  returning id, class_id, invitee_id, paid_by_inviter, yoco_payment_id
    into v_invite;

  if not found then return; end if;

  if v_invite.invitee_id is not null and v_invite.paid_by_inviter then
    select b.id into v_existing_booking
      from public.bookings b
      where b.profile_id = v_invite.invitee_id
        and b.class_id = v_invite.class_id
        and coalesce(b.status::text, '') <> 'cancelled'
      limit 1;
    if v_existing_booking is null then
      insert into public.bookings (
        profile_id, class_id, status, payment_method,
        credit_id, flow_points_used, mat_addon, towel_addon, qr_token,
        class_invite_id
      ) values (
        v_invite.invitee_id, v_invite.class_id, 'confirmed', 'free',
        null, 0, false, false, gen_random_uuid(),
        p_class_invite_id
      );
      update public.class_invites set status = 'completed' where id = p_class_invite_id;
    end if;
    -- If the friend was already booked, this payment is a duplicate: left "pending" so it shows up to refund.
  end if;
end;
$$;

grant execute on function public.record_paid_class_invite(uuid, text, text) to service_role;

-- Existing paid invites whose friend has a booking for that class: mark completed.
update public.class_invites ci
set status = 'completed'
where ci.status::text = 'pending'
  and ci.yoco_payment_id is not null
  and exists (select 1 from public.bookings b where b.class_invite_id = ci.id);

-- Check: paid invites with no booking made from them. Each one is a payment to look at
-- (a duplicate to refund, or a friend who hasn't signed up yet).
select to_char(ci.created_at at time zone 'Africa/Johannesburg', 'DD Mon HH24:MI') as paid_at,
       trim(ip.first_name || ' ' || coalesce(ip.last_name, '')) as paid_by,
       coalesce(trim(vp.first_name || ' ' || coalesce(vp.last_name, '')), coalesce(ci.invitee_email, '?')) as for_friend,
       c.name || ' ' || to_char(c.starts_at at time zone 'Africa/Johannesburg', 'DD Mon HH24:MI') as class,
       ci.yoco_payment_id
from public.class_invites ci
join public.profiles ip on ip.id = ci.inviter_id
left join public.profiles vp on vp.id = ci.invitee_id
join public.classes c on c.id = ci.class_id
where ci.status::text = 'pending' and ci.yoco_payment_id is not null
order by ci.created_at;
