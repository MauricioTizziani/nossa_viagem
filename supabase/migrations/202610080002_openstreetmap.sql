-- Apply after 202610080001_nossa_viagem.sql. Existing activities are preserved.
begin;
-- Also protect internal receipts when upgrading an earlier initial migration.
alter table private.invite_redemptions enable row level security;

alter table public.activities
  add column osm_place_id text,
  add column osm_place_name text,
  add column osm_place_address text,
  add column osm_latitude double precision,
  add column osm_longitude double precision;

alter table public.activities drop constraint place_source_exclusive;
alter table public.activities add constraint place_source_exclusive check (
  (case when place_id is null then 0 else 1 end) +
  (case when osm_place_id is null then 0 else 1 end) +
  (case when manual_place_name is null and manual_place_address is null and manual_place_url is null then 0 else 1 end) <= 1
);
alter table public.activities add constraint osm_place_valid check (
  (osm_place_id is null and osm_place_name is null and osm_place_address is null and osm_latitude is null and osm_longitude is null)
  or
  (osm_place_id is not null and osm_place_id ~ '^[NWR]/[1-9][0-9]{0,19}$'
   and osm_place_name is not null and osm_place_name = private.trim_text(osm_place_name) and char_length(osm_place_name) between 1 and 240
   and (osm_place_address is null or (osm_place_address = private.trim_text(osm_place_address) and char_length(osm_place_address) between 1 and 1000))
   and osm_latitude is not null and osm_latitude between -90 and 90
   and osm_longitude is not null and osm_longitude between -180 and 180)
);

alter table public.activities drop constraint manual_maps_url_valid;
alter table public.activities add constraint manual_maps_url_valid check (
  manual_place_url is null or
  manual_place_url ~ '^https://(www\.openstreetmap\.org|openstreetmap\.org|osm\.org)/(search/?|directions/?|(node|way|relation)/[1-9][0-9]*/?|go/[A-Za-z0-9_~@-]+/?)?([?#][^[:space:]]*)?$' or
  -- Keep manually provided links from previous versions; no Google API is used.
  manual_place_url ~ '^https://(maps\.app\.goo\.gl/[A-Za-z0-9_-]+/?([?#][^[:space:]]*)?|goo\.gl/maps/[A-Za-z0-9_-]+/?([?#][^[:space:]]*)?|(www\.)?google\.(com|com\.br|co\.uk|pt|es|fr|it|de|ca|com\.ar|com\.mx|cl)/maps([/?#][^[:space:]]*)?|maps\.google\.(com|com\.br|co\.uk|pt|es|fr|it|de|ca|com\.ar|com\.mx|cl)/([?#][^[:space:]]*|maps([/?#][^[:space:]]*)?)?)$'
);

drop function public.save_activity(uuid, uuid, integer, timestamptz, bigint, text, text, text, text, text, text);
create function public.save_activity(
  p_trip_id uuid, p_id uuid, p_expected_version integer,
  p_starts_at timestamptz, p_budget_cents bigint, p_name text, p_type text,
  p_place_id text, p_manual_place_name text, p_manual_place_address text, p_manual_place_url text,
  p_osm_place_id text default null, p_osm_place_name text default null, p_osm_place_address text default null,
  p_osm_latitude double precision default null, p_osm_longitude double precision default null
)
returns public.activities language plpgsql security definer set search_path = '' as $$
declare
  v_activity public.activities;
  v_name text := private.trim_text(p_name);
  v_place_id text := nullif(private.trim_text(p_place_id), '');
  v_manual_name text := nullif(private.trim_text(p_manual_place_name), '');
  v_manual_address text := nullif(private.trim_text(p_manual_place_address), '');
  v_manual_url text := nullif(private.trim_text(p_manual_place_url), '');
  v_osm_id text := nullif(private.trim_text(p_osm_place_id), '');
  v_osm_name text := nullif(private.trim_text(p_osm_place_name), '');
  v_osm_address text := nullif(private.trim_text(p_osm_place_address), '');
begin
  if auth.uid() is null or not private.is_trip_member(p_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_id is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'INVALID_ACTIVITY_VERSION' using errcode = '22023';
  end if;
  if p_expected_version = 0 then
    insert into public.activities (
      id, trip_id, starts_at, budget_cents, name, type, place_id,
      manual_place_name, manual_place_address, manual_place_url,
      osm_place_id, osm_place_name, osm_place_address, osm_latitude, osm_longitude
    ) values (
      p_id, p_trip_id, p_starts_at, p_budget_cents, v_name, p_type, v_place_id,
      v_manual_name, v_manual_address, v_manual_url,
      v_osm_id, v_osm_name, v_osm_address, p_osm_latitude, p_osm_longitude
    ) on conflict (id) do nothing returning * into v_activity;
    if not found then
      select * into v_activity from public.activities where id = p_id and trip_id = p_trip_id;
      if v_activity.id is null or v_activity.version <> 1 or
        v_activity.starts_at is distinct from p_starts_at or
        v_activity.budget_cents is distinct from p_budget_cents or
        v_activity.name is distinct from v_name or v_activity.type is distinct from p_type or
        v_activity.place_id is distinct from v_place_id or
        v_activity.manual_place_name is distinct from v_manual_name or
        v_activity.manual_place_address is distinct from v_manual_address or
        v_activity.manual_place_url is distinct from v_manual_url or
        v_activity.osm_place_id is distinct from v_osm_id or
        v_activity.osm_place_name is distinct from v_osm_name or
        v_activity.osm_place_address is distinct from v_osm_address or
        v_activity.osm_latitude is distinct from p_osm_latitude or
        v_activity.osm_longitude is distinct from p_osm_longitude then
        raise exception 'VERSION_CONFLICT' using errcode = '40001';
      end if;
    end if;
  else
    update public.activities set
      starts_at = p_starts_at, budget_cents = p_budget_cents, name = v_name, type = p_type,
      place_id = v_place_id, manual_place_name = v_manual_name,
      manual_place_address = v_manual_address, manual_place_url = v_manual_url,
      osm_place_id = v_osm_id, osm_place_name = v_osm_name, osm_place_address = v_osm_address,
      osm_latitude = p_osm_latitude, osm_longitude = p_osm_longitude,
      version = version + 1, updated_at = now()
    where id = p_id and trip_id = p_trip_id and version = p_expected_version
    returning * into v_activity;
    if not found then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
  end if;
  update public.trips set updated_at = now() where id = p_trip_id;
  return v_activity;
end;
$$;

revoke all on function public.save_activity(uuid, uuid, integer, timestamptz, bigint, text, text, text, text, text, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.save_activity(uuid, uuid, integer, timestamptz, bigint, text, text, text, text, text, text, text, text, text, double precision, double precision) to authenticated;
comment on column public.activities.osm_place_id is 'OpenStreetMap reference N/id, W/id or R/id; data via Photon, ODbL attribution required.';
notify pgrst, 'reload schema';
commit;
