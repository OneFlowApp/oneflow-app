-- Class reviews: only Director and Management can read them (Admin → Reviews).
-- Before, every guide could read every guide's reviews. Members still see only their own.
drop policy if exists class_reviews_staff_select on public.class_reviews;
create policy class_reviews_staff_select
  on public.class_reviews
  for select
  to authenticated
  using (public.has_any_role(array['director', 'management']));

-- Check: how many reviews are waiting to be read.
select count(*) as reviews_so_far,
       round(avg(rating)::numeric, 1) as average_rating
from public.class_reviews;
