-- Admin → Master: "Free / complimentary class". Members book it with no credit and no payment.
alter table public.classes
  add column if not exists is_free boolean not null default false;
