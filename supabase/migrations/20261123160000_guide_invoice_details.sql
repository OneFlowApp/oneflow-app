-- Guide invoicing details (Payouts → "Your invoicing details"), and the studio's details that go on
-- every guide invoice ("Billed to", set by Directors / Management in Payouts → Guide rates).
--   Bank details are private: only the guide and Directors / Management can see them.
--   Each submitted invoice keeps a copy of both, plus an invoice number, so later edits don't change it.

create table if not exists public.guide_invoice_details (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  invoice_name text,          -- name or business name on the invoice
  id_or_reg_number text,      -- ID number or company registration
  vat_number text,
  address text,
  phone text,
  email text,
  bank_name text,
  account_holder text,
  account_number text,
  branch_code text,
  account_type text,
  updated_at timestamptz not null default now()
);

alter table public.guide_invoice_details enable row level security;

drop policy if exists guide_invoice_details_own on public.guide_invoice_details;
create policy guide_invoice_details_own on public.guide_invoice_details for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists guide_invoice_details_admin_read on public.guide_invoice_details;
create policy guide_invoice_details_admin_read on public.guide_invoice_details for select to authenticated
  using (public.is_admin_role());

grant select, insert, update on public.guide_invoice_details to authenticated;
grant all on public.guide_invoice_details to service_role;

alter table public.guide_invoices add column if not exists invoice_number text;
alter table public.guide_invoices add column if not exists guide_details jsonb;
alter table public.guide_invoices add column if not exists bill_to jsonb;

-- The studio's details on guide invoices. Directors / Management (main or second role) can edit them.
insert into public.studio_settings (key, value) values
  ('invoice_bill_to_name', 'One Flow Longkloof'),
  ('invoice_bill_to_address', ''),
  ('invoice_bill_to_reg', ''),
  ('invoice_bill_to_vat', ''),
  ('invoice_bill_to_email', 'deeds@oneflow.co.za')
on conflict (key) do nothing;

drop policy if exists studio_settings_invoice_admin_write on public.studio_settings;
create policy studio_settings_invoice_admin_write on public.studio_settings for all to authenticated
  using (key like 'invoice_bill_to_%' and public.is_admin_role())
  with check (key like 'invoice_bill_to_%' and public.is_admin_role());

-- Check: should say details_table = 1, invoice_columns = 3, bill_to_settings = 5
select (select count(*) from information_schema.tables
        where table_schema = 'public' and table_name = 'guide_invoice_details') as details_table,
       (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'guide_invoices'
          and column_name in ('invoice_number', 'guide_details', 'bill_to')) as invoice_columns,
       (select count(*) from public.studio_settings where key like 'invoice_bill_to_%') as bill_to_settings;
