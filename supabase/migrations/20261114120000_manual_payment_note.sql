-- Manual payments in Assign Package: where it was paid (yoco_payment_id = manual_green_point /
-- manual_studio / manual_assignment), the amount (amount_paid_zar) and an optional receipt reference.
alter table public.user_credits add column if not exists payment_note text;
alter table public.user_credits add column if not exists amount_paid_zar numeric;
