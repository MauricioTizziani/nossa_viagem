import assert from "node:assert/strict";
import test from "node:test";
import { summarizeActivities } from "../lib/domain";
import { amountInputValue, compareActivityExpenses, describeActivitySpending, expensesForActivity, filterExpenses, formatCalendarDate, hasExpenseFilters, matchesExpenseFilters, parseAmountCents, sortExpenses, summarizeExpenses, todayInTimezone, validateExpenseFilters, validateExpenseInput } from "../lib/expenses";
import { EMPTY_PLACE, type Activity, type Expense, type ExpenseCategory } from "../lib/types";

const expense = (id: string, amount_cents: number, category: ExpenseCategory, expense_date: string, extra: Partial<Expense> = {}): Expense => ({ id, trip_id: "trip", description: id, category, amount_cents, expense_date, activity_id: null, notes: null, version: 1, created_at: "2026-10-08T12:00:00.000Z", ...extra });
const activity = (id: string, budget_cents: number | null): Activity => ({ id, trip_id: "trip", name: id, starts_at: "2026-10-10T15:00:00Z", budget_cents, type: "Refeição", version: 1, ...EMPTY_PLACE });
// Test-only examples; nothing here is inserted into a real trip.
const gasolina = expense("gasolina", 20000, "Combustível", "2026-10-09", { description: "Gasolina — viagem de ida", notes: "Abastecimento antes de sair" });
const airbnb = expense("airbnb", 60000, "Hospedagem", "2026-09-20", { description: "Airbnb — hospedagem", notes: "Pago antecipadamente" });
const almoco = expense("almoco", 8000, "Alimentação", "2026-10-10", { description: "Almoço de domingo" });
const all = [gasolina, airbnb, almoco];

test("amounts require a positive value in integer centavos and accept Brazilian notation", () => {
  assert.equal(parseAmountCents("200"), 20000);
  assert.equal(parseAmountCents("200,00"), 20000);
  assert.equal(parseAmountCents("R$ 1.234,56"), 123456);
  assert.equal(parseAmountCents("0,01"), 1);
  assert.equal(parseAmountCents("80.5"), 8050);
  assert.throws(() => parseAmountCents(""), /Informe o valor/);
  assert.throws(() => parseAmountCents("   "), /Informe o valor/);
  assert.throws(() => parseAmountCents("0"), /maior que zero/);
  assert.throws(() => parseAmountCents("0,00"), /maior que zero/);
  assert.throws(() => parseAmountCents("-1"), /positivo/);
  assert.throws(() => parseAmountCents("-150,00"), /positivo/);
  assert.throws(() => parseAmountCents("abc"), /positivo/);
  assert.throws(() => parseAmountCents("10.999.999.999,99"), /máximo/);
  assert.equal(amountInputValue(16800), "168,00");
  assert.equal(amountInputValue(null), "");
});

test("the total adds only registered expenses and ignores schedule budgets", () => {
  const summary = summarizeExpenses(all);
  assert.equal(summary.totalCents, 88000, "200 + 600 + 80 = R$ 880,00");
  assert.equal(summary.count, 3);
  assert.equal(summary.byCategory["Combustível"].totalCents, 20000);
  assert.equal(summary.byCategory["Hospedagem"].totalCents, 60000);
  assert.equal(summary.byCategory["Alimentação"].totalCents, 8000);
  assert.deepEqual(summary.byCategory["Compras"], { totalCents: 0, count: 0 });
  assert.deepEqual(summarizeExpenses([]), { ...summarizeExpenses([]), totalCents: 0, count: 0 });
  const budgets = summarizeActivities([activity("jantar", 15000)]);
  assert.equal(budgets.totalCents, 15000);
  assert.equal(summarizeExpenses(all).totalCents, 88000, "a planned budget never enters the expense total");
});

