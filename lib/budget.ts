import { formatCurrency, parseBudgetCents, summarizeActivities } from "./domain";
import { summarizeExpenses } from "./expenses";
import type { Activity, Expense } from "./types";

/**
 * One derived balance for the whole trip. Nothing here is stored.
 * B is the initial budget and stays a reference; expenses never decrement it.
 * G is the sum of confirmed expenses. D = B - G is the available balance
 * on Gastos and the budget the schedule is allowed to plan against.
 * Each activity keeps its original budget. Pending reservation is
 * max(budget - expenses linked to that activity, 0). P is the sum of those
 * reservations, so an overrun on one activity cannot reduce another.
 * Free balance after planning is D - P. Projected cost is G + P.
 */

export const UNDEFINED_BUDGET_LABEL = "Orçamento inicial não definido";
export const PLANNING_NOTE = "O planejamento utiliza o saldo que restou após os gastos. Despesas já vinculadas às atividades não são reservadas novamente.";
export const SPENDING_NOTE = "Os gastos registrados também reduzem o valor disponível para planejar o cronograma.";
export const OFFLINE_BUDGET_NOTE = "Valores da última sincronização, sem rascunhos locais. Eles podem estar desatualizados.";
export const FILTER_BUDGET_NOTE = "Estes indicadores consideram toda a viagem. O subtotal dos filtros não muda esta situação.";
export const INITIAL_BUDGET_HELP = "Quanto vocês pretendem disponibilizar para a viagem? Cada gasto reduz o saldo disponível para planejar o cronograma.";
export const PROJECTION_NOTE = "Soma dos gastos registrados com o que ainda está reservado para as atividades. Uma despesa já vinculada não entra de novo.";
export const ORIGINAL_PLAN_NOTE = "Total original dos orçamentos informados nas atividades. É diferente do valor ainda reservado.";
export const UNKNOWN_TOTAL_LABEL = "Não foi possível carregar este total. O saldo não foi calculado.";
export const FULLY_RESERVED_LABEL = "O saldo disponível está totalmente reservado para as atividades.";
export const WITHIN_BUDGET_LABEL = "Dentro do orçamento";
export const FULLY_USED_LABEL = "Orçamento totalmente utilizado";

export type BudgetSituation = "undefined" | "within" | "exact" | "over" | "unknown";

export interface TripBudgetView {
  initialCents: number | null;
  /** G. Null when expenses could not be loaded. Never treated as zero. */
  spentCents: number | null;
  /** Sum of the original activity budgets that have a value. */
  plannedCents: number;
  /** P. Null when expenses are unknown, because coverage depends on linked spending. */
  pendingCents: number | null;
  /** D = B - G. Null when B is missing or G is unknown. */
  availableCents: number | null;
  /** D - P. Null when D or P is unknown. Negative values stay negative. */
  freeCents: number | null;
  /** G + P. Null when either total is unknown. Does not add linked expenses twice. */
  projectedCents: number | null;
  undefinedBudgetCount: number;
  spendingSituation: BudgetSituation;
  /** Positive amount spent beyond B. Null unless spending is over. */
  spendingExcessCents: number | null;
  /** Whole percent of B used by G. Null when B is missing, zero, or G is unknown. */
  spendingPercent: number | null;
  /** Situation of the free balance. Distinct from the spending situation. */
  planningSituation: BudgetSituation;
  /**
   * How far pending reservations exceed the available balance.
   * Null unless that excess exists. Spending beyond B is a separate field.
   */
  planningShortfallCents: number | null;
  /** Whole percent of D reserved by P. Null when D is missing or not positive, so zero never divides. */
  reservedPercent: number | null;
}

/** Empty input stays unset. Zero is a valid budget. Negative values are rejected. */
export function parseInitialBudgetCents(value: string): number | null {
  if (!value.trim()) return null;
  try {
    const cents = parseBudgetCents(value);
    if (cents === null) return null;
    if (cents < 0) throw new Error("O orçamento inicial não pode ser negativo.");
    return cents;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("não pode ser negativo")) throw error;
    throw new Error(message.includes("máximo")
      ? "O orçamento inicial máximo é R$ 9.999.999.999,99."
      : "Informe um valor igual ou maior que zero, com até dois centavos, como 2.000,00.");
  }
}

