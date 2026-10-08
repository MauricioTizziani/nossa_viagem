'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Activity, ActivityInput, Expense, ExpenseInput, Trip } from './types';
import { coerceInitialBudgetCents } from './budget';
import { clearLegacyInvitation, getSupabase, initializeSession, isConfigured, resetSessionInitialization } from './supabase';
import { clearSnapshot, readOfflineSnapshot, saveSnapshot } from './storage';

export const emptyTrip: Trip = { id: '', name: 'Nossa Viagem', destination: '', start_date: null, end_date: null, timezone: 'America/Sao_Paulo', person_one: null, person_two: null, initial_budget_cents: null, version: 1 };
export const EXPENSES_MIGRATION = '202610080004_gastos.sql';
export const BUDGET_MIGRATION = '202610080005_orcamento_inicial.sql';
function errorCode(error: unknown): string { return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''; }
/** The expense table/RPCs come from migration 004; until it runs, the schedule keeps working. */
function isMissingExpensesSchema(error: unknown): boolean {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  return ['PGRST205', 'PGRST202', '42P01', '42883'].includes(errorCode(error)) && /trip_expenses|save_expense|delete_expense/.test(message);
}
export function friendlyError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  if (message.includes('VERSION_CONFLICT')) return 'Esta informação mudou em outro aparelho. Carregue a versão atual antes de salvar novamente.';
  if (message.includes('ACCESS_DENIED')) return 'Não foi possível abrir a viagem. Tente novamente para conectar este aparelho.';
  if (message.includes('SHARED_TRIP_NOT_CONFIGURED') || message.includes('open_shared_trip')) return 'Falta aplicar a atualização de acesso livre no Supabase: 202610080003_acesso_livre.sql.';
  if (message.includes('EXPENSES_MIGRATION_PENDING') || isMissingExpensesSchema(error)) return `Falta aplicar a atualização de gastos no Supabase: ${EXPENSES_MIGRATION}.`;
  if (message.includes('BUDGET_MIGRATION_PENDING') || message.includes('INVALID_INITIAL_BUDGET') || (errorCode(error) === 'PGRST202' && /update_trip/.test(message) && /initial_budget|touch_budget/.test(message))) return message.includes('INVALID_INITIAL_BUDGET') ? 'Informe um orçamento inicial válido e não negativo.' : `Falta aplicar a atualização de orçamento inicial no Supabase: ${BUDGET_MIGRATION}.`;
  if (message.includes('EXPENSE_ACTIVITY_MISMATCH')) return 'A atividade escolhida não está mais disponível nesta viagem. Atualize os dados e escolha novamente.';
  if (message.includes('trip_expenses_category_check')) return `A categoria não foi aceita pelo banco. Execute novamente ${EXPENSES_MIGRATION} no SQL Editor do Supabase e tente de novo.`;
  if (message.includes('Failed to fetch') || message.includes('Network')) return 'Não conseguimos conectar agora. Seu formulário continua aqui; tente novamente com conexão.';
  if (message.includes('Conecte') || message.includes('primeira vez')) return message;
  return 'Não foi possível concluir. Confira a conexão e a configuração da viagem, e tente novamente.';
}
export function useTravelData() {
  const [trip, setTrip] = useState<Trip>(emptyTrip);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesReady, setExpensesReady] = useState(true);
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>(isConfigured ? 'loading' : 'unconfigured');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const userRef = useRef('');
  const refreshRef = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!isConfigured || !navigator.onLine) return;
    if (refreshRef.current) return refreshRef.current;
    const run = (async () => {
      try {
        const userId = await initializeSession();
        userRef.current = userId;
        const client = getSupabase();
        const access = await client.rpc('open_shared_trip').single();
        if (access.error) throw access.error;
        const membership = access.data as { trip_id: string; role: 'owner' | 'member' };
        if (!membership?.trip_id) throw new Error('SHARED_TRIP_NOT_CONFIGURED');
        const [tripResult, activitiesResult, expensesResult] = await Promise.all([
          client.from('trips').select('*').eq('id', membership.trip_id).single(),
          client.from('activities').select('*').eq('trip_id', membership.trip_id).order('starts_at').order('id'),
          client.from('trip_expenses').select('*').eq('trip_id', membership.trip_id).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).order('id'),
        ]);
        if (tripResult.error) throw tripResult.error;
        if (activitiesResult.error) throw activitiesResult.error;
        let expenseRecords: Expense[] = [];
        let expensesAvailable = true;
        if (expensesResult.error) {
          if (!isMissingExpensesSchema(expensesResult.error)) throw expensesResult.error;
          expensesAvailable = false;
        } else expenseRecords = expensesResult.data as Expense[];
        const currentTrip = { ...tripResult.data, destination: tripResult.data.destination ?? '', initial_budget_cents: coerceInitialBudgetCents(tripResult.data.initial_budget_cents) } as Trip;
        const records = activitiesResult.data as Activity[];
        const timestamp = new Date().toISOString();
        saveSnapshot({ trip: currentTrip, activities: records, expenses: expenseRecords, userId, role: membership.role, syncedAt: timestamp });
        if (alive.current) { setTrip(currentTrip); setActivities(records); setExpenses(expenseRecords); setExpensesReady(expensesAvailable); setRole(membership.role); setSyncedAt(timestamp); setStatus('ready'); setError(''); }
      } catch (err) {
        if (alive.current) { setError(friendlyError(err)); setStatus(s => s === 'ready' ? s : 'error'); }
      }
    })();
    refreshRef.current = run;
    try { await run; } finally { refreshRef.current = null; }
  }, []);

  useEffect(() => {
    alive.current = true;
    clearLegacyInvitation();
    setOnline(navigator.onLine);
    if (isConfigured) {
      void (async () => {
        try {
          // Offline consultation must not wait for a network refresh of an expired JWT.
          if (!navigator.onLine) {
            const cached = readOfflineSnapshot();
            if (!cached) throw new Error('Abra a viagem com conexão pela primeira vez neste aparelho.');
            userRef.current = cached.userId;
            if (!alive.current) return;
            setTrip({ ...cached.trip, destination: cached.trip.destination ?? '' }); setActivities(cached.activities); setExpenses(cached.expenses); setRole(cached.role); setSyncedAt(cached.syncedAt); setStatus('ready');
            return;
          }
          userRef.current = await initializeSession();
          await refresh();
        } catch (err) { if (alive.current) { setError(friendlyError(err)); setStatus('error'); } }
      })();
    }
    const connected = () => { setOnline(true); void refresh(); };
    const disconnected = () => setOnline(false);
    const focused = () => { if (navigator.onLine) void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') focused(); };
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected); window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', visible);
    const auth = isConfigured ? getSupabase().auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        if (userRef.current) clearSnapshot(userRef.current);
        resetSessionInitialization();
        userRef.current = ''; setTrip(emptyTrip); setActivities([]); setExpenses([]); setStatus('error');
        setError('A conexão deste aparelho foi reiniciada. Toque em Tentar novamente para abrir a viagem.');
      }
    }) : null;
    return () => { alive.current = false; window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', visible); auth?.data.subscription.unsubscribe(); };
  }, [refresh]);

  useEffect(() => {
    if (!trip.id || !isConfigured) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 200); };
    const channel = getSupabase().channel(`trip:${trip.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${trip.id}` }, update)
      .subscribe();
    const periodic = setInterval(() => { if (navigator.onLine) void refresh(); }, 60000);
    return () => { clearTimeout(timer); clearInterval(periodic); void getSupabase().removeChannel(channel); };
  }, [trip.id, refresh]);

  function requireWrite() {
    if (!isConfigured) throw new Error('Conecte o Supabase conforme o README para salvar e compartilhar sua viagem.');
    if (!navigator.onLine) throw new Error('Network');
    if (!trip.id || status !== 'ready') throw new Error('ACCESS_DENIED');
  }
  function requireExpenses() {
    requireWrite();
    if (!expensesReady) throw new Error('EXPENSES_MIGRATION_PENDING');
  }
  async function saveActivity(input: ActivityInput, id: string, expectedVersion: number) {
    requireWrite();
    const result = await getSupabase().rpc('save_activity', { p_trip_id: trip.id, p_id: id, p_expected_version: expectedVersion,
      p_starts_at: input.starts_at, p_budget_cents: input.budget_cents, p_name: input.name, p_type: input.type,
      p_place_id: input.place_id, p_manual_place_name: input.manual_place_name, p_manual_place_address: input.manual_place_address, p_manual_place_url: input.manual_place_url,
      p_osm_place_id: input.osm_place_id, p_osm_place_name: input.osm_place_name, p_osm_place_address: input.osm_place_address,
      p_osm_latitude: input.osm_latitude, p_osm_longitude: input.osm_longitude });
    if (result.error) throw result.error;
    await refreshRef.current;
    await refresh();
  }
  async function deleteActivity(activity: Activity) {
    requireWrite();
    const result = await getSupabase().rpc('delete_activity', { p_id: activity.id, p_expected_version: activity.version });
    if (result.error) throw result.error;
    await refreshRef.current;
    await refresh();
  }
  /** Resolves only after the server confirmed the record and the lists were refreshed. */
  async function saveExpense(input: ExpenseInput, id: string, expectedVersion: number): Promise<Expense> {
    requireExpenses();
    const result = await getSupabase().rpc('save_expense', { p_trip_id: trip.id, p_id: id, p_expected_version: expectedVersion,
      p_description: input.description, p_category: input.category, p_amount_cents: input.amount_cents, p_expense_date: input.expense_date,
      p_activity_id: input.activity_id, p_notes: input.notes });
    if (result.error) throw result.error;
    await refreshRef.current;
    await refresh();
    return (Array.isArray(result.data) ? result.data[0] : result.data) as Expense;
  }
  async function deleteExpense(expense: Expense) {
    requireExpenses();
    const result = await getSupabase().rpc('delete_expense', { p_id: expense.id, p_expected_version: expense.version });
    if (result.error) throw result.error;
    await refreshRef.current;
    await refresh();
  }
  async function updateTrip(values: Omit<Trip, 'id' | 'version'>, expectedVersion: number, options: { touchBudget: boolean }) {
    requireWrite();
    const base = { p_id: trip.id, p_expected_version: expectedVersion,
      p_name: values.name, p_destination: values.destination, p_start_date: values.start_date, p_end_date: values.end_date,
      p_timezone: values.timezone, p_person_one: values.person_one, p_person_two: values.person_two };
    // Omitting the new arguments keeps older databases able to save the rest of the trip.
    const args = options.touchBudget ? { ...base, p_initial_budget_cents: values.initial_budget_cents, p_touch_budget: true } : base;
    const result = await getSupabase().rpc('update_trip', args);
    if (result.error && options.touchBudget && (errorCode(result.error) === 'PGRST202' || String(result.error.message ?? '').includes('schema cache'))) throw new Error('BUDGET_MIGRATION_PENDING');
    if (result.error) throw result.error;
    await refreshRef.current;
    await refresh();
  }
  async function latestActivity(id: string): Promise<Activity> {
    requireWrite();
    const result = await getSupabase().from('activities').select('*').eq('id', id).eq('trip_id', trip.id).single();
    if (result.error) throw new Error('A atividade não está mais disponível. Atualize o cronograma.');
    return result.data as Activity;
  }
  async function latestExpense(id: string): Promise<Expense> {
    requireExpenses();
    const result = await getSupabase().from('trip_expenses').select('*').eq('id', id).eq('trip_id', trip.id).single();
    if (result.error) throw new Error('Este gasto não está mais disponível. Atualize a lista de gastos.');
    return result.data as Expense;
  }
  async function latestTrip(): Promise<Trip> {
    requireWrite();
    const result = await getSupabase().from('trips').select('*').eq('id', trip.id).single();
    if (result.error) throw result.error;
    return { ...result.data, destination: result.data.destination ?? '', initial_budget_cents: coerceInitialBudgetCents(result.data.initial_budget_cents) } as Trip;
  }
  return { trip, activities, expenses, expensesReady, role, status, error, online, syncedAt, refresh, saveActivity, deleteActivity, saveExpense, deleteExpense, updateTrip, latestActivity, latestExpense, latestTrip };
}