test("linking an expense to an activity never changes the total or counts it twice", () => {
  const linked = all.map((item) => item.id === "almoco" ? { ...item, activity_id: "jantar" } : item);
  assert.equal(summarizeExpenses(linked).totalCents, 88000);
  assert.equal(summarizeExpenses(linked).count, 3);
  assert.deepEqual(expensesForActivity(linked, "jantar").map((item) => item.id), ["almoco"]);
  const comparison = compareActivityExpenses(activity("jantar", 15000), [...linked, expense("vinho", 8800, "Alimentação", "2026-10-10", { activity_id: "jantar" })]);
  assert.deepEqual(comparison, { totalCents: 16800, count: 2, budgetCents: 15000, differenceCents: 1800 });
  assert.match(describeActivitySpending(comparison), /2 gastos vinculados: R\$\s168,00 · R\$\s18,00 acima do previsto até agora/);
  assert.match(describeActivitySpending(compareActivityExpenses(activity("jantar", 20000), linked)), /abaixo do previsto até agora/);
  assert.match(describeActivitySpending(compareActivityExpenses(activity("jantar", 8000), linked)), /igual ao previsto até agora/);
});

test("undefined budgets and missing expenses are never treated as zero or as a free activity", () => {
  const undecided = compareActivityExpenses(activity("passeio", null), [expense("ingresso", 5000, "Passeios e lazer", "2026-10-11", { activity_id: "passeio" })]);
  assert.equal(undecided.differenceCents, null);
  assert.equal(undecided.totalCents, 5000);
  assert.match(describeActivitySpending(undecided), /orçamento a definir/);
  const none = compareActivityExpenses(activity("jantar", 15000), all);
  assert.deepEqual(none, { totalCents: 0, count: 0, budgetCents: 15000, differenceCents: -15000 });
  assert.equal(describeActivitySpending(none), "Nenhum gasto registrado");
});

test("expenses sort by date descending with a stable creation tiebreak and move when the date changes", () => {
  const first = expense("first", 100, "Outros", "2026-10-10", { created_at: "2026-10-08T10:00:00.000Z" });
  const second = expense("second", 100, "Outros", "2026-10-10", { created_at: "2026-10-08T11:00:00.000Z" });
  const sorted = sortExpenses([airbnb, first, gasolina, second]);
  assert.deepEqual(sorted.map((item) => item.id), ["second", "first", "gasolina", "airbnb"]);
  assert.deepEqual(sortExpenses(sorted).map((item) => item.id), sorted.map((item) => item.id), "sorting is idempotent");
  assert.deepEqual(sortExpenses([{ ...first, expense_date: "2026-09-01" }, second]).map((item) => item.id), ["second", "first"]);
  assert.deepEqual(sortExpenses([expense("b", 1, "Outros", "2026-10-10", { created_at: undefined }), expense("a", 1, "Outros", "2026-10-10", { created_at: undefined })]).map((item) => item.id), ["a", "b"]);
});

test("filters combine, dates are inclusive, prepaid expenses are included and the period is validated", () => {
  assert.equal(filterExpenses(all, {}).length, 3, "the trip period never limits the list by default");
  assert.deepEqual(filterExpenses(all, { search: "airbnb" }).map((item) => item.id), ["airbnb"]);
  assert.deepEqual(filterExpenses(all, { search: "ANTECIPADAMENTE" }).map((item) => item.id), ["airbnb"], "notes are searchable without accent or case sensitivity");
  assert.deepEqual(filterExpenses(all, { search: "almoco" }).map((item) => item.id), ["almoco"]);
  assert.deepEqual(filterExpenses(all, { category: "Combustível" }).map((item) => item.id), ["gasolina"]);
  assert.deepEqual(filterExpenses(all, { from: "2026-10-09", to: "2026-10-10" }).map((item) => item.id), ["almoco", "gasolina"]);
  assert.deepEqual(filterExpenses(all, { from: "2026-10-10" }).map((item) => item.id), ["almoco"]);
  assert.deepEqual(filterExpenses(all, { to: "2026-09-20" }).map((item) => item.id), ["airbnb"]);
  assert.deepEqual(filterExpenses(all, { category: "Alimentação", from: "2026-10-01", to: "2026-10-31", search: "domingo" }).map((item) => item.id), ["almoco"]);
  assert.equal(filterExpenses(all, { category: "Alimentação", search: "gasolina" }).length, 0);
  assert.equal(summarizeExpenses(filterExpenses(all, { from: "2026-10-01" })).totalCents, 28000, "subtotal of filters");
  assert.equal(hasExpenseFilters({ search: "  " }), false);
  assert.equal(hasExpenseFilters({ to: "2026-10-10" }), true);
  assert.equal(validateExpenseFilters({ from: "2026-10-10", to: "2026-10-09" }), "A data final do filtro não pode ser anterior à data inicial.");
  assert.equal(validateExpenseFilters({ from: "2026-10-10", to: "2026-10-10" }), null);
  assert.equal(validateExpenseFilters({ from: "2026-13-01" }), "Escolha uma data inicial válida.");
  assert.equal(matchesExpenseFilters(airbnb, { from: "2026-10-01" }), false);
});

