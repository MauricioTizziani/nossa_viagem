-- A site invitation authorizes one other anonymous identity to the trips
-- owned by its creator, including trips created after the invitation.
-- Existing trip and collection memberships remain unchanged.
begin;

create table if not exists public.site_members (
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);
create index if not exists site_members_member_idx on public.site_members(member_id, owner_id);
alter table public.site_members enable row level security;
revoke all on public.site_members from public, anon, authenticated;
grant all on public.site_members to service_role;
drop policy if exists site_member_self_read on public.site_members;
create policy site_member_self_read on public.site_members for select to authenticated
  using (member_id = (select auth.uid()));

create table if not exists public.site_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  role text not null default 'member' check (role = 'member'),
  expires_at timestamptz not null check (isfinite(expires_at)),
  max_uses integer not null default 1 check (max_uses = 1),
  use_count integer not null default 0 check (use_count between 0 and max_uses),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists site_invites_owner_idx on public.site_invites(owner_id, created_at desc);
alter table public.site_invites enable row level security;
revoke all on public.site_invites from public, anon, authenticated;
grant all on public.site_invites to service_role;

create table if not exists private.site_invite_redemptions (
  invite_id uuid not null references public.site_invites(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (invite_id, member_id)
);
alter table private.site_invite_redemptions enable row level security;
revoke all on private.site_invite_redemptions from public, anon, authenticated;
grant all on private.site_invite_redemptions to service_role;

create or replace function private.is_trip_member(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = (select auth.uid()))
    or exists (select 1 from public.trips t join public.collection_members m on m.collection_id = t.collection_id
      where t.id = p_trip_id and m.user_id = (select auth.uid()))
    or exists (
      select 1 from public.site_members sm
      join public.trip_members owner_membership on owner_membership.user_id = sm.owner_id
        and owner_membership.trip_id = p_trip_id and owner_membership.role = 'owner'
      where sm.member_id = (select auth.uid())
    )
    or exists (
      select 1 from public.site_members sm
      join public.trips t on t.id = p_trip_id
      join public.collection_members owner_membership on owner_membership.collection_id = t.collection_id
        and owner_membership.user_id = sm.owner_id and owner_membership.role = 'owner'
      where sm.member_id = (select auth.uid())
    );
$$;

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
    where private.is_trip_member(t.id)
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

create or replace function public.create_site_invite()
returns table(invite_id uuid, token text, expires_at timestamptz, max_uses integer, role text)
language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex'); v_invite public.site_invites;
begin
  if auth.uid() is null then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  insert into public.site_invites(owner_id, token_hash, role, expires_at, max_uses)
    values(auth.uid(), extensions.digest(v_token, 'sha256'), 'member', now() + interval '24 hours', 1)
    returning * into v_invite;
  return query select v_invite.id, v_token, v_invite.expires_at, v_invite.max_uses, v_invite.role;
end;
$$;

create or replace function public.list_site_invites()
returns table(id uuid, role text, expires_at timestamptz, max_uses integer, use_count integer,
  revoked_at timestamptz, created_at timestamptz, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  return query select i.id, i.role, i.expires_at, i.max_uses, i.use_count, i.revoked_at, i.created_at, i.last_used_at
    from public.site_invites i where i.owner_id = auth.uid() order by i.created_at desc;
end;
$$;

create or replace function public.revoke_site_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  update public.site_invites set revoked_at = now()
    where id = p_invite_id and owner_id = auth.uid() and revoked_at is null;
  if not found then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
end;
$$;

create or replace function public.redeem_site_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite public.site_invites; v_user_id uuid := auth.uid(); v_hash bytea;
begin
  if v_user_id is null then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  if p_token is null or p_token !~* '^[0-9a-f]{64}$' then raise exception 'INVALID_INVITE' using errcode = '22023'; end if;
  v_hash := extensions.digest(lower(p_token), 'sha256');
  select i.* into v_invite from public.site_invites i where i.token_hash = v_hash for update;
  if not found or v_invite.owner_id = v_user_id then raise exception 'INVALID_INVITE' using errcode = '22023'; end if;

  if exists(select 1 from private.site_invite_redemptions r where r.invite_id = v_invite.id and r.member_id = v_user_id) then
    return v_invite.owner_id;
  end if;
  if v_invite.revoked_at is not null then raise exception 'INVITE_REVOKED' using errcode = '22023'; end if;
  if v_invite.expires_at <= now() then raise exception 'INVITE_EXPIRED' using errcode = '22023'; end if;
  if v_invite.use_count >= v_invite.max_uses then raise exception 'INVITE_EXHAUSTED' using errcode = '22023'; end if;

  insert into public.site_members(owner_id, member_id) values(v_invite.owner_id, v_user_id) on conflict do nothing;
  insert into private.site_invite_redemptions(invite_id, member_id) values(v_invite.id, v_user_id);
  update public.site_invites set use_count = use_count + 1, last_used_at = now() where id = v_invite.id;
  return v_invite.owner_id;
end;
$$;

revoke all on function public.create_site_invite(), public.list_site_invites(),
  public.revoke_site_invite(uuid), public.redeem_site_invite(text) from public, anon;
grant execute on function public.create_site_invite(), public.list_site_invites(),
  public.revoke_site_invite(uuid), public.redeem_site_invite(text) to authenticated;
notify pgrst, 'reload schema';
commit;
