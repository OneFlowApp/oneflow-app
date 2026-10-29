-- Admin → Products: "Offer as a monthly add-on". Lists the pricing sections whose
-- purchases ask "Would you like to add …?" before payment.
alter table public.products
  add column if not exists offer_with_section_ids uuid[] not null default '{}';
