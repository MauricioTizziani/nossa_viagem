import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// This smoke test only edits unsaved drafts in an unconfigured application.
// It requires an existing Chrome installation; it never downloads a browser.
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const artifacts = path.resolve(process.cwd(), 'artifacts');
const launchOptions = { headless: true };
if (process.env.BROWSER_EXECUTABLE) launchOptions.executablePath = process.env.BROWSER_EXECUTABLE;
else launchOptions.channel = 'chrome';

const browser = await chromium.launch(launchOptions);
const checks = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(12000);

async function visible(locator, message) {
  await locator.waitFor({ state: 'visible' });
  assert(await locator.isVisible(), message);
}

async function noOverflow(label) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(widths.html <= widths.viewport + 1, `${label}: document overflow ${JSON.stringify(widths)}`);
  assert(widths.body <= widths.viewport + 1, `${label}: body overflow ${JSON.stringify(widths)}`);
}

async function focusInsideDialog(dialog) {
  assert(await dialog.evaluate((element) => element.contains(document.activeElement)), 'Keyboard focus must remain inside the dialog');
}

async function closeDirtyDialog(dialog, accept) {
  const confirmation = page.waitForEvent('dialog');
  const clicking = dialog.getByRole('button', { name: 'Fechar formulário' }).click();
  const prompt = await confirmation;
  assert.equal(prompt.type(), 'confirm');
  assert.match(prompt.message(), /descartar|alteraç/i);
  if (accept) await prompt.accept();
  else await prompt.dismiss();
  await clicking;
}

