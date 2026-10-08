import assert from "node:assert/strict";
import test from "node:test";
import { activityPendingCents, formatBudgetInput, parseInitialBudgetCents, planningShortfallLabel, scheduleCalmLabel, spendingStatusLabel, tripBudgetView, undefinedBudgetMessage } from "../lib/budget";
import { filterActivities, formatCurrency, summarizeActivities, validateTripInput } from "../lib/domain";
import { filterExpenses, summarizeExpenses } from "../lib/expenses";
import { EMPTY_PLACE, type Activity, type Expense, type ExpenseCategory, type Trip } from "../lib/types";

const trip = (initial_budget_cents: number | null) => ({ id: "trip", initial_budget_cents });
const fullTrip = (initial_budget_cents: number | null): Trip => ({ id: "trip", name: "Nossa Viagem", destination: "", start_date: "2026-10-10", end_date: "2026-10-12", timezone: "America/Sao_Paulo", person_one: null, person_two: null, initial_budget_cents, version: 1 });
const activity = (id: string, budget_cents: number | null, type: Activity["type"] = "Lazer", name = id): Activity => ({ id, trip_id: "trip", name, starts_at: "2026-10-10T15:00:00Z", budget_cents, type, version: 1, ...EMPTY_PLACE });
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

test("scenario 1: an unlinked expense reduces the balance shared by spending and the schedule", () => {
  const view = tripBudgetView(trip(200000), [activity("planned", 150000)], [expense("fuel", 30000)]);
  assert.equal(view.spentCents, 30000);
  assert.equal(view.availableCents, 170000);
  assert.equal(view.pendingCents, 150000);
  assert.equal(view.freeCents, 20000);
  assert.equal(view.projectedCents, 180000);
  assert.equal(view.spendingSituation, "within");
  assert.equal(view.planningSituation, "within");
  assert.equal(view.spendingExcessCents, null);
  assert.equal(view.planningShortfallCents, null);
  assert.equal(spendingStatusLabel(view), "Dentro do orçamento");
  assert.equal(scheduleCalmLabel(view), "Dentro do orçamento");
  assert.notEqual(view.availableCents, 200000);
  assert.notEqual(view.freeCents, 200000 - 150000);
});

test("scenario 2: more unlinked spending can leave the plan uncovered without exceeding the initial budget", () => {
  const view = tripBudgetView(trip(200000), [activity("planned", 150000)], [expense("fuel", 30000), expense("toll", 30000)]);
  assert.equal(view.spentCents, 60000);
  assert.equal(view.availableCents, 140000);
  assert.equal(view.pendingCents, 150000);
  assert.equal(view.freeCents, -10000);
  assert.equal(view.spendingSituation, "within");
  assert.equal(view.spendingExcessCents, null);
  assert.equal(view.planningSituation, "over");
  assert.equal(view.planningShortfallCents, 10000);
  assert.equal(planningShortfallLabel(view.planningShortfallCents!), `As atividades ainda previstas ultrapassam o saldo disponível em ${formatCurrency(10000)}.`);
  assert.equal(spendingStatusLabel(view), "Dentro do orçamento");
  assert.notEqual(spendingStatusLabel(view), planningShortfallLabel(view.planningShortfallCents!));
});

test("scenario 3: a linked expense reduces that activity's reservation and is not counted twice", () => {
  const dinner = activity("jantar", 20000, "Refeição", "Jantar");
  const paid = expense("conta", 15000, { activity_id: "jantar" });
  const view = tripBudgetView(trip(200000), [dinner], [paid]);
  assert.equal(view.spentCents, 15000);
  assert.equal(view.availableCents, 185000);
  assert.equal(activityPendingCents(dinner, [paid]), 5000);
  assert.equal(view.pendingCents, 5000);
  assert.equal(view.freeCents, 180000);
  assert.equal(view.projectedCents, 20000);
  assert.equal(dinner.budget_cents, 20000);
  assert.notEqual(view.projectedCents, 20000 + 15000);
  assert.notEqual(view.freeCents, 200000 - 15000 - 20000);
});

