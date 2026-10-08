import type { Trip, Activity, Expense, TripCard, AuthorizedCollection } from './types';
import { coerceInitialBudgetCents } from './budget';
export type Snapshot = { trip: Trip; activities: Activity[]; expenses: Expense[]; syncedAt: string; userId: string; role: 'owner' | 'member'; complete?: boolean; expensesReady?: boolean };
export type TripsSnapshot = { trips: TripCard[]; collections: AuthorizedCollection[]; syncedAt: string; userId: string; complete: boolean };
const project = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'unconfigured';
// Retain the namespace to keep this device's previously authorized snapshot readable.
const prefix = `nossa-viagem:v1:${project}:`;
function snapshotKey(userId: string, tripId: string) { return `${prefix}${userId}:${tripId}`; }
function indexKey(userId: string) { return `${prefix}${userId}:active`; }
function manifestKey(userId: string) { return `${prefix}${userId}:snapshots`; }
function tripsKey(userId: string) { return `${prefix}${userId}:trips`; }
const authorizedDeviceKey = `${prefix}authorized-device`;
function tripIds(userId: string): string[] {
  const stored = JSON.parse(localStorage.getItem(manifestKey(userId)) ?? '[]');
  const ids: string[] = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  // Also find older snapshots whose active pointer was replaced before the manifest existed.
  const userPrefix = `${prefix}${userId}:`;
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(userPrefix)) continue;
    const id = key.slice(userPrefix.length);
    if (!['active', 'snapshots', 'trips'].includes(id)) ids.push(id);
  }
  const legacyId = localStorage.getItem(indexKey(userId));
  return [...new Set([...ids, ...(legacyId ? [legacyId] : [])])];
}
/** Local identity is a cache namespace, never a server authorization. */
export function readOfflineUserId(): string | null {
  try { return localStorage.getItem(authorizedDeviceKey); } catch { return null; }
}
export function saveSnapshot(value: Snapshot, options: { remember?: boolean } = {}) {
  try {
    if (value.activities.some(item => item.trip_id !== value.trip.id) || value.expenses.some(item => item.trip_id !== value.trip.id)) return;
    localStorage.setItem(snapshotKey(value.userId, value.trip.id), JSON.stringify(value));
    localStorage.setItem(manifestKey(value.userId), JSON.stringify([...new Set([...tripIds(value.userId), value.trip.id])]));
    if (options.remember !== false) localStorage.setItem(indexKey(value.userId), value.trip.id);
    if (options.remember !== false) localStorage.setItem(authorizedDeviceKey, value.userId);
  } catch { /* Disabled/full storage does not prevent online use. */ }
}
export function readSnapshot(userId: string, selectedTripId?: string): Snapshot | null {
  try {
    const tripId = selectedTripId ?? localStorage.getItem(indexKey(userId));
    if (!tripId) return null;
    const raw = localStorage.getItem(snapshotKey(userId, tripId));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<Snapshot>;
    if (snapshot.userId !== userId || snapshot.trip?.id !== tripId || !Array.isArray(snapshot.activities) || typeof snapshot.syncedAt !== 'string' || !['owner', 'member'].includes(snapshot.role ?? '')) return null;
    if (snapshot.expenses !== undefined && !Array.isArray(snapshot.expenses)) return null;
    const expenses = snapshot.expenses ?? [];
    if (snapshot.activities.some(item => item.trip_id !== tripId) || expenses.some(item => item.trip_id !== tripId)) return null;
    const initial_budget_cents = coerceInitialBudgetCents(snapshot.trip.initial_budget_cents);
    // Older snapshots were unpaginated and may only contain the first server page.
    const complete = snapshot.complete === true;
    return { ...snapshot, trip: { ...snapshot.trip, destination: snapshot.trip.destination ?? '', initial_budget_cents }, expenses, complete, expensesReady: snapshot.expensesReady ?? snapshot.expenses !== undefined } as Snapshot;
  } catch { return null; }
}
export function readOfflineSnapshot(tripId?: string): Snapshot | null {
  const userId = readOfflineUserId();
  return userId ? readSnapshot(userId, tripId) : null;
}
export function readOfflineSnapshots(userId = readOfflineUserId()): Snapshot[] {
  try { return userId ? tripIds(userId).flatMap(id => { const value = readSnapshot(userId, id); return value ? [value] : []; }) : []; }
  catch { return []; }
}
export function clearSnapshot(userId: string, selectedTripId?: string) {
  try {
    const ids = tripIds(userId);
    const remove = selectedTripId ? [selectedTripId] : ids;
    for (const id of remove) localStorage.removeItem(snapshotKey(userId, id));
    const remaining = ids.filter(id => !remove.includes(id));
    if (selectedTripId) {
      localStorage.setItem(manifestKey(userId), JSON.stringify(remaining));
      if (localStorage.getItem(indexKey(userId)) === selectedTripId) localStorage.removeItem(indexKey(userId));
      const list = readTripsSnapshot(userId);
      if (list) localStorage.setItem(tripsKey(userId), JSON.stringify({ ...list, trips: list.trips.filter(trip => trip.id !== selectedTripId) }));
    } else {
      localStorage.removeItem(manifestKey(userId)); localStorage.removeItem(indexKey(userId)); localStorage.removeItem(tripsKey(userId));
      if (localStorage.getItem(authorizedDeviceKey) === userId) localStorage.removeItem(authorizedDeviceKey);
    }
  } catch { /* Best effort with disabled browser storage. */ }
}
export function saveTripsSnapshot(value: TripsSnapshot) {
  try { localStorage.setItem(tripsKey(value.userId), JSON.stringify(value)); localStorage.setItem(authorizedDeviceKey, value.userId); }
  catch { /* Online use continues. */ }
}
export function readTripsSnapshot(userId = readOfflineUserId()): TripsSnapshot | null {
  try {
    if (!userId) return null;
    const raw = localStorage.getItem(tripsKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as TripsSnapshot;
    if (value.userId !== userId || !Array.isArray(value.trips) || !Array.isArray(value.collections) || typeof value.syncedAt !== 'string') return null;
    if (value.trips.some(item => typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.timezone !== 'string' || !['owner', 'member'].includes(item.trip_role) || !Number.isSafeInteger(item.total_spent_cents) || item.total_spent_cents < 0)) return null;
    if (value.collections.some(item => typeof item.id !== 'string' || !['owner', 'member'].includes(item.role))) return null;
    // Reject invalid monetary fields rather than fabricate balances.
    return { ...value, trips: value.trips.map(trip => ({ ...trip, initial_budget_cents: coerceInitialBudgetCents(trip.initial_budget_cents) })) };
  } catch { return null; }
}
/** Apply a fresh RLS-authorized ID set before keeping private offline data. */
export function pruneUnauthorizedSnapshots(userId: string, authorizedIds: Set<string>) {
  try {
    for (const id of tripIds(userId)) if (!authorizedIds.has(id)) clearSnapshot(userId, id);
    const list = readTripsSnapshot(userId);
    if (list) localStorage.setItem(tripsKey(userId), JSON.stringify({ ...list, trips: list.trips.filter(trip => authorizedIds.has(trip.id)) }));
  } catch { /* Best effort with disabled storage. */ }
}
export function rememberedTripId(userId = readOfflineUserId()): string | null {
  try { return userId ? localStorage.getItem(indexKey(userId)) : null; } catch { return null; }
}
