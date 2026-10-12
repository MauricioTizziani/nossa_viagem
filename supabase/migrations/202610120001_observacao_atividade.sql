-- Add optional schedule observations and keep the write RPC idempotent.
-- Existing activities receive NULL and remain valid without any backfill.
begin;

alter table public.activities
  add column observation text,
  add constraint activities_observation_trimmed check (
    observation is null or observation = private.trim_text(observation)
  );

comment on column public.activities.observation is
  'Optional plain-text observation for this schedule activity; distinct from expense notes.';

-- Replace the RPC signature so observation is part of the same authorized,
-- versioned write as the rest of the activity. All type values stay aligned
-- with the activities.type check constraint: Refeição, Lazer, Atividade.
drop function public.save_activity(
  uuid, uuid, integer, timestamptz, bigint, text, text, text, text, text, text,
  text, text, text, double precision, double precision
);

create function public.save_activity(
  p_trip_id uuid, p_id uuid, p_expected_version integer,
  p_starts_at timestamptz, p_budget_cents bigint, p_name text, p_type text,
  p_place_id text, p_manual_place_name text, p_manual_place_address text, p_manual_place_url text,
  p_osm_place_id text default null, p_osm_place_name text default null, p_osm_place_address text default null,
  p_osm_latitude double precision default null, p_osm_longitude double precision default null,
  p_observation text default null
)
returns public.activities language plpgsql security definer set search_path = '' as $$
declare
  v_activity public.activities;
  v_name text := private.trim_text(p_name);
  v_observation text := nullif(private.trim_text(p_observation), '');
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
  if p_type is null or p_type not in ('Refeição', 'Lazer', 'Atividade') then
    raise exception 'INVALID_ACTIVITY_TYPE' using errcode = '22023';
  end if;

  if p_expected_version = 0 then
    insert into public.activities (
      id, trip_id, starts_at, budget_cents, name, type, observation, place_id,
      manual_place_name, manual_place_address, manual_place_url,
      osm_place_id, osm_place_name, osm_place_address, osm_latitude, osm_longitude
    ) values (
      p_id, p_trip_id, p_starts_at, p_budget_cents, v_name, p_type, v_observation, v_place_id,
      v_manual_name, v_manual_address, v_manual_url,
      v_osm_id, v_osm_name, v_osm_address, p_osm_latitude, p_osm_longitude
    ) on conflict (id) do nothing returning * into v_activity;

    if not found then
      select * into v_activity from public.activities where id = p_id and trip_id = p_trip_id;
      -- A lost successful response may be retried using the same UUID and data.
      if v_activity.id is null or v_activity.version <> 1 or
        v_activity.starts_at is distinct from p_starts_at or
        v_activity.budget_cents is distinct from p_budget_cents or
        v_activity.name is distinct from v_name or v_activity.type is distinct from p_type or
        v_activity.observation is distinct from v_observation or
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
      observation = v_observation,
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

revoke all on function public.save_activity(
  uuid, uuid, integer, timestamptz, bigint, text, text, text, text, text, text,
  text, text, text, double precision, double precision, text
) from public, anon;
grant execute on function public.save_activity(
  uuid, uuid, integer, timestamptz, bigint, text, text, text, text, text, text,
  text, text, text, double precision, double precision, text
) to authenticated;

notify pgrst, 'reload schema';
commit;
