import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSnapshot, readOfflineSnapshot, readOfflineSnapshots, readSnapshot, saveSnapshot, saveTripsSnapshot, readTripsSnapshot, pruneUnauthorizedSnapshots, rememberedTripId, type Snapshot } from '../lib/storage';
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
  keys() { return [...this.items.keys()]; }
  get length() { return this.items.size; }
  key(index: number) { return this.keys()[index] ?? null; }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
const snapshot = (userId: string, tripId: string): Snapshot => ({ userId, role: 'member', syncedAt: '2026-10-08T12:00:00Z', trip: { id: tripId, name: 'Nossa Viagem', destination: '', start_date: null, end_date: null, timezone: 'America/Sao_Paulo', person_one: null, person_two: null, initial_budget_cents: null, version: 1 }, activities: [], expenses: [] });
test('offline snapshots are scoped by previously authorized session and trip', () => {
  localStorage.clear();
  assert.equal(readOfflineSnapshot(), null);
  saveSnapshot(snapshot('session-a', 'trip-a'));
  assert.equal(readSnapshot('session-b'), null);
  assert.equal(readSnapshot('session-a')?.trip.id, 'trip-a');
  assert.equal(readOfflineSnapshot()?.userId, 'session-a');
  saveSnapshot(snapshot('session-b', 'trip-b'));
  assert.equal(readOfflineSnapshot()?.trip.id, 'trip-b');
  clearSnapshot('session-a');
  assert.equal(readSnapshot('session-a'), null);
  assert.equal(readOfflineSnapshot()?.userId, 'session-b');
  clearSnapshot('session-b');
  assert.equal(readOfflineSnapshot(), null);
});
test('expenses are kept in the same private snapshot and older snapshots without expenses stay readable', () => {
  localStorage.clear();
  const expense = { id: 'e1', trip_id: 'trip-c', description: 'Gasolina', category: 'Combustível' as const, amount_cents: 20000, expense_date: '2026-10-05', activity_id: null, notes: null, version: 1 };
  saveSnapshot({ ...snapshot('session-c', 'trip-c'), expenses: [expense] });
  assert.deepEqual(readSnapshot('session-c')?.expenses, [expense]);
  assert.equal(readSnapshot('session-d'), null, 'another session never reads these expenses');
  // A snapshot written by the previous version has no expenses field at all.
  const storage = globalThis.localStorage as unknown as MemoryStorage;
  const key = storage.keys().find((item) => item.endsWith(':session-c:trip-c'))!;
  const legacy = JSON.parse(storage.getItem(key)!);
  delete legacy.expenses;
  storage.setItem(key, JSON.stringify(legacy));
  assert.deepEqual(readSnapshot('session-c')?.expenses, []);
  assert.equal(readSnapshot('session-c')?.activities.length, 0);
  legacy.expenses = 'corrupted';
  storage.setItem(key, JSON.stringify(legacy));
  assert.equal(readSnapshot('session-c'), null);
  clearSnapshot('session-c');
});
test('an older snapshot without an initial budget stays unset, while zero remains zero', () => {
  localStorage.clear();
  saveSnapshot(snapshot('session-budget', 'trip-budget'));
  const storage = globalThis.localStorage as unknown as MemoryStorage;
  const key = storage.keys().find((item) => item.endsWith(':session-budget:trip-budget'))!;
  const legacy = JSON.parse(storage.getItem(key)!);
  delete legacy.trip.initial_budget_cents;
  storage.setItem(key, JSON.stringify(legacy));
  assert.equal(readSnapshot('session-budget')?.trip.initial_budget_cents, null);
  legacy.trip.initial_budget_cents = 0;
  storage.setItem(key, JSON.stringify(legacy));
  assert.equal(readSnapshot('session-budget')?.trip.initial_budget_cents, 0);
  legacy.trip.initial_budget_cents = '200000';
  storage.setItem(key, JSON.stringify(legacy));
  assert.equal(readSnapshot('session-budget')?.trip.initial_budget_cents, 200000);
  legacy.trip.initial_budget_cents = -1;
  storage.setItem(key, JSON.stringify(legacy));
  assert.equal(readSnapshot('session-budget'), null);
  clearSnapshot('session-budget');
});
test('disabled browser storage cannot prevent online application use', () => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage unavailable'); } });
  assert.doesNotThrow(() => saveSnapshot(snapshot('session', 'trip')));
  assert.equal(readSnapshot('session'), null);
  assert.equal(readOfflineSnapshot(), null);
  assert.doesNotThrow(() => clearSnapshot('session'));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous });
});


