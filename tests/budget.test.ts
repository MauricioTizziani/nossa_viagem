import assert from "node:assert/strict";
import test from "node:test";
import { formatBudgetInput, parseInitialBudgetCents, situationLabel, tripBudgetView, undefinedBudgetMessage } from "../lib/budget";
import { filterActivities, formatCurrency, summarizeActivities, validateTripInput } from "../lib/domain";
import { compareActivityExpenses, filterExpenses, summarizeExpenses } from "../lib/expenses";
import { EMPTY_PLACE, type Activity, type Expense, type ExpenseCategory, type Trip } from "../lib/types";

const trip = (initial_budget_cents: number | null): Pick<Trip, "initial_budget_cents"> => ({ initial_budget_cents });
const fullTrip = (initial_budget_cents: number | null): Trip => ({ id: "trip", name: "Nossa Viagem", destination: "", start_date: "2026-10-10", end_date: "2026-10-12", timezone: "America/Sao_Paulo", person_one: null, person_two: null, initial_budget_cents, version: 1 });
const activity = (id: string, budget_cents: number | null, type: Activity["type"] = "Lazer"): Activity => ({ id, trip_id: "trip", name: id, starts_at: "2026-10-10T15:00:00Z", budget_cents, type, version: 1, ...EMPTY_PLACE });
const expense = (id: string, amount_cents: number, extra: Partial<Expense> = {}): Expense => ({ id, trip_id: "trip", description: id, category: "Outros" as ExpenseCategory, amount_cents, expense_date: "2026-10-10", activity_id: null, notes: null, version: 1, ...extra });

test("the initial budget accepts cents and zero, and never turns an empty field into zero", () => {
  assert.equal(parseInitialBudgetCents(""), null);
  assert.equal(parseInitialBudgetCents("   "), null);
  assert.equal(parseInitialBudgetCents("0"), 0);
  assert.equal(parseInitialBudgetCents("0,00"), 0);
  assert.equal(parseInitialBudgetCents("2.000,00"), 200000);
  assert.equal(parseInitialBudgetCents("R$ 2.000,00"), 200000);
  assert.equal(parseInitialBudgetCents("0,01"), 1);
  assert.equal(formatBudgetInput(200000), "2.000,00");
  assert.equal(formatBudgetInput(0), "0,00");
  assert.equal(formatBudgetInput(1), "0,01");
  assert.throws(() => parseInitialBudgetCents("-1"), /igual ou maior que zero/);
  assert.throws(() => parseInitialBudgetCents("-0,01"), /igual ou maior que zero/);
  assert.equal(validateTripInput(fullTrip(null)).initial_budget_cents, null);
  assert.equal(validateTripInput(fullTrip(0)).initial_budget_cents, 0);
  assert.throws(() => validateTripInput(fullTrip(null), { requireInitialBudget: true }), /Informe o orçamento inicial/);
  assert.throws(() => validateTripInput(fullTrip(-1)), /não negativo/);
});

test("scenario 1: planning and spending stay inside the same initial budget without subtracting each other", () => {
  const view = tripBudgetView(trip(200000), [activity("planned", 150000)], [expense("paid", 80000)]);
  assert.equal(view.planning.balanceCents, 50000);
  assert.equal(view.spending.balanceCents, 120000);
  assert.equal(view.planning.situation, "within");
  assert.equal(view.spending.situation, "within");
  assert.equal(view.planning.excessCents, null);
  assert.equal(view.spending.excessCents, null);
  assert.equal(situationLabel("planning", view.planning), "Dentro do orçamento");
  assert.equal(situationLabel("spending", view.spending), "Dentro do orçamento");
  assert.notEqual(view.planning.balanceCents, 200000 - 150000 - 80000);
  assert.equal("combinedCents" in view, false);
});

test("scenario 2: only the schedule can exceed the initial budget", () => {
  const view = tripBudgetView(trip(200000), [activity("planned", 230000)], [expense("paid", 80000)]);
  assert.equal(view.planning.balanceCents, -30000);
  assert.equal(view.planning.excessCents, 30000);
  assert.equal(view.planning.situation, "over");
  assert.equal(situationLabel("planning", view.planning), `O cronograma ultrapassa o orçamento inicial em ${formatCurrency(30000)}.`);
  assert.equal(view.spending.balanceCents, 120000);
  assert.equal(view.spending.situation, "within");
  assert.equal(view.spending.excessCents, null);
  assert.equal(view.planning.percent, 115);
});