test("a linked activity of R$ 500 with R$ 200 spent keeps R$ 300 reserved", () => {
  const tour = activity("passeio", 50000);
  const ticket = expense("ingresso", 20000, { activity_id: "passeio" });
  const view = tripBudgetView(trip(200000), [tour], [ticket]);
  assert.equal(view.availableCents, 180000);
  assert.equal(view.pendingCents, 30000);
  assert.equal(view.freeCents, 150000);
  assert.equal(tour.budget_cents, 50000);
  assert.equal(view.projectedCents, 50000);
});

test("scenario 4: an overrun on one activity does not consume the reservation of another", () => {
  const first = activity("a", 50000);
  const second = activity("b", 50000);
  const over = expense("extra", 70000, { activity_id: "a" });
  const view = tripBudgetView(trip(200000), [first, second], [over]);
  assert.equal(view.availableCents, 130000);
  assert.equal(activityPendingCents(first, [over]), 0);
  assert.equal(activityPendingCents(second, [over]), 50000);
  assert.equal(view.pendingCents, 50000);
  assert.equal(view.freeCents, 80000);
  assert.equal(view.spendingSituation, "within");
  assert.equal(view.planningShortfallCents, null);
  assert.notEqual(view.pendingCents, Math.max(100000 - 70000, 0));
});

test("several expenses linked to the same activity are summed before the reservation is capped at zero", () => {
  const meal = activity("jantar", 20000, "Refeição");
  const expenses = [expense("entrada", 8000, { activity_id: "jantar" }), expense("prato", 7000, { activity_id: "jantar" }), expense("sobremesa", 9000, { activity_id: "jantar" })];
  assert.equal(activityPendingCents(meal, expenses), 0);
  const view = tripBudgetView(trip(200000), [meal, activity("museu", 40000)], expenses);
  assert.equal(view.spentCents, 24000);
  assert.equal(view.pendingCents, 40000);
  assert.equal(view.availableCents, 176000);
  assert.equal(view.freeCents, 136000);
});

test("an undefined activity budget adds no invented reservation, while its expenses still reduce the balance", () => {
  const open = activity("passeio", null, "Lazer", "Passeio");
  const known = activity("jantar", 20000, "Refeição");
  const ticket = expense("ingresso", 5000, { activity_id: "passeio", description: "Jantar" });
  const view = tripBudgetView(trip(200000), [open, known], [ticket]);
  assert.equal(activityPendingCents(open, [ticket]), 0);
  assert.equal(view.pendingCents, 20000);
  assert.equal(view.plannedCents, 20000);
  assert.equal(view.undefinedBudgetCount, 1);
  assert.equal(view.spentCents, 5000);
  assert.equal(view.availableCents, 195000);
  assert.equal(view.freeCents, 175000);
  assert.equal(undefinedBudgetMessage(1), "Há 1 atividade com orçamento a definir. O planejamento está incompleto e os indicadores consideram apenas os valores conhecidos.");
  assert.equal(undefinedBudgetMessage(3), "Há 3 atividades com orçamento a definir. O planejamento está incompleto e os indicadores consideram apenas os valores conhecidos.");
  assert.match(undefinedBudgetMessage(1)!, /valores conhecidos/);
});

test("name, category and date do not create a link, and a past activity stays reserved", () => {
  const dinner = activity("jantar", 20000, "Refeição", "Jantar");
  dinner.starts_at = "2020-01-01T15:00:00Z";
  const similar = expense("parecido", 15000, { description: "Jantar", category: "Alimentação", expense_date: "2020-01-01" });
  const view = tripBudgetView(trip(200000), [dinner], [similar]);
  assert.equal(view.pendingCents, 20000);
  assert.equal(view.availableCents, 185000);
  assert.equal(view.freeCents, 165000);
  assert.equal(dinner.budget_cents, 20000);
});

