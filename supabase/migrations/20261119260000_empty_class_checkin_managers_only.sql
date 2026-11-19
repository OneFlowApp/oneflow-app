-- Empty class check-ins are a Director and Management job only.
drop policy if exists empty_class_checkins_staff on public.empty_class_checkins;
drop policy if exists empty_class_checkins_managers on public.empty_class_checkins;
create policy empty_class_checkins_managers on public.empty_class_checkins for all to authenticated
  using (public.has_any_role(array['director','management']))
  with check (public.has_any_role(array['director','management']));

-- Check: one rule, for Director and Management.
select policyname from pg_policies where tablename = 'empty_class_checkins';
