import { DEFAULT_TIMEZONE, EXPENSE_CATEGORIES, type Activity, type ActivityExpenseComparison, type Expense, type ExpenseCategory, type ExpenseFilters, type ExpenseInput, type ExpenseSummary, type ExpenseTotals } from "./types";
import { budgetInputValue, dateKey, formatCurrency, isValidDate, parseBudgetCents } from "./domain";

/** Confirmed expenses reduce the trip balance. Only an explicit activity link reduces that activity's pending reservation. */
export const MAX_EXPENSE_CENTS = 999_999_999_999;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_NOTES_LENGTH = 2000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

/** Brazilian notation, integer centavos, strictly positive. Empty input is an error, never zero. */
export function parseAmountCents(value: string): number {
  if (!value.trim()) throw new Error("Informe o valor do gasto.");
  let cents: number | null;
  try { cents = parseBudgetCents(value); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new Error(message.includes("máximo") ? "O valor máximo de um gasto é R$ 9.999.999.999,99." : "Informe um valor positivo com até dois centavos, como 150,00.");
  }
  if (cents === null || cents <= 0) throw new Error("O valor do gasto deve ser maior que zero.");
  return cents;
}

export function amountInputValue(cents: number | null | undefined): string {
  return typeof cents === "number" ? budgetInputValue(cents) : "";
}

/** Today's calendar date in the trip timezone, so a suggestion never shifts by the device zone. */
export function todayInTimezone(timeZone = DEFAULT_TIMEZONE, now: Date | number = new Date()): string {
  return dateKey(typeof now === "number" ? new Date(now) : now, timeZone);
}

export function formatCalendarDate(day: string): string {
  if (!isValidDate(day)) return day;
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

const createdAtValue = (expense: Expense) => (expense.created_at ? Date.parse(expense.created_at) : 0) || 0;

/** Most recent expense date first; equal dates fall back to creation order, then id, so positions are stable. */
export function sortExpenses(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => (a.expense_date < b.expense_date ? 1 : a.expense_date > b.expense_date ? -1 : 0) || createdAtValue(b) - createdAtValue(a) || a.id.localeCompare(b.id));
}

const searchable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function hasExpenseFilters(filters: ExpenseFilters): boolean {
  return Boolean(filters.search?.trim() || filters.category || filters.from || filters.to);
}

/** Returns a message when the period is inconsistent; combined filters are otherwise applied as given. */
export function validateExpenseFilters(filters: ExpenseFilters): string | null {
  if (filters.from && !isValidDate(filters.from)) return "Escolha uma data inicial válida.";
  if (filters.to && !isValidDate(filters.to)) return "Escolha uma data final válida.";
  if (filters.from && filters.to && filters.to < filters.from) return "A data final do filtro não pode ser anterior à data inicial.";
  return null;
}

export function matchesExpenseFilters(expense: Expense, filters: ExpenseFilters): boolean {
  if (filters.category && expense.category !== filters.category) return false;
  // Calendar strings compare lexicographically; both ends are inclusive.
  if (filters.from && expense.expense_date < filters.from) return false;
  if (filters.to && expense.expense_date > filters.to) return false;
  const search = searchable(filters.search?.trim() ?? "");
  if (!search) return true;
  return searchable([expense.description, expense.notes].filter(Boolean).join(" ")).includes(search);
}

export function filterExpenses(expenses: Expense[], filters: ExpenseFilters): Expense[] {
  return sortExpenses(expenses).filter((expense) => matchesExpenseFilters(expense, filters));
}

const emptyTotals = (): ExpenseTotals => ({ totalCents: 0, count: 0 });

/** Totals are always derived from the current records, using integer centavos. */
export function summarizeExpenses(expenses: Expense[]): ExpenseSummary {
  const byCategory = Object.fromEntries(EXPENSE_CATEGORIES.map((category) => [category, emptyTotals()])) as Record<ExpenseCategory, ExpenseTotals>;
  const result: ExpenseSummary = { totalCents: 0, count: 0, byCategory };
  for (const expense of expenses) {
    const bucket = byCategory[expense.category] ?? byCategory["Outros"];
    bucket.count++;
    bucket.totalCents += expense.amount_cents;
    result.count++;
    result.totalCents += expense.amount_cents;
    if (!Number.isSafeInteger(result.totalCents)) throw new Error("O total de gastos excede o limite de cálculo seguro.");
  }
  return result;
}

export function expensesForActivity(expenses: Expense[], activityId: string): Expense[] {
  return sortExpenses(expenses.filter((expense) => expense.activity_id === activityId));
}

/** Linked expenses so far versus the planned budget. No expenses never means the activity was free. */
export function compareActivityExpenses(activity: Pick<Activity, "id" | "budget_cents">, expenses: Expense[]): ActivityExpenseComparison {
  const linked = expensesForActivity(expenses, activity.id);
  const { totalCents, count } = summarizeExpenses(linked);
  const budgetCents = activity.budget_cents;
  return { totalCents, count, budgetCents, differenceCents: budgetCents === null ? null : totalCents - budgetCents };
}

/** Wording for the schedule detail: a comparison so far, never a closing of the activity. */
export function describeActivitySpending(comparison: ActivityExpenseComparison): string {
  if (comparison.count === 0) return "Nenhum gasto registrado";
  const base = `${comparison.count === 1 ? "1 gasto vinculado" : `${comparison.count} gastos vinculados`}: ${formatCurrency(comparison.totalCents)}`;
  if (comparison.differenceCents === null) return `${base} · orçamento a definir`;
  if (comparison.differenceCents === 0) return `${base} · igual ao previsto até agora`;
  return `${base} · ${formatCurrency(Math.abs(comparison.differenceCents))} ${comparison.differenceCents > 0 ? "acima" : "abaixo"} do previsto até agora`;
}

export function validateExpenseInput(input: ExpenseInput, activities?: Pick<Activity, "id" | "trip_id">[], tripId?: string): ExpenseInput {
  const description = input.description.trim();
  const notes = input.notes?.trim() || null;
  if (!description) throw new Error("Informe a descrição do gasto.");
  if (description.length > MAX_DESCRIPTION_LENGTH) throw new Error(`A descrição deve ter até ${MAX_DESCRIPTION_LENGTH} caracteres.`);
  if (!isExpenseCategory(input.category)) throw new Error("Escolha uma categoria para o gasto.");
  if (!Number.isSafeInteger(input.amount_cents) || input.amount_cents <= 0 || input.amount_cents > MAX_EXPENSE_CENTS) throw new Error("Informe um valor maior que zero.");
  if (!isValidDate(input.expense_date)) throw new Error("Escolha a data do gasto.");
  if (input.activity_id !== null) {
    if (typeof input.activity_id !== "string" || !UUID_PATTERN.test(input.activity_id)) throw new Error("A atividade selecionada é inválida.");
    if (activities && !activities.some((activity) => activity.id === input.activity_id && (!tripId || activity.trip_id === tripId))) throw new Error("A atividade selecionada não pertence a esta viagem. Atualize o cronograma e escolha novamente.");
  }
  if (notes && notes.length > MAX_NOTES_LENGTH) throw new Error(`As observações devem ter até ${MAX_NOTES_LENGTH} caracteres.`);
  return { description, category: input.category, amount_cents: input.amount_cents, expense_date: input.expense_date, activity_id: input.activity_id, notes };
}