try {
  await mkdir(artifacts, { recursive: true });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  // Stop before opening a form if a real backend is configured.
  assert(await page.getByRole('button', { name: 'Como começar' }).isVisible(), 'Run this smoke test with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY unset; live trips must not be modified.');

  await visible(page.getByRole('heading', { name: 'Nossa próxima aventura começa aqui' }), 'The initial schedule must be empty');
  await visible(page.getByText('Destino a escolher', { exact: true }));
  await visible(page.getByText('Datas a combinar', { exact: true }));
  assert.equal(await page.locator('section[aria-labelledby="schedule-heading"] article').count(), 0);
  await noOverflow('desktop schedule');
  await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });
  checks.push('Desktop empty state contains no invented destination, dates or activities');

  await page.locator('.desktop-nav').getByRole('button', { name: 'Resumo', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'O que estamos planejando' }));
  await visible(page.getByText('Ainda temos espaço para novas memórias.', { exact: true }));
  for (const type of ['Refeição', 'Lazer', 'Atividade']) await visible(page.getByRole('heading', { name: type, exact: true }));
  await visible(page.getByRole('heading', { name: 'Gastos da viagem', exact: true }));
  await visible(page.getByText('Orçamento previsto no cronograma', { exact: true }));
  assert.match(await page.getByTestId('summary-expenses-total').textContent(), /R\$\s0,00/);
  await visible(page.getByText('Nenhum gasto registrado até agora', { exact: true }));
  checks.push('Summary shows all three categories, the empty daily summary and a separate R$ 0,00 expenses section');

  await page.locator('.desktop-nav').getByRole('button', { name: 'Gastos', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'Nossos gastos' }));
  await visible(page.getByText('Ainda não registramos nenhum gasto.', { exact: true }));
  await visible(page.getByText('Adicione a primeira despesa da nossa viagem.', { exact: true }));
  assert.match(await page.getByTestId('expenses-total').textContent(), /R\$\s0,00/);
  assert.equal(await page.getByTestId('expenses-subtotal').count(), 0, 'no filter subtotal without active filters');
  await page.getByLabel('Data inicial').fill('2026-10-10');
  await page.getByLabel('Data final').fill('2026-10-09');
  await visible(page.getByRole('alert').filter({ hasText: 'A data final do filtro não pode ser anterior à data inicial.' }));
  await visible(page.getByTestId('expenses-subtotal'));
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).first().click();
  assert.equal(await page.getByLabel('Data inicial').inputValue(), '');
  await noOverflow('desktop expenses');
  checks.push('Expenses tab opens empty with R$ 0,00, validates the filter period and clears filters');

  await page.getByRole('button', { name: 'Adicionar gasto', exact: true }).first().click();
  let expenseDialog = page.getByRole('dialog', { name: 'Um novo gasto' });
  await visible(expenseDialog);
  await focusInsideDialog(expenseDialog);
  const expenseLabels = await expenseDialog.locator('.expense-form .field-label').evaluateAll((elements) => elements.map((element) => element.textContent.trim()));
  assert.equal(expenseLabels.length, 6, `Expected six expense fields, got ${expenseLabels.length}`);
  ['Descrição', 'Categoria', 'Valor (R$)', 'Data do gasto', 'Atividade relacionada', 'Observações'].forEach((label, index) => assert(expenseLabels[index].startsWith(label), `Wrong expense field order at ${index}: ${expenseLabels[index]}`));
  const expenseDate = expenseDialog.locator('input[type="date"]');
  const expectedToday = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  assert.equal(await expenseDate.inputValue(), expectedToday, 'the suggested date is today in the trip timezone');
  const amount = expenseDialog.getByPlaceholder('Ex.: 150,00', { exact: true });
  assert.equal(await amount.getAttribute('inputmode'), 'decimal');
  assert.equal(await amount.inputValue(), '', 'the amount is never prefilled with zero');
  const categorySelect = expenseDialog.locator('select').first();
  assert.deepEqual(await categorySelect.locator('option').allTextContents(), ['Escolha a categoria', 'Combustível', 'Hospedagem', 'Alimentação', 'Transporte', 'Passeios e lazer', 'Compras', 'Outros']);
  await visible(expenseDialog.getByText('O cronograma ainda não tem atividades. Dá para vincular depois.', { exact: true }));
  const description = expenseDialog.getByPlaceholder('Gasolina — viagem de ida, Airbnb — hospedagem…');
  const saveExpense = expenseDialog.getByRole('button', { name: 'Salvar gasto', exact: true });
  await description.fill('  Rascunho de gasto do teste  ');
  await categorySelect.selectOption('Combustível');
  await saveExpense.click();
  assert.equal(await amount.evaluate((element) => element.validity.valueMissing), true, 'an empty amount is required by the browser too');
  await amount.fill('0,00');
  await saveExpense.click();
  await visible(expenseDialog.getByRole('alert').filter({ hasText: 'O valor do gasto deve ser maior que zero.' }));
  await amount.fill('-150,00');
  await saveExpense.click();
  await visible(expenseDialog.getByRole('alert').filter({ hasText: /valor positivo/ }));
  await amount.fill('150,00');
  await saveExpense.click();
  await visible(expenseDialog.getByRole('alert').filter({ hasText: /Supabase|conect|configur/i }));
  assert.equal(await description.inputValue(), '  Rascunho de gasto do teste  ');
  assert.equal(await amount.inputValue(), '150,00');
  assert.equal(await page.getByText('Gasto salvo na nossa viagem.', { exact: true }).count(), 0);
  await closeDirtyDialog(expenseDialog, false);
  await visible(expenseDialog);
  await closeDirtyDialog(expenseDialog, true);
  await expenseDialog.waitFor({ state: 'hidden' });
  checks.push('Expense form keeps the six fields, suggests today, rejects empty/zero/negative amounts and preserves the draft');

  await page.locator('.desktop-nav').getByRole('button', { name: 'Nossa viagem', exact: true }).click();
  await visible(page.getByRole('heading', { name: 'Do jeitinho de vocês' }));
  assert.equal(await page.locator('.settings-form input[type="date"]').count(), 2);
  assert.equal(await page.locator('.settings-form input').nth(1).inputValue(), '');
  assert.equal(await page.locator('.settings-form input[type="date"]').nth(0).inputValue(), '');
  assert.equal(await page.locator('.settings-form input[type="date"]').nth(1).inputValue(), '');
  assert.equal(await page.locator('.settings-form select').inputValue(), 'America/Sao_Paulo');
  checks.push('Trip settings keep optional personal details empty and use the default trip timezone');

  await page.locator('.desktop-nav').getByRole('button', { name: 'Cronograma', exact: true }).click();
  const add = page.getByRole('button', { name: 'Adicionar atividade', exact: true });
  await add.click();
  let dialog = page.getByRole('dialog');
  await visible(dialog);
  await focusInsideDialog(dialog);
  const labels = await dialog.locator('.activity-form > .field-label, .activity-form > fieldset > .field-label').evaluateAll((elements) => elements.map((element) => element.textContent.trim()));
  assert.equal(labels.length, 5, `Expected the five original fields, got ${labels.length}`);
  ['Data e hora', 'Orçamento (R$)', 'Nome da atividade', 'Lugar', 'Tipo'].forEach((label, index) => assert(labels[index].startsWith(label), `Wrong field order at ${index}: ${labels[index]}`));
  const dateTime = dialog.locator('input[type="datetime-local"]');
  const budget = dialog.getByPlaceholder('A definir', { exact: true });
  const name = dialog.getByPlaceholder('Jantar especial, passeio no parque…');
  const type = dialog.locator('.activity-form select');
  assert(await dateTime.getAttribute('required') !== null);
  assert.equal(await budget.getAttribute('inputmode'), 'decimal');
  assert(await name.getAttribute('required') !== null);
  assert.deepEqual(await type.locator('option').allTextContents(), ['Refeição', 'Lazer', 'Atividade']);
  await visible(dialog.getByRole('button', { name: 'Informar manualmente', exact: true }));
  await visible(dialog.getByRole('combobox', { name: 'Pesquisar lugar ou endereço' }));
  await dialog.getByRole('button', { name: 'Informar manualmente', exact: true }).click();
  checks.push('The form preserves the five original fields and native date/time, decimal and category controls');

  const save = dialog.getByRole('button', { name: 'Salvar atividade', exact: true });
  await save.click();
  assert.equal(await dateTime.evaluate((element) => element.validity.valueMissing), true);
  await dateTime.fill('2026-10-08T14:30');
  await name.fill('  Rascunho temporário do teste  ');
  await budget.fill('-1,00');
  await save.click();
  await visible(dialog.getByRole('alert').filter({ hasText: /valor.*positiv|orçamento.*negativ|orçamento.*válid/i }));
  assert.equal(await budget.inputValue(), '-1,00');
  checks.push('Required date/time and negative budget validation preserve the draft');

  const manualName = dialog.getByPlaceholder('Nome do restaurante, parque ou museu');
  const manualAddress = dialog.getByPlaceholder('Rua, número, cidade');
  const manualLink = dialog.getByPlaceholder('https://www.openstreetmap.org/…');
  await manualName.fill('Local temporário');
  await manualAddress.fill('Endereço do rascunho');
  await manualLink.fill('https://example.com/nao-maps');
  assert.equal(await manualLink.getAttribute('aria-invalid'), 'true');
  await visible(dialog.getByRole('alert').filter({ hasText: 'Cole um link HTTPS válido de mapa.' }));
  await manualLink.fill('https://www.openstreetmap.org/search?query=parque');
  assert.equal(await manualLink.getAttribute('aria-invalid'), 'false');
  const openMaps = dialog.getByRole('link', { name: 'Abrir mapa', exact: true });
  assert.match(await openMaps.getAttribute('href'), /^https:\/\/www\.openstreetmap\.org\/search/);
  await visible(dialog.getByRole('link', { name: 'Traçar rota', exact: true }));
  checks.push('Manual place entry validates the Maps link and exposes Maps and directions links');

  await budget.fill('0,00');
  await save.click();
  await visible(dialog.getByRole('alert').filter({ hasText: /Supabase|conect|configur/i }));
  assert.equal(await budget.inputValue(), '0,00');
  assert.equal(await name.inputValue(), '  Rascunho temporário do teste  ');
  assert.equal(await manualName.inputValue(), 'Local temporário');
  assert.equal(await page.getByText('Atividade salva na nossa viagem.', { exact: true }).count(), 0);
  checks.push('A zero budget remains distinct from empty; unconfigured save reports an error and retains all draft fields');

  // Exercise both forward and backward Tab movement without leaving the modal.
  await dialog.getByRole('button', { name: 'Fechar formulário' }).focus();
  await page.keyboard.press('Shift+Tab');
  await focusInsideDialog(dialog);
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press('Tab');
    await focusInsideDialog(dialog);
  }
  await closeDirtyDialog(dialog, false);
  await visible(dialog);
  assert.equal(await name.inputValue(), '  Rascunho temporário do teste  ');
  await closeDirtyDialog(dialog, true);
  await dialog.waitFor({ state: 'hidden' });
  assert(await add.evaluate((element) => element === document.activeElement), 'Closing a modal should restore keyboard focus to its trigger');
  checks.push('Keyboard focus stays inside the modal, and dirty close requires explicit discard confirmation');

  const install = page.getByRole('button', { name: 'Instalar aplicativo', exact: false });
  await install.click();
  await visible(page.getByText('Nossa Viagem sempre por perto', { exact: true }));
  await visible(page.getByText(/No iPhone, abra no Safari/));
  await page.getByRole('button', { name: 'Entendi', exact: true }).click();
  checks.push('The installation action displays manual instructions when no browser installation prompt is available');

  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow('360px schedule');
  const mobileNav = page.locator('.mobile-nav');
  await visible(mobileNav);
  await visible(page.locator('.mobile-add'));
  assert.equal(await mobileNav.getByRole('button').count(), 4);
  assert.deepEqual(await mobileNav.getByRole('button').allTextContents(), ['Cronograma', 'Gastos', 'Resumo', 'Nossa viagem']);
  for (const button of await mobileNav.getByRole('button').all()) {
    const box = await button.boundingBox();
    assert(box && box.height >= 44 && box.width >= 44, 'Mobile navigation must offer comfortable touch targets');
  }
  await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
  await mobileNav.getByRole('button', { name: 'Gastos', exact: true }).click();
  await visible(page.getByText('Ainda não registramos nenhum gasto.', { exact: true }));
  await noOverflow('360px expenses');
  const mobileAddExpense = page.locator('.mobile-add');
  await visible(mobileAddExpense);
  assert.equal(await mobileAddExpense.getAttribute('aria-label'), 'Adicionar gasto');
  await mobileAddExpense.click();
  expenseDialog = page.getByRole('dialog', { name: 'Um novo gasto' });
  await visible(expenseDialog);
  await noOverflow('360px expense form');
  await visible(expenseDialog.getByRole('button', { name: 'Salvar gasto', exact: true }));
  await expenseDialog.getByRole('button', { name: 'Fechar formulário' }).click();
  await expenseDialog.waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(artifacts, 'mobile-gastos.png'), fullPage: true });
  await mobileNav.getByRole('button', { name: 'Resumo', exact: true }).click();
  await noOverflow('360px summary');
  await mobileNav.getByRole('button', { name: 'Nossa viagem', exact: true }).click();
  await noOverflow('360px settings');
  await mobileNav.getByRole('button', { name: 'Cronograma', exact: true }).click();
  await page.locator('.mobile-add').click();
  dialog = page.getByRole('dialog');
  await visible(dialog);
  await noOverflow('360px activity form');
  await visible(dialog.getByRole('button', { name: 'Salvar atividade', exact: true }));
  await dialog.getByRole('button', { name: 'Fechar formulário' }).click();
  await dialog.waitFor({ state: 'hidden' });
  checks.push('360px schedule, expenses, summary, settings and forms do not overflow; four-tab mobile navigation and add actions remain accessible');

  assert.deepEqual(errors, [], `Browser runtime errors: ${errors.join('; ')}`);
  for (const check of checks) console.log(`PASS ${check}`);
  console.log(`PASS ${checks.length} browser smoke checks; screenshots: ${artifacts}`);
} catch (error) {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, 'browser-failure.png'), fullPage: true }).catch(() => {});
  console.error(error);
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
