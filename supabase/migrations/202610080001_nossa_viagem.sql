-- Nossa Viagem: private-by-default trip data and controlled device access.
-- Run once through Supabase migrations or SQL Editor as the database owner.
begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Match JavaScript trim(), including tabs, line breaks and Unicode spaces.
-- Required names made only of whitespace must also fail at the database.
create function private.trim_text(p_text text)
returns text language sql immutable strict set search_path = '' as $$
  select btrim(p_text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
revoke all on function private.trim_text(text) from public, anon;
grant execute on function private.trim_text(text) to authenticated, service_role;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Nossa Viagem' check (name = private.trim_text(name) and char_length(name) between 1 and 160),
  destination text check (destination is null or (destination = private.trim_text(destination) and char_length(destination) between 1 and 240)),
  start_date date check (start_date is null or isfinite(start_date)),
  end_date date check (end_date is null or isfinite(end_date)),
  timezone text not null default 'America/Sao_Paulo' check (char_length(timezone) between 1 and 100),
  person_one text check (person_one is null or (person_one = private.trim_text(person_one) and char_length(person_one) between 1 and 80)),
  person_two text check (person_two is null or (person_two = private.trim_text(person_two) and char_length(person_two) between 1 and 80)),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_period_order check (start_date is null or end_date is null or end_date >= start_date)
);

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index trip_members_user_id_idx on public.trip_members(user_id, trip_id);

create table public.activities (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  starts_at timestamptz not null check (isfinite(starts_at)),
  budget_cents bigint check (budget_cents is null or budget_cents between 0 and 999999999999),
  name text not null check (name = private.trim_text(name) and char_length(name) between 1 and 160),
  type text not null check (type in ('Refeição', 'Lazer', 'Atividade')),
  -- Only the durable place identifier is retained for a Google-selected place.
  place_id text check (place_id is null or (place_id = private.trim_text(place_id) and char_length(place_id) between 1 and 512)),
  manual_place_name text check (manual_place_name is null or (manual_place_name = private.trim_text(manual_place_name) and char_length(manual_place_name) between 1 and 240)),
  manual_place_address text check (manual_place_address is null or (manual_place_address = private.trim_text(manual_place_address) and char_length(manual_place_address) between 1 and 1000)),
  manual_place_url text check (manual_place_url is null or char_length(manual_place_url) between 1 and 2048),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_source_exclusive check (
    place_id is null or (manual_place_name is null and manual_place_address is null and manual_place_url is null)
  ),
  constraint manual_maps_url_valid check (
    manual_place_url is null or
    manual_place_url ~ '^https://(maps\.app\.goo\.gl/[^[:space:]]+|goo\.gl/maps/[^[:space:]]+|(www\.)?google\.(com|com\.br|co\.uk|pt|es|fr|it|de|ca|com\.ar|com\.mx|cl)/maps([/?#][^[:space:]]*)?|maps\.google\.(com|com\.br|co\.uk|pt|es|fr|it|de|ca|com\.ar|com\.mx|cl)([/?#][^[:space:]]*)?)$'
  )
);
create index activities_trip_starts_at_idx on public.activities(trip_id, starts_at, id);
create index activities_trip_type_idx on public.activities(trip_id, type);

create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  role text not null default 'member' check (role in ('owner', 'member')),
  expires_at timestamptz not null check (isfinite(expires_at)),
  max_uses integer not null default 1 check (max_uses between 1 and 20),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= max_uses),
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index trip_invites_trip_created_idx on public.trip_invites(trip_id, created_at desc);

-- A receipt makes a retry by the same session idempotent, including a retry
-- after the last allowed redemption committed but its HTTP response was lost.
create table private.invite_redemptions (
  invite_id uuid not null references public.trip_invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);
revoke all on private.invite_redemptions from public, anon, authenticated;
-- Internal receipts have no client policies; only owner-executed functions access them.
alter table private.invite_redemptions enable row level security;

create function private.is_trip_member(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = (select auth.uid())
  );