test("spending beyond the initial budget is a different alert from an uncovered plan", () => {
  const overSpent = tripBudgetView(trip(200000), [], [expense("hotel", 215000, { expense_date: "2026-09-01", category: "Hospedagem" })]);
  assert.equal(overSpent.availableCents, -15000);
  assert.equal(overSpent.freeCents, -15000);
  assert.equal(overSpent.spendingExcessCents, 15000);
  assert.equal(overSpent.planningShortfallCents, null);
  assert.equal(overSpent.spendingSituation, "over");
  assert.equal(spendingStatusLabel(overSpent), `Os gastos ultrapassaram o orçamento inicial em ${formatCurrency(15000)}.`);
  assert.equal(overSpent.pendingCents, 0);

  const both = tripBudgetView(trip(200000), [activity("plano", 50000)], [expense("hotel", 215000)]);
  assert.equal(both.spendingExcessCents, 15000);
  assert.equal(both.planningShortfallCents, 65000);
  assert.notEqual(both.spendingExcessCents, both.planningShortfallCents);
  assert.equal(both.freeCents, -65000);
});

test("exact totals are fully used, including an explicit zero budget, without dividing by zero", () => {
  const exact = tripBudgetView(trip(200000), [activity("plano", 200000)], [expense("pago", 200000, { activity_id: "plano" })]);
  assert.equal(exact.availableCents, 0);
  assert.equal(exact.pendingCents, 0);
  assert.equal(exact.freeCents, 0);
  assert.equal(exact.spendingSituation, "exact");
  assert.equal(exact.planningSituation, "exact");
  assert.equal(spendingStatusLabel(exact), "Orçamento totalmente utilizado");
  assert.equal(scheduleCalmLabel(exact), "Orçamento totalmente utilizado");
  assert.equal(exact.spendingPercent, 100);
  assert.equal(exact.spendingExcessCents, null);
  assert.equal(exact.planningShortfallCents, null);

  const reserved = tripBudgetView(trip(200000), [activity("plano", 150000)], [expense("pago", 50000)]);
  assert.equal(reserved.availableCents, 150000);
  assert.equal(reserved.freeCents, 0);
  assert.equal(scheduleCalmLabel(reserved), "O saldo disponível está totalmente reservado para as atividades.");
  assert.equal(reserved.planningShortfallCents, null);

  const zero = tripBudgetView(trip(0), [], []);
  assert.equal(zero.spendingSituation, "exact");
  assert.equal(zero.planningSituation, "exact");
  assert.equal(zero.availableCents, 0);
  assert.equal(zero.freeCents, 0);
  assert.equal(zero.spendingPercent, null);
  assert.equal(zero.reservedPercent, null);

  const overZero = tripBudgetView(trip(0), [activity("plano", 100)], [expense("pago", 50)]);
  assert.equal(overZero.spendingExcessCents, 50);
  assert.equal(overZero.planningShortfallCents, 150);
  assert.equal(overZero.availableCents, -50);
  assert.equal(overZero.freeCents, -150);
  assert.equal(overZero.spendingPercent, null);
  assert.equal(overZero.reservedPercent, null);
});

test("a legacy trip without a budget keeps the totals and calculates neither balance nor excess", () => {
  const view = tripBudgetView(trip(null), [activity("planned", 150000), activity("open", null)], [expense("paid", 80000)]);
  assert.equal(view.plannedCents, 150000);
  assert.equal(view.pendingCents, 150000);
  assert.equal(view.spentCents, 80000);
  assert.equal(view.projectedCents, 230000);
  assert.equal(view.undefinedBudgetCount, 1);
  assert.equal(view.availableCents, null);
  assert.equal(view.freeCents, null);
  assert.equal(view.spendingSituation, "undefined");
  assert.equal(view.planningSituation, "undefined");
  assert.equal(view.spendingExcessCents, null);
  assert.equal(view.planningShortfallCents, null);
  assert.equal(spendingStatusLabel(view), "Orçamento inicial não definido");
  assert.equal(scheduleCalmLabel(view), "Orçamento inicial não definido");
});

