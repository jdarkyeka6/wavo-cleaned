-- Structured locations for plans.
--
-- `plans.location` is free text — "Jake's" — which is enough to render but
-- not enough to navigate to. These columns sit alongside it so a plan can
-- carry a real place without breaking anything that reads the old field.
--
-- Backend only for now: nothing in the app writes these yet. The point of
-- landing the schema first is that the UI becomes a small change later
-- rather than a change plus a migration.

alter table public.plans
  add column if not exists place_name    text,
  add column if not exists place_address text,
  add column if not exists place_lat     double precision,
  add column if not exists place_lng     double precision;

-- Validity lives in the database, not in whatever writes to it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plans_place_lat_range') then
    alter table public.plans add constraint plans_place_lat_range
      check (place_lat is null or place_lat between -90 and 90);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'plans_place_lng_range') then
    alter table public.plans add constraint plans_place_lng_range
      check (place_lng is null or place_lng between -180 and 180);
  end if;

  -- A latitude on its own is not a location. Either both or neither.
  if not exists (select 1 from pg_constraint where conname = 'plans_place_coords_pair') then
    alter table public.plans add constraint plans_place_coords_pair
      check ((place_lat is null) = (place_lng is null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'plans_place_text_len') then
    alter table public.plans add constraint plans_place_text_len
      check (
        (place_name is null or length(place_name) <= 120) and
        (place_address is null or length(place_address) <= 300)
      );
  end if;
end $$;

-- A ready-made maps link, derived rather than stored by the client so it
-- cannot drift from the coordinates.
--
-- Deliberately built from the numbers only: a generated column has to be
-- immutable, and percent-encoding free text in SQL is fiddly enough to get
-- wrong. An address with no coordinates is the client's problem to link.
alter table public.plans
  drop column if exists place_map_url;

alter table public.plans
  add column place_map_url text
  generated always as (
    case
      when place_lat is not null and place_lng is not null then
        'https://www.google.com/maps/search/?api=1&query='
        || place_lat::text || ',' || place_lng::text
    end
  ) stored;

-- Keep the legacy display field in step. Anything already reading
-- `plans.location` — including the current Plans card — shows the new place
-- with no frontend change at all.
create or replace function public.sync_plan_location()
returns trigger
language plpgsql
as $$
begin
  if coalesce(btrim(new.place_name), '') <> '' then
    new.location := btrim(new.place_name);
  elsif coalesce(btrim(new.place_address), '') <> '' then
    new.location := btrim(new.place_address);
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_plan_location on public.plans;
create trigger trg_sync_plan_location
before insert or update of place_name, place_address on public.plans
for each row execute function public.sync_plan_location();

-- Reads and writes stay on the existing policies: plans are readable by group
-- members, and editable by the creator or a group admin
-- (`created_by = auth.uid() OR is_group_admin(group_id)`). New columns are
-- covered by those automatically, so there is no new RPC and no new grant.
