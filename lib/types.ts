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
  version: number;
  created_at?: string;
  updated_at?: string;
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
