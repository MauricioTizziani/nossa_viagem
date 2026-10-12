import { getSupabase, initializeSession, isConfigured } from './supabase';
import type { Invitation, InvitationCreated } from './types';
import type { InvitationScope } from './invitationLinks';
export type { InvitationScope } from './invitationLinks';
async function requireConnection() {
  if (!isConfigured) throw new Error('Conecte o Supabase conforme o README para compartilhar suas viagens.');
  if (!navigator.onLine) throw new Error('Network');
  await initializeSession();
}
/** Returned raw token belongs only in memory and in the invitation URL fragment. */
export async function createInvitation(scope: InvitationScope, id?: string): Promise<InvitationCreated> {
  await requireConnection();
  const rpc = scope === 'site' ? 'create_site_invite' : scope === 'collection' ? 'create_collection_invite' : 'create_trip_invite';
  if (scope !== 'site' && !id) throw new Error('INVALID_INVITE_SCOPE');
  const args = scope === 'site' ? {} : scope === 'collection'
    ? { p_collection_id: id, p_role: 'member', p_max_uses: 1, p_expires_in_hours: 24 }
    : { p_trip_id: id, p_role: 'member', p_max_uses: 1, p_expires_in_hours: 24 };
  const result = await getSupabase().rpc(rpc, args);
  if (result.error) throw result.error;
  return (Array.isArray(result.data) ? result.data[0] : result.data) as InvitationCreated;
}
export async function listInvitations(scope: InvitationScope, id?: string): Promise<Invitation[]> {
  await requireConnection();
  const rpc = scope === 'site' ? 'list_site_invites' : scope === 'collection' ? 'list_collection_invites' : 'list_trip_invites';
  if (scope !== 'site' && !id) throw new Error('INVALID_INVITE_SCOPE');
  const args = scope === 'site' ? {} : scope === 'collection' ? { p_collection_id: id } : { p_trip_id: id };
  const result = await getSupabase().rpc(rpc, args);
  if (result.error) throw result.error;
  return result.data as Invitation[];
}
export async function revokeInvitation(scope: InvitationScope, inviteId: string): Promise<void> {
  await requireConnection();
  const rpc = scope === 'site' ? 'revoke_site_invite' : scope === 'collection' ? 'revoke_collection_invite' : 'revoke_trip_invite';
  const result = await getSupabase().rpc(rpc, { p_invite_id: inviteId });
  if (result.error) throw result.error;
}

export type { Invitation, InvitationCreated } from './types';
