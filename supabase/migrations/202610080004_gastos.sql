-- Run after migrations 001, 002 and 003. Adds the trip expense control
-- without touching trips, activities, access or the schedule budgets.
-- Expenses are real spending; activity budgets remain plans. They are never summed together.
-- Safe to re-run: every statement checks for existing objects.
begin;

create table if not exists public.trip_expenses (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  description text not null check (description = private.trim_text(description) and char_length(description) between 1 and 200),
  -- The allowed values are installed below with Unicode escapes. An inline list
  -- here would be corrupted if this file were applied with a Windows-1252 client.
  category text not null,
  -- Integer centavos for the whole expense; zero, negative and absent values are rejected.
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  -- A calendar date chosen by the couple; never shifted by a session or device timezone.
  expense_date date not null check (isfinite(expense_date)),
  -- Deleting an activity keeps the expense and only clears the link.
  activity_id uuid references public.activities(id) on delete set null,
  notes text check (notes is null or (notes = private.trim_text(notes) and char_length(notes) between 1 and 2000)),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.trip_expenses is 'Expenses actually paid for a trip. Independent from schedule budgets.';
create index if not exists trip_expenses_trip_date_idx on public.trip_expenses(trip_id, expense_date desc, created_at desc, id);
create index if not exists trip_expenses_trip_category_idx on public.trip_expenses(trip_id, category);
create index if not exists trip_expenses_activity_idx on public.trip_expenses(activity_id) where activity_id is not null;

-- Accented categories are ASCII-only on purpose. Applying this file with
-- client_encoding WIN1252 used to store the UTF-8 bytes of "í" and "ção" as
-- the characters U+00C3/U+00AD (shown as "CombustÃ­vel"), so the app's real
-- categories were rejected. Drop the rule first, repair those rows, then
-- install the canonical list. Re-running keeps existing expenses.
alter table public.trip_expenses drop constraint if exists trip_expenses_category_check;
update public.trip_expenses set category = U&'Combust\00EDvel'
where category = 'Combust' || chr(195) || chr(173) || 'vel';
update public.trip_expenses set category = U&'Alimenta\00E7\00E3o'
where category = 'Alimenta' || chr(195) || chr(167) || chr(195) || chr(163) || 'o';
alter table public.trip_expenses add constraint trip_expenses_category_check
  check (category in (
    U&'Combust\00EDvel', 'Hospedagem', U&'Alimenta\00E7\00E3o',
    'Transporte', 'Passeios e lazer', 'Compras', 'Outros'
  ));

-- Database-level guarantees, independent of the form: a linked activity must
-- belong to the same trip, and an expense can never be moved to another trip.
create or replace function private.validate_trip_expense()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.trip_id is distinct from old.trip_id then
    raise exception 'EXPENSE_TRIP_IMMUTABLE' using errcode = '23514';
  end if;
  if new.activity_id is not null and not exists (
    select 1 from public.activities a where a.id = new.activity_id and a.trip_id = new.trip_id
  ) then
    raise exception 'EXPENSE_ACTIVITY_MISMATCH' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_trip_expense() from public, anon, authenticated;
drop trigger if exists trip_expenses_validate on public.trip_expenses;
create trigger trip_expenses_validate before insert or update of trip_id, activity_id on public.trip_expenses
for each row execute function private.validate_trip_expense();

-- Same access model as activities: members read under RLS; all writes go through RPCs.
alter table public.trip_expenses enable row level security;
revoke all on public.trip_expenses from public, anon, authenticated;
grant select on public.trip_expenses to authenticated;
grant all on public.trip_expenses to service_role;
drop policy if exists expense_member_read on public.trip_expenses;
create policy expense_member_read on public.trip_expenses for select to authenticated
using ((select private.is_trip_member(trip_id)));

create or replace function public.save_expense(
  p_trip_id uuid,
  p_id uuid,
  p_expected_version integer,
  p_description text,
  p_category text,
  p_amount_cents bigint,
  p_expense_date date,
  p_activity_id uuid default null,
  p_notes text default null
)
returns public.trip_expenses language plpgsql security definer set search_path = '' as $$
declare
  v_expense public.trip_expenses;
  v_description text := private.trim_text(p_description);
  v_notes text := nullif(private.trim_text(p_notes), '');
begin
  if auth.uid() is null or not private.is_trip_member(p_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_id is null or p_expected_version is null or p_expected_version < 0 then
    raise exception 'INVALID_EXPENSE_VERSION' using errcode = '22023';
  end if;
  if p_activity_id is not null and not exists (
    select 1 from public.activities a where a.id = p_activity_id and a.trip_id = p_trip_id
  ) then
    raise exception 'EXPENSE_ACTIVITY_MISMATCH' using errcode = '23503';
  end if;

  if p_expected_version = 0 then
    insert into public.trip_expenses (id, trip_id, description, category, amount_cents, expense_date, activity_id, notes)
    values (p_id, p_trip_id, v_description, p_category, p_amount_cents, p_expense_date, p_activity_id, v_notes)
    on conflict (id) do nothing returning * into v_expense;
    if not found then
      -- A retry after a lost response reuses the same UUID and data; it never inserts twice.
      select * into v_expense from public.trip_expenses where id = p_id and trip_id = p_trip_id;
      if v_expense.id is null or v_expense.version <> 1 or
        v_expense.description is distinct from v_description or
        v_expense.category is distinct from p_category or
        v_expense.amount_cents is distinct from p_amount_cents or
        v_expense.expense_date is distinct from p_expense_date or
        v_expense.activity_id is distinct from p_activity_id or
        v_expense.notes is distinct from v_notes then
        raise exception 'VERSION_CONFLICT' using errcode = '40001';
      end if;
    end if;
  else
    update public.trip_expenses set
      description = v_description, category = p_category, amount_cents = p_amount_cents,
      expense_date = p_expense_date, activity_id = p_activity_id, notes = v_notes,
      version = version + 1, updated_at = now()
    where id = p_id and trip_id = p_trip_id and version = p_expected_version
    returning * into v_expense;
    if not found then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
  end if;
  -- Signals the trip so other devices refetch under RLS; trip settings keep their version.
  update public.trips set updated_at = now() where id = p_trip_id;
  return v_expense;
end;
$$;

create or replace function public.delete_expense(p_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.trip_expenses where id = p_id;
  if auth.uid() is null or v_trip_id is null or not private.is_trip_member(v_trip_id) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  delete from public.trip_expenses where id = p_id and version = p_expected_version;
  if not found then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  update public.trips set updated_at = now() where id = v_trip_id;
end;
$$;

revoke all on function public.save_expense(uuid, uuid, integer, text, text, bigint, date, uuid, text) from public, anon;
revoke all on function public.delete_expense(uuid, integer) from public, anon;
grant execute on function public.save_expense(uuid, uuid, integer, text, text, bigint, date, uuid, text) to authenticated;
grant execute on function public.delete_expense(uuid, integer) to authenticated;

-- trip_expenses is deliberately not added to supabase_realtime: expense writes
-- touch trips.updated_at, and clients refetch expenses together with the schedule.
notify pgrst, 'reload schema';
commit;