test('switching trips preserves each offline history and cache removal only removes the revoked trip', () => {
  localStorage.clear();
  saveSnapshot({ ...snapshot('couple', 'a'), complete: true });
  saveSnapshot({ ...snapshot('couple', 'b'), complete: true });
  assert.equal(readSnapshot('couple', 'a')?.trip.id, 'a');
  assert.equal(readSnapshot('couple', 'b')?.trip.id, 'b');
  assert.equal(readSnapshot('outsider', 'a'), null);
  assert.deepEqual(readOfflineSnapshots().map(item => item.trip.id).sort(), ['a', 'b']);
  clearSnapshot('couple', 'a');
  assert.equal(readSnapshot('couple', 'a'), null);
  assert.equal(readOfflineSnapshot('b')?.trip.id, 'b');
  clearSnapshot('couple');
  assert.deepEqual(readOfflineSnapshots(), []);
});
test('a server authorization refresh removes revoked snapshots and cards while preserving other sessions', () => {
  localStorage.clear();
  saveSnapshot({ ...snapshot('first', 'a'), complete: true });
  saveSnapshot({ ...snapshot('first', 'b'), complete: true });
  saveSnapshot({ ...snapshot('second', 'c'), complete: true });
  saveTripsSnapshot({ userId: 'first', syncedAt: '2026-10-08T12:00:00Z', complete: false, collections: [], trips: ['a', 'b'].map(id => ({ ...snapshot('first', id).trip, total_spent_cents: 0, trip_role: 'member', collection_role: null })) });
  pruneUnauthorizedSnapshots('first', new Set(['b']));
  assert.equal(readSnapshot('first', 'a'), null);
  assert.equal(readSnapshot('first', 'b')?.trip.id, 'b');
  assert.deepEqual(readTripsSnapshot('first')?.trips.map(item => item.id), ['b']);
  assert.equal(readSnapshot('second', 'c')?.trip.id, 'c');
  clearSnapshot('first');
  assert.equal(readTripsSnapshot('first'), null);
  assert.equal(readSnapshot('second', 'c')?.trip.id, 'c');
});
test('cache rejects mixed-trip records and identifies pre-pagination snapshots as partial', () => {
  localStorage.clear();
  const legacy = snapshot('couple', 'a');
  saveSnapshot(legacy);
  assert.equal(readSnapshot('couple', 'a')?.complete, false);
  const expense = { id: 'e', trip_id: 'b', description: 'Pagamento', category: 'Outros' as const, amount_cents: 1, expense_date: '2026-10-08', activity_id: null, notes: null, version: 1 };
  saveSnapshot({ ...legacy, expenses: [expense] });
  assert.deepEqual(readSnapshot('couple', 'a')?.expenses, []);
  const storage = globalThis.localStorage as unknown as MemoryStorage;
  const key = storage.keys().find(item => item.endsWith(':couple:a'))!;
  storage.setItem(key, JSON.stringify({ ...legacy, expenses: [expense] }));
  assert.equal(readSnapshot('couple', 'a'), null);
});
test('updating cached metadata does not change the locally remembered open trip', () => {
  localStorage.clear();
  saveSnapshot(snapshot('couple', 'a'));
  saveSnapshot(snapshot('couple', 'b'));
  saveSnapshot({ ...snapshot('couple', 'a'), trip: { ...snapshot('couple', 'a').trip, archived_at: '2026-10-08T12:00:00Z' } }, { remember: false });
  assert.equal(rememberedTripId('couple'), 'b');
  assert.ok(readSnapshot('couple', 'a')?.trip.archived_at);
});
test('signout removes old orphan snapshots from before the multi-trip cache manifest existed', () => {
  localStorage.clear();
  saveSnapshot(snapshot('couple', 'a'));
  saveSnapshot(snapshot('couple', 'b'));
  const storage = globalThis.localStorage as unknown as MemoryStorage;
  storage.removeItem(storage.keys().find(item => item.endsWith(':couple:snapshots'))!);
  clearSnapshot('couple');
  assert.equal(readSnapshot('couple', 'a'), null);
  assert.equal(readSnapshot('couple', 'b'), null);
});
