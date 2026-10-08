import { formatCurrency, parseBudgetCents, summarizeActivities } from "./domain";
import { summarizeExpenses } from "./expenses";
import type { Activity, Expense } from "./types";

/**
 * The schedule shows how much of the initial budget is committed by planning.
 * Expenses show how much was used by recorded spending.
 * Both start from the same initial budget and never subtract each other.
 * Balances are derived on read; the stored initial budget is never decremented.
 */

export const UNDEFINED_BUDGET_LABEL = "Orçamento inicial não definido";
export const PLANNING_NOTE = "Este saldo considera apenas o planejamento do cronograma. Os gastos são acompanhados separadamente.";
export const SPENDING_NOTE = "Este saldo considera apenas os gastos registrados. Os valores previstos no cronograma não são descontados aqui.";
export const OFFLINE_BUDGET_NOTE = "Valores da última sincronização, sem rascunhos locais. Eles podem estar desatualizados.";
export const FILTER_BUDGET_NOTE = "Estes indicadores consideram toda a viagem. O subtotal dos filtros não muda esta situação.";
export const INITIAL_BUDGET_HELP = "Quanto vocês pretendem disponibilizar para a viagem? Esse valor será usado para acompanhar o planejamento e os gastos separadamente.";

export type BudgetKind = "planning" | "spending";
export type BudgetSituation = "undefined" | "within" | "exact" | "over" | "unknown";

export interface BudgetSnapshot {
  initialCents: number | null;
  /** Null when the corresponding total could not be loaded. Never treated as zero. */
  usedCents: number | null;
  balanceCents: number | null;
  /** Positive amount over the initial budget. Null unless the situation is over. */
  excessCents: number | null;
  situation: BudgetSituation;
  /** Whole percent of the initial budget. Null when the budget is missing, zero, or the total is unknown. */
  percent: number | null;
}

export interface TripBudgetView {
  initialCents: number | null;
  planning: BudgetSnapshot;
  spending: BudgetSnapshot;
  plannedCents: number;
  spentCents: number | null;
  undefinedBudgetCount: number;
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

export function undefinedBudgetMessage(count: number): string | null {
  if (count <= 0) return null;
  const intro = count === 1 ? "Há 1 atividade com orçamento a definir." : `Há ${count} atividades com orçamento a definir.`;
  return `${intro} O total planejado considera apenas os valores informados.`;
}

/** Planning balance is B - P. Spending balance is B - G. Neither formula includes the other total. */
export function budgetSnapshot(initialCents: number | null, usedCents: number | null): BudgetSnapshot {
  if (usedCents === null) return { initialCents, usedCents: null, balanceCents: null, excessCents: null, situation: "unknown", percent: null };
  if (!Number.isSafeInteger(usedCents) || usedCents < 0) throw new Error("O total informado para o orçamento é inválido.");
  if (initialCents === null) return { initialCents: null, usedCents, balanceCents: null, excessCents: null, situation: "undefined", percent: null };
  if (!Number.isSafeInteger(initialCents) || initialCents < 0) throw new Error("O orçamento inicial informado é inválido.");
  const balanceCents = initialCents - usedCents;
  if (!Number.isSafeInteger(balanceCents)) throw new Error("O saldo do orçamento excede o limite de cálculo seguro.");
  const situation: BudgetSituation = balanceCents > 0 ? "within" : balanceCents === 0 ? "exact" : "over";
  const percent = initialCents === 0 ? null : Number((BigInt(usedCents) * 100n + BigInt(initialCents) / 2n) / BigInt(initialCents));
  return { initialCents, usedCents, balanceCents, excessCents: situation === "over" ? -balanceCents : null, situation, percent };
}

export function situationLabel(kind: BudgetKind, snapshot: BudgetSnapshot): string {
  if (snapshot.situation === "within") return "Dentro do orçamento";
  if (snapshot.situation === "exact") return kind === "planning" ? "Orçamento totalmente planejado" : "Orçamento totalmente utilizado";
  if (snapshot.situation === "over" && snapshot.excessCents !== null) {
    const amount = formatCurrency(snapshot.excessCents);
    return kind === "planning"
      ? `O cronograma ultrapassa o orçamento inicial em ${amount}.`
      : `Os gastos registrados ultrapassam o orçamento inicial em ${amount}.`;
  }
  if (snapshot.situation === "unknown") return "Não foi possível carregar este total. O saldo não foi calculado.";
  return UNDEFINED_BUDGET_LABEL;
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
 * A null expense list means the spending total is unknown, not zero.
 */
export function tripBudgetView(trip: { id?: string; initial_budget_cents: number | null }, activities: Activity[], expenses: Expense[] | null): TripBudgetView {
  const sameTrip = <T extends { trip_id: string }>(items: T[]) => (trip.id ? items.filter((item) => item.trip_id === trip.id) : items);
  const planned = summarizeActivities(uniqueById(sameTrip(activities)));
  const spentCents = expenses === null ? null : summarizeExpenses(uniqueById(sameTrip(expenses))).totalCents;
  return {
    initialCents: trip.initial_budget_cents,
    planning: budgetSnapshot(trip.initial_budget_cents, planned.totalCents),
    spending: budgetSnapshot(trip.initial_budget_cents, spentCents),
    plannedCents: planned.totalCents,
    spentCents,
    undefinedBudgetCount: planned.undefinedBudgetCount,
  };
}