$$;
create function private.is_trip_owner(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
revoke all on function private.is_trip_member(uuid), private.is_trip_owner(uuid) from public, anon;
grant execute on function private.is_trip_member(uuid), private.is_trip_owner(uuid) to authenticated;

create function private.validate_trip_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'INVALID_TIMEZONE' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_trip_timezone() from public, anon, authenticated;
create trigger trips_validate_timezone before insert or update of timezone on public.trips
for each row execute function private.validate_trip_timezone();

alter table public.trips enable row level security;
alter table public.activities enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;

-- Read-only table grants; all writes below check membership inside their RPC.
revoke all on public.trips, public.activities, public.trip_members, public.trip_invites from public, anon, authenticated;
grant select on public.trips, public.activities, public.trip_members to authenticated;
grant all on public.trips, public.activities, public.trip_members, public.trip_invites to service_role;
create policy trip_member_read on public.trips for select to authenticated
using ((select private.is_trip_member(id)));
create policy activity_member_read on public.activities for select to authenticated
using ((select private.is_trip_member(trip_id)));
create policy own_membership_read on public.trip_members for select to authenticated
using (user_id = (select auth.uid()));
-- trip_invites deliberately has no table policy or client grant. Owners use
-- list_trip_invites, which never exposes token_hash or raw invite tokens.

create function public.save_activity(
  p_trip_id uuid,
  p_id uuid,
  p_expected_version integer,
  p_starts_at timestamptz,
  p_budget_cents bigint,
  p_name text,
  p_type text,
  p_place_id text,
  p_manual_place_name text,
  p_manual_place_address text,
  p_manual_place_url text
)
returns public.activities language plpgsql security definer set search_path = '' as $$
declare
  v_activity public.activities;
  v_name text := private.trim_text(p_name);
  v_place_id text := nullif(private.trim_text(p_place_id), '');
  v_manual_name text := nullif(private.trim_text(p_manual_place_name), '');
  v_manual_address text := nullif(private.trim_text(p_manual_place_address), '');
  v_manual_url text := nullif(private.trim_text(p_manual_place_url), '');
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
      manual_place_name, manual_place_address, manual_place_url
    ) values (
      p_id, p_trip_id, p_starts_at, p_budget_cents, v_name, p_type, v_place_id,
      v_manual_name, v_manual_address, v_manual_url
    ) on conflict (id) do nothing returning * into v_activity;

    if not found then
      select * into v_activity from public.activities where id = p_id and trip_id = p_trip_id;
      -- A lost successful response may be retried using the same UUID and data.
      if v_activity.id is null or v_activity.version <> 1 or
        v_activity.starts_at is distinct from p_starts_at or
        v_activity.budget_cents is distinct from p_budget_cents or
        v_activity.name is distinct from v_name or v_activity.type is distinct from p_type or
        v_activity.place_id is distinct from v_place_id or
        v_activity.manual_place_name is distinct from v_manual_name or
        v_activity.manual_place_address is distinct from v_manual_address or
        v_activity.manual_place_url is distinct from v_manual_url then
        raise exception 'VERSION_CONFLICT' using errcode = '40001';
      end if;
    end if;
  else
    update public.activities set
      starts_at = p_starts_at, budget_cents = p_budget_cents, name = v_name, type = p_type,
      place_id = v_place_id, manual_place_name = v_manual_name,
      manual_place_address = v_manual_address, manual_place_url = v_manual_url,
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

