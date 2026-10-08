'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Activity, ActivityInput, Expense, ExpenseInput, Trip, AccessRole, AuthorizedCollection } from './types';
import { coerceInitialBudgetCents } from './budget';
import { getSupabase, initializeSession, isConfigured, resetSessionInitialization } from './supabase';
import { clearSnapshot, readOfflineSnapshot, readOfflineUserId, saveSnapshot } from './storage';
import { readAllPages, responseBelongsToRequest } from './dataQueries';

export const emptyTrip: Trip = { id: '', name: '', destination: '', start_date: null, end_date: null, timezone: 'America/Sao_Paulo', person_one: null, person_two: null, initial_budget_cents: null, collection_id: null, archived_at: null, version: 1 };
export const EXPENSES_MIGRATION = '202610080004_gastos.sql';
export const BUDGET_MIGRATION = '202610080005_orcamento_inicial.sql';
export const MULTI_TRIP_MIGRATION = '202610080006_multiplas_viagens.sql';
function errorCode(error: unknown): string { return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''; }
function messageOf(error: unknown): string { return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error); }
function isMissingExpensesSchema(error: unknown): boolean {
  return ['PGRST205', 'PGRST202', '42P01', '42883'].includes(errorCode(error)) && /trip_expenses|save_expense|delete_expense/.test(messageOf(error));
}
function isAccessDenied(error: unknown) { return messageOf(error).includes('ACCESS_DENIED') || errorCode(error) === '42501'; }
export function friendlyError(error: unknown): string {
  const message = messageOf(error);
  if (message.includes('SYNC_BUSY')) return 'Esta viagem está recebendo alterações em outro aparelho. Atualize os dados novamente para carregar os totais completos.';
  if (message.includes('VERSION_CONFLICT')) return 'Esta informação mudou em outro aparelho. Carregue a versão atual antes de salvar novamente.';
  if (message.includes('ACCESS_DENIED')) return 'Este aparelho não tem mais acesso a esta viagem. Abra Minhas viagens para ver as viagens autorizadas.';
  if (/INVALID_INVITE|INVITE_EXPIRED|INVITE_REVOKED|INVITE_EXHAUSTED|INVITE_USED/.test(message)) return 'Este convite não está disponível. Peça um novo convite privado ao aparelho autorizado.';
  if (message.includes('EXPENSES_MIGRATION_PENDING') || isMissingExpensesSchema(error)) return `Falta aplicar a atualização de gastos no Supabase: ${EXPENSES_MIGRATION}.`;
  if (message.includes('BUDGET_MIGRATION_PENDING') || message.includes('INVALID_INITIAL_BUDGET') || (errorCode(error) === 'PGRST202' && /update_trip/.test(message) && /initial_budget|touch_budget/.test(message))) return message.includes('INVALID_INITIAL_BUDGET') ? 'Informe um orçamento inicial válido e não negativo.' : `Falta aplicar a atualização de orçamento inicial no Supabase: ${BUDGET_MIGRATION}.`;
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(errorCode(error)) && /list_authorized|create_private_trip|set_trip_archived|collection_invite|collection_id|archived_at/.test(message)) return `Falta aplicar a atualização de múltiplas viagens no Supabase: ${MULTI_TRIP_MIGRATION}.`;
  if (message.includes('EXPENSE_ACTIVITY_MISMATCH')) return 'A atividade escolhida não está disponível nesta viagem. Atualize os dados e escolha novamente.';
  if (message.includes('trip_expenses_category_check')) return `A categoria não foi aceita pelo banco. Execute novamente ${EXPENSES_MIGRATION} no SQL Editor do Supabase e tente de novo.`;
  if (/Failed to fetch|Network|fetch failed/.test(message)) return 'Não conseguimos conectar agora. Seu formulário continua aqui; tente novamente com conexão.';
  if (/Conecte|primeira vez|sincronizada|formulário|viagem aberta/.test(message)) return message;
  return 'Não foi possível concluir. Confira a conexão e a configuração das viagens, e tente novamente.';
}
export function normalizeTrip(value: Trip): Trip {
  return { ...value, destination: value.destination ?? '', initial_budget_cents: coerceInitialBudgetCents(value.initial_budget_cents), collection_id: value.collection_id ?? null, archived_at: value.archived_at ?? null };
}
type DataStatus = 'loading' | 'ready' | 'unconfigured' | 'error' | 'inaccessible';
export function useTravelData(tripId: string) {
  const [trip, setTrip] = useState<Trip>(emptyTrip);
  const [stateTripId, setStateTripId] = useState(tripId);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesReady, setExpensesReady] = useState(true);
  const [role, setRole] = useState<AccessRole>('member');
  const [collectionRole, setCollectionRole] = useState<AccessRole | null>(null);
  const [status, setStatus] = useState<DataStatus>(isConfigured ? 'loading' : 'unconfigured');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [offlinePartial, setOfflinePartial] = useState(false);
  const userRef = useRef('');
  const scope = useRef({ tripId, generation: 0 });
  if (scope.current.tripId !== tripId) scope.current = { tripId, generation: scope.current.generation + 1 };
  const refreshRef = useRef<{ tripId: string; generation: number; promise: Promise<void> } | null>(null);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const consistencyRetries = useRef(0);

  const refresh = useCallback(async () => {
    if (!isConfigured || !navigator.onLine || !tripId) return;
    const request = { ...scope.current };
    if (request.tripId !== tripId) return;
    const current = () => alive.current && responseBelongsToRequest(request, scope.current);
    const pending = refreshRef.current;
    if (pending && responseBelongsToRequest(request, pending) && !controller.current?.signal.aborted) return pending.promise;
    const abort = new AbortController();
    controller.current?.abort(); controller.current = abort;
    const run = (async () => {
      try {
        const userId = await initializeSession();
        if (!current()) return;
        const cachedUserId = readOfflineUserId();
        if (cachedUserId && cachedUserId !== userId) clearSnapshot(cachedUserId);
        userRef.current = userId;
        const client = getSupabase();
        const tripResult = await client.from('trips').select('*').eq('id', tripId).abortSignal(abort.signal).maybeSingle();
        if (tripResult.error) throw tripResult.error;
        if (!tripResult.data) throw new Error('ACCESS_DENIED');
        const currentTrip = normalizeTrip(tripResult.data as Trip);
        const [records, expenseResult, membership, collections] = await Promise.all([
          readAllPages<Activity>(async (offset, size) => await client.from('activities').select('*').eq('trip_id', tripId).order('id').range(offset, offset + size - 1).abortSignal(abort.signal)),
          readAllPages<Expense>(async (offset, size) => await client.from('trip_expenses').select('*').eq('trip_id', tripId).order('id').range(offset, offset + size - 1).abortSignal(abort.signal)).then(data => ({ data, available: true }), err => { if (isMissingExpensesSchema(err)) return { data: [] as Expense[], available: false }; throw err; }),
          client.from('trip_members').select('role').eq('trip_id', tripId).eq('user_id', userId).abortSignal(abort.signal).maybeSingle(),
          client.rpc('list_authorized_collections').abortSignal(abort.signal),
        ]);
        if (membership.error) throw membership.error;
        if (collections.error) throw collections.error;
        if (records.some(row => row.trip_id !== tripId) || expenseResult.data.some(row => row.trip_id !== tripId)) throw new Error('ACCESS_DENIED');
        // Recheck after pagination: a revocation while reading must not produce a new private snapshot.
        const confirmation = await client.from('trips').select('id,version,updated_at').eq('id', tripId).abortSignal(abort.signal).maybeSingle();
        if (confirmation.error) throw confirmation.error;
        if (!confirmation.data) throw new Error('ACCESS_DENIED');
        if (!current()) return;
        if (confirmation.data.version !== currentTrip.version || confirmation.data.updated_at !== currentTrip.updated_at) {
          // Activity/expense writes touch updated_at without conflicting with metadata edits.
          if (consistencyRetries.current >= 2) { consistencyRetries.current = 0; throw new Error('SYNC_BUSY'); }
          consistencyRetries.current++;
          setTimeout(() => { if (current()) void refresh(); }, 0);
          return;
        }
        consistencyRetries.current = 0;
        const currentCollectionRole = (collections.data as AuthorizedCollection[]).find(item => item.id === currentTrip.collection_id)?.role ?? null;
        const currentRole: AccessRole = membership.data?.role === 'owner' || currentCollectionRole === 'owner' ? 'owner' : 'member';
        const timestamp = new Date().toISOString();
        saveSnapshot({ trip: currentTrip, activities: records, expenses: expenseResult.data, userId, role: currentRole, syncedAt: timestamp, complete: expenseResult.available, expensesReady: expenseResult.available });
        setTrip(currentTrip); setActivities(records); setExpenses(expenseResult.data); setExpensesReady(expenseResult.available); setRole(currentRole); setCollectionRole(currentCollectionRole); setSyncedAt(timestamp); setOfflinePartial(!expenseResult.available); setStatus('ready'); setError('');
      } catch (err) {
        if (!current() || abort.signal.aborted) return;
        if (isAccessDenied(err)) {
          if (userRef.current) clearSnapshot(userRef.current, tripId);
          setTrip(emptyTrip); setActivities([]); setExpenses([]); setSyncedAt(null); setCollectionRole(null); setStatus('inaccessible');
        } else setStatus(previous => previous === 'ready' ? previous : 'error');
        setError(friendlyError(err));
      }
    })();
    refreshRef.current = { ...request, promise: run };
    try { await run; } finally { if (refreshRef.current?.promise === run) refreshRef.current = null; }
  }, [tripId]);

  useEffect(() => {
    alive.current = true;
    const request = { ...scope.current };
    consistencyRetries.current = 0;
    setStateTripId(tripId); setTrip(emptyTrip); setActivities([]); setExpenses([]); setSyncedAt(null); setCollectionRole(null); setOfflinePartial(false); setError(''); setStatus(isConfigured ? 'loading' : 'unconfigured');
    setOnline(navigator.onLine);
    const restoreOffline = () => {
      const cached = readOfflineSnapshot(tripId);
      if (!cached) { setError('Esta viagem ainda não foi sincronizada neste aparelho. Abra-a com conexão para consultar offline.'); setStatus('error'); return; }
      userRef.current = cached.userId;
      if (!responseBelongsToRequest(request, scope.current)) return;
      setTrip(normalizeTrip(cached.trip)); setActivities(cached.activities); setExpenses(cached.expenses); setExpensesReady(cached.expensesReady ?? false); setRole(cached.role); setSyncedAt(cached.syncedAt); setOfflinePartial(cached.complete !== true); setStatus('ready');
    };
    if (isConfigured) { if (navigator.onLine) void refresh(); else restoreOffline(); }
    const connected = () => { setOnline(true); void refresh(); };
    const disconnected = () => setOnline(false);
    const focused = () => { if (navigator.onLine) void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') focused(); };
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected); window.addEventListener('focus', focused); document.addEventListener('visibilitychange', visible);
    const auth = isConfigured ? getSupabase().auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION') || (session && userRef.current && session.user.id !== userRef.current)) {
        if (userRef.current) clearSnapshot(userRef.current);
        resetSessionInitialization(); controller.current?.abort(); scope.current.generation++;
        userRef.current = ''; setTrip(emptyTrip); setActivities([]); setExpenses([]); setSyncedAt(null); setStatus('inaccessible');
        setError('A sessão deste aparelho mudou. Abra Minhas viagens para conectar novamente.');
      }
    }) : null;
    return () => { alive.current = false; controller.current?.abort(); window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', visible); auth?.data.subscription.unsubscribe(); };
  }, [tripId, refresh]);

  useEffect(() => {
    if (trip.id !== tripId || !tripId || !isConfigured || status !== 'ready') return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 200); };
    const channel = getSupabase().channel(`trip:${tripId}:${userRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` }, update)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter: `trip_id=eq.${tripId}` }, update)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_expenses', filter: `trip_id=eq.${tripId}` }, update).subscribe();
    const periodic = setInterval(() => { if (navigator.onLine) void refresh(); }, 60000);
    return () => { clearTimeout(timer); clearInterval(periodic); void getSupabase().removeChannel(channel); };
  }, [trip.id, tripId, status, refresh]);

  function requireWrite() {
    if (!isConfigured) throw new Error('Conecte o Supabase conforme o README para salvar suas viagens.');
    if (!navigator.onLine) throw new Error('Network');
    if (!tripId || trip.id !== tripId || scope.current.tripId !== tripId || status !== 'ready') throw new Error('ACCESS_DENIED');
  }
  function requireExpenses() { requireWrite(); if (!expensesReady) throw new Error('EXPENSES_MIGRATION_PENDING'); }
  function failWrite(err: unknown): never {
    if (isAccessDenied(err) && scope.current.tripId === tripId) {
      if (userRef.current) clearSnapshot(userRef.current, tripId);
      controller.current?.abort(); scope.current.generation++;
      setTrip(emptyTrip); setActivities([]); setExpenses([]); setSyncedAt(null); setCollectionRole(null); setStatus('inaccessible'); setError(friendlyError(err));
    }
    throw err;
  }
  async function afterWrite() {
    const pending = refreshRef.current;
    if (pending?.tripId === tripId) await pending.promise;
    if (scope.current.tripId === tripId) await refresh();
  }
  async function saveActivity(input: ActivityInput, id: string, expectedVersion: number) {
    requireWrite();
    const result = await getSupabase().rpc('save_activity', { p_trip_id: tripId, p_id: id, p_expected_version: expectedVersion, p_starts_at: input.starts_at, p_budget_cents: input.budget_cents, p_name: input.name, p_type: input.type,
      p_place_id: input.place_id, p_manual_place_name: input.manual_place_name, p_manual_place_address: input.manual_place_address, p_manual_place_url: input.manual_place_url, p_osm_place_id: input.osm_place_id, p_osm_place_name: input.osm_place_name, p_osm_place_address: input.osm_place_address, p_osm_latitude: input.osm_latitude, p_osm_longitude: input.osm_longitude });
    if (result.error) failWrite(result.error); await afterWrite();
  }
  async function deleteActivity(activity: Activity) {
    requireWrite(); if (activity.trip_id !== tripId) throw new Error('ACCESS_DENIED');
    const result = await getSupabase().rpc('delete_activity', { p_id: activity.id, p_expected_version: activity.version });
    if (result.error) failWrite(result.error); await afterWrite();
  }
  async function saveExpense(input: ExpenseInput, id: string, expectedVersion: number): Promise<Expense> {
    requireExpenses();
    if (input.activity_id && !activities.some(item => item.id === input.activity_id && item.trip_id === tripId)) throw new Error('EXPENSE_ACTIVITY_MISMATCH');
    const result = await getSupabase().rpc('save_expense', { p_trip_id: tripId, p_id: id, p_expected_version: expectedVersion, p_description: input.description, p_category: input.category, p_amount_cents: input.amount_cents, p_expense_date: input.expense_date, p_activity_id: input.activity_id, p_notes: input.notes });
    if (result.error) failWrite(result.error); await afterWrite(); return (Array.isArray(result.data) ? result.data[0] : result.data) as Expense;
  }
  async function deleteExpense(expense: Expense) {
    requireExpenses(); if (expense.trip_id !== tripId) throw new Error('ACCESS_DENIED');
    const result = await getSupabase().rpc('delete_expense', { p_id: expense.id, p_expected_version: expense.version });
    if (result.error) failWrite(result.error); await afterWrite();
  }
  async function updateTrip(values: Omit<Trip, 'id' | 'version'>, expectedVersion: number, options: { touchBudget: boolean }) {
    requireWrite();
    const base = { p_id: tripId, p_expected_version: expectedVersion, p_name: values.name, p_destination: values.destination, p_start_date: values.start_date, p_end_date: values.end_date, p_timezone: values.timezone, p_person_one: values.person_one, p_person_two: values.person_two };
    const result = await getSupabase().rpc('update_trip', options.touchBudget ? { ...base, p_initial_budget_cents: values.initial_budget_cents, p_touch_budget: true } : base);
    if (result.error && options.touchBudget && (errorCode(result.error) === 'PGRST202' || String(result.error.message ?? '').includes('schema cache'))) throw new Error('BUDGET_MIGRATION_PENDING');
    if (result.error) failWrite(result.error); await afterWrite();
  }
  async function latestActivity(id: string): Promise<Activity> {
    requireWrite(); const result = await getSupabase().from('activities').select('*').eq('id', id).eq('trip_id', tripId).single();
    if (result.error) throw new Error('A atividade não está mais disponível. Atualize o cronograma.'); return result.data as Activity;
  }
  async function latestExpense(id: string): Promise<Expense> {
    requireExpenses(); const result = await getSupabase().from('trip_expenses').select('*').eq('id', id).eq('trip_id', tripId).single();
    if (result.error) throw new Error('Este gasto não está mais disponível. Atualize a lista de gastos.'); return result.data as Expense;
  }
  async function latestTrip(): Promise<Trip> {
    requireWrite(); const result = await getSupabase().from('trips').select('*').eq('id', tripId).single();
    if (result.error) failWrite(errorCode(result.error) === 'PGRST116' ? new Error('ACCESS_DENIED') : result.error); return normalizeTrip(result.data as Trip);
  }
  // Hide the previous route synchronously, before the next effect or request can run.
  const selected = trip.id === tripId;
  return { trip: selected ? trip : emptyTrip, activities: selected ? activities : [], expenses: selected ? expenses : [], expensesReady: selected && expensesReady, role: selected ? role : 'member' as AccessRole, collectionRole: selected ? collectionRole : null,
    status: stateTripId !== tripId || (!selected && status === 'ready') ? (isConfigured ? 'loading' : 'unconfigured') as DataStatus : status, error: selected || status !== 'ready' ? error : '', online, syncedAt: selected ? syncedAt : null, offlinePartial: selected && offlinePartial, refresh, saveActivity, deleteActivity, saveExpense, deleteExpense, updateTrip, latestActivity, latestExpense, latestTrip };
}
