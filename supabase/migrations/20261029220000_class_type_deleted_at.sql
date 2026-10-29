-- Master → Class types: "Delete" for old types.
-- The row is kept (past classes, bookings and guide disciplines point at it); deleted_at
-- hides it from the list. A deleted type is always switched off.
alter table public.class_types add column if not exists deleted_at timestamptz;

create or replace function public.class_types_deleted_off()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is not null then
    new.is_active := false;
  end if;
  return new;
end;
$$;

drop trigger if exists class_types_deleted_off on public.class_types;
create trigger class_types_deleted_off
  before insert or update on public.class_types
  for each row execute function public.class_types_deleted_off();
