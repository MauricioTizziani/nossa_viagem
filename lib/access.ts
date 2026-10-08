import { getSupabase, initializeSession, isConfigured } from './supabase';
import type { Invitation, InvitationCreated } from './types';
export type InvitationScope = 'trip' | 'collection';
async function requireConnection() {
  if (!isConfigured) throw new Error('Conecte o Supabase conforme o README para compartilhar suas viagens.');
  if (!navigator.onLine) throw new Error('Network');
  await initializeSession();
}
/** Returned raw token belongs only in memory and in the invitation URL fragment. */
export async function createInvitation(scope: InvitationScope, id: string): Promise<InvitationCreated> {
  await requireConnection();
  const args = scope === 'collection' ? { p_collection_id: id, p_role: 'member', p_max_uses: 1, p_expires_in_hours: 24 } : { p_trip_id: id, p_role: 'member', p_max_uses: 1, p_expires_in_hours: 24 };
  const result = await getSupabase().rpc(scope === 'collection' ? 'create_collection_invite' : 'create_trip_invite', args);
  if (result.error) throw result.error;
  return (Array.isArray(result.data) ? result.data[0] : result.data) as InvitationCreated;
}
export async function listInvitations(scope: InvitationScope, id: string): Promise<Invitation[]> {
  await requireConnection();
  const result = await getSupabase().rpc(scope === 'collection' ? 'list_collection_invites' : 'list_trip_invites', scope === 'collection' ? { p_collection_id: id } : { p_trip_id: id });
  if (result.error) throw result.error;
  return result.data as Invitation[];
}
export async function revokeInvitation(scope: InvitationScope, inviteId: string): Promise<void> {
  await requireConnection();
  const result = await getSupabase().rpc(scope === 'collection' ? 'revoke_collection_invite' : 'revoke_trip_invite', { p_invite_id: inviteId });
  if (result.error) throw result.error;
}

export type { Invitation, InvitationCreated } from './types';
