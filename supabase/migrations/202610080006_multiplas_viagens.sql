-- Incremental private collections, multiple trips, history and archiving.
-- Existing IDs, memberships, invites, activities and expenses are preserved.
-- Re-running never promotes a trip-only member to collection access.
begin;

create table if not exists public.trip_collections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create table if not exists public.collection_members (
  collection_id uuid not null references public.trip_collections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (collection_id, user_id)
);
create index if not exists collection_members_user_idx on public.collection_members(user_id, collection_id);
alter table public.trips add column if not exists collection_id uuid references public.trip_collections(id);
alter table public.trips add column if not exists archived_at timestamptz;

-- Only previously unassigned legacy trips are migrated. Every old membership,
-- including an owner invite, retains its single-trip scope. Collection access
-- requires a new explicit invitation; migration never grants broader authority.
do $$
declare v_trip record; v_collection_id uuid;
begin
  for v_trip in select id from public.trips where collection_id is null loop
    insert into public.trip_collections default values returning id into v_collection_id;
    update public.trips set collection_id = v_collection_id where id = v_trip.id;
  end loop;
end;
$$;
alter table public.trips alter column collection_id set not null;
create index if not exists trips_collection_archive_date_idx on public.trips(collection_id, archived_at, start_date, end_date, id);
create index if not exists trips_archive_updated_idx on public.trips(archived_at, updated_at desc, id);
create index if not exists activities_trip_id_page_idx on public.activities(trip_id, id);
create index if not exists trip_expenses_trip_id_page_idx on public.trip_expenses(trip_id, id);

create or replace function private.is_collection_member(p_collection_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.collection_members m
    where m.collection_id = p_collection_id and m.user_id = (select auth.uid()));
$$;
create or replace function private.is_collection_owner(p_collection_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.collection_members m
    where m.collection_id = p_collection_id and m.user_id = (select auth.uid()) and m.role = 'owner');
$$;
create or replace function private.is_trip_member(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = (select auth.uid()))
    or exists (select 1 from public.trips t join public.collection_members m on m.collection_id = t.collection_id
      where t.id = p_trip_id and m.user_id = (select auth.uid()));
$$;
create or replace function private.is_trip_owner(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = (select auth.uid()) and m.role = 'owner')
    or exists (select 1 from public.trips t join public.collection_members m on m.collection_id = t.collection_id
      where t.id = p_trip_id and m.user_id = (select auth.uid()) and m.role = 'owner');
$$;
revoke all on function private.is_collection_member(uuid), private.is_collection_owner(uuid) from public, anon;
grant execute on function private.is_collection_member(uuid), private.is_collection_owner(uuid) to authenticated;

alter table public.trip_collections enable row level security;
alter table public.collection_members enable row level security;
revoke all on public.trip_collections, public.collection_members from public, anon, authenticated;
grant select on public.trip_collections, public.collection_members to authenticated;
grant all on public.trip_collections, public.collection_members to service_role;
drop policy if exists collection_member_read on public.trip_collections;
create policy collection_member_read on public.trip_collections for select to authenticated
using ((select private.is_collection_member(id)));
drop policy if exists own_collection_membership_read on public.collection_members;
create policy own_collection_membership_read on public.collection_members for select to authenticated
using (user_id = (select auth.uid()));

-- End the historical public auto-association path. Preserve its data and
-- memberships, but even an accidentally re-granted RPC can no longer add members.
create or replace function public.open_shared_trip()
returns table (trip_id uuid, role text)
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'PRIVATE_ACCESS_REQUIRED' using errcode = '42501';
end;
$$;
revoke all on function public.open_shared_trip() from public, anon, authenticated;
grant execute on function public.create_trip_invite(uuid, text, integer, integer),
  public.list_trip_invites(uuid), public.revoke_trip_invite(uuid), public.redeem_trip_invite(text) to authenticated;

create or replace function private.prevent_trip_transfer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.trip_id is distinct from old.trip_id then
    raise exception 'ACTIVITY_TRIP_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_trip_transfer() from public, anon, authenticated;
drop trigger if exists activities_trip_immutable on public.activities;
create trigger activities_trip_immutable before update of trip_id on public.activities
for each row execute function private.prevent_trip_transfer();
create or replace function private.prevent_collection_transfer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.collection_id is distinct from old.collection_id then
    raise exception 'TRIP_COLLECTION_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_collection_transfer() from public, anon, authenticated;