test("the expense date is a calendar date independent of the device timezone", () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const deviceTimezone of ["Pacific/Honolulu", "Asia/Tokyo", "America/Sao_Paulo"]) {
      process.env.TZ = deviceTimezone;
      // 23:30 in São Paulo on the 8th is already the 9th in Tokyo; the trip zone decides the suggestion.
      assert.equal(todayInTimezone("America/Sao_Paulo", new Date("2026-10-09T02:30:00Z")), "2026-10-08");
      assert.equal(todayInTimezone("Asia/Tokyo", new Date("2026-10-09T02:30:00Z")), "2026-10-09");
      assert.equal(formatCalendarDate("2026-10-05"), "05/10/2026");
      assert.equal(validateExpenseInput({ ...airbnb }).expense_date, "2026-09-20");
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  assert.equal(formatCalendarDate("invalid"), "invalid");
});

test("validation trims text, rejects whitespace-only descriptions, invalid values and foreign activities", () => {
  const input = { description: "  Restaurante do jantar  ", category: "Alimentação" as const, amount_cents: 16800, expense_date: "2026-10-10", activity_id: null, notes: "  Valor total do casal  " };
  const valid = validateExpenseInput(input);
  assert.equal(valid.description, "Restaurante do jantar");
  assert.equal(valid.notes, "Valor total do casal");
  assert.equal(validateExpenseInput({ ...input, notes: "   " }).notes, null);
  assert.throws(() => validateExpenseInput({ ...input, description: "   " }), /descrição/);
  assert.throws(() => validateExpenseInput({ ...input, description: "x".repeat(201) }), /200/);
  assert.throws(() => validateExpenseInput({ ...input, category: "Hotel" as ExpenseCategory }), /categoria/);
  assert.throws(() => validateExpenseInput({ ...input, amount_cents: 0 }), /maior que zero/);
  assert.throws(() => validateExpenseInput({ ...input, amount_cents: -100 }), /maior que zero/);
  assert.throws(() => validateExpenseInput({ ...input, amount_cents: 10.5 }), /maior que zero/);
  assert.throws(() => validateExpenseInput({ ...input, expense_date: "2026-02-30" }), /data/);
  assert.throws(() => validateExpenseInput({ ...input, expense_date: "10/10/2026" }), /data/);
  assert.throws(() => validateExpenseInput({ ...input, activity_id: "not-a-uuid" }), /inválida/);
  const id = "20000000-0000-4000-8000-000000000001";
  assert.throws(() => validateExpenseInput({ ...input, activity_id: id }, [{ id, trip_id: "other" }], "trip"), /não pertence/);
  assert.equal(validateExpenseInput({ ...input, activity_id: id }, [{ id, trip_id: "trip" }], "trip").activity_id, id);
  assert.throws(() => validateExpenseInput({ ...input, notes: "n".repeat(2001) }), /2000/);
});
