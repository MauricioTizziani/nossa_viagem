/** Browser integration with an isolated, in-memory Supabase HTTP fixture.
 * No real Supabase project, Photon service, credentials or user records are used.
 * Production app / service worker run at 3100; fixture alone owns port 54321.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = resolve(root, 'node_modules/next/dist/bin/next');
const fixtureOrigin = 'http://127.0.0.1:54321';
const appOrigin = 'http://127.0.0.1:3100';
const photonQueries = [];
const now = () => new Date().toISOString();
const tripId = '60000000-0000-4000-8000-000000000001';
const trip = { id: tripId, name: 'Nossa Viagem', destination: null, start_date: null, end_date: null,
  timezone: 'America/Sao_Paulo', person_one: null, person_two: null, version: 1, created_at: now(), updated_at: now() };
const users = new Map();
const memberships = new Map();
const activities = new Map();
const invitations = [];
let buildProcess;
let appProcess;
let browser;
let appOutput = '';
let cleanupPromise;

function jwt(user) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000), aud: 'authenticated', role: 'authenticated', is_anonymous: true })}.TEST_ONLY_SIGNATURE`;
}
function session(user) {
  return { access_token: jwt(user), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `fixture-refresh-${user.id}`, user };
}
function identity(request) {
  try {
    const payload = JSON.parse(Buffer.from((request.headers.authorization ?? '').replace(/^Bearer /i, '').split('.')[1], 'base64url'));
    return users.get(payload.sub);
  } catch { return undefined; }
}
function respond(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Content-Range': '0-100/*' });
  response.end(JSON.stringify(value));
}
function deny(response, message = 'ACCESS_DENIED', code = '42501', status = 403) {
  respond(response, { message, code, details: null, hint: null }, status);
}
async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}
const fixture = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') { respond(response, {}, 200); return; }
    const url = new URL(request.url, fixtureOrigin);
    if (url.pathname === '/auth/v1/signup' && request.method === 'POST') {
      const user = { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email: '', phone: '',
        app_metadata: { provider: 'anonymous', providers: [] }, user_metadata: {}, identities: [],
        created_at: now(), updated_at: now(), is_anonymous: true };
      users.set(user.id, user);
      respond(response, session(user)); return;
    }
    if (url.pathname === '/auth/v1/token') {
      const input = await body(request);
      const user = users.get(String(input.refresh_token ?? '').replace('fixture-refresh-', ''));
      if (!user) { deny(response); return; }
      respond(response, session(user)); return;
    }
    const user = identity(request);
    if (url.pathname === '/auth/v1/user') { user ? respond(response, user) : deny(response); return; }
    if (!user) { deny(response); return; }
    const membership = memberships.get(user.id);
    const singular = request.headers.accept?.includes('application/vnd.pgrst.object+json');
    if (request.method === 'GET') {
      let records;
      if (url.pathname === '/rest/v1/trip_members') records = membership ? [{ ...membership, user_id: user.id }] : [];
      else if (url.pathname === '/rest/v1/trips') records = membership ? [{ ...trip }] : [];
      else if (url.pathname === '/rest/v1/activities') {
        records = membership ? [...activities.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id)) : [];
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        if (id) records = records.filter((record) => record.id === id);
      }
      if (records) {
        if (singular && records.length !== 1) deny(response, 'Record not found', 'PGRST116', 406);
        else respond(response, singular ? records[0] : records);
        return;
      }
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/rest/v1/rpc/')) { deny(response); return; }
    const input = await body(request);
    const rpc = url.pathname.split('/').at(-1);
    if (rpc === 'redeem_trip_invite') {
      if (!['test-owner', 'test-member'].includes(input.p_token)) { deny(response, 'INVALID_INVITE', '22023', 400); return; }
      memberships.set(user.id, { trip_id: tripId, role: input.p_token === 'test-owner' ? 'owner' : 'member' });
      respond(response, tripId); return;
    }
    if (!membership) { deny(response); return; }
    if (rpc === 'save_activity') {
      if (input.p_trip_id !== tripId) { deny(response); return; }
      const previous = activities.get(input.p_id);
      if ((previous && previous.version !== input.p_expected_version) || (!previous && input.p_expected_version !== 0)) {
        deny(response, 'VERSION_CONFLICT', '40001', 409); return;
      }
      const record = { id: input.p_id, trip_id: tripId, starts_at: input.p_starts_at,
        budget_cents: input.p_budget_cents, name: input.p_name.trim(), type: input.p_type,
        place_id: input.p_place_id, manual_place_name: input.p_manual_place_name,
        manual_place_address: input.p_manual_place_address, manual_place_url: input.p_manual_place_url,
        osm_place_id: input.p_osm_place_id, osm_place_name: input.p_osm_place_name, osm_place_address: input.p_osm_place_address,
        osm_latitude: input.p_osm_latitude, osm_longitude: input.p_osm_longitude,
        version: (previous?.version ?? 0) + 1, created_at: previous?.created_at ?? now(), updated_at: now() };
      activities.set(record.id, record); trip.updated_at = now(); respond(response, record); return;
    }
    if (rpc === 'delete_activity') {
      const record = activities.get(input.p_id);
      if (!record || record.version !== input.p_expected_version) { deny(response, 'VERSION_CONFLICT', '40001', 409); return; }
      activities.delete(input.p_id); trip.updated_at = now(); respond(response, null); return;
    }
    if (rpc === 'update_trip') {
      if (input.p_id !== tripId) { deny(response); return; }
      if (trip.version !== input.p_expected_version) { deny(response, 'VERSION_CONFLICT', '40001', 409); return; }
      Object.assign(trip, { name: input.p_name, destination: input.p_destination?.trim() || null,
        start_date: input.p_start_date, end_date: input.p_end_date, timezone: input.p_timezone,
        person_one: input.p_person_one, person_two: input.p_person_two, version: trip.version + 1, updated_at: now() });
      respond(response, { ...trip }); return;
    }
    if (rpc === 'list_trip_invites' && membership.role === 'owner') { respond(response, invitations); return; }
    if (rpc === 'create_trip_invite' && membership.role === 'owner') {
      const invite = { id: randomUUID(), role: input.p_role ?? 'member', expires_at: new Date(Date.now() + 86400000).toISOString(),
        max_uses: input.p_max_uses ?? 1, use_count: 0, revoked_at: null, created_at: now(), last_used_at: null };
      invitations.push(invite); respond(response, [{ ...invite, invite_id: invite.id, token: 'TEST_ONLY_INVITE' }]); return;
    }
    deny(response);
  } catch { deny(response, 'FIXTURE_ERROR', 'XX000', 500); }
});

function child(args, env) {
  const process = spawn(globalThis.process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  process.stdout.on('data', (data) => { appOutput = (appOutput + data).slice(-12000); });
  process.stderr.on('data', (data) => { appOutput = (appOutput + data).slice(-12000); });
  return process;
}
async function waitServer() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) throw new Error(`O servidor de teste encerrou: ${appOutput}`);
    try { if ((await fetch(appOrigin, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Only this local test server is polled. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('O servidor isolado do aplicativo não ficou disponível.');
}
async function stop(process) {
  if (!process || process.exitCode !== null) return;
  if (globalThis.process.platform === 'win32') {
    // The exact PID comes from a child spawned by this harness. Kill only its
    // tree, including build workers; the user's other Next servers are untouched.
    const killer = spawn('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await Promise.race([once(killer, 'exit').catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } else process.kill();
  await Promise.race([once(process, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
}
function cleanup() {
  if (!cleanupPromise) cleanupPromise = (async () => {
    await browser?.close().catch(() => {});
    await stop(appProcess);
    await stop(buildProcess);
    if (fixture.listening) { fixture.closeAllConnections(); await new Promise((resolve) => fixture.close(resolve)); }
  })();
  return cleanupPromise;
}
process.once('SIGINT', () => { void cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(143)); });
async function visibleText(page, text) {
  await page.getByText(text, { exact: typeof text === 'string' }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15000 });
}
async function button(page, name) { return page.getByRole('button', { name, exact: true }); }
async function navigate(page, label) { await (await button(page, label)).click(); }
async function refresh(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await new Promise((resolve) => setTimeout(resolve, 300));
}
async function newActivity(page, { name, date = '2030-04-10T09:30', budget = '', type = 'Lazer', manual = false, osm = false }) {
  await (await button(page, 'Adicionar atividade')).first().click();
  const dialog = page.getByRole('dialog', { name: 'Um novo momento' });
  await dialog.getByLabel(/Data e hora/).fill(date);
  await dialog.getByLabel(/Orçamento \(R\$\)/).fill(budget);
  await dialog.getByLabel(/Nome da atividade/).fill(name);
  await dialog.getByLabel(/^Tipo/).selectOption(type);
  if (manual) {
    await dialog.getByRole('button', { name: 'Informar manualmente', exact: true }).click();
    await dialog.getByLabel('Nome do local (opcional)').fill('Parque de teste');
    await dialog.getByLabel('Endereço (opcional)').fill('Rua de teste, 10');
    await dialog.getByLabel('Link do mapa (opcional)').fill('https://www.openstreetmap.org/search?query=Parque');
  }
  if (osm) {
    const search = dialog.getByRole('combobox', { name: 'Pesquisar lugar ou endereço' });
    await search.fill('Mu');
    await page.waitForTimeout(900);
    assert.equal(photonQueries.length, 0, 'short queries do not call Photon');
    await search.fill('falha');
    await visibleText(page, /A pesquisa está indisponível/);
    await dialog.getByRole('button', { name: 'Informar manualmente', exact: true }).click();
    await dialog.getByLabel('Nome do local (opcional)').fill('Rascunho manual');
    await dialog.getByRole('button', { name: 'Pesquisar lugar', exact: true }).click();
    await search.fill('vazia');
    await visibleText(page, /Nenhum lugar encontrado/);
    await search.fill('antiga');
    await page.waitForTimeout(950);
    await search.fill('Museu do Amanhã, Rio de Janeiro');
    await dialog.getByRole('option').filter({ hasText: 'Museu do Amanhã' }).first().waitFor({ state: 'visible' });
    await page.waitForTimeout(1700);
    assert.equal(await dialog.getByText('Resultado antigo', { exact: true }).count(), 0, 'canceled stale response must not replace current suggestions');
    assert.equal(await dialog.getByRole('listbox').getByRole('option').count(), 2);
    await search.press('ArrowDown'); await search.press('Enter');
    assert.equal(await dialog.getByRole('listbox').count(), 0);
    const mapUrl = new URL(await dialog.getByRole('link', { name: 'Abrir mapa', exact: true }).getAttribute('href'));
    assert.equal(mapUrl.hostname, 'www.openstreetmap.org');
    assert.equal(mapUrl.searchParams.get('mlat'), '-22.8940683');
    const routeUrl = new URL(await dialog.getByRole('link', { name: 'Traçar rota', exact: true }).getAttribute('href'));
    assert.equal(routeUrl.searchParams.get('route'), ';-22.8940683,-43.1794045');
    await mkdir(resolve(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: resolve(root, 'artifacts/photon-selection.png'), fullPage: true });
    passed('Photon: limite mínimo, falha com alternativa manual, resposta vazia, cancelamento e seleção pelo teclado com destino correto.');
  }
  await dialog.getByRole('button', { name: 'Salvar atividade', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 15000 });
  await visibleText(page, name);
}
async function context(options = {}) {
  const context = await browser.newContext(options);
  // External services are never contacted: Photon replies are local fixtures.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://photon.test') {
      const query = url.searchParams.get('q'); photonQueries.push(query);
      if (query === 'falha') { await route.fulfill({ status: 503, body: '{}' }); return; }
      if (query === 'antiga') await new Promise(resolve => setTimeout(resolve, 2200));
      const name = query === 'antiga' ? 'Resultado antigo' : 'Museu do Amanhã';
      const feature = (id, title) => ({ type: 'Feature', properties: { osm_type: 'W', osm_id: id, name: title, street: 'Praça Mauá', housenumber: '1', city: 'Rio de Janeiro', country: 'Brasil' }, geometry: { type: 'Point', coordinates: [-43.1794045, -22.8940683] } });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: query === 'vazia' ? [] : [feature(372720167, name), feature(372720168, `${name} — outro local`)] }) }).catch(() => {});
    }
    else if ([appOrigin, fixtureOrigin].includes(url.origin)) await route.continue();
    else await route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  return { context, page };
}
let checks = 0;
function passed(message) { checks++; console.log(`✓ ${message}`); }

try {
  // Binding must succeed before the build: if a real local Supabase is already
  // using 54321, this test refuses to run and cannot accidentally contact it.
  fixture.listen(54321, '127.0.0.1');
  await once(fixture, 'listening');
  const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NOSSA_VIAGEM_BUILD_DIR: '.next-test', NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-only-placeholder', NEXT_PUBLIC_PHOTON_URL: 'https://photon.test/api/',
    NEXT_PUBLIC_APP_URL: appOrigin };
  console.log('Preparando build isolado para teste de navegador com dados somente em memória…');
  buildProcess = child([nextBin, 'build'], env);
  const buildTimeout = setTimeout(() => { void stop(buildProcess); }, 180000);
  const [buildCode] = await once(buildProcess, 'exit');
  clearTimeout(buildTimeout);
  if (buildCode !== 0) throw new Error(`A compilação isolada falhou: ${appOutput}`);
  appOutput = '';
  appProcess = child([nextBin, 'start', '--hostname', '127.0.0.1', '--port', '3100'], env);
  await waitServer();
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
  const owner = await context({ viewport: { width: 1366, height: 900 }, timezoneId: 'America/Sao_Paulo' });
  await owner.page.goto(`${appOrigin}/#convite=test-owner`);
  await visibleText(owner.page, 'Só de vocês');
  assert.equal(new URL(owner.page.url()).hash, '');
  assert.equal(activities.size, 0);
  passed('Sessão anônima autoriza o aparelho pelo convite e remove o fragmento.');

  await newActivity(owner.page, { name: 'Teste passeio', budget: '0', manual: true });
  await newActivity(owner.page, { name: 'Teste almoço', date: '2030-04-10T12:30', type: 'Refeição', osm: true });
  assert.equal(activities.size, 2);
  const first = [...activities.values()].find((activity) => activity.name === 'Teste passeio');
  assert.equal(first.budget_cents, 0);
  assert.equal(first.starts_at, '2030-04-10T12:30:00.000Z');
  assert.equal(first.place_id, null);
  assert.equal([...activities.values()].find((activity) => activity.name === 'Teste almoço').budget_cents, null);
  const osmActivity = [...activities.values()].find(activity => activity.name === 'Teste almoço');
  assert.equal(osmActivity.osm_place_id, 'W/372720167');
  assert.equal(osmActivity.manual_place_name, null);
  assert.equal(osmActivity.osm_longitude, -43.1794045);
  await visibleText(owner.page, 'Informado manualmente');
  await visibleText(owner.page, '10/04/2030 09:30');
  passed('Inclusão real no frontend preserva zero, orçamento ausente, instante do fuso e lugar manual.');

  await owner.page.getByLabel('Filtrar por tipo').selectOption('Refeição');
  assert.equal(await owner.page.getByRole('button', { name: 'Editar Teste passeio', exact: true }).count(), 0);
  await visibleText(owner.page, /Subtotal dos filtros:/);
  await (await button(owner.page, 'Limpar filtros')).click();
  await owner.page.getByLabel('Pesquisar atividade ou lugar').fill('parque');
  await visibleText(owner.page, 'Teste passeio');
  assert.equal(await owner.page.getByRole('button', { name: 'Editar Teste almoço', exact: true }).count(), 0);
  await (await button(owner.page, 'Limpar filtros')).click();
  passed('Filtros de categoria e texto do lugar exibem somente os registros correspondentes.');

  await (await button(owner.page, 'Editar Teste passeio')).click();
  let edit = owner.page.getByRole('dialog', { name: 'Editar atividade' });
  await edit.getByLabel(/Nome da atividade/).fill('Teste passeio revisado');
  await edit.getByLabel(/Orçamento \(R\$\)/).fill('15,05');
  await edit.getByLabel(/Data e hora/).fill('2030-04-10T10:30');
  await edit.getByRole('button', { name: 'Salvar atividade', exact: true }).click();
  await edit.waitFor({ state: 'hidden' });
  assert.equal(activities.get(first.id).version, 2);
  assert.equal(activities.get(first.id).budget_cents, 1505);
  await (await button(owner.page, 'Duplicar Teste passeio revisado')).click();
  const duplicate = owner.page.getByRole('dialog', { name: 'Mais um momento parecido' });
  assert.equal(activities.size, 2);
  assert.equal(await duplicate.getByLabel(/Nome da atividade/).inputValue(), 'Teste passeio revisado');
  await duplicate.getByLabel(/Nome da atividade/).fill('Teste passeio duplicado');
  await duplicate.getByLabel(/Data e hora/).fill('2030-04-11T10:30');
  await duplicate.getByRole('button', { name: 'Salvar atividade', exact: true }).click();
  await duplicate.waitFor({ state: 'hidden' });
  assert.equal(activities.size, 3);
  await owner.page.getByLabel('Filtrar por dia').selectOption('2030-04-11');
  await visibleText(owner.page, 'Teste passeio duplicado');
  assert.equal(await owner.page.getByRole('button', { name: 'Editar Teste passeio revisado', exact: true }).count(), 0);
  await (await button(owner.page, 'Limpar filtros')).click();
  await (await button(owner.page, 'Linha do tempo')).click();
  await visibleText(owner.page, 'Teste passeio revisado');
  await (await button(owner.page, 'Tabela')).click();
  passed('Edição atualiza centavos/horário; duplicação exige revisão; filtro por dia e modos de visualização funcionam.');

  const member = await context({ viewport: { width: 360, height: 800 }, timezoneId: 'Asia/Tokyo', isMobile: true });
  await member.page.goto(`${appOrigin}/#convite=test-member`);
  await member.page.getByRole('button', { name: 'Editar Teste passeio revisado', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await visibleText(member.page, '10/04/2030 10:30');
  assert.equal(await member.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await (await button(owner.page, 'Editar Teste passeio revisado')).click();
  edit = owner.page.getByRole('dialog', { name: 'Editar atividade' });
  await edit.getByLabel(/Nome da atividade/).fill('Tentativa antiga');
  await (await button(member.page, 'Editar Teste passeio revisado')).click();
  let mobileEdit = member.page.getByRole('dialog', { name: 'Editar atividade' });
  await mobileEdit.getByLabel(/Nome da atividade/).fill('Teste compartilhado');
  await mobileEdit.getByLabel(/Orçamento \(R\$\)/).fill('17,25');
  await mobileEdit.getByRole('button', { name: 'Salvar atividade', exact: true }).click();
  await mobileEdit.waitFor({ state: 'hidden' });
  await refresh(owner.page);
  await edit.getByRole('button', { name: 'Salvar atividade', exact: true }).click();
  await visibleText(owner.page, /Esta informação mudou em outro aparelho/);
  assert.equal(activities.get(first.id).name, 'Teste compartilhado');
  await edit.getByRole('button', { name: 'Carregar versão atual', exact: true }).click();
  edit = owner.page.getByRole('dialog', { name: 'Editar atividade' });
  await owner.page.waitForFunction(() => document.querySelector('[role="dialog"] input[maxlength="160"]')?.value === 'Teste compartilhado');
  await edit.getByLabel(/Nome da atividade/).fill('Teste conflito resolvido');
  await edit.getByRole('button', { name: 'Salvar atividade', exact: true }).click();
  await edit.waitFor({ state: 'hidden' });
  await refresh(member.page);
  await visibleText(member.page, 'Teste conflito resolvido');
  await visibleText(member.page, 'Museu do Amanhã');
  await visibleText(member.page, 'Praça Mauá, 1 · Rio de Janeiro · Brasil');
  passed('Dois contextos consultam a mesma fixture; layout 360 px, fuso distinto e conflito/revisão funcionam (sem validar Realtime remoto).');

  await (await button(owner.page, 'Excluir Teste passeio duplicado')).click();
  const deletion = owner.page.getByRole('dialog', { name: 'Excluir este momento?' });
  assert.equal(activities.size, 3);
  await deletion.getByRole('button', { name: 'Excluir atividade', exact: true }).click();
  await deletion.waitFor({ state: 'hidden' });
  assert.equal(activities.size, 2);
  assert.ok(![...activities.values()].some((activity) => activity.name === 'Teste passeio duplicado'));
  await navigate(owner.page, 'Nossa viagem');
  await owner.page.getByLabel(/Nome da viagem/).fill('Viagem de teste');
  assert.equal(await owner.page.getByLabel('Destino', { exact: true }).inputValue(), '');
  await (await button(owner.page, 'Salvar nossa viagem')).click();
  await visibleText(owner.page, 'Sua viagem foi atualizada.');
  assert.equal(trip.destination, null);
  assert.equal(trip.name, 'Viagem de teste');
  await navigate(owner.page, 'Cronograma');
  await refresh(member.page);
  await visibleText(member.page, 'Viagem de teste');
  passed('Exclusão pede confirmação e configurações salvam destino NULL recebido do banco.');

  await (await button(member.page, 'Editar Teste conflito resolvido')).click();
  mobileEdit = member.page.getByRole('dialog', { name: 'Editar atividade' });
  await mobileEdit.getByLabel(/Orçamento \(R\$\)/).fill('19,00');
  await member.context.setOffline(true);
  await visibleText(member.page, 'Você está offline');
  assert.equal(await mobileEdit.getByLabel(/Orçamento \(R\$\)/).inputValue(), '19,00');
  assert.equal(await mobileEdit.getByRole('button', { name: 'Salvar atividade', exact: true }).isDisabled(), true);
  assert.equal(activities.get(first.id).budget_cents, 1725);
  await mobileEdit.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await mobileEdit.waitFor({ state: 'hidden' });
  await member.context.setOffline(false);
  await refresh(member.page);
  await member.page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20000 });
  await member.page.evaluate(() => {
    // Exercise expired-session offline reopening without contacting Auth. This
    // changes only a synthetic session in this browser's isolated test storage.
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
      const value = JSON.parse(localStorage.getItem(key));
      if (!value?.access_token) continue;
      const [header, payload, signature] = value.access_token.split('.');
      const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      decoded.exp = Math.floor(Date.now() / 1000) - 120;
      value.expires_at = decoded.exp;
      value.access_token = `${header}.${btoa(JSON.stringify(decoded)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.${signature}`;
      localStorage.setItem(key, JSON.stringify(value));
    }
  });
  await member.context.setOffline(true);
  await member.page.reload({ waitUntil: 'domcontentloaded' });
  await visibleText(member.page, 'Você está offline');
  await visibleText(member.page, 'Teste conflito resolvido');
  await visibleText(member.page, 'Museu do Amanhã');
  await visibleText(member.page, 'Praça Mauá, 1 · Rio de Janeiro · Brasil');
  await visibleText(member.page, /Última sincronização:/);
  await visibleText(member.page, 'Mapas disponíveis com conexão');
  passed('Queda de conexão preserva formulário sem gravação; SW recarrega cronograma autorizado com sessão sintética expirada.');

  const visitor = await context({ viewport: { width: 1280, height: 800 } });
  await visitor.page.goto(appOrigin);
  await visibleText(visitor.page, 'Este aparelho precisa de um convite.');
  assert.equal(await visitor.page.getByRole('button', { name: 'Editar Teste conflito resolvido', exact: true }).count(), 0);
  assert.equal(activities.size, 2);
  passed('Um terceiro contexto sem convite recebe cronograma vazio e orientação de acesso privado.');
  console.log(`Teste de navegador concluído: ${checks} grupos aprovados. Auth/Realtime/Photon reais não foram usados.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha no teste de navegador.');
  process.exitCode = 1;
} finally {
  await cleanup();
}
