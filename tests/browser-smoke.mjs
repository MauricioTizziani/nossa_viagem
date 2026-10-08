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
  checks.push('Summary shows all three categories and the empty daily summary');

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
  assert.equal(await mobileNav.getByRole('button').count(), 3);
  for (const button of await mobileNav.getByRole('button').all()) {
    const box = await button.boundingBox();
    assert(box && box.height >= 44 && box.width >= 44, 'Mobile navigation must offer comfortable touch targets');
  }
  await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
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
  checks.push('360px schedule, summary, settings and form do not overflow; mobile navigation and add action remain accessible');

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
