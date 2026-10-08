import { ACTIVITY_TYPES, DEFAULT_TIMEZONE, type Activity, type ActivityFilters, type ActivityInput, type ActivitySummary, type PlaceDisplay, type PlaceValue, type Trip } from "./types";

const MAX_BUDGET_CENTS = 999_999_999_999;
const pad = (value: number) => String(value).padStart(2, "0");
const padYear = (value: number) => String(value).padStart(4, "0");
const GOOGLE_MAPS_DOMAINS = ["com", "com.br", "co.uk", "pt", "es", "fr", "it", "de", "ca", "com.ar", "com.mx", "cl"];

function calendarUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** Accepts Brazilian notation or a dot decimal; parsing and addition use integers. */
export function parseBudgetCents(value: string): number | null {
  let text = value.trim().replace(/^R\$\s*/i, "").trim();
  if (!text) return null;
  if (text.includes(",")) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) {
      throw new Error("Informe um valor positivo com até dois centavos, como 150,00.");
    }
    text = text.replaceAll(".", "").replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    text = text.replaceAll(".", "");
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Informe um valor positivo com até dois centavos, como 150,00.");
  }
  const [whole, decimals = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
  if (cents > BigInt(MAX_BUDGET_CENTS)) throw new Error("O orçamento máximo por atividade é R$ 9.999.999.999,99.");
  return Number(cents);
}

export function budgetInputValue(cents: number | null): string {
  if (cents === null) return "";
  return `${Math.floor(cents / 100)},${pad(cents % 100)}`;
}

export function formatCurrency(cents: number | null): string {
  if (cents === null) return "A definir";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function zonedParts(instant: number | string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

export function isValidTimezone(timeZone: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); return true; } catch { return false; }
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999) return false;
  const date = new Date(calendarUtc(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Resolves a civil time in the trip zone, never the device zone. Ambiguous DST times must be reviewed. */
export function localDateTimeToIso(value: string, timeZone = DEFAULT_TIMEZONE): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !isValidDate(value.slice(0, 10))) throw new Error("Escolha uma data e um horário válidos.");
  if (!isValidTimezone(timeZone)) throw new Error("O fuso horário da viagem não é válido.");
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  if (hour > 23 || minute > 59) throw new Error("Escolha um horário válido, entre 00:00 e 23:59.");
  const civil = calendarUtc(year, month, day, hour, minute);
  const offsets = new Set<number>();
  // Sampling both sides of a transition covers historical DST and half-hour offsets.
  for (let delta = -36; delta <= 36; delta += 3) {
    const probe = civil + delta * 3_600_000;
    const parts = zonedParts(probe, timeZone);
    offsets.add(calendarUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second) - probe);
  }
  const matches = [...offsets].map((offset) => civil - offset).filter((candidate) => {
    const parts = zonedParts(candidate, timeZone);
    return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute;
  });
  if (!matches.length) throw new Error("Esse horário não existe no fuso da viagem devido à mudança do horário de verão. Escolha outro horário.");
  if (matches.length > 1) throw new Error("Esse horário ocorre duas vezes no fuso da viagem devido à mudança do horário de verão. Escolha um horário fora dessa transição.");
  return new Date(matches[0]).toISOString();
}

