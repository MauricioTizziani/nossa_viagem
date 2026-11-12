import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const normalize = value => value.replace(/\s+/g, ' ').trim();
const money = cents => `${cents < 0 ? '-' : ''}${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(cents) / 100)}`;

async function amount(page, id, cents) {
  const expected = normalize(money(cents));
  await page.waitForFunction(({ id, expected }) => {
    const element = document.querySelector(`[data-testid="${id}"]`);
    return element?.textContent.replace(/\s+/g, ' ').trim() === expected;
  }, { id, expected }, { timeout: 15000 });
}

async function navigate(page, label) {
  await page.getByRole('button', { name: label, exact: true }).click();
}

async function focus(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

async function schedule(page, available, pending, free) {
  await amount(page, 'budget-schedule-available', available);
  await amount(page, 'budget-schedule-pending', pending);
  await amount(page, 'budget-schedule-free', free);
}

async function addExpense(page, description, amountValue, activityId, beforeSave) {
  await navigate(page, 'Gastos');
  await page.getByRole('button', { name: 'Adicionar gasto', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Um novo gasto' });
  await dialog.getByLabel(/^Descrição/).fill(description);
  await dialog.getByLabel(/^Categoria/).selectOption('Outros');
  await dialog.getByLabel(/^Valor \(R\$\)/).fill(amountValue);
  await dialog.getByLabel(/^Data do gasto/).fill('2030-04-10');
  if (activityId) await dialog.getByLabel('Atividade relacionada', { exact: true }).selectOption(activityId);
  if (beforeSave) await beforeSave();
  await dialog.getByRole('button', { name: 'Salvar gasto', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await navigate(page, 'Cronograma');
}

async function editExpense(page, description, change) {
  await navigate(page, 'Gastos');
  await page.getByRole('button', { name: `Editar ${description}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar gasto' });
  await change(dialog);
  await dialog.getByRole('button', { name: 'Salvar gasto', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await navigate(page, 'Cronograma');
}

async function deleteExpense(page, description) {
  await navigate(page, 'Gastos');
  await page.getByRole('button', { name: `Excluir ${description}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Excluir este gasto?' });
  await dialog.getByRole('button', { name: 'Excluir gasto', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await navigate(page, 'Cronograma');
}

/** Dedicated trip in the HTTP fixture. Nothing is read from or written to a real project. */
export async function verifyBudgetReservations({ page, context, appOrigin, trip: sourceTrip, activities, trips, expenses, root }) {
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 1366, height: 900 });
  const sourceInitialBudget = sourceTrip.initial_budget_cents;
  const trip = { ...sourceTrip, id: randomUUID(), name: 'Reserva — cenário isolado', initial_budget_cents: 100000, version: 1 };
  trips.set(trip.id, trip);
  const makeActivity = (name, budget) => ({ id: randomUUID(), trip_id: trip.id, name, budget_cents: budget,
    starts_at: '2030-04-10T15:00:00.000Z', type: 'Lazer', observation: 'Observação histórica preservada.', version: 1,
    place_id: null, manual_place_name: null, manual_place_address: null, manual_place_url: null,
    osm_place_id: null, osm_place_name: null, osm_place_address: null, osm_latitude: null, osm_longitude: null });
  const planned = makeActivity('Atividade prevista em duzentos', 20000);
  activities.set(planned.id, planned);
  const original = JSON.stringify(planned);
  const otherDevice = await context.newPage();
  try {
    await page.goto(`${appOrigin}/viagens/${trip.id}/cronograma`);
    await schedule(page, 100000, 20000, 80000);
    await otherDevice.goto(`${appOrigin}/viagens/${trip.id}/cronograma`);
    await schedule(otherDevice, 100000, 20000, 80000);

    await addExpense(page, 'Primeiro gasto confirmado', '132,00', planned.id, async () => {
      await amount(page, 'budget-spending-used', 0);
      await amount(page, 'budget-spending-balance', 100000);
      assert.equal([...expenses.values()].filter(value => value.trip_id === trip.id).length, 0,
        'the open draft never affects confirmed totals');
    });
    await schedule(page, 86800, 0, 86800);
    await page.getByText(/68,00 abaixo do previsto até agora\. Diferença não reservada\./).filter({ visible: true }).first().waitFor();
    await focus(otherDevice);
    await schedule(otherDevice, 86800, 0, 86800);

    await addExpense(page, 'Segundo gasto confirmado', '20,00', planned.id);
    await schedule(page, 84800, 0, 84800);
    await editExpense(page, 'Primeiro gasto confirmado', dialog => dialog.getByLabel(/^Valor \(R\$\)/).fill('140,00'));
    await schedule(page, 84000, 0, 84000);
    await deleteExpense(page, 'Segundo gasto confirmado');
    await schedule(page, 86000, 0, 86000);
    await deleteExpense(page, 'Primeiro gasto confirmado');
    await schedule(page, 100000, 20000, 80000);
    await focus(otherDevice);
    await schedule(otherDevice, 100000, 20000, 80000);

    await addExpense(page, 'Gasto para mudar vínculo', '132,00', planned.id);
    const nextPlan = makeActivity('Outro plano com a diferença', 6800);
    activities.set(nextPlan.id, nextPlan);
    await focus(page);
    await schedule(page, 86800, 6800, 80000);
    await editExpense(page, 'Gasto para mudar vínculo', dialog => dialog.getByLabel('Atividade relacionada', { exact: true }).selectOption(nextPlan.id));
    await schedule(page, 86800, 20000, 66800);
    await editExpense(page, 'Gasto para mudar vínculo', dialog => dialog.getByLabel('Atividade relacionada', { exact: true }).selectOption(''));
    await schedule(page, 86800, 26800, 60000);
    await editExpense(page, 'Gasto para mudar vínculo', dialog => dialog.getByLabel('Atividade relacionada', { exact: true }).selectOption(planned.id));
    await schedule(page, 86800, 6800, 80000);
    await editExpense(page, 'Gasto para mudar vínculo', dialog => dialog.getByLabel(/^Valor \(R\$\)/).fill('250,00'));
    await schedule(page, 75000, 6800, 68200);
    await page.getByText(/50,00 acima do previsto até agora/).filter({ visible: true }).first().waitFor();
    assert.equal(JSON.stringify(activities.get(planned.id)), original, 'all expense operations preserve the original activity');
    assert.equal(trip.initial_budget_cents, 100000);

    // Recreate the supplied totals with isolated records. The unspecified remainder is synthetic.
    for (const [id, value] of activities) if (value.trip_id === trip.id) activities.delete(id);
    for (const [id, value] of expenses) if (value.trip_id === trip.id) expenses.delete(id);
    trip.initial_budget_cents = 170000;
    const reference = [
      ['Feira japonesa', 20000, 13200], ['Visita museu PUCRS', 8300, 5400],
      ['Jantar Tanga Tacos', 14000, 9950], ['Café da manhã', 6000, 2420],
      ['Almoço no Sui Yuan', 9000, 8500], ['Jantar no shopping', 14000, 7836],
      ['Orçamento restante da fixture', 29800, 29800], ['Atividade com orçamento zero', 0, null],
      ['Rolê no Centro', null, 6400], ['A definir um', null, null], ['A definir dois', null, null], ['A definir três', null, null],
    ];
    const makeExpense = (description, cents, activityId = null) => ({ id: randomUUID(), trip_id: trip.id, description,
      category: 'Outros', amount_cents: cents, expense_date: '2030-04-10', activity_id: activityId,
      notes: 'Registro histórico da fixture.', version: 1 });
    for (const [name, budget, spent] of reference) {
      const activity = makeActivity(name, budget);
      activities.set(activity.id, activity);
      if (spent !== null) {
        const expense = makeExpense(name, spent, activity.id);
        expenses.set(expense.id, expense);
      }
    }
    const unlinked = makeExpense('Gastos sem vínculo da fixture', 71720);
    expenses.set(unlinked.id, unlinked);
    const savedRecords = JSON.stringify({ trip, activities: [...activities.values()], expenses: [...expenses.values()] });
    await focus(page);
    await schedule(page, 14774, 0, 14774);
    await page.getByTestId('budget-schedule').getByRole('img', { name: '0% do saldo disponível', exact: true }).waitFor();
    assert.equal(await page.getByTestId('budget-schedule-planning-alert').count(), 0);
    assert.equal(await page.getByTestId('budget-schedule-spending-alert').count(), 0);
    assert.match(normalize(await page.getByTestId('budget-schedule-planned').innerText()), /R\$ 1\.011,00/);
    await page.getByText(/3 atividades.*sem orçamento.*sem gastos/).first().waitFor();
    await page.getByText(/1 atividade.*gastos.*orçamento original/).first().waitFor();
    if (root) {
      const viewport = page.viewportSize();
      await mkdir(resolve(root, 'artifacts'), { recursive: true });
      for (const [label, size] of [['desktop', { width: 1366, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
        await page.setViewportSize(size);
        await page.evaluate(() => scrollTo(0, 0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
          `the corrected budget fits the ${label} viewport`);
        await page.screenshot({ path: resolve(root, `artifacts/budget-corrected-${label}.png`), fullPage: true });
      }
      if (viewport) await page.setViewportSize(viewport);
    }
    await page.getByLabel('Filtrar por tipo').selectOption('Refeição');
    await schedule(page, 14774, 0, 14774);
    await navigate(page, 'Gastos');
    await amount(page, 'budget-spending-initial', 170000);
    await amount(page, 'budget-spending-used', 155226);
    await amount(page, 'budget-spending-balance', 14774);
    await page.getByLabel('Pesquisar gasto por descrição').fill('sem correspondência');
    await amount(page, 'budget-spending-used', 155226);
    await amount(page, 'budget-spending-balance', 14774);
    await navigate(page, 'Resumo');
    await amount(page, 'budget-flow-available', 14774);
    await amount(page, 'budget-flow-pending', 0);
    await amount(page, 'budget-flow-free', 14774);
    await amount(page, 'budget-flow-projection', 155226);
    await focus(otherDevice);
    await schedule(otherDevice, 14774, 0, 14774);
    assert.equal(JSON.stringify({ trip, activities: [...activities.values()], expenses: [...expenses.values()] }), savedRecords,
      'rendering, filters, summaries and refresh do not write financial history');
    assert.equal(sourceTrip.initial_budget_cents, sourceInitialBudget, 'the dedicated fixture never changes another trip');
  } finally {
    await otherDevice.close();
    await page.goto(`${appOrigin}/viagens/${sourceTrip.id}/cronograma`);
    if (originalViewport) await page.setViewportSize(originalViewport);
    trips.delete(trip.id);
    for (const [id, value] of activities) if (value.trip_id === trip.id) activities.delete(id);
    for (const [id, value] of expenses) if (value.trip_id === trip.id) expenses.delete(id);
  }
}
