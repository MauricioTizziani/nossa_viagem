-- Materialize accepted site-wide invitations as trip memberships so they work
-- with the same trip list and row-level policies used by other invitations.
-- This also repairs site invitations that were accepted before this migration.
begin;

create or replace function private.grant_site_trip_access(p_owner_id uuid, p_trip_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_members(trip_id, user_id, role)
  select distinct t.id, sm.member_id, 'member'
  from public.site_members sm
  join public.trips t on p_trip_id is null or t.id = p_trip_id
  where sm.owner_id = p_owner_id
    and (
      exists (select 1 from public.trip_members owner_membership
        where owner_membership.trip_id = t.id and owner_membership.user_id = sm.owner_id and owner_membership.role = 'owner')
      or exists (select 1 from public.collection_members owner_membership
        where owner_membership.collection_id = t.collection_id and owner_membership.user_id = sm.owner_id and owner_membership.role = 'owner')
    )
  on conflict (trip_id, user_id) do nothing;
end;
$$;

create or replace function private.propagate_site_access_from_trip_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.grant_site_trip_access(new.user_id, new.trip_id);
  return new;
end;
$$;

create or replace function private.propagate_site_access_from_collection_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.grant_site_trip_access(new.user_id);
  return new;
end;
$$;

create or replace function private.propagate_site_access_from_site_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.grant_site_trip_access(new.owner_id);
  return new;
end;
$$;

revoke all on function private.grant_site_trip_access(uuid, uuid),
  private.propagate_site_access_from_trip_owner(),
  private.propagate_site_access_from_collection_owner(),
  private.propagate_site_access_from_site_member() from public, anon, authenticated;

drop trigger if exists site_access_from_trip_owner on public.trip_members;
create trigger site_access_from_trip_owner after insert or update on public.trip_members
  for each row when (new.role = 'owner') execute function private.propagate_site_access_from_trip_owner();

drop trigger if exists site_access_from_collection_owner on public.collection_members;
create trigger site_access_from_collection_owner after insert or update on public.collection_members
  for each row when (new.role = 'owner') execute function private.propagate_site_access_from_collection_owner();

drop trigger if exists site_access_from_site_member on public.site_members;
create trigger site_access_from_site_member after insert on public.site_members
  for each row execute function private.propagate_site_access_from_site_member();

-- Backfill every previously redeemed site invitation without granting access
-- to trips where the inviter is only a member.
do $$
declare v_owner record;
begin
  for v_owner in select distinct owner_id from public.site_members loop
    perform private.grant_site_trip_access(v_owner.owner_id);
  end loop;
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
    perform private.grant_site_trip_access(v_invite.owner_id);
    return v_invite.owner_id;
  end if;
  if v_invite.revoked_at is not null then raise exception 'INVITE_REVOKED' using errcode = '22023'; end if;
  if v_invite.expires_at <= now() then raise exception 'INVITE_EXPIRED' using errcode = '22023'; end if;
  if v_invite.use_count >= v_invite.max_uses then raise exception 'INVITE_EXHAUSTED' using errcode = '22023'; end if;

  insert into public.site_members(owner_id, member_id) values(v_invite.owner_id, v_user_id) on conflict do nothing;
  perform private.grant_site_trip_access(v_invite.owner_id);
  insert into private.site_invite_redemptions(invite_id, member_id) values(v_invite.id, v_user_id);
  update public.site_invites set use_count = use_count + 1, last_used_at = now() where id = v_invite.id;
  return v_invite.owner_id;
end;
$$;

revoke all on function public.redeem_site_invite(text) from public, anon;
grant execute on function public.redeem_site_invite(text) to authenticated;
notify pgrst, 'reload schema';
commit;
