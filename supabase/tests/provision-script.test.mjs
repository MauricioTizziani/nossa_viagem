import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const script = fileURLToPath(new URL('../../scripts/provision-owner.mjs', import.meta.url));
const token = 'a'.repeat(64);
const tripId = '40000000-0000-4000-8000-000000000001';
const inviteId = '50000000-0000-4000-8000-000000000001';

async function fixture(handler, run) {
  const directory = await mkdtemp(join(tmpdir(), 'nossa-viagem-owner-test-'));
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(directory, `http://127.0.0.1:${address.port}`); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await rm(directory, { recursive: true, force: true });
  }
}

async function execute(directory, endpoint, args = [], overrides = {}) {
  const child = spawn(process.execPath, [script, '--output', join(directory, 'invite.txt'), ...args], {
    cwd: directory,
    env: { ...process.env, SUPABASE_URL: endpoint, SUPABASE_SECRET_KEY: 'sb_secret_TEST_ONLY',
      SUPABASE_SERVICE_ROLE_KEY: '', APP_URL: 'http://localhost:3000', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  return { code, stdout, stderr };
}

function success(response) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify([{ trip_id: tripId, invite_id: inviteId, token, expires_at: '2026-10-09T12:00:00Z' }]));
}

test('owner script sends a current secret in apikey only and writes token solely to the private output file', async () => {
  let requestBody;
  await fixture((request, response) => {
    assert.equal(request.url, '/rest/v1/rpc/provision_trip_owner');
    assert.equal(request.headers.apikey, 'sb_secret_TEST_ONLY');
    assert.equal(request.headers.authorization, undefined);
    let body = '';
    request.on('data', (data) => { body += data; });
    request.on('end', () => { requestBody = JSON.parse(body); success(response); });
  }, async (directory, endpoint) => {
    const result = await execute(directory, endpoint);
    assert.equal(result.code, 0);
    assert.deepEqual(requestBody, { p_trip_id: null, p_name: 'Nossa Viagem' });
    const contents = await readFile(join(directory, 'invite.txt'), 'utf8');
    assert.ok(contents.includes(`http://localhost:3000/#convite=${token}`));
    assert.ok(contents.includes(tripId));
    assert.ok(!result.stdout.includes(token));
    assert.ok(!result.stderr.includes(token));
    assert.ok(!`${result.stdout}${result.stderr}${contents}`.includes('sb_secret_TEST_ONLY'));
  });
});

test('recovery targets the existing trip and legacy service JWT headers remain supported', async () => {
  let requestBody;
  await fixture((request, response) => {
    assert.equal(request.headers.apikey, 'LEGACY_TEST_JWT');
    assert.equal(request.headers.authorization, 'Bearer LEGACY_TEST_JWT');
    let body = '';
    request.on('data', (data) => { body += data; });
    request.on('end', () => { requestBody = JSON.parse(body); success(response); });
  }, async (directory, endpoint) => {
    const result = await execute(directory, endpoint, ['--trip', tripId], {
      SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: 'LEGACY_TEST_JWT',
    });
    assert.equal(result.code, 0);
    assert.equal(requestBody.p_trip_id, tripId);
    assert.match(result.stdout, /recuperação/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(token));
  });
});

test('collection recovery requires an explicit scope and writes a distinct collection invite fragment', async () => {
  let requestBody;
  const collectionId = '60000000-0000-4000-8000-000000000001';
  await fixture((request, response) => {
    assert.equal(request.url, '/rest/v1/rpc/provision_collection_owner');
    let body = '';
    request.on('data', (data) => { body += data; });
    request.on('end', () => {
      requestBody = JSON.parse(body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify([{ collection_id: collectionId, invite_id: inviteId, token, expires_at: '2026-10-09T12:00:00Z' }]));
    });
  }, async (directory, endpoint) => {
    const result = await execute(directory, endpoint, ['--scope', 'collection', '--trip', tripId]);
    assert.equal(result.code, 0);
    assert.deepEqual(requestBody, { p_trip_id: tripId });
    const contents = await readFile(join(directory, 'invite.txt'), 'utf8');
    assert.ok(contents.includes(`http://localhost:3000/#colecao=${token}`));
    assert.ok(contents.includes(collectionId));
    assert.match(contents, /TODAS as viagens atuais e futuras/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(token));
  });
});

test('collection recovery without a trip and invalid scopes are rejected before a request', async () => {
  let requests = 0;
  await fixture((_request,response) => { requests += 1; success(response); }, async (directory,endpoint) => {
    for (const args of [['--scope','collection'],['--scope','public','--trip',tripId]]) {
      const result = await execute(directory,endpoint,args);
      assert.equal(result.code,1);
      await assert.rejects(access(join(directory,'invite.txt')),/ENOENT/);
    }
    assert.equal(requests,0);
  });
});

test('failed responses neither log their secret payload nor leave a token output file', async () => {
  await fixture((_request, response) => {
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: token, key: 'sb_secret_TEST_ONLY' }));
  }, async (directory, endpoint) => {
    const result = await execute(directory, endpoint);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /HTTP 403/);
    assert.ok(!result.stderr.includes(token));
    assert.ok(!result.stderr.includes('sb_secret_TEST_ONLY'));
    await assert.rejects(access(join(directory, 'invite.txt')), /ENOENT/);
  });
});

test('an existing output is preserved and no new database request is made', async () => {
  let requests = 0;
  await fixture((_request, response) => { requests += 1; success(response); }, async (directory, endpoint) => {
    await writeFile(join(directory, 'invite.txt'), 'Existing private invite');
    const result = await execute(directory, endpoint);
    assert.equal(result.code, 1);
    assert.equal(requests, 0);
    assert.equal(await readFile(join(directory, 'invite.txt'), 'utf8'), 'Existing private invite');
  });
});

test('remote plaintext destinations are rejected before a database call', async () => {
  let requests = 0;
  await fixture((_request, response) => { requests += 1; success(response); }, async (directory, endpoint) => {
    const result = await execute(directory, endpoint, [], { APP_URL: 'http://example.test' });
    assert.equal(result.code, 1);
    assert.equal(requests, 0);
    assert.match(result.stderr, /HTTPS/);
  });
});