test("scenario 3: only recorded expenses can exceed the initial budget", () => {
  const view = tripBudgetView(trip(200000), [activity("planned", 150000)], [expense("paid", 215000)]);
  assert.equal(view.planning.balanceCents, 50000);
  assert.equal(view.planning.situation, "within");
  assert.equal(view.spending.balanceCents, -15000);
  assert.equal(view.spending.excessCents, 15000);
  assert.equal(view.spending.situation, "over");
  assert.equal(situationLabel("spending", view.spending), `Os gastos registrados ultrapassam o orçamento inicial em ${formatCurrency(15000)}.`);
  assert.equal(view.planning.excessCents, null);
});

test("scenario 4: both follow-ups can exceed the budget and their excesses stay separate", () => {
  const view = tripBudgetView(trip(200000), [activity("planned", 230000)], [expense("paid", 215000)]);
  assert.equal(view.planning.excessCents, 30000);
  assert.equal(view.spending.excessCents, 15000);
  assert.notEqual(view.planning.excessCents! + view.spending.excessCents!, view.planning.excessCents);
  assert.equal(view.planning.balanceCents, -30000);
  assert.equal(view.spending.balanceCents, -15000);
});

test("exact totals are fully used, not over budget, including an explicit zero budget", () => {
  const exact = tripBudgetView(trip(200000), [activity("planned", 200000)], [expense("paid", 200000)]);
  assert.equal(exact.planning.balanceCents, 0);
  assert.equal(exact.spending.balanceCents, 0);
  assert.equal(exact.planning.situation, "exact");
  assert.equal(exact.spending.situation, "exact");
  assert.equal(situationLabel("planning", exact.planning), "Orçamento totalmente planejado");
  assert.equal(situationLabel("spending", exact.spending), "Orçamento totalmente utilizado");
  assert.equal(exact.planning.excessCents, null);
  assert.equal(exact.planning.percent, 100);

  const zero = tripBudgetView(trip(0), [], []);
  assert.equal(zero.planning.situation, "exact");
  assert.equal(zero.spending.situation, "exact");
  assert.equal(zero.planning.percent, null);
  assert.equal(zero.spending.percent, null);
  const overZero = tripBudgetView(trip(0), [activity("planned", 100)], [expense("paid", 50)]);
  assert.equal(overZero.planning.situation, "over");
  assert.equal(overZero.planning.excessCents, 100);
  assert.equal(overZero.spending.excessCents, 50);
  assert.equal(overZero.planning.percent, null);
  assert.equal(overZero.spending.percent, null);
});

test("a legacy trip without a budget keeps both totals and calculates neither balance", () => {
  const view = tripBudgetView(trip(null), [activity("planned", 150000), activity("open", null)], [expense("paid", 80000)]);
  assert.equal(view.plannedCents, 150000);
  assert.equal(view.spentCents, 80000);
  assert.equal(view.undefinedBudgetCount, 1);
  assert.equal(view.planning.situation, "undefined");
  assert.equal(view.spending.situation, "undefined");
  assert.equal(view.planning.balanceCents, null);
  assert.equal(view.spending.balanceCents, null);
  assert.equal(view.planning.excessCents, null);
  assert.equal(situationLabel("planning", view.planning), "Orçamento inicial não definido");
  assert.equal(undefinedBudgetMessage(3), "Há 3 atividades com orçamento a definir. O total planejado considera apenas os valores informados.");
  assert.equal(undefinedBudgetMessage(1), "Há 1 atividade com orçamento a definir. O total planejado considera apenas os valores informados.");
});

test("unknown expense totals are not replaced by zero", () => {
  const view = tripBudgetView(trip(200000), [activity("planned", 150000)], null);
  assert.equal(view.planning.balanceCents, 50000);
  assert.equal(view.spending.usedCents, null);
  assert.equal(view.spending.balanceCents, null);
  assert.equal(view.spending.situation, "unknown");
  assert.notEqual(view.spending.balanceCents, 200000);
  assert.equal(situationLabel("spending", view.spending), "Não foi possível carregar este total. O saldo não foi calculado.");
});

