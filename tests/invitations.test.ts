import test from 'node:test';
import assert from 'node:assert/strict';

const tripId = '00000000-0000-4000-8000-000000000011';
const collectionId = '00000000-0000-4000-8000-000000000012';
const userId = '00000000-0000-4000-8000-000000000013';
const calls: { rpc: string; body: Record<string, unknown> }[] = [];
const saved = new Map<string, string>();
let hash = '';
let invalid = false;
const cleaned: string[] = [];
const fakeWindow = { location: { get hash() { return hash; }, pathname: '/viagens', search: '' }, history: { replaceState(_state: unknown, _unused: string, url: string) { cleaned.push(url); hash = ''; } }, addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
Object.defineProperty(globalThis, 'document', { value: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) }, configurable: true });
Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true });
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://invites-test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: expiresAt })).toString('base64url')}.test-signature`;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === '/auth/v1/signup') return new Response(JSON.stringify({ access_token: jwt, token_type: 'bearer', refresh_token: 'test-refresh-token', expires_in: 3600, expires_at: expiresAt, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, email: '', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }), { headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const rpc = url.pathname.split('/').at(-1)!;
    calls.push({ rpc, body: JSON.parse(String(init?.body)) });
    assert.equal(hash, '', 'the token fragment was removed before the RPC');
    if (invalid) return new Response(JSON.stringify({ code: '22023', message: 'INVALID_INVITE' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(rpc === 'redeem_collection_invite' ? collectionId : tripId), { headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('Unexpected endpoint in invitation test');
};
let session: typeof import('../lib/supabase');
const sessionReady = import('../lib/supabase').then(result => { session = result; });

test('legacy trip invitations stay trip scoped and explicit collection invitations use their own RPC', async () => {
  await sessionReady;
  try {
    hash = '#convite=private-trip-token';
    assert.equal(await session.initializeSession(), userId);
    assert.deepEqual(calls.at(-1), { rpc: 'redeem_trip_invite', body: { p_token: 'private-trip-token' } });
    assert.deepEqual(session.takeRedeemedInvitation(), { scope: 'trip', id: tripId });
    hash = '#convite=private-trip-token&scope=collection';
    assert.equal(await session.initializeSession(), userId);
    assert.deepEqual(calls.at(-1), { rpc: 'redeem_trip_invite', body: { p_token: 'private-trip-token' } });
    assert.deepEqual(session.takeRedeemedInvitation(), { scope: 'trip', id: tripId });
    hash = '#colecao=private-collection-token';
    assert.equal(await session.initializeSession(), userId);
    assert.deepEqual(calls.at(-1), { rpc: 'redeem_collection_invite', body: { p_token: 'private-collection-token' } });
    assert.deepEqual(session.takeRedeemedInvitation(), { scope: 'collection', id: collectionId });
    assert.ok(cleaned.every(url => url === '/viagens'));
    assert.ok([...saved.values()].every(value => !value.includes('private-trip-token') && !value.includes('private-collection-token')));
    assert.equal(calls.some(call => call.rpc === 'open_shared_trip'), false);
  } finally { session.getSupabase().auth.stopAutoRefresh(); }
});
test('ambiguous scopes are removed and rejected instead of silently widening access', async () => {
  await sessionReady;
  hash = '#convite=old-token&colecao=new-token';
  assert.throws(() => session.captureInvitation(), /INVALID_INVITE/);
  assert.equal(hash, '');
  hash = '#invite=token-without-scope';
  assert.throws(() => session.captureInvitation(), /INVALID_INVITE/);
  assert.equal(hash, '');
});
test('an invalid invitation cannot indefinitely block the existing authorized session', async () => {
  await sessionReady;
  invalid = true; hash = '#convite=revoked-token';
  await assert.rejects(session.initializeSession(), error => Boolean(error && typeof error === 'object' && 'message' in error && error.message === 'INVALID_INVITE'));
  const attempts = calls.length;
  assert.equal(await session.initializeSession(), userId);
  assert.equal(calls.length, attempts, 'invalid token was discarded rather than replayed');
  session.getSupabase().auth.stopAutoRefresh();
});
