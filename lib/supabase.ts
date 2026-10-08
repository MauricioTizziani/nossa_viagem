import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const isConfigured = Boolean(url && key);
let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!url || !key) throw new Error('Conecte o Supabase conforme o README para salvar e compartilhar sua viagem.');
  if (!client) client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'nossa-viagem/1.0' }, fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return client;
}
let initialization: Promise<string> | null = null;
let invitation: string | null = null;
export function resetSessionInitialization() { initialization = null; }
export function captureInvitation() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('convite');
  if (token) { invitation = token; window.history.replaceState(null, '', window.location.pathname + window.location.search); }
}
export async function initializeSession(): Promise<string> {
  if (initialization) return initialization;
  initialization = (async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    let session = data.session;
    if (!session) {
      if (!navigator.onLine) throw new Error('Abra a viagem com conexão pela primeira vez neste aparelho.');
      const result = await supabase.auth.signInAnonymously();
      if (result.error) throw result.error;
      session = result.data.session;
    }
    if (!session) throw new Error('Não foi possível autorizar este aparelho. Tente novamente.');
    if (invitation) {
      const token = invitation;
      const result = await supabase.rpc('redeem_trip_invite', { p_token: token });
      if (result.error) {
        if (!result.error.code || /fetch|network/i.test(result.error.message)) throw new Error('Network');
        invitation = null;
        throw new Error('Este convite expirou, foi revogado ou já foi utilizado. Peça um novo link ao proprietário.');
      }
      invitation = null;
    }
    return session.user.id;
  })();
  try { return await initialization; } catch (error) { initialization = null; throw error; }
}
