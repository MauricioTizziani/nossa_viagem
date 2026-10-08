import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSnapshot, readOfflineSnapshot, readSnapshot, saveSnapshot, type Snapshot } from '../lib/storage';
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
const snapshot = (userId: string, tripId: string): Snapshot => ({ userId, role: 'member', syncedAt: '2026-10-08T12:00:00Z', trip: { id: tripId, name: 'Nossa Viagem', destination: '', start_date: null, end_date: null, timezone: 'America/Sao_Paulo', person_one: null, person_two: null, version: 1 }, activities: [] });
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
test('disabled browser storage cannot prevent online application use', () => {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage unavailable'); } });
  assert.doesNotThrow(() => saveSnapshot(snapshot('session', 'trip')));
  assert.equal(readSnapshot('session'), null);
  assert.equal(readOfflineSnapshot(), null);
  assert.doesNotThrow(() => clearSnapshot('session'));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous });
});