drop trigger if exists trips_collection_immutable on public.trips;
create trigger trips_collection_immutable before update of collection_id on public.trips
for each row execute function private.prevent_collection_transfer();

create or replace function public.list_authorized_collections()
returns table(id uuid, role text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, m.role, c.created_at from public.trip_collections c
  join public.collection_members m on m.collection_id = c.id
  where m.user_id = (select auth.uid()) order by c.created_at, c.id;
$$;

create or replace function public.create_private_trip(
  p_id uuid, p_collection_id uuid, p_name text, p_destination text,
  p_start_date date, p_end_date date, p_timezone text, p_person_one text,
  p_person_two text, p_initial_budget_cents bigint
)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_collection_id uuid := p_collection_id;
  v_name text := private.trim_text(p_name);
  v_destination text := nullif(private.trim_text(p_destination), '');
  v_person_one text := nullif(private.trim_text(p_person_one), '');
  v_person_two text := nullif(private.trim_text(p_person_two), '');
begin
  if auth.uid() is null then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  if p_id is null then raise exception 'INVALID_TRIP_ID' using errcode = '22023'; end if;
  if p_initial_budget_cents is null or p_initial_budget_cents not between 0 and 999999999999 then
    raise exception 'INVALID_INITIAL_BUDGET' using errcode = '22023';
  end if;
  -- Concurrent submissions with the same client-generated UUID share one transaction path.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
  select * into v_trip from public.trips where id = p_id;
  if found then
    if not exists (select 1 from public.trip_members m where m.trip_id = p_id and m.user_id = auth.uid() and m.role = 'owner')
      or (p_collection_id is not null and v_trip.collection_id is distinct from p_collection_id)
      or v_trip.version <> 1 or v_trip.archived_at is not null
      or v_trip.name is distinct from v_name or v_trip.destination is distinct from v_destination
      or v_trip.start_date is distinct from p_start_date or v_trip.end_date is distinct from p_end_date
      or v_trip.timezone is distinct from p_timezone or v_trip.person_one is distinct from v_person_one
      or v_trip.person_two is distinct from v_person_two or v_trip.initial_budget_cents is distinct from p_initial_budget_cents then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
    return v_trip;
  end if;
  if v_collection_id is null then
    insert into public.trip_collections default values returning id into v_collection_id;
    insert into public.collection_members(collection_id, user_id, role) values(v_collection_id, auth.uid(), 'owner');
  elsif not private.is_collection_member(v_collection_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  insert into public.trips(id, collection_id, name, destination, start_date, end_date, timezone, person_one, person_two, initial_budget_cents)
  values(p_id, v_collection_id, v_name, v_destination, p_start_date, p_end_date, p_timezone, v_person_one, v_person_two, p_initial_budget_cents)
  returning * into v_trip;
  insert into public.trip_members(trip_id, user_id, role) values(v_trip.id, auth.uid(), 'owner');
  return v_trip;
end;
$$;

create or replace function public.set_trip_archived(p_id uuid, p_expected_version integer, p_archived boolean)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips;
begin
  if auth.uid() is null or not private.is_trip_member(p_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_archived is null then raise exception 'INVALID_ARCHIVE_OPTION' using errcode = '22023'; end if;
  update public.trips set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
    version = version + 1, updated_at = now()
  where id = p_id and version = p_expected_version returning * into v_trip;
  if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  return v_trip;
end;
$$;

-- Aggregation is over every expense in each authorized trip, independent of
-- list pagination/search. It never combines planning and actual spending.
create or replace function public.list_authorized_trips(
  p_limit integer default 50, p_offset integer default 0, p_search text default null, p_filter text default 'all'
)
returns table(
  id uuid, name text, destination text, start_date date, end_date date, timezone text,
  person_one text, person_two text, version integer, created_at timestamptz, updated_at timestamptz,
  initial_budget_cents bigint, collection_id uuid, archived_at timestamptz,
  total_spent_cents bigint, trip_role text, collection_role text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0
    or p_filter is null or p_filter not in ('all','upcoming','ongoing','past','archived','undated') then
    raise exception 'INVALID_LIST_OPTIONS' using errcode = '22023';
  end if;
  return query
  with visible as (
    select t.*, (now() at time zone t.timezone)::date as today,
      cm.role as collection_access,
      case when tm.role = 'owner' or cm.role = 'owner' then 'owner' else 'member' end as effective_role
    from public.trips t
    left join public.collection_members cm on cm.collection_id = t.collection_id and cm.user_id = auth.uid()
    left join public.trip_members tm on tm.trip_id = t.id and tm.user_id = auth.uid()
    where (cm.user_id is not null or tm.user_id is not null)
      and (nullif(private.trim_text(p_search), '') is null or
        position(lower(private.trim_text(p_search)) in lower(t.name)) > 0 or
        position(lower(private.trim_text(p_search)) in lower(coalesce(t.destination, ''))) > 0)
  ), classified as (
    select v.*, case when v.start_date is null or v.end_date is null then 'undated'
      when v.today < v.start_date then 'upcoming' when v.today > v.end_date then 'past' else 'ongoing' end as status
    from visible v
  )
  select t.id, t.name, t.destination, t.start_date, t.end_date, t.timezone, t.person_one, t.person_two,
    t.version, t.created_at, t.updated_at, t.initial_budget_cents, t.collection_id, t.archived_at,
    coalesce((select sum(e.amount_cents) from public.trip_expenses e where e.trip_id = t.id), 0)::bigint,
    t.effective_role, t.collection_access
  from classified t
  where (p_filter = 'archived' and t.archived_at is not null) or
    (p_filter <> 'archived' and t.archived_at is null and (p_filter = 'all' or p_filter = t.status))
  order by case t.status when 'ongoing' then 0 when 'upcoming' then 1 when 'past' then 2 else 3 end,
    case when t.status in ('ongoing','upcoming') then t.start_date end asc,
    case when t.status = 'past' then t.end_date end desc, t.created_at desc, t.id
  limit p_limit offset p_offset;
end;
$$;

create table if not exists public.collection_invites (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.trip_collections(id) on delete cascade,
  token_hash bytea not null unique check(octet_length(token_hash) = 32),
  role text not null default 'member' check(role in ('owner','member')),
  expires_at timestamptz not null check(isfinite(expires_at)),
  max_uses integer not null default 1 check(max_uses between 1 and 20),
  use_count integer not null default 0 check(use_count >= 0 and use_count <= max_uses),
  revoked_at timestamptz, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), last_used_at timestamptz
);
create index if not exists collection_invites_created_idx on public.collection_invites(collection_id, created_at desc);
create table if not exists private.collection_invite_redemptions (
  invite_id uuid not null references public.collection_invites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(), primary key(invite_id,user_id)
);
alter table public.collection_invites enable row level security;
alter table private.collection_invite_redemptions enable row level security;
revoke all on public.collection_invites, private.collection_invite_redemptions from public, anon, authenticated;
grant all on public.collection_invites to service_role;

create or replace function public.create_collection_invite(
  p_collection_id uuid, p_role text default 'member', p_max_uses integer default 1, p_expires_in_hours integer default 24
)
returns table(invite_id uuid, token text, expires_at timestamptz, max_uses integer, role text)
language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex'); v_invite public.collection_invites;
begin
  if auth.uid() is null or not private.is_collection_owner(p_collection_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner','member') or p_max_uses is null or p_max_uses not between 1 and 20
    or p_expires_in_hours is null or p_expires_in_hours not between 1 and 168 then
    raise exception 'INVALID_INVITE_OPTIONS' using errcode = '22023';
  end if;
  insert into public.collection_invites(collection_id, token_hash, role, expires_at, max_uses, created_by)
  values(p_collection_id, extensions.digest(v_token,'sha256'), p_role,
    now() + make_interval(hours => p_expires_in_hours), p_max_uses, auth.uid()) returning * into v_invite;
  return query select v_invite.id,v_token,v_invite.expires_at,v_invite.max_uses,v_invite.role;
end;
$$;
create or replace function public.list_collection_invites(p_collection_id uuid)
returns table(id uuid, role text, expires_at timestamptz, max_uses integer, use_count integer,
  revoked_at timestamptz, created_at timestamptz, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_collection_owner(p_collection_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  return query select i.id,i.role,i.expires_at,i.max_uses,i.use_count,i.revoked_at,i.created_at,i.last_used_at
  from public.collection_invites i where i.collection_id = p_collection_id order by i.created_at desc;
end;
$$;
create or replace function public.revoke_collection_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_collection_id uuid;
begin
  select collection_id into v_collection_id from public.collection_invites where id = p_invite_id;
  if auth.uid() is null or v_collection_id is null or not private.is_collection_owner(v_collection_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  update public.collection_invites set revoked_at = coalesce(revoked_at,now()) where id = p_invite_id;
end;
$$;
create or replace function public.redeem_collection_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite public.collection_invites; v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_INVITE' using errcode = '22023'; end if;
  select * into v_invite from public.collection_invites where token_hash = extensions.digest(p_token,'sha256') for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
    raise exception 'INVALID_INVITE' using errcode = '22023';
  end if;
  if exists(select 1 from private.collection_invite_redemptions where invite_id = v_invite.id and user_id = v_user_id) then
    if private.is_collection_member(v_invite.collection_id) then return v_invite.collection_id; end if;
    raise exception 'INVALID_INVITE' using errcode = '22023';
  end if;
  if v_invite.use_count >= v_invite.max_uses then raise exception 'INVALID_INVITE' using errcode = '22023'; end if;
  insert into public.collection_members(collection_id,user_id,role) values(v_invite.collection_id,v_user_id,v_invite.role)
  on conflict(collection_id,user_id) do update set role = case
    when public.collection_members.role = 'owner' or excluded.role = 'owner' then 'owner' else 'member' end;
  insert into private.collection_invite_redemptions(invite_id,user_id) values(v_invite.id,v_user_id);
  update public.collection_invites set use_count = use_count + 1,last_used_at = now() where id = v_invite.id;
  return v_invite.collection_id;
end;
$$;

-- Administrative recovery remains an explicit, locally executed workflow.
-- Single-trip recovery never grants collection access.
create or replace function public.provision_trip_owner(p_trip_id uuid default null,p_name text default 'Nossa Viagem')
returns table(trip_id uuid,invite_id uuid,token text,expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid := p_trip_id; v_collection_id uuid; v_invite public.trip_invites;
  v_token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  if v_trip_id is null then
    insert into public.trip_collections default values returning id into v_collection_id;
    insert into public.trips(name,collection_id) values(private.trim_text(p_name),v_collection_id) returning id into v_trip_id;
  elsif not exists(select 1 from public.trips where id = v_trip_id) then
    raise exception 'TRIP_NOT_FOUND' using errcode = '22023';
  end if;
  insert into public.trip_invites(trip_id,token_hash,role,expires_at,max_uses)
  values(v_trip_id,extensions.digest(v_token,'sha256'),'owner',now() + interval '24 hours',1) returning * into v_invite;
  return query select v_trip_id,v_invite.id,v_token,v_invite.expires_at;
end;
$$;
create or replace function public.provision_collection_owner(p_trip_id uuid)
returns table(collection_id uuid,invite_id uuid,token text,expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_collection_id uuid; v_invite public.collection_invites; v_token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  select t.collection_id into v_collection_id from public.trips t where t.id = p_trip_id;
  if v_collection_id is null then raise exception 'TRIP_NOT_FOUND' using errcode = '22023'; end if;
  insert into public.collection_invites(collection_id,token_hash,role,expires_at,max_uses)
  values(v_collection_id,extensions.digest(v_token,'sha256'),'owner',now() + interval '24 hours',1) returning * into v_invite;
  return query select v_collection_id,v_invite.id,v_token,v_invite.expires_at;
end;
$$;

revoke all on function public.list_authorized_collections(), public.create_private_trip(uuid,uuid,text,text,date,date,text,text,text,bigint),
  public.set_trip_archived(uuid,integer,boolean), public.list_authorized_trips(integer,integer,text,text),
  public.create_collection_invite(uuid,text,integer,integer), public.list_collection_invites(uuid),
  public.revoke_collection_invite(uuid), public.redeem_collection_invite(text) from public, anon;
grant execute on function public.list_authorized_collections(), public.create_private_trip(uuid,uuid,text,text,date,date,text,text,text,bigint),
  public.set_trip_archived(uuid,integer,boolean), public.list_authorized_trips(integer,integer,text,text),
  public.create_collection_invite(uuid,text,integer,integer), public.list_collection_invites(uuid),
  public.revoke_collection_invite(uuid), public.redeem_collection_invite(text) to authenticated;
revoke all on function public.provision_trip_owner(uuid,text), public.provision_collection_owner(uuid) from public, anon, authenticated;
grant execute on function public.provision_trip_owner(uuid,text), public.provision_collection_owner(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
