-- Home spotlights library: many spotlights, each Top or Bottom of the member Home page,
-- live or closed (closed ones are kept so they can be reopened or reused).
create table if not exists public.home_spotlights (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'promo' check (kind in ('promo', 'event', 'challenge')),
  badge text,
  title text not null default '',
  subtitle text,
  body text,
  event_date text,
  price_label text,
  image_url text,
  link_url text,
  link_label text,
  placement text not null default 'bottom' check (placement in ('top', 'bottom')),
  is_live boolean not null default true,
  sort_order integer not null default 0,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.home_spotlights enable row level security;

drop policy if exists home_spotlights_read on public.home_spotlights;
create policy home_spotlights_read on public.home_spotlights
  for select to authenticated
  using (is_live or public.has_any_role(array['director', 'management', 'marketing']));

drop policy if exists home_spotlights_write on public.home_spotlights;
create policy home_spotlights_write on public.home_spotlights
  for all to authenticated
  using (public.has_any_role(array['director', 'management', 'marketing']))
  with check (public.has_any_role(array['director', 'management', 'marketing']));

grant select, insert, update, delete on public.home_spotlights to authenticated;

-- Bring across what's showing today (once).
do $$
declare v_ch jsonb; v_ev jsonb;
begin
  if exists (select 1 from public.home_spotlights) then return; end if;

  select nullif(value, '')::jsonb into v_ch from public.studio_settings where key = 'movement_challenge';
  select nullif(value, '')::jsonb into v_ev from public.studio_settings where key = 'home_event_card';

  if v_ch is not null and coalesce(v_ch->>'home_card_mode', 'challenge') <> 'hidden' then
    if coalesce(v_ch->>'home_card_mode', 'challenge') = 'challenge' then
      insert into public.home_spotlights (kind, badge, title, placement, sort_order)
      values ('challenge', v_ch->>'badge_label', coalesce(v_ch->>'title', 'Challenge'), 'bottom', 10);
    else
      insert into public.home_spotlights (kind, badge, title, subtitle, image_url, link_url, link_label, placement, sort_order)
      values ('promo', v_ch->>'promo_badge_label', coalesce(v_ch->>'promo_title', ''), v_ch->>'promo_subtitle',
              v_ch->>'promo_image_url', v_ch->>'promo_link', v_ch->>'promo_link_label', 'bottom', 10);
    end if;
  end if;

  if v_ev is not null and coalesce((v_ev->>'enabled')::boolean, false) then
    insert into public.home_spotlights (kind, title, body, event_date, price_label, image_url, link_url, link_label, placement, sort_order)
    values ('event', coalesce(v_ev->>'title', ''), v_ev->>'body_text', v_ev->>'event_date', v_ev->>'price_label',
            v_ev->>'image_url', v_ev->>'link_url', v_ev->>'link_label', 'bottom', 20);
  end if;
exception when others then
  raise notice 'Could not copy the current spotlight settings: %', sqlerrm;
end $$;

select kind, title, placement, is_live from public.home_spotlights order by placement, sort_order;
