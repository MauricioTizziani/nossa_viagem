-- Any authorized trip member may share that trip and permanently delete it.
-- Members can manage only invitations they created and cannot invite owners.
begin;

create or replace function public.create_trip_invite(
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
  if auth.uid() is null or not private.is_trip_member(p_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if not private.is_trip_owner(p_trip_id) and p_role is distinct from 'member' then
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

create or replace function public.list_trip_invites(p_trip_id uuid)
returns table (id uuid, role text, expires_at timestamptz, max_uses integer, use_count integer,
               revoked_at timestamptz, created_at timestamptz, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_trip_member(p_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  return query select i.id, i.role, i.expires_at, i.max_uses, i.use_count,
                      i.revoked_at, i.created_at, i.last_used_at
  from public.trip_invites i
  where i.trip_id = p_trip_id
    and (private.is_trip_owner(p_trip_id) or i.created_by = auth.uid())
  order by i.created_at desc;
end;
$$;

create or replace function public.revoke_trip_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_created_by uuid;
begin
  select trip_id, created_by into v_trip_id, v_created_by
  from public.trip_invites where id = p_invite_id;
  if auth.uid() is null or v_trip_id is null or not private.is_trip_member(v_trip_id) or
     (not private.is_trip_owner(v_trip_id) and v_created_by is distinct from auth.uid()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  update public.trip_invites set revoked_at = coalesce(revoked_at, now()) where id = p_invite_id;
end;
$$;

create or replace function public.delete_trip(p_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_trip_member(p_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  delete from public.trips where id = p_id and version = p_expected_version;
  if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
end;
$$;

revoke all on function public.create_trip_invite(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.list_trip_invites(uuid) from public, anon, authenticated;
revoke all on function public.revoke_trip_invite(uuid) from public, anon, authenticated;
revoke all on function public.delete_trip(uuid, integer) from public, anon, authenticated;
grant execute on function public.create_trip_invite(uuid, text, integer, integer),
  public.list_trip_invites(uuid), public.revoke_trip_invite(uuid), public.delete_trip(uuid, integer)
  to authenticated;
notify pgrst, 'reload schema';
commit;
