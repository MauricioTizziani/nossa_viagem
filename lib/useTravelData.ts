'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Activity, ActivityInput, Trip } from './types';
import { captureInvitation, getSupabase, initializeSession, isConfigured, resetSessionInitialization } from './supabase';
import { clearSnapshot, readSnapshot, readOfflineSnapshot, saveSnapshot } from './storage';

export const emptyTrip: Trip = { id: '', name: 'Nossa Viagem', destination: '', start_date: null, end_date: null, timezone: 'America/Sao_Paulo', person_one: null, person_two: null, version: 1 };
export function friendlyError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  if (message.includes('VERSION_CONFLICT')) return 'Esta informação mudou em outro aparelho. Carregue a versão atual antes de salvar novamente.';
  if (message.includes('ACCESS_DENIED')) return 'Este aparelho não tem mais acesso à viagem. Peça um novo convite ao proprietário.';
  if (message.includes('Failed to fetch') || message.includes('Network')) return 'Não conseguimos conectar agora. Seu formulário continua aqui; tente novamente com conexão.';
  if (message.includes('convite') || message.includes('Conecte') || message.includes('primeira vez')) return message;
  return 'Não foi possível concluir. Confira a conexão e a configuração da viagem, e tente novamente.';
}
export function useTravelData() {
  const [trip, setTrip] = useState<Trip>(emptyTrip);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfigured' | 'unauthorized' | 'error'>(isConfigured ? 'loading' : 'unconfigured');
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
        const memberships = await client.from('trip_members').select('trip_id,role').eq('user_id', userId);
        if (memberships.error) throw memberships.error;
        const preferred = readSnapshot(userId)?.trip.id;
        const membership = memberships.data?.find(m => m.trip_id === preferred) ?? memberships.data?.[0];
        if (!membership) {
          clearSnapshot(userId);
          if (alive.current) { setTrip(emptyTrip); setActivities([]); setStatus('unauthorized'); setError(''); }
          return;
        }
        const [tripResult, activitiesResult] = await Promise.all([
          client.from('trips').select('*').eq('id', membership.trip_id).single(),
          client.from('activities').select('*').eq('trip_id', membership.trip_id).order('starts_at').order('id'),
        ]);
        if (tripResult.error) throw tripResult.error;
        if (activitiesResult.error) throw activitiesResult.error;
        const currentTrip = { ...tripResult.data, destination: tripResult.data.destination ?? '' } as Trip;
        const records = activitiesResult.data as Activity[];
        const timestamp = new Date().toISOString();
        saveSnapshot({ trip: currentTrip, activities: records, userId, role: membership.role, syncedAt: timestamp });
        if (alive.current) { setTrip(currentTrip); setActivities(records); setRole(membership.role); setSyncedAt(timestamp); setStatus('ready'); setError(''); }
      } catch (err) {
        if (alive.current) { setError(friendlyError(err)); setStatus(s => s === 'ready' ? s : 'error'); }
      }
    })();
    refreshRef.current = run;
    try { await run; } finally { refreshRef.current = null; }
  }, []);

  useEffect(() => {
    alive.current = true;
    captureInvitation();
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
            setTrip({ ...cached.trip, destination: cached.trip.destination ?? '' }); setActivities(cached.activities); setRole(cached.role); setSyncedAt(cached.syncedAt); setStatus('ready');
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
        userRef.current = ''; setTrip(emptyTrip); setActivities([]); setStatus('unauthorized');
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
  async function updateTrip(values: Omit<Trip, 'id' | 'version'>, expectedVersion: number) {
    requireWrite();
    const result = await getSupabase().rpc('update_trip', { p_id: trip.id, p_expected_version: expectedVersion,
      p_name: values.name, p_destination: values.destination, p_start_date: values.start_date, p_end_date: values.end_date,
      p_timezone: values.timezone, p_person_one: values.person_one, p_person_two: values.person_two });
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
  async function latestTrip(): Promise<Trip> {
    requireWrite();
    const result = await getSupabase().from('trips').select('*').eq('id', trip.id).single();
    if (result.error) throw result.error;
    return { ...result.data, destination: result.data.destination ?? '' } as Trip;
  }
  return { trip, activities, role, status, error, online, syncedAt, refresh, saveActivity, deleteActivity, updateTrip, latestActivity, latestTrip };
}
