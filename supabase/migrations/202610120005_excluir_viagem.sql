-- Permanently remove one trip and every record owned by it. Only trip owners
-- can invoke this RPC; the expected version prevents deleting a stale record.
begin;

create or replace function public.delete_trip(p_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_trip_owner(p_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  delete from public.trips where id = p_id and version = p_expected_version;
  if not found then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
end;
$$;

revoke all on function public.delete_trip(uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_trip(uuid, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