test("editing the initial budget recalculates both balances and does not change recorded amounts", () => {
  const activities = [activity("planned", 150000)];
  const expenses = [expense("paid", 80000)];
  const before = tripBudgetView(trip(200000), activities, expenses);
  const after = tripBudgetView(trip(100000), activities, expenses);
  assert.equal(before.plannedCents, after.plannedCents);
  assert.equal(before.spentCents, after.spentCents);
  assert.equal(activities[0].budget_cents, 150000);
  assert.equal(expenses[0].amount_cents, 80000);
  assert.equal(after.planning.balanceCents, -50000);
  assert.equal(after.spending.balanceCents, 20000);
  assert.equal(after.planning.situation, "over");
  assert.equal(after.spending.situation, "within");
});

test("activity changes move only the planning balance, and expense changes move only the spending balance", () => {
  const activities = [activity("planned", 150000), activity("open", null)];
  const expenses = [expense("paid", 80000), expense("lodging", 60000, { category: "Hospedagem", expense_date: "2026-09-01", notes: "Pago antecipadamente" })];
  const original = tripBudgetView(trip(200000), activities, expenses);
  assert.equal(original.spentCents, 140000, "prepaid lodging is part of the trip total");
  const withoutActivity = tripBudgetView(trip(200000), activities.slice(0, 1), expenses);
  assert.equal(withoutActivity.plannedCents, original.plannedCents);
  assert.equal(withoutActivity.spending.balanceCents, original.spending.balanceCents);
  const edited = tripBudgetView(trip(200000), [{ ...activities[0], budget_cents: 230000 }, activities[1]], expenses);
  assert.equal(edited.planning.balanceCents, -30000);
  assert.equal(edited.spending.balanceCents, original.spending.balanceCents);
  const withoutExpense = tripBudgetView(trip(200000), activities, expenses.slice(0, 1));
  assert.equal(withoutExpense.plannedCents, original.plannedCents);
  assert.equal(withoutExpense.planning.balanceCents, original.planning.balanceCents);
  assert.equal(withoutExpense.spending.balanceCents, 120000);
});

test("linking an expense does not change either global total or the activity budget", () => {
  const activities = [activity("picnic", null), activity("tour", 150000)];
  const expenses = [expense("lunch", 80000), expense("fuel", 20000)];
  const before = tripBudgetView(trip(200000), activities, expenses);
  const linked = [{ ...expenses[0], activity_id: "picnic" }, expenses[1]];
  const after = tripBudgetView(trip(200000), activities, linked);
  assert.equal(after.plannedCents, before.plannedCents);
  assert.equal(after.spentCents, before.spentCents);
  assert.equal(after.planning.balanceCents, before.planning.balanceCents);
  assert.equal(after.spending.balanceCents, before.spending.balanceCents);
  assert.equal(activities[0].budget_cents, null);
  const comparison = compareActivityExpenses(activities[0], linked);
  assert.equal(comparison.totalCents, 80000);
  assert.equal(comparison.budgetCents, null);
  assert.equal(comparison.differenceCents, null);
  assert.equal(summarizeExpenses(linked).totalCents, 100000);
});

test("filters, duplicates and other trips cannot replace the global budget reference", () => {
  const activities = [activity("meal", 150000, "Refeição"), activity("tour", 80000, "Lazer"), { ...activity("copy", 80000, "Lazer"), id: "tour" }];
  const expenses = [expense("fuel", 20000, { category: "Combustível" }), expense("lunch", 60000, { category: "Alimentação" }), { ...expense("again", 60000), id: "lunch" }];
  const view = tripBudgetView({ id: "trip", initial_budget_cents: 200000 }, [...activities, { ...activity("foreign", 900000), trip_id: "other-trip" }], [...expenses, expense("foreign", 900000, { trip_id: "other-trip" })]);
  assert.equal(view.plannedCents, 230000, "the duplicated activity id is counted once and another trip is ignored");
  assert.equal(view.spentCents, 80000, "the duplicated expense id is counted once and another trip is ignored");
  const filteredActivities = filterActivities(activities, { type: "Refeição" }, "America/Sao_Paulo");
  const filteredExpenses = filterExpenses(expenses, { category: "Combustível" });
  assert.equal(summarizeActivities(filteredActivities).totalCents, 150000);
  assert.equal(summarizeExpenses(filteredExpenses).totalCents, 20000);
  assert.notEqual(summarizeActivities(filteredActivities).totalCents, view.plannedCents);
  assert.equal(view.planning.balanceCents, -30000);
  assert.equal(view.spending.balanceCents, 120000);
});
