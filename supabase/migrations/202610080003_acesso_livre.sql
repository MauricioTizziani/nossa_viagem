-- Run after migrations 001 and 002. Changes access without deleting trip data.
-- The user explicitly approved fully open reading and editing on this app.
begin;

create table if not exists private.shared_trip (
  singleton boolean primary key default true check (singleton),
  trip_id uuid not null references public.trips(id)
);
alter table private.shared_trip enable row level security;
revoke all on private.shared_trip from public, anon, authenticated;

-- Preserve the trip with the most saved activities. For ties, use the oldest.
-- An empty installation gets one trip here, rather than one per visitor.
do $$
declare v_trip_id uuid;
begin
  if not exists (select 1 from private.shared_trip) then
    select t.id into v_trip_id from public.trips t
    order by (select count(*) from public.activities a where a.trip_id = t.id) desc,
             t.created_at asc, t.id asc limit 1;
    if v_trip_id is null then
      insert into public.trips(name) values ('Nossa Viagem') returning id into v_trip_id;
    end if;
    insert into private.shared_trip(singleton, trip_id) values (true, v_trip_id);
  end if;
end;
$$;

create or replace function public.open_shared_trip()
returns table (trip_id uuid, role text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_trip_id uuid;
begin
  if v_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  select s.trip_id into v_trip_id from private.shared_trip s where s.singleton = true;
  if v_trip_id is null then
    raise exception 'SHARED_TRIP_NOT_CONFIGURED' using errcode = '22023';
  end if;
  insert into public.trip_members(trip_id, user_id, role)
  values (v_trip_id, v_user_id, 'member') on conflict do nothing;
  return query select m.trip_id, m.role from public.trip_members m
  where m.trip_id = v_trip_id and m.user_id = v_user_id;
end;
$$;
revoke all on function public.open_shared_trip() from public, anon;
grant execute on function public.open_shared_trip() to authenticated;

-- Retain historic receipts/data, but disable the obsolete invitation workflow.
revoke all on function public.create_trip_invite(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.list_trip_invites(uuid) from public, anon, authenticated;
revoke all on function public.revoke_trip_invite(uuid) from public, anon, authenticated;
revoke all on function public.redeem_trip_invite(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
