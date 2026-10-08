import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSnapshot, readOfflineSnapshot, readSnapshot, saveSnapshot, type Snapshot } from '../lib/storage';
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
  keys() { return [...this.items.keys()]; }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
const snapshot = (userId: string, tripId: string): Snapshot => ({ userId, role: 'member', syncedAt: '2026-10-08T12:00:00Z', trip: { id: tripId, name: 'Nossa Viagem', destination: '', start_date: null, end_date: null, timezone: 'America/Sao_Paulo', person_one: null, person_two: null, version: 1 }, activities: [], expenses: [] });
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
test('disabled browser storage cannot prevent online application use', () => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage unavailable'); } });
  assert.doesNotThrow(() => saveSnapshot(snapshot('session', 'trip')));
  assert.equal(readSnapshot('session'), null);
  assert.equal(readOfflineSnapshot(), null);
  assert.doesNotThrow(() => clearSnapshot('session'));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous });
});
