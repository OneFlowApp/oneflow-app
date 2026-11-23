-- Guides see their own rates on their invoice and tick to confirm them (with a comment if needed).
-- The confirmation, comment and the rates they saw are saved on the invoice.

drop policy if exists guide_rates_own_read on public.guide_rates;
create policy guide_rates_own_read on public.guide_rates for select to authenticated
  using (guide_profile_id = auth.uid());

alter table public.guide_invoices add column if not exists rates_confirmed boolean not null default false;
alter table public.guide_invoices add column if not exists rates_comment text;
alter table public.guide_invoices add column if not exists rates_snapshot jsonb;

-- Check: the three new invoice columns.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'guide_invoices'
  and column_name in ('rates_confirmed', 'rates_comment', 'rates_snapshot')
order by 1;
