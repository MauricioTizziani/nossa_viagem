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
const collectionId = '70000000-0000-4000-8000-000000000001';
const ownerToken = 'a'.repeat(64);
const memberToken = 'b'.repeat(64);
const trip = { id: tripId, name: 'Nossa Viagem', destination: null, start_date: null, end_date: null,
  timezone: 'America/Sao_Paulo', person_one: null, person_two: null, initial_budget_cents: null, collection_id: collectionId,
  archived_at: null, version: 1, created_at: now(), updated_at: now() };
const trips = new Map([[tripId, trip]]);
const collections = new Map([[collectionId, { id: collectionId, created_at: now() }]]);
const users = new Map();
const memberships = new Map();
const collectionMemberships = new Map();
const activities = new Map();
const expenses = new Map();
const invitations = [
  { id: randomUUID(), scope: 'collection', target: collectionId, token: ownerToken, role: 'owner', max_uses: 1, use_count: 0, expires_at: new Date(Date.now()+86400000).toISOString(), revoked_at: null, created_at: now(), last_used_at: null, users: new Set() },
  { id: randomUUID(), scope: 'trip', target: tripId, token: memberToken, role: 'member', max_uses: 1, use_count: 0, expires_at: new Date(Date.now()+86400000).toISOString(), revoked_at: null, created_at: now(), last_used_at: null, users: new Set() },
];
const rpcCalls = [];
const delayedReads = new Map();
const delayedRpcs = new Map();
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
function memberKey(userId, target) { return `${userId}:${target}`; }
function collectionRole(userId, id) { return collectionMemberships.get(memberKey(userId, id))?.role ?? null; }
function tripRole(userId, id) {
  const direct = memberships.get(memberKey(userId,id))?.role;
  const shared = collectionRole(userId,trips.get(id)?.collection_id);
  return direct === 'owner' || shared === 'owner' ? 'owner' : direct || shared ? 'member' : null;
}
function tripPhase(value) {
  if (!value.start_date || !value.end_date) return 'undated';
  const date = new Intl.DateTimeFormat('en-CA',{ timeZone:value.timezone,year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  return date < value.start_date ? 'upcoming' : date > value.end_date ? 'past' : 'ongoing';
}
function safeInvite(invite) {
  const { id,role,expires_at,max_uses,use_count,revoked_at,created_at,last_used_at } = invite;
  return { id,role,expires_at,max_uses,use_count,revoked_at,created_at,last_used_at };
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
    const singular = request.headers.accept?.includes('application/vnd.pgrst.object+json');
    if (request.method === 'GET') {
      let records;
      if (url.pathname === '/rest/v1/trip_members') records = [...memberships.values()].filter(item=>item.user_id===user.id);
      else if (url.pathname === '/rest/v1/collection_members') records = [...collectionMemberships.values()].filter(item=>item.user_id===user.id);
      else if (url.pathname === '/rest/v1/trips') records = [...trips.values()].filter(value=>tripRole(user.id,value.id)).map(value=>({ ...value }));
      else if (url.pathname === '/rest/v1/activities') {
        records = [...activities.values()].filter(value=>tripRole(user.id,value.trip_id)).sort((a,b)=>a.id.localeCompare(b.id));
      }
      else if (url.pathname === '/rest/v1/trip_expenses') {
        records = [...expenses.values()].filter(value=>tripRole(user.id,value.trip_id)).sort((a,b)=>a.id.localeCompare(b.id));
      }
      if (records) {
        for(const key of ['id','trip_id','user_id']) {
          const expected = url.searchParams.get(key)?.replace(/^eq\./,'');
          if(expected) records=records.filter(item=>item[key]===expected);
        }
        const tripFilter = url.searchParams.get('trip_id')?.replace(/^eq\./,'');
        if (tripFilter && delayedReads.has(tripFilter)) await new Promise(resolve=>setTimeout(resolve,delayedReads.get(tripFilter)));
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? records.length);
        records = records.slice(offset,offset+limit);
        if (singular && records.length !== 1) deny(response, 'Record not found', 'PGRST116', 406);
        else respond(response, singular ? records[0] : records);
        return;
      }
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/rest/v1/rpc/')) { deny(response); return; }
    const input = await body(request);
    const rpc = url.pathname.split('/').at(-1);
    rpcCalls.push(rpc);
    if(delayedRpcs.has(rpc)) await new Promise(resolve=>setTimeout(resolve,delayedRpcs.get(rpc)));
    if (rpc === 'open_shared_trip') { deny(response,'PRIVATE_ACCESS_REQUIRED'); return; }
    if (rpc === 'redeem_trip_invite' || rpc === 'redeem_collection_invite') {
      const scope=rpc==='redeem_trip_invite'?'trip':'collection';
      const invite=invitations.find(item=>item.token===input.p_token && item.scope===scope);
      if(!invite || invite.revoked_at || Date.parse(invite.expires_at)<=Date.now() || (!invite.users.has(user.id) && invite.use_count>=invite.max_uses)) { deny(response,'INVALID_INVITE','22023',400); return; }
      const store=scope==='trip'?memberships:collectionMemberships;
      const key=memberKey(user.id,invite.target);
      const prior=store.get(key);
      store.set(key,{ user_id:user.id,[scope==='trip'?'trip_id':'collection_id']:invite.target,role:prior?.role==='owner'?'owner':invite.role });
      if(!invite.users.has(user.id)) { invite.users.add(user.id); invite.use_count++; invite.last_used_at=now(); }
      respond(response,invite.target); return;
    }
    if(rpc==='list_authorized_collections') {
      respond(response,[...collectionMemberships.values()].filter(item=>item.user_id===user.id).map(item=>({ ...collections.get(item.collection_id),role:item.role }))); return;
    }
    if(rpc==='list_authorized_trips') {
      const search=String(input.p_search??'').trim().toLocaleLowerCase();
      const filter=input.p_filter??'all';
      const records=[...trips.values()].filter(value=>tripRole(user.id,value.id))
        .filter(value=>filter==='archived'?value.archived_at:!value.archived_at && (filter==='all'||tripPhase(value)===filter))
        .filter(value=>!search||`${value.name} ${value.destination??''}`.toLocaleLowerCase().includes(search))
        .sort((a,b)=>a.id.localeCompare(b.id)).map(value=>({ ...value,
          total_spent_cents:[...expenses.values()].filter(item=>item.trip_id===value.id).reduce((sum,item)=>sum+item.amount_cents,0),
          trip_role:tripRole(user.id,value.id),collection_role:collectionRole(user.id,value.collection_id) }));
      respond(response,records.slice(input.p_offset??0,(input.p_offset??0)+(input.p_limit??50))); return;
    }
    if(rpc==='create_private_trip') {
      if(input.p_initial_budget_cents==null||!Number.isInteger(input.p_initial_budget_cents)||input.p_initial_budget_cents<0) { deny(response,'INVALID_INITIAL_BUDGET','22023',400); return; }
      if(!input.p_name?.trim()||(input.p_start_date&&input.p_end_date&&input.p_end_date<input.p_start_date)) { deny(response,'new row violates check constraint','23514',400); return; }
      const existing=trips.get(input.p_id);
      if(existing) { if(tripRole(user.id,existing.id)!=='owner') deny(response); else respond(response,existing); return; }
      let target=input.p_collection_id;
      if(target&&!collectionRole(user.id,target)) { deny(response); return; }
      if(!target) { target=randomUUID(); collections.set(target,{ id:target,created_at:now() }); collectionMemberships.set(memberKey(user.id,target),{ user_id:user.id,collection_id:target,role:'owner' }); }
      const created={ id:input.p_id,collection_id:target,name:input.p_name.trim(),destination:input.p_destination?.trim()||null,
        start_date:input.p_start_date,end_date:input.p_end_date,timezone:input.p_timezone,person_one:input.p_person_one,person_two:input.p_person_two,
        initial_budget_cents:input.p_initial_budget_cents,archived_at:null,version:1,created_at:now(),updated_at:now() };
      trips.set(created.id,created); memberships.set(memberKey(user.id,created.id),{ user_id:user.id,trip_id:created.id,role:'owner' });
      respond(response,created); return;
    }
    if(rpc==='set_trip_archived') {
      const target=trips.get(input.p_id);
      if(!target||!tripRole(user.id,target.id)) { deny(response); return; }
      if(target.version!==input.p_expected_version) { deny(response,'VERSION_CONFLICT','40001',409); return; }
      target.archived_at=input.p_archived?target.archived_at??now():null; target.version++; target.updated_at=now(); respond(response,{...target}); return;
    }
    if (rpc === 'save_activity') {
      if (!tripRole(user.id,input.p_trip_id)) { deny(response); return; }
      const previous = activities.get(input.p_id);
      if ((previous && (previous.trip_id!==input.p_trip_id || previous.version !== input.p_expected_version)) || (!previous && input.p_expected_version !== 0)) {
        deny(response, 'VERSION_CONFLICT', '40001', 409); return;
      }
      const record = { id: input.p_id, trip_id: input.p_trip_id, starts_at: input.p_starts_at,
        budget_cents: input.p_budget_cents, name: input.p_name.trim(), type: input.p_type,
        place_id: input.p_place_id, manual_place_name: input.p_manual_place_name,
        manual_place_address: input.p_manual_place_address, manual_place_url: input.p_manual_place_url,
        osm_place_id: input.p_osm_place_id, osm_place_name: input.p_osm_place_name, osm_place_address: input.p_osm_place_address,
        osm_latitude: input.p_osm_latitude, osm_longitude: input.p_osm_longitude,
        version: (previous?.version ?? 0) + 1, created_at: previous?.created_at ?? now(), updated_at: now() };
      activities.set(record.id, record); trips.get(record.trip_id).updated_at = now(); respond(response, record); return;
    }
    if (rpc === 'delete_activity') {
      const record = activities.get(input.p_id);
      if(!record||!tripRole(user.id,record.trip_id)) { deny(response); return; }
      if (!record || record.version !== input.p_expected_version) { deny(response, 'VERSION_CONFLICT', '40001', 409); return; }
      activities.delete(input.p_id);
      // Mirrors the database foreign key: linked expenses are preserved and only unlinked.
      for (const expense of expenses.values()) if (expense.activity_id === input.p_id) expense.activity_id = null;
      trips.get(record.trip_id).updated_at = now(); respond(response, null); return;
    }
    if (rpc === 'save_expense') {
      if (!tripRole(user.id,input.p_trip_id)) { deny(response); return; }
      const previous = expenses.get(input.p_id);
      if ((previous && (previous.trip_id!==input.p_trip_id || previous.version !== input.p_expected_version)) || (!previous && input.p_expected_version !== 0)) {
        deny(response, 'VERSION_CONFLICT', '40001', 409); return;
      }
      if (input.p_activity_id && activities.get(input.p_activity_id)?.trip_id !== input.p_trip_id) { deny(response, 'EXPENSE_ACTIVITY_MISMATCH', '23503', 409); return; }
      if (!(Number.isInteger(input.p_amount_cents) && input.p_amount_cents > 0) || !input.p_description?.trim()) { deny(response, 'new row violates check constraint', '23514', 400); return; }
      const record = { id: input.p_id, trip_id: input.p_trip_id, description: input.p_description.trim(), category: input.p_category,
        amount_cents: input.p_amount_cents, expense_date: input.p_expense_date, activity_id: input.p_activity_id ?? null,
        notes: input.p_notes?.trim() || null, version: (previous?.version ?? 0) + 1, created_at: previous?.created_at ?? now(), updated_at: now() };
      expenses.set(record.id, record); trips.get(record.trip_id).updated_at = now(); respond(response, record); return;
    }
    if (rpc === 'delete_expense') {
      const record = expenses.get(input.p_id);
      if(!record||!tripRole(user.id,record.trip_id)) { deny(response); return; }
      if (!record || record.version !== input.p_expected_version) { deny(response, 'VERSION_CONFLICT', '40001', 409); return; }
      expenses.delete(input.p_id); trips.get(record.trip_id).updated_at = now(); respond(response, null); return;
    }
    if (rpc === 'update_trip') {
      const target=trips.get(input.p_id);
      if (!target||!tripRole(user.id,input.p_id)) { deny(response); return; }
      if (target.version !== input.p_expected_version) { deny(response, 'VERSION_CONFLICT', '40001', 409); return; }
      const next = { name: input.p_name, destination: input.p_destination?.trim() || null,
        start_date: input.p_start_date, end_date: input.p_end_date, timezone: input.p_timezone,
        person_one: input.p_person_one, person_two: input.p_person_two, version: target.version + 1, updated_at: now() };
      if (input.p_touch_budget) {
        if (input.p_initial_budget_cents != null && !(Number.isInteger(input.p_initial_budget_cents) && input.p_initial_budget_cents >= 0)) { deny(response, 'INVALID_INITIAL_BUDGET', '22023', 400); return; }
        next.initial_budget_cents = input.p_initial_budget_cents ?? null;
      }
      Object.assign(target, next);
      respond(response, { ...target }); return;
    }
    if (['list_trip_invites','list_collection_invites','create_trip_invite','create_collection_invite','revoke_trip_invite','revoke_collection_invite'].includes(rpc)) {
      const scope=rpc.includes('collection')?'collection':'trip';
      const existing=invitations.find(item=>item.id===input.p_invite_id&&item.scope===scope);
      const target=existing?.target??(scope==='trip'?input.p_trip_id:input.p_collection_id);
      const role=scope==='trip'?tripRole(user.id,target):collectionRole(user.id,target);
      if(role!=='owner') { deny(response); return; }
      if(rpc.startsWith('list_')) { respond(response,invitations.filter(item=>item.scope===scope&&item.target===target).map(safeInvite)); return; }
      if(rpc.startsWith('revoke_')) { if(!existing) deny(response); else { existing.revoked_at=now(); respond(response,null); } return; }
      const invite = { id: randomUUID(), role: input.p_role ?? 'member', expires_at: new Date(Date.now() + 86400000).toISOString(),
        max_uses: input.p_max_uses ?? 1, use_count: 0, revoked_at: null, created_at: now(), last_used_at: null,
        scope,target,token:randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),users:new Set() };
      invitations.push(invite); respond(response, [{ ...safeInvite(invite), invite_id: invite.id, token: invite.token }]); return;
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
async function expectTotal(page, testId, amount) {
  await page.getByTestId(testId).filter({ hasText: new RegExp(`R\\$\\s${amount.replace('.', '\\.')}`) }).waitFor({ state: 'visible', timeout: 15000 });
}
// Example amounts exist only in this in-memory fixture; no real trip receives them.
async function newExpense(page, { description, amount, category, date, notes = '', expectVisible = true }) {
  await (await button(page, 'Adicionar gasto')).first().click();
  const dialog = page.getByRole('dialog', { name: 'Um novo gasto' });
  await dialog.getByLabel(/^Descrição/).fill(description);
  await dialog.getByLabel(/^Categoria/).selectOption(category);
  await dialog.getByLabel(/^Valor \(R\$\)/).fill(amount);
  await dialog.getByLabel(/^Data do gasto/).fill(date);
  if (notes) await dialog.getByLabel(/^Observações/).fill(notes);
  await dialog.getByRole('button', { name: 'Salvar gasto', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 15000 });
  if (expectVisible) await visibleText(page, description);
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
  await owner.page.goto(`${appOrigin}/#colecao=${ownerToken}`);
  await visibleText(owner.page, 'Minhas viagens');
  await owner.page.locator('.trip-card').filter({ hasText: 'Nossa Viagem' }).getByRole('button', { name: 'Abrir viagem', exact: true }).click();
  await visibleText(owner.page, 'Viagem privada');
  await owner.page.getByRole('button', { name: 'Compartilhar viagem', exact: true }).waitFor({ state: 'visible' });
  await owner.page.waitForFunction(() => !document.querySelector('.header-actions button')?.disabled);
  assert.equal(new URL(owner.page.url()).hash, '');
  assert.equal(activities.size, 0);
  assert.equal(collectionMemberships.size, 1);
  assert.equal(memberships.size, 0);
  assert.equal(rpcCalls.includes('redeem_collection_invite'), true);
  assert.equal(rpcCalls.includes('open_shared_trip'), false);
  passed('O convite explícito da coleção abre Minhas viagens e preserva a viagem existente sem conceder acesso público.');
  await owner.page.getByRole('button', { name: 'Compartilhar viagem', exact: true }).click();
  const sharing = owner.page.getByRole('dialog', { name: 'Nossos planos em outro aparelho' });
  await sharing.getByRole('button', { name: 'Gerar convite privado', exact: true }).click();
  await sharing.getByLabel('Convite desta viagem').waitFor();
  const tripInviteUrl = await sharing.getByLabel('Convite desta viagem').inputValue();
  assert.match(tripInviteUrl,/\/#convite=[0-9a-f]{64}$/);
  assert.equal((await owner.page.evaluate(()=>JSON.stringify(localStorage))).includes(new URL(tripInviteUrl).hash.slice('#convite='.length)),false,'invitation tokens are never cached');
  await sharing.getByRole('button', { name: 'Fechar formulário' }).click();
  passed('Compartilhar gera convite restrito à viagem, com escopos visíveis e sem guardar o token no cache.');

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
  await member.page.goto(`${appOrigin}/#convite=${memberToken}`);
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
  await navigate(owner.page, 'Detalhes');
  await owner.page.getByLabel(/Nome da viagem/).fill('Viagem de teste');
  assert.equal(await owner.page.getByLabel('Destino', { exact: true }).inputValue(), '');
  assert.equal(await owner.page.getByLabel(/Orçamento inicial da viagem/).inputValue(), '', 'an unset budget is empty, not zero');
  await owner.page.getByLabel(/Orçamento inicial da viagem/).fill('2.000,00');
  await (await button(owner.page, 'Salvar nossa viagem')).click();
  await visibleText(owner.page, 'Sua viagem foi atualizada.');
  assert.equal(trip.destination, null);
  assert.equal(trip.name, 'Viagem de teste');
  assert.equal(trip.initial_budget_cents, 200000);
  assert.equal(expenses.size, 0, 'the initial budget never creates an expense');
  assert.equal(activities.get(first.id).budget_cents, 1725, 'the initial budget never fills activity budgets');
  await navigate(owner.page, 'Cronograma');
  await refresh(member.page);
  await visibleText(member.page, 'Viagem de teste');
  passed('Exclusão pede confirmação e configurações salvam destino NULL recebido do banco.');

  await navigate(owner.page, 'Gastos');
  await visibleText(owner.page, 'Ainda não registramos nenhum gasto.');
  await expectTotal(owner.page, 'expenses-total', '0,00');
  await newExpense(owner.page, { description: 'Teste gasolina', amount: '200,00', category: 'Combustível', date: '2030-04-09' });
  await newExpense(owner.page, { description: 'Teste Airbnb', amount: '600', category: 'Hospedagem', date: '2030-03-01', notes: 'Pago antecipadamente' });
  await newExpense(owner.page, { description: 'Teste almoço de domingo', amount: '80,00', category: 'Alimentação', date: '2030-04-10' });
  assert.equal(expenses.size, 3);
  assert.equal(activities.size, 2, 'registering expenses never creates schedule activities');
  const fuel = [...expenses.values()].find((expense) => expense.description === 'Teste gasolina');
  const lunch = [...expenses.values()].find((expense) => expense.description === 'Teste almoço de domingo');
  assert.equal(fuel.amount_cents, 20000);
  assert.equal(fuel.expense_date, '2030-04-09', 'the calendar date is stored exactly as chosen');
  assert.equal([...expenses.values()].find((expense) => expense.description === 'Teste Airbnb').amount_cents, 60000);
  assert.equal(lunch.activity_id, null);
  await expectTotal(owner.page, 'expenses-total', '880,00');
  assert.deepEqual(await owner.page.locator('table tbody tr td:first-child').allTextContents(), ['10/04/2030', '09/04/2030', '01/03/2030'], 'most recent expense first, prepaid lodging included');
  await (await button(owner.page, 'Ver detalhes de Teste Airbnb')).click();
  await visibleText(owner.page, 'Pago antecipadamente');
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await owner.page.screenshot({ path: resolve(root, 'artifacts/gastos-desktop.png'), fullPage: true });
  passed('Gastos: combustível, hospedagem antecipada e almoço somam R$ 880,00 sem criar atividades, em ordem decrescente de data.');

  await navigate(owner.page, 'Cronograma');
  await newActivity(owner.page, { name: 'Teste piquenique', date: '2030-04-10T13:00', type: 'Refeição' });
  assert.equal(activities.size, 3);
  const picnic = [...activities.values()].find((activity) => activity.name === 'Teste piquenique');
  assert.equal(picnic.budget_cents, null);
  await navigate(owner.page, 'Gastos');
  await (await button(owner.page, 'Editar Teste almoço de domingo')).click();
  let expenseEdit = owner.page.getByRole('dialog', { name: 'Editar gasto' });
  await expenseEdit.getByLabel('Pesquisar atividade do cronograma').fill('piquenique');
  assert.equal(await expenseEdit.getByLabel('Atividade relacionada', { exact: true }).locator('option').count(), 2, 'search narrows the activity list');
  await expenseEdit.getByLabel('Atividade relacionada', { exact: true }).selectOption(picnic.id);
  await expenseEdit.getByRole('button', { name: 'Salvar gasto', exact: true }).click();
  await expenseEdit.waitFor({ state: 'hidden' });
  assert.equal(expenses.get(lunch.id).activity_id, picnic.id);
  assert.equal(expenses.get(lunch.id).version, 2);
  assert.equal(activities.get(picnic.id).budget_cents, null, 'linking never changes the activity budget');
  assert.equal(expenses.size, 3, 'linking never creates another expense');
  await expectTotal(owner.page, 'expenses-total', '880,00');
  await visibleText(owner.page, 'Teste piquenique');
  await navigate(owner.page, 'Cronograma');
  await visibleText(owner.page, /1 gasto vinculado: R\$\s80,00 · orçamento a definir/);
  await visibleText(owner.page, 'Nenhum gasto registrado');
  passed('Vincular o almoço mantém R$ 880,00, preserva o orçamento da atividade e aparece como detalhe no cronograma.');

  await navigate(owner.page, 'Gastos');
  await owner.page.getByLabel('Filtrar por categoria').selectOption('Alimentação');
  await expectTotal(owner.page, 'expenses-subtotal', '80,00');
  await visibleText(owner.page, '1 de 3 registros correspondem aos filtros');
  await visibleText(owner.page, 'Considerando apenas os resultados filtrados');
  assert.equal(await owner.page.getByRole('button', { name: 'Editar Teste gasolina', exact: true }).count(), 0);
  await expectTotal(owner.page, 'expenses-total', '880,00');
  await newExpense(owner.page, { description: 'Teste pedágio', amount: '12,30', category: 'Transporte', date: '2030-04-09', expectVisible: false });
  await visibleText(owner.page, /foi salvo, mas não aparece na lista porque está fora dos filtros atuais/);
  await expectTotal(owner.page, 'expenses-total', '892,30');
  await (await button(owner.page, 'Limpar filtros')).first().click();
  await visibleText(owner.page, 'Teste pedágio');
  await owner.page.getByLabel('Pesquisar gasto por descrição').fill('airbnb');
  await owner.page.getByLabel('Data inicial').fill('2030-01-01');
  await owner.page.getByLabel('Data final').fill('2030-03-01');
  await expectTotal(owner.page, 'expenses-subtotal', '600,00');
  await owner.page.getByLabel('Data final').fill('2030-02-28');
  await visibleText(owner.page, 'Nenhum gasto encontrado');
  await owner.page.getByLabel('Data final').fill('2029-12-31');
  await visibleText(owner.page, 'A data final do filtro não pode ser anterior à data inicial.');
  await (await button(owner.page, 'Limpar filtros')).first().click();
  assert.equal(await owner.page.getByTestId('expenses-subtotal').count(), 0);
  passed('Filtros combinados: subtotal e contagem, aviso de gasto salvo fora dos filtros, período inclusivo e validação.');

  await (await button(owner.page, 'Editar Teste pedágio')).click();
  expenseEdit = owner.page.getByRole('dialog', { name: 'Editar gasto' });
  await expenseEdit.getByLabel(/^Valor \(R\$\)/).fill('10,00');
  await expenseEdit.getByRole('button', { name: 'Salvar gasto', exact: true }).click();
  await expenseEdit.waitFor({ state: 'hidden' });
  await expectTotal(owner.page, 'expenses-total', '890,00');
  await (await button(owner.page, 'Excluir Teste pedágio')).click();
  const expenseDeletion = owner.page.getByRole('dialog', { name: 'Excluir este gasto?' });
  await expenseDeletion.getByRole('button', { name: 'Excluir gasto', exact: true }).click();
  await expenseDeletion.waitFor({ state: 'hidden' });
  assert.equal(expenses.size, 3);
  await expectTotal(owner.page, 'expenses-total', '880,00');
  const savesBefore = rpcCalls.filter((call) => call === 'save_expense').length;
  await (await button(owner.page, 'Adicionar gasto')).first().click();
  const doubleDialog = owner.page.getByRole('dialog', { name: 'Um novo gasto' });
  await doubleDialog.getByLabel(/^Descrição/).fill('Teste estacionamento');
  await doubleDialog.getByLabel(/^Categoria/).selectOption('Transporte');
  await doubleDialog.getByLabel(/^Valor \(R\$\)/).fill('15');
  await doubleDialog.getByLabel(/^Data do gasto/).fill('2030-04-10');
  await doubleDialog.getByRole('button', { name: 'Salvar gasto', exact: true }).dblclick();
  await doubleDialog.waitFor({ state: 'hidden' });
  assert.equal(rpcCalls.filter((call) => call === 'save_expense').length, savesBefore + 1, 'repeated clicks produce a single save');
  assert.equal(expenses.size, 4);
  await expectTotal(owner.page, 'expenses-total', '895,00');
  passed('Editar e excluir atualizam os indicadores; cliques repetidos em Salvar geram uma única gravação.');

  await refresh(member.page);
  await navigate(member.page, 'Gastos');
  await member.page.getByRole('button', { name: 'Editar Teste gasolina', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await member.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal scrolling at 360px');
  assert.equal(await member.page.locator('table').first().isVisible(), false, 'the phone shows cards instead of a squeezed table');
  await expectTotal(member.page, 'expenses-total', '895,00');
  await member.page.screenshot({ path: resolve(root, 'artifacts/gastos-mobile.png'), fullPage: true });
  await (await button(owner.page, 'Editar Teste gasolina')).click();
  expenseEdit = owner.page.getByRole('dialog', { name: 'Editar gasto' });
  await expenseEdit.getByLabel(/^Valor \(R\$\)/).fill('205,00');
  await (await button(member.page, 'Editar Teste gasolina')).click();
  const mobileExpenseEdit = member.page.getByRole('dialog', { name: 'Editar gasto' });
  await mobileExpenseEdit.getByLabel(/^Valor \(R\$\)/).fill('210,00');
  await mobileExpenseEdit.getByRole('button', { name: 'Salvar gasto', exact: true }).click();
  await mobileExpenseEdit.waitFor({ state: 'hidden' });
  await refresh(owner.page);
  await expenseEdit.getByRole('button', { name: 'Salvar gasto', exact: true }).click();
  await visibleText(owner.page, /Esta informação mudou em outro aparelho/);
  assert.equal(expenses.get(fuel.id).amount_cents, 21000, 'the concurrent edit is never overwritten');
  await expenseEdit.getByRole('button', { name: 'Carregar versão atual', exact: true }).click();
  expenseEdit = owner.page.getByRole('dialog', { name: 'Editar gasto' });
  await owner.page.waitForFunction(() => document.querySelector('[role="dialog"] input[inputmode="decimal"]')?.value === '210,00');
  await expenseEdit.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expenseEdit.waitFor({ state: 'hidden' });
  await expectTotal(owner.page, 'expenses-total', '905,00');
  passed('Dois aparelhos sincronizam gastos; edição simultânea exibe conflito e carrega a versão atual; celular usa cartões.');

  await navigate(owner.page, 'Cronograma');
  await (await button(owner.page, 'Excluir Teste piquenique')).click();
  const activityDeletion = owner.page.getByRole('dialog', { name: 'Excluir este momento?' });
  await visibleText(owner.page, /Há 1 gasto vinculado a esta atividade/);
  await activityDeletion.getByRole('button', { name: 'Excluir atividade', exact: true }).click();
  await activityDeletion.waitFor({ state: 'hidden' });
  assert.equal(activities.size, 2);
  assert.equal(expenses.size, 4, 'deleting an activity never deletes expenses');
  assert.equal(expenses.get(lunch.id).activity_id, null, 'only the link is removed');
  await navigate(owner.page, 'Gastos');
  await expectTotal(owner.page, 'expenses-total', '905,00');
  await (await button(owner.page, 'Ver detalhes de Teste almoço de domingo')).click();
  await visibleText(owner.page, 'Sem atividade vinculada');
  await navigate(owner.page, 'Resumo');
  await expectTotal(owner.page, 'summary-expenses-total', '905,00');
  await visibleText(owner.page, 'Orçamento previsto no cronograma');
  await (await button(owner.page, 'Ver gastos')).click();
  await visibleText(owner.page, 'Nossos gastos');
  await navigate(owner.page, 'Cronograma');
  passed('Excluir uma atividade vinculada preserva o gasto; o Resumo separa gastos registrados do orçamento previsto.');

  await navigate(member.page, 'Cronograma');
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

  await navigate(member.page, 'Gastos');
  await visibleText(member.page, 'Teste Airbnb');
  await expectTotal(member.page, 'expenses-total', '905,00');
  await member.page.locator('.mobile-add').click();
  const offlineExpense = member.page.getByRole('dialog', { name: 'Um novo gasto' });
  await visibleText(member.page, 'Você está offline. Seu formulário continua aqui; conecte-se para salvar.');
  assert.equal(await offlineExpense.getByRole('button', { name: 'Salvar gasto', exact: true }).isDisabled(), true);
  await offlineExpense.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await offlineExpense.waitFor({ state: 'hidden' });
  assert.equal(expenses.size, 4, 'offline consultation never adds local drafts to confirmed expenses');
  passed('Offline, os gastos da última sincronização continuam consultáveis no celular e gravações exigem conexão.');

  await member.context.setOffline(false);
  await refresh(member.page);
  await navigate(owner.page, 'Trocar viagem');
  await visibleText(owner.page, 'Minhas viagens');
  const existingCard=owner.page.locator('.trip-card').filter({ hasText:'Viagem de teste' });
  await visibleText(owner.page,'Orçamento inicial');
  assert.ok((await existingCard.textContent()).includes('905,00'));
  await navigate(owner.page, 'Nova viagem');
  await owner.page.getByRole('heading',{ name:'Nova viagem',exact:true }).waitFor();
  assert.equal(await owner.page.getByLabel(/Nome da viagem/).inputValue(),'');
  assert.equal(await owner.page.getByLabel('Destino',{exact:true}).inputValue(),'');
  assert.equal(await owner.page.getByLabel(/Orçamento inicial da viagem/).inputValue(),'');
  await owner.page.getByLabel(/Nome da viagem/).fill('Segunda aventura');
  await owner.page.getByLabel('Destino',{exact:true}).fill('Destino B');
  await owner.page.getByLabel('Data de início',{exact:true}).fill('2035-08-10');
  await owner.page.getByLabel('Data de término',{exact:true}).fill('2035-08-12');
  await navigate(owner.page,'Criar viagem');
  assert.equal(await owner.page.getByLabel(/Orçamento inicial da viagem/).evaluate(input=>input.validity.valueMissing),true);
  assert.equal(trips.size,1,'a blank initial budget does not create a zero-budget trip');
  await owner.page.getByLabel(/Orçamento inicial da viagem/).fill('0');
  const createsBefore=rpcCalls.filter(call=>call==='create_private_trip').length;
  await owner.page.getByRole('button',{ name:'Criar viagem',exact:true }).dblclick();
  await visibleText(owner.page,'Segunda aventura');
  await owner.page.getByRole('heading',{ name:'Segunda aventura',exact:true }).waitFor();
  const tripB=[...trips.values()].find(value=>value.name==='Segunda aventura');
  assert.ok(tripB);
  assert.equal(tripB.collection_id,collectionId);
  assert.equal(tripB.initial_budget_cents,0);
  assert.equal(trips.size,2);
  assert.equal(rpcCalls.filter(call=>call==='create_private_trip').length,createsBefore+1);
  assert.equal(activities.size,2);
  assert.equal(expenses.size,4);
  assert.equal(trip.initial_budget_cents,200000);
  assert.equal(await owner.page.getByRole('button',{ name:'Editar Teste conflito resolvido',exact:true }).count(),0);
  await navigate(owner.page,'Gastos');
  await expectTotal(owner.page,'expenses-total','0,00');
  await newExpense(owner.page,{ description:'Gasto só da segunda viagem',amount:'5',category:'Outros',date:'2025-01-01' });
  await expectTotal(owner.page,'expenses-total','5,00');
  await navigate(owner.page,'Cronograma');
  await newActivity(owner.page,{ name:'Momento só da segunda viagem',date:'2035-08-10T09:30',budget:'10' });
  await navigate(owner.page,'Resumo');
  await expectTotal(owner.page,'summary-expenses-total','5,00');
  assert.equal(await owner.page.getByText('Teste Airbnb',{exact:true}).count(),0);
  passed('Nova viagem exige orçamento, aceita zero, evita duplo cadastro e começa com cronograma e gastos vazios; cada saldo permanece separado.');

  await navigate(owner.page,'Trocar viagem');
  await owner.page.getByLabel('Pesquisar por nome ou destino',{exact:true}).fill('Destino B');
  await owner.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).waitFor();
  await owner.page.waitForFunction(()=>document.querySelectorAll('.trip-card').length===1);
  await owner.page.getByLabel('Pesquisar por nome ou destino',{exact:true}).fill('');
  await navigate(owner.page,'Próximas');
  await owner.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).waitFor();
  assert.equal(await owner.page.locator('.trip-card').filter({hasText:'Viagem de teste'}).count(),0);
  const bCard=owner.page.locator('.trip-card').filter({hasText:'Segunda aventura'});
  await bCard.getByLabel('Ações de Segunda aventura').click();
  await bCard.getByRole('button',{name:'Arquivar',exact:true}).click();
  const archive=owner.page.getByRole('dialog',{name:'Guardar esta viagem no arquivo?'});
  assert.equal(tripB.archived_at,null,'archiving waits for a concrete confirmation');
  await archive.getByRole('button',{name:'Arquivar viagem',exact:true}).click();
  await archive.waitFor({state:'hidden'});
  assert.ok(tripB.archived_at);
  assert.equal(await owner.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).count(),0);
  await navigate(owner.page,'Arquivadas');
  const archivedCard=owner.page.locator('.trip-card').filter({hasText:'Segunda aventura'});
  await archivedCard.waitFor();
  await archivedCard.getByRole('button',{name:'Abrir viagem',exact:true}).click();
  await visibleText(owner.page,'Momento só da segunda viagem');
  await navigate(owner.page,'Gastos');
  await expectTotal(owner.page,'expenses-total','5,00');
  await navigate(owner.page,'Trocar viagem');
  await navigate(owner.page,'Arquivadas');
  const restoreCard=owner.page.locator('.trip-card').filter({hasText:'Segunda aventura'});
  await restoreCard.getByLabel('Ações de Segunda aventura').click();
  await restoreCard.getByRole('button',{name:'Desarquivar',exact:true}).click();
  const restore=owner.page.getByRole('dialog',{name:'Trazer esta viagem de volta?'});
  await restore.getByRole('button',{name:'Desarquivar viagem',exact:true}).click();
  await restore.waitFor({state:'hidden'});
  assert.equal(tripB.archived_at,null);
  assert.equal(tripB.start_date,'2035-08-10');
  assert.equal(tripB.initial_budget_cents,0);
  assert.equal([...activities.values()].filter(value=>value.trip_id===tripB.id).length,1);
  assert.equal([...expenses.values()].filter(value=>value.trip_id===tripB.id).length,1);
  await navigate(owner.page,'Todas');
  await owner.page.locator('.trip-card').filter({hasText:'Viagem de teste'}).getByRole('button',{name:'Abrir viagem',exact:true}).click();
  await navigate(owner.page,'Gastos');
  await expectTotal(owner.page,'expenses-total','905,00');
  assert.equal(await owner.page.getByText('Gasto só da segunda viagem',{exact:true}).count(),0);
  passed('Pesquisa e filtro por período funcionam; arquivar/desarquivar preserva atividades, gastos, datas e orçamento sem afetar a viagem anterior.');

  const tripOnly=await context({viewport:{width:1280,height:800}});
  await tripOnly.page.goto(tripInviteUrl);
  await visibleText(tripOnly.page,'Teste conflito resolvido');
  await navigate(tripOnly.page,'Trocar viagem');
  await tripOnly.page.waitForFunction(()=>document.querySelectorAll('.trip-card').length===1);
  assert.equal(await tripOnly.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).count(),0);
  await tripOnly.page.goto(`${appOrigin}/viagens/${tripB.id}/cronograma`);
  await tripOnly.page.getByRole('heading',{name:'Minhas viagens',exact:true}).waitFor();
  assert.equal(await tripOnly.page.getByText('Momento só da segunda viagem',{exact:true}).count(),0);
  await navigate(owner.page,'Trocar viagem');
  await navigate(owner.page,'Convidar aparelho');
  const collectionSharing=owner.page.getByRole('dialog',{name:'Nossos planos em outro aparelho'});
  assert.equal(await collectionSharing.getByRole('button',{name:'Gerar convite privado',exact:true}).isDisabled(),true);
  await collectionSharing.getByRole('checkbox').check();
  await collectionSharing.getByRole('button',{name:'Gerar convite privado',exact:true}).click();
  await collectionSharing.getByLabel('Convite da coleção').waitFor();
  const collectionInviteUrl=await collectionSharing.getByLabel('Convite da coleção').inputValue();
  assert.match(collectionInviteUrl,/\/#colecao=[0-9a-f]{64}$/);
  await collectionSharing.getByRole('button',{name:'Fechar formulário'}).click();
  const collectionDevice=await context({viewport:{width:360,height:780}});
  await collectionDevice.page.goto(collectionInviteUrl);
  await collectionDevice.page.getByRole('heading',{name:'Minhas viagens',exact:true}).waitFor();
  await collectionDevice.page.waitForFunction(()=>document.querySelectorAll('.trip-card').length===2);
  assert.equal(await collectionDevice.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await collectionDevice.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).getByRole('button',{name:'Abrir viagem',exact:true}).click();
  await visibleText(collectionDevice.page,'Momento só da segunda viagem');
  assert.equal(new URL(owner.page.url()).pathname,'/viagens','another device never forces a trip selection here');
  const visitor=await context({viewport:{width:1280,height:800}});
  await visitor.page.goto(`${appOrigin}/viagens/${tripB.id}/cronograma`);
  await visitor.page.getByRole('heading',{name:'Minhas viagens',exact:true}).waitFor();
  await visibleText(visitor.page,'Qual será o próximo destino?');
  assert.equal(await visitor.page.locator('.trip-card').count(),0);
  assert.equal(rpcCalls.includes('open_shared_trip'),false);
  passed('Convites restritos abrem só uma viagem; acesso à coleção exige autorização explícita; conhecer a URL não revela dados e a seleção é local ao aparelho.');

  await navigate(owner.page,'Nova viagem');
  await owner.page.getByLabel(/Nome da viagem/).fill('Memória da terceira viagem');
  await owner.page.getByLabel(/Orçamento inicial da viagem/).fill('100');
  await owner.page.getByLabel('Data de início',{exact:true}).fill('2020-01-01');
  await owner.page.getByLabel('Data de término',{exact:true}).fill('2020-01-02');
  await navigate(owner.page,'Criar viagem');
  await visibleText(owner.page,'Esta viagem faz parte das nossas memórias. Você pode consultar e corrigir seus registros.');
  const tripC=[...trips.values()].find(value=>value.name==='Memória da terceira viagem');
  await navigate(owner.page,'Gastos');
  await newExpense(owner.page,{description:'Gasto esquecido da viagem passada',amount:'7',category:'Hospedagem',date:'2021-01-01'});
  await expectTotal(owner.page,'expenses-total','7,00');
  await navigate(owner.page,'Detalhes');
  await owner.page.getByLabel('Data de início',{exact:true}).fill('2036-01-01');
  await owner.page.getByLabel('Data de término',{exact:true}).fill('2036-01-02');
  await navigate(owner.page,'Salvar nossa viagem');
  await visibleText(owner.page,'Sua viagem foi atualizada.');
  assert.equal([...expenses.values()].filter(value=>value.trip_id===tripC.id).length,1);
  await navigate(owner.page,'Trocar viagem');
  await navigate(collectionDevice.page,'Trocar viagem');
  await collectionDevice.page.waitForFunction(()=>document.querySelectorAll('.trip-card').length===3);
  await tripOnly.page.goto(`${appOrigin}/viagens/${tripC.id}/cronograma`);
  await tripOnly.page.getByRole('heading',{name:'Minhas viagens',exact:true}).waitFor();
  await tripOnly.page.waitForFunction(()=>document.querySelectorAll('.trip-card').length===1);
  assert.equal(await tripOnly.page.locator('.trip-card').count(),1);
  passed('A coleção autoriza viagens futuras; viagens passadas aceitam gastos esquecidos e datas corrigidas sem mover lançamentos.');

  await owner.page.locator('.trip-card').filter({hasText:'Viagem de teste'}).getByRole('button',{name:'Abrir viagem',exact:true}).click();
  await visibleText(owner.page,'Teste conflito resolvido');
  delayedReads.set(tripId,1600);
  await owner.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await owner.page.waitForTimeout(150);
  await navigate(owner.page,'Trocar viagem');
  await owner.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).getByRole('button',{name:'Abrir viagem',exact:true}).click();
  await visibleText(owner.page,'Momento só da segunda viagem');
  await owner.page.waitForTimeout(1800);
  assert.equal(await owner.page.getByText('Teste conflito resolvido',{exact:true}).count(),0);
  assert.equal(new URL(owner.page.url()).pathname,`/viagens/${tripB.id}/cronograma`);
  delayedReads.delete(tripId);
  await navigate(owner.page,'Detalhes');
  await owner.page.getByLabel(/Nome da viagem/).fill('Rascunho que fica na segunda viagem');
  owner.page.removeAllListeners('dialog');
  owner.page.once('dialog',dialog=>dialog.dismiss());
  await navigate(owner.page,'Trocar viagem');
  assert.equal(await owner.page.getByLabel(/Nome da viagem/).inputValue(),'Rascunho que fica na segunda viagem');
  assert.equal(tripB.name,'Segunda aventura');
  owner.page.on('dialog',dialog=>dialog.accept());
  await navigate(owner.page,'Trocar viagem');
  await owner.page.getByRole('heading',{name:'Minhas viagens',exact:true}).waitFor();
  assert.equal(tripB.name,'Segunda aventura');
  assert.equal(trip.name,'Viagem de teste');
  passed('Respostas da viagem anterior são ignoradas; a troca confirma o descarte de rascunhos e nunca salva dados em outra viagem.');

  await owner.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).getByRole('button',{name:'Abrir viagem',exact:true}).click();
  await visibleText(owner.page,'Momento só da segunda viagem');
  await navigate(owner.page,'Editar Momento só da segunda viagem');
  const pendingActivity=owner.page.getByRole('dialog',{name:'Editar atividade'});
  await pendingActivity.getByLabel(/Orçamento \(R\$\)/).fill('12');
  delayedRpcs.set('save_activity',2000);
  await pendingActivity.getByRole('button',{name:'Salvar atividade',exact:true}).click();
  const saveAlert=owner.page.waitForEvent('dialog');
  await owner.page.evaluate(()=>history.back());
  assert.match((await saveAlert).message(),/Aguarde a confirmação do salvamento/);
  assert.equal(await pendingActivity.getByLabel(/Nome da atividade/).inputValue(),'Momento só da segunda viagem');
  assert.equal(await pendingActivity.getByLabel(/Orçamento \(R\$\)/).isDisabled(),true);
  await pendingActivity.waitFor({state:'hidden'});
  delayedRpcs.delete('save_activity');
  assert.equal(new URL(owner.page.url()).pathname,`/viagens/${tripB.id}/cronograma`);
  assert.equal([...activities.values()].find(value=>value.trip_id===tripB.id).budget_cents,1200);
  assert.equal(activities.get(first.id).budget_cents,1725);
  await navigate(owner.page,'Gastos');
  await navigate(owner.page,'Editar Gasto só da segunda viagem');
  const pendingExpense=owner.page.getByRole('dialog',{name:'Editar gasto'});
  await pendingExpense.getByLabel(/^Valor \(R\$\)/).fill('6');
  delayedRpcs.set('save_expense',2000);
  await pendingExpense.getByRole('button',{name:'Salvar gasto',exact:true}).click();
  const expenseAlert=owner.page.waitForEvent('dialog');
  await owner.page.evaluate(()=>history.back());
  assert.match((await expenseAlert).message(),/Aguarde a confirmação do salvamento/);
  assert.equal(await pendingExpense.getByLabel(/^Descrição/).inputValue(),'Gasto só da segunda viagem');
  await pendingExpense.waitFor({state:'hidden'});
  delayedRpcs.delete('save_expense');
  assert.equal(new URL(owner.page.url()).pathname,`/viagens/${tripB.id}/gastos`);
  assert.equal([...expenses.values()].find(value=>value.trip_id===tripB.id).amount_cents,600);
  assert.equal(expenses.get(fuel.id).amount_cents,21000);
  passed('Navegar Voltar durante gravações de atividade ou gasto aguarda a confirmação, mantém o formulário correto e não inicia outro rascunho.');

  await collectionDevice.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).getByRole('button',{name:'Abrir viagem',exact:true}).click();
  await visibleText(collectionDevice.page,'Momento só da segunda viagem');
  const sharedSession=await collectionDevice.page.evaluate(()=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('sb-')&&key.endsWith('-auth-token'));
    return JSON.parse(localStorage.getItem(key)).user.id;
  });
  collectionMemberships.delete(memberKey(sharedSession,collectionId));
  await refresh(collectionDevice.page);
  await collectionDevice.page.getByRole('heading',{name:'Minhas viagens',exact:true}).waitFor();
  await collectionDevice.page.waitForFunction(()=>document.querySelectorAll('.trip-card').length===0);
  const stalePrivate=await collectionDevice.page.evaluate(()=>JSON.stringify(localStorage));
  assert.equal(stalePrivate.includes('Momento só da segunda viagem'),false);
  await member.context.setOffline(true);
  await navigate(member.page,'Trocar viagem');
  await visibleText(member.page,'Consulta offline neste aparelho');
  await visibleText(member.page,/Somente as viagens sincronizadas neste aparelho estão disponíveis/);
  assert.equal(await member.page.locator('.trip-card').count(),1);
  assert.equal(await member.page.locator('.trip-card').filter({hasText:'Segunda aventura'}).count(),0);
  passed('A revogação interrompe o acesso e limpa a cópia privada; a lista offline indica o histórico parcial disponível neste aparelho.');
  console.log(`Teste de navegador concluído: ${checks} grupos aprovados. Auth/Realtime/Photon reais não foram usados.`);
} catch (error) {
  console.error(error instanceof Error ? error.stack : 'Falha no teste de navegador.');
  for(const current of browser?.contexts()??[]) for(const page of current.pages()) {
    console.error(`Tela de teste: ${page.url().replace(/#[^#]*/, '')}`);
    console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-4000).replace(/[0-9a-f]{64}/g,'[convite omitido]'));
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
