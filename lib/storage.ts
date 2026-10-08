import type { Trip, Activity, Expense } from './types';
export type Snapshot = { trip: Trip; activities: Activity[]; expenses: Expense[]; syncedAt: string; userId: string; role: 'owner' | 'member' };
const project = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'unconfigured';
const prefix = `nossa-viagem:v1:${project}:`;
function snapshotKey(userId: string, tripId: string) { return `${prefix}${userId}:${tripId}`; }
function indexKey(userId: string) { return `${prefix}${userId}:active`; }
const authorizedDeviceKey = `${prefix}authorized-device`;
export function saveSnapshot(value: Snapshot) {
  try {
    localStorage.setItem(snapshotKey(value.userId, value.trip.id), JSON.stringify(value));
    localStorage.setItem(indexKey(value.userId), value.trip.id);
    localStorage.setItem(authorizedDeviceKey, value.userId);
  } catch { /* Storage may be disabled; online use still works. */ }
}
export function readSnapshot(userId: string): Snapshot | null {
  try {
    const tripId = localStorage.getItem(indexKey(userId));
    if (!tripId) return null;
    const raw = localStorage.getItem(snapshotKey(userId, tripId));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<Snapshot> & { expenses?: unknown };
    if (snapshot.userId !== userId || snapshot.trip?.id !== tripId || !Array.isArray(snapshot.activities)) return null;
    // Snapshots saved before the expense control carry no expenses; they stay readable offline.
    if (snapshot.expenses !== undefined && !Array.isArray(snapshot.expenses)) return null;
    return { ...snapshot, expenses: (snapshot.expenses ?? []) as Expense[] } as Snapshot;
  } catch { return null; }
}
export function clearSnapshot(userId: string) {
  try {
    const tripId = localStorage.getItem(indexKey(userId));
    if (tripId) localStorage.removeItem(snapshotKey(userId, tripId));
    localStorage.removeItem(indexKey(userId));
    if (localStorage.getItem(authorizedDeviceKey) === userId) localStorage.removeItem(authorizedDeviceKey);
  } catch { /* Best effort on browsers with disabled storage. */ }
}
/** Previously confirmed device identity; not an authorization for server operations. */
export function readOfflineSnapshot(): Snapshot | null {
  try { const userId = localStorage.getItem(authorizedDeviceKey); return userId ? readSnapshot(userId) : null; }
  catch { return null; }
}
