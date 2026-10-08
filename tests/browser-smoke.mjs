/** Safe smoke test: draft-only checks with no Supabase backend configured. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const artifacts = path.resolve('artifacts');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(15000);
async function noOverflow(label) {
  const widths = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth, document.body.scrollWidth]);
  assert(widths[1] <= widths[0] + 1 && widths[2] <= widths[0] + 1, `${label}: overflow ${widths}`);
}
try {
  await mkdir(artifacts, { recursive: true });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByText(/Conecte o Supabase e aplique as migrações/).waitFor();
  assert(await page.getByText(/Conecte o Supabase e aplique as migrações/).isVisible(), 'Only run draft-only checks with Supabase unconfigured.');
  await page.getByRole('heading', { name: 'Minhas viagens', exact: true }).waitFor();
  assert.equal(await page.locator('.trip-card').count(), 0, 'no invented trip cards');
  await page.getByLabel('Pesquisar por nome ou destino').fill('Uma busca');
  for (const label of ['Todas', 'Próximas', 'Em andamento', 'Passadas', 'Arquivadas']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    assert.equal(await page.locator('.trip-card').count(), 0);
  }
  await noOverflow('desktop list');
  await page.screenshot({ path: path.join(artifacts, 'desktop-viagens.png'), fullPage: true });
  await page.getByRole('button', { name: 'Nova viagem', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Nova viagem', exact: true }).waitFor();
  const name = page.getByLabel(/Nome da viagem/);
  const budget = page.getByLabel(/Orçamento inicial da viagem/);
  assert.equal(await name.inputValue(), '');
  assert.equal(await budget.inputValue(), '');
  assert.equal(await page.getByLabel('Destino', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Data de início').inputValue(), '');
  assert.equal(await page.getByLabel('Data de término').inputValue(), '');
  assert.equal(await page.getByLabel('Fuso horário').inputValue(), 'America/Sao_Paulo');
  assert.equal(await budget.getAttribute('inputmode'), 'decimal');
  assert(await page.getByRole('button', { name: /Criar viagem/ }).isDisabled(), 'unconfigured app cannot confirm creation');
  await name.fill('Rascunho de teste');
  await budget.fill('0,00');
  assert.equal(await budget.inputValue(), '0,00', 'zero is preserved as a draft');
  const prompt = page.waitForEvent('dialog');
  const click = page.getByRole('button', { name: 'Minhas viagens', exact: true }).click();
  const confirmation = await prompt;
  assert.equal(confirmation.type(), 'confirm');
  await confirmation.dismiss(); await click;
  assert.equal(await name.inputValue(), 'Rascunho de teste', 'canceling navigation preserves draft');
  const nextPrompt = page.waitForEvent('dialog');
  const nextClick = page.getByRole('button', { name: 'Minhas viagens', exact: true }).click();
  await (await nextPrompt).accept(); await nextClick;
  await page.getByRole('heading', { name: 'Minhas viagens', exact: true }).waitFor();
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow('360px list');
  await page.screenshot({ path: path.join(artifacts, 'mobile-viagens.png'), fullPage: true });
  await page.getByRole('button', { name: 'Nova viagem', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Nova viagem', exact: true }).waitFor();
  await noOverflow('360px new trip');
  await page.screenshot({ path: path.join(artifacts, 'mobile-nova-viagem.png'), fullPage: true });
  await page.getByRole('button', { name: 'Minhas viagens', exact: true }).click();
  await page.getByRole('button', { name: /Instalar aplicativo/ }).click();
  await page.getByText('Nossa Viagem sempre por perto', { exact: true }).waitFor();
  await noOverflow('360px install help');
  assert.deepEqual(errors, []);
  console.log('PASS Minhas viagens sem dados fictícios; filtros e pesquisa; formulário vazio; orçamento zero como rascunho; descarte confirmado; desktop e 360px; instruções da PWA.');
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'browser-failure.png'), fullPage: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { await context.close(); await browser.close(); }