test("unknown expenses are not replaced by zero, so no balance looks available", () => {
  const view = tripBudgetView(trip(200000), [activity("planned", 150000)], null);
  assert.equal(view.plannedCents, 150000);
  assert.equal(view.spentCents, null);
  assert.equal(view.pendingCents, null);
  assert.equal(view.availableCents, null);
  assert.equal(view.freeCents, null);
  assert.equal(view.projectedCents, null);
  assert.equal(view.spendingSituation, "unknown");
  assert.equal(view.planningSituation, "unknown");
  assert.notEqual(view.availableCents, 200000);
  assert.notEqual(view.pendingCents, 150000);
  assert.equal(spendingStatusLabel(view), "Não foi possível carregar este total. O saldo não foi calculado.");
});

test("editing the initial budget recalculates the derived balances and does not change records", () => {
  const activities = [activity("planned", 150000)];
  const expenses = [expense("paid", 80000)];
  const before = tripBudgetView(trip(200000), activities, expenses);
  const after = tripBudgetView(trip(100000), activities, expenses);
  assert.equal(before.plannedCents, after.plannedCents);
  assert.equal(before.spentCents, after.spentCents);
  assert.equal(before.pendingCents, after.pendingCents);
  assert.equal(activities[0].budget_cents, 150000);
  assert.equal(expenses[0].amount_cents, 80000);
  assert.equal(after.initialCents, 100000);
  assert.equal(after.availableCents, 20000);
  assert.equal(after.freeCents, -130000);
  assert.equal(after.spendingSituation, "within");
  assert.equal(after.planningShortfallCents, 130000);
});

test("creating or editing an activity changes the plan and the free balance, not the money already spent", () => {
  const activities = [activity("planned", 150000), activity("open", null)];
  const expenses = [expense("paid", 80000), expense("lodging", 60000, { category: "Hospedagem", expense_date: "2026-09-01" })];
  const original = tripBudgetView(trip(200000), activities, expenses);
  assert.equal(original.spentCents, 140000);
  assert.equal(original.availableCents, 60000);
  assert.equal(original.pendingCents, 150000);
  const added = tripBudgetView(trip(200000), [...activities, activity("novo", 10000)], expenses);
  assert.equal(added.spentCents, original.spentCents);
  assert.equal(added.availableCents, original.availableCents);
  assert.equal(added.pendingCents, 160000);
  assert.equal(added.freeCents, -100000);
  const edited = tripBudgetView(trip(200000), [{ ...activities[0], budget_cents: 40000 }, activities[1]], expenses);
  assert.equal(edited.pendingCents, 40000);
  assert.equal(edited.spentCents, original.spentCents);
  assert.equal(edited.availableCents, original.availableCents);
  assert.equal(edited.freeCents, 20000);
});

test("editing an expense replaces its amount, and deleting it restores the balance and the reservation", () => {
  const meal = activity("jantar", 20000, "Refeição");
  const originalExpense = expense("conta", 15000, { activity_id: "jantar" });
  const before = tripBudgetView(trip(200000), [meal], [originalExpense]);
  const editedExpense = { ...originalExpense, amount_cents: 5000 };
  const edited = tripBudgetView(trip(200000), [meal], [editedExpense]);
  assert.equal(before.spentCents, 15000);
  assert.equal(edited.spentCents, 5000);
  assert.equal(edited.availableCents, 195000);
  assert.equal(edited.pendingCents, 15000);
  assert.equal(edited.initialCents, 200000);
  assert.equal(meal.budget_cents, 20000);
  const removed = tripBudgetView(trip(200000), [meal], []);
  assert.equal(removed.spentCents, 0);
  assert.equal(removed.availableCents, 200000);
  assert.equal(removed.pendingCents, 20000);
  assert.equal(removed.freeCents, 180000);
  assert.equal(removed.initialCents, 200000);
});

