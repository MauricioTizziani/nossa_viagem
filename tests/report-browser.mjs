import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Called with the isolated HTTP fixture from app-integration.mjs, never real data. */
export async function verifyScheduleReport({ page, context, appOrigin, trip, activities, trips, expenses, root }) {
  const backup = [...activities.values()].filter(a => a.trip_id === trip.id);
  const originalTrip = { ...trip };
  const filterReads = [];
  let failNextRead = false;
  const intercept = async route => {
    const url = new URL(route.request().url());
    filterReads.push({ trip: url.searchParams.get('trip_id'), offset: Number(url.searchParams.get('offset') ?? 0) });
    if (failNextRead) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Network error' }) }); return; }
    // Prove the report traverses the returned row count, even below Supabase's default cap.
    url.searchParams.set('limit', '3');
    await route.continue({ url: url.href });
  };
  await page.route('**/rest/v1/activities?*', intercept);
  const reportDialog = () => page.getByRole('dialog', { name: 'Relatório do cronograma', exact: true });
  const open = async () => {
    await page.getByRole('button', { name: 'Gerar relatório', exact: true }).click();
    return reportDialog();
  };
  const generate = async dialog => {
    await dialog.getByRole('button', { name: /^(Gerar|Atualizar) relatório$/ }).click();
    await dialog.getByRole('heading', { name: 'Pré-visualização', exact: true }).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => ![...document.querySelectorAll('[role=dialog] button')].some(b => b.textContent.includes('Gerando relatório…')));
  };
  const close = dialog => dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  try {
    for (const a of backup) activities.delete(a.id);
    Object.assign(trip, { name: 'Férias de São João / Relatório', destination: 'São Paulo — Praça da Sé', start_date: '2026-11-08', end_date: '2026-11-10', timezone: 'America/Manaus', updated_at: new Date().toISOString() });
    await page.goto(`${appOrigin}/viagens/${trip.id}/cronograma`);
    await page.getByRole('heading', { name: 'Nosso cronograma' }).waitFor();
    let dialog = await open();
    await dialog.getByRole('button', { name: 'Gerar relatório', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Não existem atividades' }).waitFor();
    assert.equal(await dialog.locator('img').count(), 0);
    assert.equal(await dialog.getByRole('button', { name: 'Enviar pelo WhatsApp', exact: true }).isDisabled(), true);
    await close(dialog);

    const base = backup[0];
    assert.ok(base);
    const one = { ...base, id: randomUUID(), trip_id: trip.id, starts_at: '2026-11-09T02:45:00Z', name: 'Refeição com acentuação e reserva', type: 'Refeição', budget_cents: 15000,
      osm_place_id: null, osm_place_name: null, osm_place_address: null, manual_place_name: 'Café da Sé', manual_place_address: 'Praça da Sé, 1 — São Paulo', observation: 'Atenção à reserva.\n\nMesa perto da janela. <script>não executar</script>', updated_at: new Date().toISOString() };
    activities.set(one.id, one);
    trip.updated_at = new Date().toISOString();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: `Editar ${one.name}`, exact: true }).first().waitFor();
    dialog = await open(); await generate(dialog);
    assert.equal(await dialog.locator('img').count(), 1);
    const pngUrl = await dialog.locator('img').first().getAttribute('src');
    const previewHash = await page.evaluate(async url => {
      const blob = await (await fetch(url)).blob();
      return { type: blob.type, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('') };
    }, pngUrl);
    assert.equal(previewHash.type, 'image/png');
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('link', { name: 'Baixar PNG', exact: true }).first().click();
    const download = await downloading;
    assert.match(download.suggestedFilename(), /^cronograma-ferias-de-sao-joao-relatorio-\d{4}-\d{2}-\d{2}\.png$/);
    const output = resolve(root, 'artifacts/relatorio-desktop.png');
    await download.saveAs(output);
    const bytes = await readFile(output);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), 2000); assert.equal(bytes.readUInt32BE(20), 1414);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), previewHash.hash);
    await dialog.locator('details summary').click();
    assert.match(await dialog.locator('table').innerText(), /08\/11\/2026\n22:45/);
    assert.match(await dialog.locator('table').innerText(), /Refeição.*|Atenção à reserva/);
    assert.ok((await dialog.locator('table').innerText()).includes('<script>não executar</script>'));

    // Native share is replaced only inside this isolated browser. Validate exact File bytes.
    await page.evaluate(() => {
      window.reportShares = []; window.reportShareMode = 'success';
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => window.reportShareMode !== 'unsupported' && data.files.every(file => file instanceof File && file.type === 'image/png' && file.name.endsWith('.png')) && (window.reportShareMode !== 'single' || data.files.length === 1) });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async data => {
        window.reportShareInvocations = (window.reportShareInvocations ?? 0) + 1;
        if (window.reportShareMode === 'cancel') throw new DOMException('Cancel', 'AbortError');
        if (window.reportShareMode === 'error') throw new DOMException('Blocked', 'NotAllowedError');
        if (window.reportShareMode === 'pending') await new Promise(resolve => { window.finishReportShare = resolve; });
        window.reportShares.push(await Promise.all(data.files.map(async file => ({ name: file.name, type: file.type, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('') }))));
      } });
    });
    const share = dialog.getByRole('button', { name: 'Enviar pelo WhatsApp', exact: true });
    await share.click(); await dialog.getByRole('status').filter({ hasText: 'Compartilhamento encerrado' }).waitFor();
    assert.equal((await page.evaluate(() => window.reportShares[0][0])).hash, previewHash.hash);
    for (const [mode, message] of [['cancel', 'Compartilhamento cancelado'], ['error', 'Não foi possível abrir o compartilhamento'], ['unsupported', 'compartilhamento de arquivos não está disponível']]) {
      await page.evaluate(mode => { window.reportShareMode = mode; }, mode);
      await share.click(); await dialog.getByText(new RegExp(message)).waitFor();
      assert.equal(await dialog.locator('img').first().getAttribute('src'), pngUrl);
    }
    await page.evaluate(() => { window.reportShareMode = 'pending'; });
    const invocations = await page.evaluate(() => window.reportShareInvocations);
    await share.click();
    await dialog.getByRole('button', { name: 'Compartilhando…' }).evaluate(button => { button.click(); button.click(); });
    assert.equal(await page.evaluate(() => window.reportShareInvocations), invocations + 1);
    await page.evaluate(() => window.finishReportShare());
    await share.waitFor();

    // A remote edit invalidates the existing image without silently replacing it.
    one.observation += '\nAlteração após a geração'; trip.updated_at = new Date().toISOString();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await dialog.getByText(/Esta prévia pode estar desatualizada/).waitFor();
    assert.equal(await share.isDisabled(), true);
    failNextRead = true;
    await dialog.getByRole('button', { name: 'Atualizar relatório', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    failNextRead = false;
    assert.equal(await dialog.locator('img').first().getAttribute('src'), pngUrl, 'a generation failure retains the old image');
    await generate(dialog);
    await close(dialog);
    assert.equal(await page.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } }, pngUrl), true, 'closing releases private blob URLs');

    // Long rows, undefined/zero budgets, stable chronology, filters and multiple server pages.
    const longObservation = Array.from({ length: 140 }, (_, i) => `Linha ${i + 1}: refeição, ação e atenção; preservar todo este conteúdo.`).join('\n');
    one.observation = longObservation;
    one.name = 'Visita com nome completo '.repeat(6);
    one.manual_place_address = 'Endereço completo, São João, com instruções para chegar. '.repeat(8);
    for (let i = 0; i < 34; i++) {
      const row = { ...one, id: randomUUID(), name: `Passeio ${String(i).padStart(2, '0')}`, manual_place_address: 'Praça da Sé, 1 — São Paulo', starts_at: new Date(Date.parse('2026-11-09T03:00:00Z') + i * 60000).toISOString(), observation: i === 33 ? 'Última observação preservada' : null, type: 'Lazer', budget_cents: i % 2 ? null : 0 };
      activities.set(row.id, row);
    }
    trip.updated_at = new Date().toISOString();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: 'Editar Passeio 33', exact: true }).first().waitFor();
    await page.getByLabel('Filtrar por tipo').selectOption('Refeição');
    dialog = await open();
    assert.equal(await dialog.getByLabel('Cronograma completo', { exact: true }).isChecked(), true);
    const untouched = JSON.stringify({ trip, activities: [...activities.values()], expenses: [...expenses.values()], trips: [...trips.values()] });
    filterReads.length = 0;
    await generate(dialog);
    const pageCount = await dialog.locator('img').count();
    assert.ok(pageCount > 2);
    assert.ok(filterReads.some(read => read.offset > 3));
    assert.ok(filterReads.every(read => read.trip === `eq.${trip.id}`));
    await dialog.locator('details summary').click();
    assert.equal(await dialog.locator('tbody tr').count(), 35);
    const reportText = await dialog.locator('table').innerText();
    assert.ok(reportText.includes(longObservation));
    assert.ok(reportText.includes('Última observação preservada'));
    assert.ok(!reportText.includes('Teste conflito resolvido'));
    assert.match(await dialog.innerText(), /35 atividades exportadas/);
    assert.match(await dialog.innerText(), /Total previsto das atividades exportadas: R\$\s150,00/);
    assert.match(await dialog.innerText(), /17 atividades com orçamento “A definir”/);
    const images = await dialog.locator('img').evaluateAll(async images => Promise.all(images.map(async img => {
      const image = new Image(); image.src = img.src; await image.decode(); return [image.naturalWidth, image.naturalHeight];
    })));
    assert.ok(images.every(([w, h]) => w === 2000 && h === 1414));
    const zipped = page.waitForEvent('download');
    await dialog.getByRole('link', { name: 'Baixar todas as páginas (ZIP)' }).click();
    const zip = await zipped; await zip.saveAs(resolve(root, 'artifacts/relatorio-paginas.zip'));
    const zipBytes = await readFile(await zip.path());
    assert.equal(zipBytes.readUInt32LE(0), 0x04034b50);
    assert.equal(zipBytes.readUInt16LE(zipBytes.length - 12), pageCount);
    const lastDownload = page.waitForEvent('download');
    await dialog.getByRole('link', { name: `Baixar PNG · ${pageCount}`, exact: true }).click();
    await (await lastDownload).saveAs(resolve(root, 'artifacts/relatorio-ultima-pagina.png'));
    const firstDownload = page.waitForEvent('download');
    await dialog.getByRole('link', { name: 'Baixar PNG · 2', exact: true }).click();
    await (await firstDownload).saveAs(resolve(root, 'artifacts/relatorio-continuacao.png'));
    await page.evaluate(() => { window.reportShareMode = 'success'; });
    await dialog.getByRole('button', { name: 'Enviar pelo WhatsApp', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Compartilhamento encerrado' }).waitFor();
    assert.equal(await page.evaluate(() => window.reportShares.at(-1).length), pageCount);
    await page.evaluate(() => { window.reportShareMode = 'single'; });
    await dialog.getByRole('button', { name: 'Enviar pelo WhatsApp', exact: true }).click();
    await dialog.getByText(/não compartilha todas as imagens juntas/).waitFor();
    await dialog.getByRole('button', { name: 'Compartilhar página 2', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Compartilhamento encerrado' }).waitFor();
    assert.equal(await page.evaluate(() => window.reportShares.at(-1).length), 1);
    assert.match(await page.evaluate(() => window.reportShares.at(-1)[0].name), /-pagina-02\.png$/);
    await page.screenshot({ path: resolve(root, 'artifacts/relatorio-previa-desktop.png') });
    assert.equal(JSON.stringify({ trip, activities: [...activities.values()], expenses: [...expenses.values()], trips: [...trips.values()] }), untouched);

    await dialog.getByLabel(/Somente atividades dos filtros atuais/).check();
    await generate(dialog);
    assert.equal(await dialog.locator('tbody tr').count(), 1);
    assert.match(await dialog.locator('details').innerText(), /Relatório parcial.*Tipo: Refeição/);
    assert.ok(!(await dialog.locator('table').innerText()).includes('Passeio 33'));
    await close(dialog);
    await page.getByLabel('Filtrar por tipo').selectOption('');

    // Portrait phone viewport: image resolution/orientation are independent of the UI.
    await page.setViewportSize({ width: 390, height: 844 });
    dialog = await open(); await generate(dialog);
    await page.screenshot({ path: resolve(root, 'artifacts/relatorio-previa-mobile.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mobileImage = await dialog.locator('img').first().evaluate(async img => { await img.decode(); return { w: img.naturalWidth, h: img.naturalHeight, display: img.getBoundingClientRect().width }; });
    assert.equal(mobileImage.w, 2000); assert.equal(mobileImage.h, 1414); assert.ok(mobileImage.display < 390);
    await dialog.getByRole('button', { name: 'Ampliar', exact: true }).first().click();
    assert.equal(await dialog.locator('img').first().evaluate(img => img.getBoundingClientRect().width), 2000);
    await close(dialog);

    // Actual service worker/offline shell; an installed mobile PWA is not simulated here.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForFunction(id => Object.keys(localStorage).some(key => {
      if (!key.endsWith(`:${id}`)) return false;
      try { const value = JSON.parse(localStorage.getItem(key)); return value.scheduleComplete && value.activities?.length === 35; } catch { return false; }
    }), trip.id);
    await context.setOffline(true);
    await page.reload(); await page.getByRole('heading', { name: 'Nosso cronograma' }).waitFor();
    dialog = await open(); await generate(dialog);
    await dialog.locator('details summary').click();
    assert.match(await dialog.locator('details').innerText(), /Cópia offline.*Última sincronização/);
    assert.equal(await dialog.getByRole('button', { name: 'Enviar pelo WhatsApp', exact: true }).isDisabled(), true);
    assert.equal(await dialog.locator('tbody tr').count(), 35);
    await close(dialog);
    await page.evaluate(id => {
      const key = Object.keys(localStorage).find(key => key.endsWith(`:${id}`));
      const value = JSON.parse(localStorage.getItem(key)); value.complete = false; value.scheduleComplete = false; value.activities = value.activities.slice(0, 2); localStorage.setItem(key, JSON.stringify(value));
    }, trip.id);
    await page.reload(); await page.getByRole('heading', { name: 'Nosso cronograma' }).waitFor();
    dialog = await open();
    await dialog.getByRole('button', { name: 'Gerar relatório', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'pode estar incompleto' }).waitFor();
    assert.equal(await dialog.locator('img').count(), 0);
    await close(dialog);
  } finally {
    await context.setOffline(false);
    await page.unroute('**/rest/v1/activities?*', intercept);
    for (const row of [...activities.values()]) if (row.trip_id === trip.id) activities.delete(row.id);
    for (const row of backup) activities.set(row.id, row);
    Object.assign(trip, originalTrip);
  }
}
