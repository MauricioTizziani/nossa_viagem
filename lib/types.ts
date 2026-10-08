export const ACTIVITY_TYPES = ["Refeição", "Lazer", "Atividade"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export interface Trip {
  id: string;
  name: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  person_one: string | null;
  person_two: string | null;
  /** Couple's reference budget in integer centavos. Null means not informed; zero is a real budget. Never reduced by activities or expenses. */
  initial_budget_cents: number | null;
  collection_id?: string | null;
  archived_at?: string | null;
  version: number;
  created_at?: string;
  updated_at?: string;
}

export type TripInput = Pick<Trip, 'name' | 'destination' | 'start_date' | 'end_date' | 'timezone' | 'person_one' | 'person_two' | 'initial_budget_cents'>;
export type AccessRole = 'owner' | 'member';
export type TripListFilter = 'all' | 'upcoming' | 'ongoing' | 'past' | 'archived' | 'undated';
export interface TripCard extends Trip {
  total_spent_cents: number;
  trip_role: AccessRole;
  collection_role: AccessRole | null;
  /** True after this device loaded the full schedule and expenses of this trip. */
  offline_available?: boolean;
  card_synced_at?: string;
  synced_at?: string | null;
}
export interface AuthorizedCollection {
  id: string;
  role: AccessRole;
  created_at?: string;
}
export interface Invitation {
  id: string;
  role: AccessRole;
  expires_at: string;
  max_uses: number;
  use_count: number;
  created_at: string;
  revoked_at: string | null;
  last_used_at?: string | null;
}
export interface InvitationCreated {
  invite_id: string;
  token: string;
  expires_at: string;
  max_uses: number;
  role: AccessRole;
}

export interface PlaceValue {
  // Retained only for places saved before the OpenStreetMap migration.
  place_id: string | null;
  manual_place_name: string | null;
  manual_place_address: string | null;
  manual_place_url: string | null;
  osm_place_id: string | null;
  osm_place_name: string | null;
  osm_place_address: string | null;
  osm_latitude: number | null;
  osm_longitude: number | null;
}

export interface PlaceDisplay {
  name: string;
  address: string;
  source: "google" | "osm" | "manual";
}

export interface ActivityInput extends PlaceValue {
  starts_at: string;
  budget_cents: number | null;
  name: string;
  type: ActivityType;
}

export interface Activity extends ActivityInput {
  id: string;
  trip_id: string;
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface ActivityFilters {
  day?: string;
  type?: ActivityType | "" | "all";
  search?: string;
}

export interface SummaryValues {
  totalCents: number;
  activityCount: number;
  undefinedBudgetCount: number;
}

export interface ActivitySummary extends SummaryValues {
  byType: Record<ActivityType, SummaryValues>;
}

/** Expense categories belong to the expense control and never replace schedule types. */
export const EXPENSE_CATEGORIES = ["Combustível", "Hospedagem", "Alimentação", "Transporte", "Passeios e lazer", "Compras", "Outros"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface ExpenseInput {
  description: string;
  category: ExpenseCategory;
  /** Total paid for the trip, in integer centavos; always greater than zero. */
  amount_cents: number;
  /** Calendar date YYYY-MM-DD; never converted through a timezone. */
  expense_date: string;
  activity_id: string | null;
  notes: string | null;
}

export interface Expense extends ExpenseInput {
  id: string;
  trip_id: string;
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface ExpenseFilters {
  search?: string;
  category?: ExpenseCategory | "";
  from?: string;
  to?: string;
}

export interface ExpenseTotals {
  totalCents: number;
  count: number;
}

export interface ExpenseSummary extends ExpenseTotals {
  byCategory: Record<ExpenseCategory, ExpenseTotals>;
}

/** Comparison between a planned budget and the expenses linked so far; never a final closing. */
export interface ActivityExpenseComparison extends ExpenseTotals {
  budgetCents: number | null;
  /** Expenses minus budget. Null while the budget is still "A definir". */
  differenceCents: number | null;
}

export const EMPTY_PLACE: PlaceValue = {
  place_id: null,
  manual_place_name: null,
  manual_place_address: null,
  manual_place_url: null,
  osm_place_id: null,
  osm_place_name: null,
  osm_place_address: null,
  osm_latitude: null,
  osm_longitude: null,
};