create function public.delete_activity(p_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.activities where id = p_id;
  if auth.uid() is null or v_trip_id is null or not private.is_trip_member(v_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  delete from public.activities where id = p_id and version = p_expected_version;
  if not found then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  update public.trips set updated_at = now() where id = v_trip_id;
end;
$$;

create function public.update_trip(
  p_id uuid,
  p_expected_version integer,
  p_name text,
  p_destination text,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_person_one text,
  p_person_two text
)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips;
begin
  if auth.uid() is null or not private.is_trip_member(p_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  update public.trips set
    name = private.trim_text(p_name), destination = nullif(private.trim_text(p_destination), ''),
    start_date = p_start_date, end_date = p_end_date, timezone = p_timezone,
    person_one = nullif(private.trim_text(p_person_one), ''), person_two = nullif(private.trim_text(p_person_two), ''),
    version = version + 1, updated_at = now()
  where id = p_id and version = p_expected_version returning * into v_trip;
  if not found then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  return v_trip;
end;
$$;

create function public.create_trip_invite(
  p_trip_id uuid,
  p_role text default 'member',
  p_max_uses integer default 1,
  p_expires_in_hours integer default 24
)
returns table (invite_id uuid, token text, expires_at timestamptz, max_uses integer, role text)
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_invite public.trip_invites;
begin
  if auth.uid() is null or not private.is_trip_owner(p_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'member') or
     p_max_uses is null or p_max_uses not between 1 and 20 or
     p_expires_in_hours is null or p_expires_in_hours not between 1 and 168 then
    raise exception 'INVALID_INVITE_OPTIONS' using errcode = '22023';
  end if;
  insert into public.trip_invites (trip_id, token_hash, role, expires_at, max_uses, created_by)
  values (p_trip_id, extensions.digest(v_token, 'sha256'), p_role,
          now() + make_interval(hours => p_expires_in_hours), p_max_uses, auth.uid())
  returning * into v_invite;
  return query select v_invite.id, v_token, v_invite.expires_at, v_invite.max_uses, v_invite.role;
end;
$$;

create function public.list_trip_invites(p_trip_id uuid)
returns table (id uuid, role text, expires_at timestamptz, max_uses integer, use_count integer,
               revoked_at timestamptz, created_at timestamptz, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_trip_owner(p_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  return query select i.id, i.role, i.expires_at, i.max_uses, i.use_count,
                      i.revoked_at, i.created_at, i.last_used_at
  from public.trip_invites i where i.trip_id = p_trip_id order by i.created_at desc;
end;
$$;

create function public.revoke_trip_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.trip_invites where id = p_invite_id;
  if auth.uid() is null or v_trip_id is null or not private.is_trip_owner(v_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  update public.trip_invites set revoked_at = coalesce(revoked_at, now()) where id = p_invite_id;
end;
$$;

create function public.redeem_trip_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.trip_invites;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INVITE' using errcode = '22023';
  end if;
  -- Row locking serializes concurrent redemptions of the final remaining use.
  select * into v_invite from public.trip_invites
  where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
    raise exception 'INVALID_INVITE' using errcode = '22023';
  end if;
  if exists (select 1 from private.invite_redemptions
             where invite_id = v_invite.id and user_id = v_user_id) then
    if exists (select 1 from public.trip_members where trip_id = v_invite.trip_id and user_id = v_user_id) then
      return v_invite.trip_id;
    end if;
    raise exception 'INVALID_INVITE' using errcode = '22023';
  end if;
  if v_invite.use_count >= v_invite.max_uses then
    raise exception 'INVALID_INVITE' using errcode = '22023';
  end if;
  insert into public.trip_members (trip_id, user_id, role)
  values (v_invite.trip_id, v_user_id, v_invite.role)
  on conflict (trip_id, user_id) do update
    set role = case when public.trip_members.role = 'owner' or excluded.role = 'owner' then 'owner' else 'member' end;
  insert into private.invite_redemptions (invite_id, user_id) values (v_invite.id, v_user_id);
  update public.trip_invites set use_count = use_count + 1, last_used_at = now() where id = v_invite.id;
  return v_invite.trip_id;
end;
$$;

-- This function is never granted to browser roles. The local owner's script is
-- the sole bootstrap/recovery path, backed by a secret service credential.
create function public.provision_trip_owner(p_trip_id uuid default null, p_name text default 'Nossa Viagem')
returns table (trip_id uuid, invite_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid := p_trip_id;
  v_invite public.trip_invites;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_trip_id is null then
    insert into public.trips (name) values (private.trim_text(p_name)) returning id into v_trip_id;
  elsif not exists (select 1 from public.trips where id = v_trip_id) then
    raise exception 'TRIP_NOT_FOUND' using errcode = '22023';
  end if;
  insert into public.trip_invites (trip_id, token_hash, role, expires_at, max_uses)
  values (v_trip_id, extensions.digest(v_token, 'sha256'), 'owner', now() + interval '24 hours', 1)
  returning * into v_invite;
  return query select v_trip_id, v_invite.id, v_token, v_invite.expires_at;
end;
$$;

revoke all on function public.save_activity(uuid, uuid, integer, timestamptz, bigint, text, text, text, text, text, text) from public, anon;
revoke all on function public.delete_activity(uuid, integer) from public, anon;
revoke all on function public.update_trip(uuid, integer, text, text, date, date, text, text, text) from public, anon;
revoke all on function public.create_trip_invite(uuid, text, integer, integer) from public, anon;
revoke all on function public.list_trip_invites(uuid) from public, anon;
revoke all on function public.revoke_trip_invite(uuid) from public, anon;
revoke all on function public.redeem_trip_invite(text) from public, anon;
revoke all on function public.provision_trip_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.save_activity(uuid, uuid, integer, timestamptz, bigint, text, text, text, text, text, text) to authenticated;
grant execute on function public.delete_activity(uuid, integer) to authenticated;
grant execute on function public.update_trip(uuid, integer, text, text, date, date, text, text, text) to authenticated;
grant execute on function public.create_trip_invite(uuid, text, integer, integer) to authenticated;
grant execute on function public.list_trip_invites(uuid) to authenticated;
grant execute on function public.revoke_trip_invite(uuid) to authenticated;
grant execute on function public.redeem_trip_invite(text) to authenticated;
grant execute on function public.provision_trip_owner(uuid, text) to service_role;

-- Only the trip UPDATE is published. Activity writes touch trips.updated_at
-- without bumping its edit version, and clients refetch the itinerary under RLS.
-- This avoids Postgres Changes' unfiltered DELETE / RLS limitations entirely.
-- Auth, activities and invitation data are never placed in this publication.
alter table public.trips replica identity full;
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips') then
      alter publication supabase_realtime add table public.trips;
    end if;
  end if;
end;
$$;

commit;
