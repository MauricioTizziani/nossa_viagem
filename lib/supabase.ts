import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const isConfigured = Boolean(url && key);
let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!url || !key) throw new Error('Conecte o Supabase conforme o README para salvar e compartilhar suas viagens.');
  if (!client) client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'nossa-viagem/2.0' }, fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return client;
}
let initialization: Promise<string> | null = null;
let invitation: { scope: 'trip' | 'collection'; token: string } | null = null;
let redeemedInvitation: { scope: 'trip' | 'collection'; id: string } | null = null;
export function resetSessionInitialization() { initialization = null; redeemedInvitation = null; }
/** Consume private fragments synchronously, before network/auth requests begin. */
export function captureInvitation() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const tripToken = params.get('convite');
  const collectionToken = params.get('colecao');
  const explicitToken = params.get('invite');
  const explicitScope = params.get('scope');
  const token = collectionToken ?? tripToken ?? explicitToken;
  if (!token) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if ([tripToken, collectionToken, explicitToken].filter(Boolean).length > 1 || (explicitToken && explicitScope !== 'trip' && explicitScope !== 'collection')) {
    invitation = null;
    throw new Error('INVALID_INVITE');
  }
  invitation = { scope: collectionToken ? 'collection' : tripToken ? 'trip' : explicitScope as 'trip' | 'collection', token };
  // A new invitation must also be redeemed in an already initialized anonymous session.
  initialization = null;
}
/** Historical name retained for existing clients; tokens are redeemed, never silently widened. */
export function clearLegacyInvitation() { captureInvitation(); }
export function takeRedeemedInvitation() {
  const result = redeemedInvitation;
  redeemedInvitation = null;
  return result;
}
export async function initializeSession(): Promise<string> {
  captureInvitation();
  if (initialization) return initialization;
  initialization = (async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    let session = data.session;
    if (!session) {
      if (!navigator.onLine) throw new Error('Abra as viagens com conexão pela primeira vez neste aparelho.');
      const result = await supabase.auth.signInAnonymously();
      if (result.error) { if (String(result.error.message).includes('INVALID_INVITE')) invitation = null; throw result.error; }
      session = result.data.session;
    }
    if (!session) throw new Error('Não foi possível conectar este aparelho. Tente novamente.');
    if (invitation) {
      if (!navigator.onLine) throw new Error('Conecte-se para confirmar este convite privado.');
      const pending = invitation;
      const result = await supabase.rpc(pending.scope === 'collection' ? 'redeem_collection_invite' : 'redeem_trip_invite', { p_token: pending.token });
      if (result.error) { if (String(result.error.message).includes('INVALID_INVITE')) invitation = null; throw result.error; }
      const id = Array.isArray(result.data) ? result.data[0] : result.data;
      if (typeof id !== 'string') throw new Error('INVALID_INVITE');
      redeemedInvitation = { scope: pending.scope, id };
      invitation = null;
    }
    return session.user.id;
  })();
  try { return await initialization; } catch (error) { initialization = null; throw error; }
}