/** Brazilian editing format, such as 2.000,00. Display with the R$ prefix stays in formatCurrency. */
export function formatBudgetInput(cents: number): string {
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0 ? "-" : ""}${whole},${String(absolute % 100).padStart(2, "0")}`;
}

/** Accepts a missing value from older trips. Rejects anything that is not a non-negative integer of centavos. */
export function coerceInitialBudgetCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("O orçamento inicial recebido é inválido.");
    return Number(value);
  }
  if (typeof value === "string") {
    if (!/^\d+$/.test(value)) throw new Error("O orçamento inicial recebido é inválido.");
    const cents = Number(value);
    if (!Number.isSafeInteger(cents)) throw new Error("O orçamento inicial recebido é inválido.");
    return cents;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error("O orçamento inicial recebido é inválido.");
}

export function formatSignedCurrency(cents: number): string {
  const amount = formatCurrency(Math.abs(cents));
  return cents < 0 ? `-${amount}` : amount;
}

export function initialBudgetText(cents: number | null): string {
  return cents === null ? UNDEFINED_BUDGET_LABEL : formatCurrency(cents);
}

/** A missing total stays unavailable. A known total, including zero, is formatted. */
export function totalText(cents: number | null): string {
  return cents === null ? "Indisponível" : formatCurrency(cents);
}

/** A balance that cannot be derived stays uncalculated. Negatives keep the minus sign. */
export function balanceText(cents: number | null): string {
  return cents === null ? "Não calculado" : formatSignedCurrency(cents);
}

export function undefinedBudgetMessage(count: number): string | null {
  if (count <= 0) return null;
  const intro = count === 1 ? "Há 1 atividade com orçamento a definir." : `Há ${count} atividades com orçamento a definir.`;
  return `${intro} O planejamento está incompleto e os indicadores consideram apenas os valores conhecidos.`;
}

export function spendingStatusLabel(view: TripBudgetView): string {
  if (view.spendingSituation === "within") return WITHIN_BUDGET_LABEL;
  if (view.spendingSituation === "exact") return FULLY_USED_LABEL;
  if (view.spendingSituation === "over" && view.spendingExcessCents !== null) {
    return `Os gastos ultrapassaram o orçamento inicial em ${formatCurrency(view.spendingExcessCents)}.`;
  }
  if (view.spendingSituation === "unknown") return UNKNOWN_TOTAL_LABEL;
  return UNDEFINED_BUDGET_LABEL;
}

export function planningShortfallLabel(shortfallCents: number): string {
  return `As atividades ainda previstas ultrapassam o saldo disponível em ${formatCurrency(shortfallCents)}.`;
}

/** Calm schedule status. Callers hide it while a spending or planning alert is visible. */
export function scheduleCalmLabel(view: TripBudgetView): string {
  if (view.spendingSituation === "unknown" || view.planningSituation === "unknown") return UNKNOWN_TOTAL_LABEL;
  if (view.spendingSituation === "undefined" || view.planningSituation === "undefined") return UNDEFINED_BUDGET_LABEL;
  if (view.freeCents === 0 && (view.pendingCents ?? 0) > 0) return FULLY_RESERVED_LABEL;
  if (view.freeCents === 0) return FULLY_USED_LABEL;
  return WITHIN_BUDGET_LABEL;
}

function addCents(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("O saldo do orçamento excede o limite de cálculo seguro.");
  return result;
}

function subtractCents(left: number, right: number): number {
  const result = left - right;
  if (!Number.isSafeInteger(result)) throw new Error("O saldo do orçamento excede o limite de cálculo seguro.");
  return result;
}

function situationOf(balanceCents: number): BudgetSituation {
  if (balanceCents > 0) return "within";
  if (balanceCents === 0) return "exact";
  return "over";
}

/** Whole percent, rounded half up. Caller must pass a positive total so zero never divides. */
function percentOf(totalCents: number, partCents: number): number {
  return Number((BigInt(partCents) * 100n + BigInt(totalCents) / 2n) / BigInt(totalCents));
}

/**
 * What is still reserved for one activity.
 * An undefined budget contributes nothing invented. Linked spending cannot push this below zero.
 */
export function pendingReservationCents(budgetCents: number | null, linkedSpentCents: number): number {
  if (!Number.isSafeInteger(linkedSpentCents) || linkedSpentCents < 0) throw new Error("O total vinculado à atividade é inválido.");
  if (budgetCents === null) return 0;
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 0) throw new Error("O orçamento da atividade é inválido.");
  return Math.max(budgetCents - linkedSpentCents, 0);
}

/** Sums only expenses whose activity_id is this activity. Name, category and date never create a link. */
export function activityPendingCents(activity: Pick<Activity, "id" | "budget_cents">, expenses: Expense[]): number {
  const linked = summarizeExpenses(expenses.filter((expense) => expense.activity_id === activity.id)).totalCents;
  return pendingReservationCents(activity.budget_cents, linked);
}

function pendingTotal(activities: Activity[], expenses: Expense[]): number {
  let pending = 0;
  for (const activity of activities) {
    pending = addCents(pending, activityPendingCents(activity, expenses));
  }
  return pending;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

/**
 * Totals always come from the complete trip records passed in.
 * Callers must not pass a filtered page: filters have their own subtotals.
 * A null expense list means spending and pending coverage are unknown, not zero.
 */
export function tripBudgetView(trip: { id?: string; initial_budget_cents: number | null }, activities: Activity[], expenses: Expense[] | null): TripBudgetView {
  const sameTrip = <T extends { trip_id: string }>(items: T[]) => (trip.id ? items.filter((item) => item.trip_id === trip.id) : items);
  const tripActivities = uniqueById(sameTrip(activities));
  const planned = summarizeActivities(tripActivities);
  const initialCents = trip.initial_budget_cents;
  if (initialCents !== null && (!Number.isSafeInteger(initialCents) || initialCents < 0)) throw new Error("O orçamento inicial informado é inválido.");

  const base = {
    initialCents,
    plannedCents: planned.totalCents,
    undefinedBudgetCount: planned.undefinedBudgetCount,
  };

  if (expenses === null) {
    return {
      ...base,
      spentCents: null,
      pendingCents: null,
      availableCents: null,
      freeCents: null,
      projectedCents: null,
      spendingSituation: "unknown",
      spendingExcessCents: null,
      spendingPercent: null,
      planningSituation: "unknown",
      planningShortfallCents: null,
      reservedPercent: null,
    };
  }

  const tripExpenses = uniqueById(sameTrip(expenses));
  const spentCents = summarizeExpenses(tripExpenses).totalCents;
  const pendingCents = pendingTotal(tripActivities, tripExpenses);
  const projectedCents = addCents(spentCents, pendingCents);
  if (initialCents === null) {
    return {
      ...base,
      spentCents,
      pendingCents,
      availableCents: null,
      freeCents: null,
      projectedCents,
      spendingSituation: "undefined",
      spendingExcessCents: null,
      spendingPercent: null,
      planningSituation: "undefined",
      planningShortfallCents: null,
      reservedPercent: null,
    };
  }

  const availableCents = subtractCents(initialCents, spentCents);
  const freeCents = subtractCents(availableCents, pendingCents);
  const spendingSituation = situationOf(availableCents);
  const planningSituation = situationOf(freeCents);
  return {
    ...base,
    spentCents,
    pendingCents,
    availableCents,
    freeCents,
    projectedCents,
    spendingSituation,
    spendingExcessCents: spendingSituation === "over" ? -availableCents : null,
    spendingPercent: initialCents === 0 ? null : percentOf(initialCents, spentCents),
    planningSituation,
    planningShortfallCents: freeCents < 0 && pendingCents > 0 ? -freeCents : null,
    reservedPercent: availableCents > 0 ? percentOf(availableCents, pendingCents) : null,
  };
}