export function isoToLocalDateTime(instant: string, timeZone = DEFAULT_TIMEZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${padYear(p.year)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function dateKey(instant: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${padYear(p.year)}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatDateTime(instant: string, timeZone = DEFAULT_TIMEZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${pad(p.day)}/${pad(p.month)}/${padYear(p.year)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDay(day: string): string {
  if (!isValidDate(day)) return day;
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(calendarUtc(year, month, date)));
}

export function sortActivities(activities: Activity[]): Activity[] {
  return [...activities].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
}

export function groupActivities(activities: Activity[], timeZone = DEFAULT_TIMEZONE): { date: string; activities: Activity[] }[] {
  const days = new Map<string, Activity[]>();
  for (const activity of sortActivities(activities)) {
    const key = dateKey(activity.starts_at, timeZone);
    const group = days.get(key) ?? [];
    group.push(activity);
    days.set(key, group);
  }
  return [...days].map(([date, list]) => ({ date, activities: list }));
}

const searchable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function filterActivities(activities: Activity[], filters: ActivityFilters, timeZone = DEFAULT_TIMEZONE, places: Record<string, PlaceDisplay> = {}): Activity[] {
  const search = searchable(filters.search?.trim() ?? "");
  return sortActivities(activities).filter((activity) => {
    if (filters.day && filters.day !== "all" && dateKey(activity.starts_at, timeZone) !== filters.day) return false;
    if (filters.type && filters.type !== "all" && activity.type !== filters.type) return false;
    if (!search) return true;
    const display = activity.place_id ? places[activity.place_id] : null;
    return searchable([activity.name, activity.osm_place_name, activity.osm_place_address, activity.manual_place_name, activity.manual_place_address, display?.name, display?.address].filter(Boolean).join(" ")).includes(search);
  });
}

export function summarizeActivities(activities: Activity[]): ActivitySummary {
  const result: ActivitySummary = { totalCents: 0, activityCount: activities.length, undefinedBudgetCount: 0, byType: {
    "Refeição": { totalCents: 0, activityCount: 0, undefinedBudgetCount: 0 },
    "Lazer": { totalCents: 0, activityCount: 0, undefinedBudgetCount: 0 },
    "Atividade": { totalCents: 0, activityCount: 0, undefinedBudgetCount: 0 },
  } };
  for (const activity of activities) {
    const type = result.byType[activity.type];
    type.activityCount++;
    if (activity.budget_cents === null) { result.undefinedBudgetCount++; type.undefinedBudgetCount++; }
    else {
      result.totalCents += activity.budget_cents;
      type.totalCents += activity.budget_cents;
      if (!Number.isSafeInteger(result.totalCents)) throw new Error("O orçamento total excede o limite de cálculo seguro.");
    }
  }
  return result;
}

export function nextActivity(activities: Activity[], now: Date | number = new Date()): Activity | null {
  const threshold = typeof now === "number" ? now : now.getTime();
  return sortActivities(activities).find((activity) => Date.parse(activity.starts_at) >= threshold) ?? null;
}

export function isOutsideTripPeriod(instant: string, trip: Pick<Trip, "timezone" | "start_date" | "end_date">): boolean {
  const day = dateKey(instant, trip.timezone);
  return Boolean((trip.start_date && day < trip.start_date) || (trip.end_date && day > trip.end_date));
}

export function tripStatus(trip: Pick<Trip, "timezone" | "start_date" | "end_date">, now: Date = new Date()): { phase: "unplanned" | "upcoming" | "ongoing" | "finished"; days: number | null; message: string } {
  const today = dateKey(now, trip.timezone);
  if (!trip.start_date || !trip.end_date) return { phase: "unplanned", days: null, message: "Datas a definir" };
  if (today < trip.start_date) {
    const days = Math.round((Date.parse(`${trip.start_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    return { phase: "upcoming", days, message: days === 1 ? "Falta 1 dia para nossa aventura" : `Faltam ${days} dias para nossa aventura` };
  }
  if (today > trip.end_date) return { phase: "finished", days: null, message: "Memórias de viagens passadas" };
  return { phase: "ongoing", days: null, message: "Nossa aventura está acontecendo" };
}

/** Never resolve or trust redirects. A manual link is described only as a provided link. */
export function isGoogleMapsUrl(value: string): boolean {
  try {
    if (/[\u0000-\u001F\u007F]/.test(value)) return false;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const host = url.hostname.toLowerCase();
    if (host === "maps.app.goo.gl") return /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    if (host === "goo.gl") return /^\/maps\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    if (GOOGLE_MAPS_DOMAINS.some((domain) => host === `maps.google.${domain}`)) return url.pathname === "/" || /^\/maps(?:\/|$)/.test(url.pathname);
    if (GOOGLE_MAPS_DOMAINS.some((domain) => host === `google.${domain}` || host === `www.google.${domain}`)) return /^\/maps(?:\/|$)/.test(url.pathname);
    return false;
  } catch { return false; }
}

export function isMapsUrl(value: string): boolean {
  try {
    if (/[\u0000-\u001F\u007F]/.test(value)) return false;
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (["www.openstreetmap.org", "openstreetmap.org", "osm.org"].includes(url.hostname)) return /^\/(?:$|search\/?$|directions\/?$|(?:node|way|relation)\/[1-9]\d*\/?$|go\/[A-Za-z0-9_~@-]+\/?$)/.test(url.pathname);
    return isGoogleMapsUrl(value); // Existing manually provided links still work.
  } catch { return false; }
}

export function mapsUrl(place: PlaceValue, display?: PlaceDisplay | null): string | null {
  if (place.osm_place_id && typeof place.osm_latitude === "number" && typeof place.osm_longitude === "number") {
    return `https://www.openstreetmap.org/?${new URLSearchParams({ mlat: String(place.osm_latitude), mlon: String(place.osm_longitude) })}#map=17/${place.osm_latitude}/${place.osm_longitude}`;
  }
  if (place.place_id) {
    const query = display?.name || "Local selecionado";
    return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query, query_place_id: place.place_id })}`;
  }
  if (place.manual_place_url && isMapsUrl(place.manual_place_url)) return place.manual_place_url;
  const query = place.manual_place_address || place.manual_place_name;
  return query ? `https://www.openstreetmap.org/search?${new URLSearchParams({ query })}` : null;
}

export function directionsUrl(place: PlaceValue, display?: PlaceDisplay | null): string | null {
  if (place.osm_place_id && typeof place.osm_latitude === "number" && typeof place.osm_longitude === "number") return `https://www.openstreetmap.org/directions?${new URLSearchParams({ engine: "fossgis_osrm_car", route: `;${place.osm_latitude},${place.osm_longitude}` })}`;
  if (place.place_id) return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: display?.address || display?.name || "Local selecionado", destination_place_id: place.place_id })}`;
  const destination = place.manual_place_address || place.manual_place_name;
  return destination ? `https://www.openstreetmap.org/directions?${new URLSearchParams({ to: destination })}` : null;
}

export function validateActivityInput(input: ActivityInput): ActivityInput {
  const manualUrl = input.manual_place_url?.trim() || null;
  if (!input.name.trim()) throw new Error("Informe o nome da atividade.");
  if (input.name.trim().length > 160) throw new Error("O nome da atividade deve ter até 160 caracteres.");
  if (!ACTIVITY_TYPES.includes(input.type)) throw new Error("Escolha Refeição, Lazer ou Atividade.");
  if (!Number.isFinite(Date.parse(input.starts_at)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.starts_at)) throw new Error("Informe uma data e hora válidas.");
  if (input.budget_cents !== null && (!Number.isSafeInteger(input.budget_cents) || input.budget_cents < 0 || input.budget_cents > MAX_BUDGET_CENTS)) throw new Error("Informe um orçamento válido e não negativo.");
  if (manualUrl && !isMapsUrl(manualUrl)) throw new Error("Cole um link HTTPS válido de mapa.");
  const manual = Boolean(input.manual_place_name || input.manual_place_address || input.manual_place_url);
  if (Number(Boolean(input.place_id)) + Number(Boolean(input.osm_place_id)) + Number(manual) > 1) throw new Error("Escolha um resultado da pesquisa ou informe um local manualmente.");
  if (input.osm_place_id) {
    if (!/^[NWR]\/[1-9]\d{0,19}$/.test(input.osm_place_id) || !input.osm_place_name?.trim() || input.osm_place_name.trim().length > 240 || (input.osm_place_address?.trim().length ?? 0) > 1000) throw new Error("O lugar selecionado é inválido. Escolha o lugar novamente.");
    if (typeof input.osm_latitude !== "number" || typeof input.osm_longitude !== "number" || !Number.isFinite(input.osm_latitude) || !Number.isFinite(input.osm_longitude) || Math.abs(input.osm_latitude) > 90 || Math.abs(input.osm_longitude) > 180) throw new Error("A posição do lugar é inválida. Escolha o lugar novamente.");
  } else if (input.osm_place_name != null || input.osm_place_address != null || input.osm_latitude != null || input.osm_longitude != null) throw new Error("Escolha um lugar para guardar sua posição.");
  if (input.place_id && (input.place_id !== input.place_id.trim() || input.place_id.length > 512)) throw new Error("A referência do lugar selecionado é inválida. Escolha o lugar novamente.");
  if ((input.manual_place_name?.trim().length ?? 0) > 240) throw new Error("O nome do local deve ter até 240 caracteres.");
  if ((input.manual_place_address?.trim().length ?? 0) > 1000) throw new Error("O endereço deve ter até 1000 caracteres.");
  if ((input.manual_place_url?.trim().length ?? 0) > 2048) throw new Error("O link do Maps deve ter até 2048 caracteres.");
  return { ...input, name: input.name.trim(), manual_place_name: input.manual_place_name?.trim() || null, manual_place_address: input.manual_place_address?.trim() || null, manual_place_url: manualUrl ? new URL(manualUrl).toString() : null,
    osm_place_id: input.osm_place_id ?? null, osm_place_name: input.osm_place_name?.trim() || null, osm_place_address: input.osm_place_address?.trim() || null, osm_latitude: input.osm_latitude ?? null, osm_longitude: input.osm_longitude ?? null };
}

export function validateTripInput(trip: Pick<Trip, "name" | "destination" | "start_date" | "end_date" | "timezone" | "person_one" | "person_two" | "initial_budget_cents">, options?: { requireInitialBudget?: boolean }) {
  if (!trip.name.trim()) throw new Error("Informe o nome da viagem.");
  if (trip.name.trim().length > 160) throw new Error("O nome da viagem deve ter até 160 caracteres.");
  if (trip.destination.trim().length > 240) throw new Error("O destino deve ter até 240 caracteres.");
  if ((trip.person_one?.trim().length ?? 0) > 80 || (trip.person_two?.trim().length ?? 0) > 80) throw new Error("Os nomes das pessoas devem ter até 80 caracteres.");
  if (!isValidTimezone(trip.timezone)) throw new Error("Escolha um fuso horário válido.");
  if ((trip.start_date && !isValidDate(trip.start_date)) || (trip.end_date && !isValidDate(trip.end_date))) throw new Error("Escolha datas válidas para a viagem.");
  if (trip.start_date && trip.end_date && trip.end_date < trip.start_date) throw new Error("A data final não pode ser anterior à data inicial.");
  const initialBudgetCents = trip.initial_budget_cents ?? null;
  if (options?.requireInitialBudget && initialBudgetCents === null) throw new Error("Informe o orçamento inicial da viagem.");
  if (initialBudgetCents !== null && (!Number.isSafeInteger(initialBudgetCents) || initialBudgetCents < 0 || initialBudgetCents > MAX_BUDGET_CENTS)) throw new Error("Informe um orçamento inicial válido e não negativo.");
  return { ...trip, name: trip.name.trim(), destination: trip.destination.trim(), person_one: trip.person_one?.trim() || null, person_two: trip.person_two?.trim() || null, initial_budget_cents: initialBudgetCents };
}
