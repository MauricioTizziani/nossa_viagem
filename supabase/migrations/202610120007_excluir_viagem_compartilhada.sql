-- The legacy shared-trip pointer must not prevent a trip from being deleted.
-- Deleting its target also removes the obsolete pointer.
begin;

alter table private.shared_trip
  drop constraint if exists shared_trip_trip_id_fkey;
alter table private.shared_trip
  add constraint shared_trip_trip_id_fkey
  foreign key (trip_id) references public.trips(id) on delete cascade;

notify pgrst, 'reload schema';
commit;
