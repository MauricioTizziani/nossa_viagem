-- Run after migrations 001 to 004. Adds the trip's initial budget without
-- deleting data, creating expenses, creating activities, or changing existing amounts.
-- Null means the budget was not informed. Zero is a valid budget. The column is a
-- reference: activities and expenses never decrement it.
-- Safe to re-run.
begin;

alter table public.trips add column if not exists initial_budget_cents bigint;
alter table public.trips drop constraint if exists trips_initial_budget_cents_check;
alter table public.trips add constraint trips_initial_budget_cents_check
  check (initial_budget_cents is null or initial_budget_cents between 0 and 999999999999);
comment on column public.trips.initial_budget_cents is
  'Reference budget for the couple, in integer centavos. Null means not informed. Never decremented by activities or expenses.';

-- One signature only, so PostgREST does not see two update_trip overloads.
-- The last two arguments default, so callers that omit them keep the stored budget.
drop function if exists public.update_trip(uuid, integer, text, text, date, date, text, text, text);
drop function if exists public.update_trip(uuid, integer, text, text, date, date, text, text, text, bigint, boolean);

create function public.update_trip(
  p_id uuid,
  p_expected_version integer,
  p_name text,
  p_destination text,
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_person_one text,
  p_person_two text,
  p_initial_budget_cents bigint default null,
  p_touch_budget boolean default false
)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips;
begin
  if auth.uid() is null or not private.is_trip_member(p_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if coalesce(p_touch_budget, false) and p_initial_budget_cents is not null
     and (p_initial_budget_cents < 0 or p_initial_budget_cents > 999999999999) then
    raise exception 'INVALID_INITIAL_BUDGET' using errcode = '22023';
  end if;
  update public.trips set
    name = private.trim_text(p_name), destination = nullif(private.trim_text(p_destination), ''),
    start_date = p_start_date, end_date = p_end_date, timezone = p_timezone,
    person_one = nullif(private.trim_text(p_person_one), ''), person_two = nullif(private.trim_text(p_person_two), ''),
    initial_budget_cents = case when coalesce(p_touch_budget, false) then p_initial_budget_cents else initial_budget_cents end,
    version = version + 1, updated_at = now()
  where id = p_id and version = p_expected_version returning * into v_trip;
  if not found then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  return v_trip;
end;
$$;

revoke all on function public.update_trip(uuid, integer, text, text, date, date, text, text, text, bigint, boolean) from public, anon;
grant execute on function public.update_trip(uuid, integer, text, text, date, date, text, text, text, bigint, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
