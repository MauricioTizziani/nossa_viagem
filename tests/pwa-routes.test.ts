import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('private route navigations use a clean public shell offline without caching trip URLs or invitation secrets', async () => {
  const listeners = new Map<string, (event: { request?: Request; waitUntil(promise: Promise<unknown>): void; respondWith?(promise: Promise<Response>): void }) => void>();
  const stored = new Map<string, Response>();
  const cache = { put: async (key: string | Request, response: Response) => { stored.set(typeof key === 'string' ? key : key.url, response); }, match: async (key: string | Request) => stored.get(typeof key === 'string' ? key : key.url)?.clone() };
  let offline = false;
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://nossaviagem.example' }, addEventListener: (name: string, callback: typeof listeners extends Map<string, infer C> ? C : never) => listeners.set(name, callback), clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async (url: string) => { if (offline) throw new Error('offline'); return new Response(url === '/' ? '<html>public root shell</html>' : '<html>private route shell</html>', { headers: { 'Content-Type': 'text/html' } }); },
    URL, Set, Promise, Response,
  });
  const pending: Promise<unknown>[] = [];
  listeners.get('install')!({ waitUntil: promise => pending.push(promise) });
  await Promise.all(pending);
  let response: Promise<Response> | undefined;
  const request = { url: 'https://nossaviagem.example/viagens/private-trip/gastos', method: 'GET', mode: 'navigate', headers: new Headers() } as Request;
  listeners.get('fetch')!({ request, waitUntil: () => {}, respondWith: value => { response = value; } });
  assert.match(await (await response!).text(), /private route shell/);
  assert.ok([...stored.keys()].every(key => !key.includes('private-trip')));
  assert.match(await stored.get('/')!.clone().text(), /public root shell/);
  offline = true;
  listeners.get('fetch')!({ request, waitUntil: () => {}, respondWith: value => { response = value; } });
  assert.match(await (await response!).text(), /public root shell/);
  for (const url of ['https://nossaviagem.example/viagens?convite=secret', 'https://nossaviagem.example/viagens/private-trip?invite=secret']) {
    let intercepted = false;
    listeners.get('fetch')!({ request: { ...request, url } as Request, waitUntil: () => {}, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
  assert.ok([...stored.keys()].every(key => !key.includes('secret') && !key.includes('private-trip')));
});
