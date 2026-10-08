'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthorizedCollection, Trip, TripCard, TripInput, TripListFilter } from './types';
import { getSupabase, initializeSession, isConfigured, resetSessionInitialization, takeRedeemedInvitation } from './supabase';
import { clearSnapshot, pruneUnauthorizedSnapshots, readOfflineSnapshots, readOfflineUserId, readSnapshot, readTripsSnapshot, saveSnapshot, saveTripsSnapshot } from './storage';
import { readAllPages } from './dataQueries';
import { friendlyError, normalizeTrip } from './useTravelData';
import { dateKey, validateTripInput } from './domain';
const PAGE_SIZE = 24;
type ListStatus = 'loading' | 'ready' | 'unconfigured' | 'error';
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
function phase(trip: Trip) {
  if (!trip.start_date || !trip.end_date) return 'undated';
  const today = dateKey(new Date(), trip.timezone);
  return today < trip.start_date ? 'upcoming' : today > trip.end_date ? 'past' : 'ongoing';
}
export function filterCachedTrips(trips: TripCard[], search: string, filter: TripListFilter): TripCard[] {
  const query = searchable(search.trim());
  const rank = { ongoing: 0, upcoming: 1, past: 2, undated: 3 };
  return trips.filter(trip => {
    if (filter === 'archived' ? !trip.archived_at : Boolean(trip.archived_at)) return false;
    if (filter !== 'all' && filter !== 'archived' && phase(trip) !== filter) return false;
    return !query || searchable(`${trip.name} ${trip.destination}`).includes(query);
  }).sort((a, b) => {
    const ap = phase(a), bp = phase(b);
    if (rank[ap] !== rank[bp]) return rank[ap] - rank[bp];
    if (ap === 'upcoming') return (a.start_date ?? '').localeCompare(b.start_date ?? '') || a.id.localeCompare(b.id);
    if (ap === 'past') return (b.end_date ?? '').localeCompare(a.end_date ?? '') || a.id.localeCompare(b.id);
    return (a.start_date ?? '').localeCompare(b.start_date ?? '') || a.id.localeCompare(b.id);
  });
}
function normalizeCard(value: TripCard, userId: string): TripCard {
  const amount = Number(value.total_spent_cents);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('INVALID_TOTAL');
  const snapshot = readSnapshot(userId, value.id);
  return { ...normalizeTrip(value), total_spent_cents: amount, trip_role: value.trip_role, collection_role: value.collection_role ?? null, offline_available: snapshot?.complete === true, synced_at: snapshot?.syncedAt ?? null };
}
export function useTrips(options: { search?: string; filter?: TripListFilter } = {}) {
  const search = options.search ?? '';
  const filter = options.filter ?? 'all';
  const [trips, setTrips] = useState<TripCard[]>([]);
  const [collections, setCollections] = useState<AuthorizedCollection[]>([]);
  const [status, setStatus] = useState<ListStatus>(isConfigured ? 'loading' : 'unconfigured');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [offlinePartial, setOfflinePartial] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [invitedTripId, setInvitedTripId] = useState<string | null>(null);
  const alive = useRef(true);
  const userRef = useRef('');
  const generation = useRef(0);
  const requestRef = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const offsetRef = useRef(0);
  const rowsRef = useRef<TripCard[]>([]);
  const createRef = useRef<Promise<Trip> | null>(null);
  const creationIdentity = useRef<{ signature: string; id: string } | null>(null);
  const stateFilter = useRef({ search, filter });
  if (stateFilter.current.search !== search || stateFilter.current.filter !== filter) { stateFilter.current = { search, filter }; generation.current++; }

  const restoreOffline = useCallback(() => {
    const userId = readOfflineUserId();
    const cached = readTripsSnapshot(userId);
    const snapshots = readOfflineSnapshots(userId);
    if (!userId || (!cached && !snapshots.length)) {
      setTrips([]); setCollections([]); setStatus('error'); setError('Abra Minhas viagens com conexão pela primeira vez neste aparelho.'); return;
    }
    userRef.current = userId;
    const cards = new Map((cached?.trips ?? []).map(item => [item.id, item]));
    for (const snapshot of snapshots) {
      const prior = cards.get(snapshot.trip.id);
      const total = snapshot.expenses.reduce((sum, item) => sum + item.amount_cents, 0);
      const priorIsNewer = Boolean(prior && Date.parse(prior.card_synced_at ?? cached?.syncedAt ?? '') >= Date.parse(snapshot.syncedAt));
      cards.set(snapshot.trip.id, { ...(priorIsNewer ? prior! : snapshot.trip), total_spent_cents: priorIsNewer ? prior!.total_spent_cents : total, trip_role: snapshot.role, collection_role: prior?.collection_role ?? null, offline_available: snapshot.complete === true, synced_at: snapshot.syncedAt });
    }
    const result = filterCachedTrips([...cards.values()].map(item => normalizeCard(item, userId)), search, filter);
    rowsRef.current = result; setTrips(result); setCollections(cached?.collections ?? []); setSyncedAt(cached?.syncedAt ?? snapshots[0]?.syncedAt ?? null); setOfflinePartial(true); setHasMore(false); setStatus('ready'); setError('');
  }, [search, filter]);

  const fetchList = useCallback(async (more: boolean) => {
    if (!isConfigured) return;
    if (!navigator.onLine) { restoreOffline(); return; }
    const requestGeneration = generation.current;
    const pending = requestRef.current;
    if (pending?.generation === requestGeneration) return pending.promise;
    const current = () => alive.current && generation.current === requestGeneration;
    const run = (async () => {
      if (more) setLoadingMore(true);
      try {
        const userId = await initializeSession();
        if (!current()) return;
        const cachedUserId = readOfflineUserId();
        if (cachedUserId && cachedUserId !== userId) clearSnapshot(cachedUserId);
        if (userRef.current && userRef.current !== userId) clearSnapshot(userRef.current);
        userRef.current = userId;
        const invited = takeRedeemedInvitation();
        if (invited?.scope === 'trip') setInvitedTripId(invited.id);
        const client = getSupabase();
        const offset = more ? offsetRef.current : 0;
        // The authoritative card total is computed in SQL for the selected trip, over all expenses.
        const [list, collectionResult, ids] = await Promise.all([
          client.rpc('list_authorized_trips', { p_limit: PAGE_SIZE, p_offset: offset, p_search: search.trim() || null, p_filter: filter }),
          client.rpc('list_authorized_collections'),
          more ? Promise.resolve(null) : readAllPages<{ id: string }>(async (pageOffset, size) => await client.from('trips').select('id').order('id').range(pageOffset, pageOffset + size - 1)),
        ]);
        if (list.error) throw list.error;
        if (collectionResult.error) throw collectionResult.error;
        if (!current()) return;
        const authorizedIds = ids ? new Set(ids.map(row => row.id)) : null;
        if (authorizedIds) pruneUnauthorizedSnapshots(userId, authorizedIds);
        const timestamp = new Date().toISOString();
        const page = (list.data as TripCard[]).map(item => ({ ...normalizeCard(item, userId), card_synced_at: timestamp }));
        const visible = more ? [...rowsRef.current, ...page.filter(item => !rowsRef.current.some(prior => prior.id === item.id))] : page;
        rowsRef.current = visible; offsetRef.current = offset + page.length;
        const previous = readTripsSnapshot(userId);
        const all = new Map((previous?.trips ?? []).filter(item => !authorizedIds || authorizedIds.has(item.id)).map(item => [item.id, item]));
        for (const item of page) all.set(item.id, item);
        // A filtered/page-limited list never claims to contain the entire private history offline.
        saveTripsSnapshot({ trips: [...all.values()], collections: collectionResult.data as AuthorizedCollection[], userId, syncedAt: timestamp, complete: filter === 'all' && !search.trim() && page.length < PAGE_SIZE && !more && [...all.values()].every(item => item.offline_available) });
        setTrips(visible); setCollections(collectionResult.data as AuthorizedCollection[]); setSyncedAt(timestamp); setOfflinePartial(false); setHasMore(page.length === PAGE_SIZE); setStatus('ready'); setError('');
      } catch (err) { if (current()) { setError(friendlyError(err)); setStatus(previous => previous === 'ready' ? previous : 'error'); } }
      finally { if (current()) setLoadingMore(false); }
    })();
    requestRef.current = { generation: requestGeneration, promise: run };
    try { await run; } finally { if (requestRef.current?.promise === run) requestRef.current = null; }
  }, [search, filter, restoreOffline]);
  const refresh = useCallback(() => fetchList(false), [fetchList]);
  const loadMore = useCallback(() => hasMore ? fetchList(true) : Promise.resolve(), [fetchList, hasMore]);

  useEffect(() => {
    alive.current = true; generation.current++;
    rowsRef.current = []; offsetRef.current = 0; setTrips([]); setHasMore(false); setLoadingMore(false); setError(''); setStatus(isConfigured ? 'loading' : 'unconfigured'); setOnline(navigator.onLine);
    if (isConfigured) { if (navigator.onLine) void refresh(); else restoreOffline(); }
    const connected = () => { setOnline(true); void refresh(); };
    const disconnected = () => { setOnline(false); restoreOffline(); };
    const focused = () => { if (navigator.onLine) void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') focused(); };
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected); window.addEventListener('focus', focused); document.addEventListener('visibilitychange', visible);
    const auth = isConfigured ? getSupabase().auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION') || (session && userRef.current && session.user.id !== userRef.current)) {
        if (userRef.current) clearSnapshot(userRef.current);
        resetSessionInitialization(); generation.current++; userRef.current = ''; rowsRef.current = []; setTrips([]); setCollections([]); setSyncedAt(null); setStatus('error'); setError('A sessão deste aparelho mudou. Toque em Tentar novamente para conectar.');
      }
    }) : null;
    const periodic = setInterval(focused, 60000);
    return () => { alive.current = false; generation.current++; clearInterval(periodic); window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', visible); auth?.data.subscription.unsubscribe(); };
  }, [refresh, restoreOffline]);

  async function requireWrite() { if (!isConfigured) throw new Error('Conecte o Supabase conforme o README para salvar suas viagens.'); if (!navigator.onLine) throw new Error('Network'); await initializeSession(); }
  function failWrite(err: unknown, selectedId?: string): never {
    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
    if (message.includes('ACCESS_DENIED') && selectedId) {
      if (userRef.current) clearSnapshot(userRef.current, selectedId);
      rowsRef.current = rowsRef.current.filter(item => item.id !== selectedId); setTrips(rowsRef.current); void refresh();
    }
    throw err;
  }
  function updateCachedTrip(updated: Trip) {
    if (!userRef.current) return;
    const snapshot = readSnapshot(userRef.current, updated.id);
    // Metadata was confirmed, but the schedule/expense sync date remains unchanged.
    if (snapshot) saveSnapshot({ ...snapshot, trip: updated }, { remember: false });
    const cached = readTripsSnapshot(userRef.current);
    const timestamp = new Date().toISOString();
    if (cached) saveTripsSnapshot({ ...cached, trips: cached.trips.map(item => item.id === updated.id ? { ...item, ...updated, card_synced_at: timestamp } : item) });
    rowsRef.current = filterCachedTrips(rowsRef.current.map(item => item.id === updated.id ? { ...item, ...updated, card_synced_at: timestamp } : item), search, filter);
    setTrips(rowsRef.current);
  }
  async function refreshAfterWrite() { if (requestRef.current) await requestRef.current.promise; await refresh(); }
  async function createTrip(values: TripInput, collectionId?: string | null): Promise<Trip> {
    if (createRef.current) return createRef.current;
    const valid = validateTripInput(values, { requireInitialBudget: true });
    const signature = JSON.stringify({ valid, collectionId: collectionId ?? null });
    if (creationIdentity.current?.signature !== signature) creationIdentity.current = { signature, id: crypto.randomUUID() };
    const id = creationIdentity.current.id;
    const run = (async () => {
      await requireWrite();
      const result = await getSupabase().rpc('create_private_trip', { p_id: id, p_collection_id: collectionId ?? null, p_name: valid.name, p_destination: valid.destination, p_start_date: valid.start_date, p_end_date: valid.end_date, p_timezone: valid.timezone, p_person_one: valid.person_one, p_person_two: valid.person_two, p_initial_budget_cents: valid.initial_budget_cents });
      if (result.error) failWrite(result.error);
      const created = normalizeTrip((Array.isArray(result.data) ? result.data[0] : result.data) as Trip);
      creationIdentity.current = null;
      await refreshAfterWrite(); return created;
    })();
    createRef.current = run;
    try { return await run; } finally { if (createRef.current === run) createRef.current = null; }
  }
  async function archiveTrip(selectedTrip: Trip, archived: boolean): Promise<Trip> {
    await requireWrite();
    const result = await getSupabase().rpc('set_trip_archived', { p_id: selectedTrip.id, p_expected_version: selectedTrip.version, p_archived: archived });
    if (result.error) failWrite(result.error, selectedTrip.id);
    const updated = normalizeTrip((Array.isArray(result.data) ? result.data[0] : result.data) as Trip);
    updateCachedTrip(updated); await refreshAfterWrite(); return updated;
  }
  async function updateTrip(values: TripInput, selectedTrip: Trip): Promise<Trip> {
    const valid = validateTripInput(values);
    await requireWrite();
    const result = await getSupabase().rpc('update_trip', { p_id: selectedTrip.id, p_expected_version: selectedTrip.version, p_name: valid.name, p_destination: valid.destination, p_start_date: valid.start_date, p_end_date: valid.end_date, p_timezone: valid.timezone, p_person_one: valid.person_one, p_person_two: valid.person_two, p_initial_budget_cents: valid.initial_budget_cents, p_touch_budget: true });
    if (result.error) failWrite(result.error, selectedTrip.id);
    const updated = normalizeTrip((Array.isArray(result.data) ? result.data[0] : result.data) as Trip);
    updateCachedTrip(updated); await refreshAfterWrite(); return updated;
  }
  return { trips, collections, status, error, online, syncedAt, offlinePartial, hasMore, loadingMore, invitedTripId, refresh, loadMore, createTrip, archiveTrip, setArchived: archiveTrip, updateTrip };
}
