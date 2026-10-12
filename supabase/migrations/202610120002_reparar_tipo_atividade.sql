-- Re-establish the exact activity type values shown by the client.
-- This repairs deployments whose check constraint drifted from the app schema.
-- Existing rows are never rewritten; unexpected legacy values stop the migration.
begin;

do $$
begin
  if exists (
    select 1 from public.activities
    where type is null or type not in ('Refeição', 'Lazer', 'Atividade')
  ) then
    raise exception 'ACTIVITY_TYPE_REPAIR_BLOCKED: existing activity types need review';
  end if;
end;
$$;

do $$
declare
  v_type_attnum smallint;
  v_constraint record;
begin
  select attnum into v_type_attnum
  from pg_catalog.pg_attribute
  where attrelid = 'public.activities'::regclass
    and attname = 'type'
    and not attisdropped;

  if v_type_attnum is null then
    raise exception 'ACTIVITY_TYPE_REPAIR_BLOCKED: public.activities.type is missing';
  end if;

  for v_constraint in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.activities'::regclass
      and contype = 'c'
      and conkey = array[v_type_attnum]
  loop
    execute pg_catalog.format(
      'alter table public.activities drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.activities
  add constraint activities_type_check
  check (type in ('Refeição', 'Lazer', 'Atividade'));

commit;