test("moving a link keeps the financial balance and only moves the affected reservations", () => {
  const first = activity("a", 50000);
  const second = activity("b", 20000);
  const paid = expense("conta", 30000, { activity_id: "a" });
  const before = tripBudgetView(trip(200000), [first, second], [paid]);
  const moved = tripBudgetView(trip(200000), [first, second], [{ ...paid, activity_id: "b" }]);
  assert.equal(moved.spentCents, before.spentCents);
  assert.equal(moved.availableCents, before.availableCents);
  assert.equal(activityPendingCents(first, [paid]), 20000);
  assert.equal(activityPendingCents(first, [{ ...paid, activity_id: "b" }]), 50000);
  assert.equal(activityPendingCents(second, [{ ...paid, activity_id: "b" }]), 0);
  assert.equal(before.pendingCents, 40000);
  assert.equal(before.freeCents, 130000);
  assert.equal(moved.pendingCents, 50000);
  assert.equal(moved.freeCents, 120000);
  assert.equal(paid.amount_cents, 30000);
});

test("deleting an activity drops its reservation and keeps the expense in the financial balance", () => {
  const first = activity("a", 50000);
  const second = activity("b", 50000);
  const paid = expense("conta", 20000, { activity_id: "a" });
  const before = tripBudgetView(trip(200000), [first, second], [paid]);
  const unlinked = tripBudgetView(trip(200000), [second], [{ ...paid, activity_id: null }]);
  const orphan = tripBudgetView(trip(200000), [second], [paid]);
  assert.equal(before.pendingCents, 80000);
  assert.equal(unlinked.spentCents, 20000);
  assert.equal(unlinked.availableCents, 180000);
  assert.equal(unlinked.pendingCents, 50000);
  assert.equal(unlinked.initialCents, 200000);
  assert.equal(orphan.spentCents, unlinked.spentCents);
  assert.equal(orphan.availableCents, unlinked.availableCents);
  assert.equal(orphan.pendingCents, unlinked.pendingCents);
  assert.equal(first.budget_cents, 50000);
});

test("repeating the calculation does not decrement the initial budget or duplicate a record", () => {
  const activities = [activity("a", 50000), { ...activity("copy", 50000), id: "a" }];
  const expenses = [expense("conta", 20000, { activity_id: "a" }), { ...expense("again", 90000, { activity_id: "a" }), id: "conta" }];
  const first = tripBudgetView(trip(200000), activities, expenses);
  const second = tripBudgetView(trip(200000), activities, expenses);
  assert.equal(first.spentCents, 20000);
  assert.equal(first.pendingCents, 30000);
  assert.equal(first.availableCents, 180000);
  assert.equal(second.availableCents, first.availableCents);
  assert.equal(second.freeCents, first.freeCents);
  assert.equal(activities[0].budget_cents, 50000);
  assert.equal(trip(200000).initial_budget_cents, 200000);
});

test("filters, other trips and a visible page cannot replace the trip totals", () => {
  const activities = [activity("meal", 150000, "Refeição"), activity("tour", 80000, "Lazer")];
  const expenses = [
    expense("fuel", 20000, { category: "Combustível", expense_date: "2026-09-01" }),
    expense("lunch", 60000, { category: "Alimentação", activity_id: "meal" }),
  ];
  const view = tripBudgetView(trip(200000), [...activities, { ...activity("foreign", 900000), trip_id: "other-trip" }], [...expenses, expense("foreign", 900000, { trip_id: "other-trip", activity_id: "meal" })]);
  assert.equal(view.plannedCents, 230000);
  assert.equal(view.spentCents, 80000);
  assert.equal(view.pendingCents, 170000, "the foreign expense does not reduce this trip's reservation");
  assert.equal(view.availableCents, 120000);
  const filteredActivities = filterActivities(activities, { type: "Refeição" }, "America/Sao_Paulo");
  const filteredExpenses = filterExpenses(expenses, { category: "Combustível" });
  const page = tripBudgetView(trip(200000), filteredActivities, filteredExpenses);
  assert.equal(summarizeActivities(filteredActivities).totalCents, 150000);
  assert.equal(summarizeExpenses(filteredExpenses).totalCents, 20000);
  assert.notEqual(page.spentCents, view.spentCents);
  assert.notEqual(page.pendingCents, view.pendingCents);
  assert.equal(view.availableCents, 120000);
});
