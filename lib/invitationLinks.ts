export type InvitationScope = 'trip' | 'collection' | 'site';

/** Use the current origin so Render and custom domains share their own URL. */
export function invitationUrl(origin: string, scope: InvitationScope, token: string): string {
  const url = new URL('/viagens', origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error('INVALID_INVITE');
  }
  url.hash = scope === 'site'
    ? new URLSearchParams({ invite: token, scope: 'site' }).toString()
    : new URLSearchParams({ [scope === 'collection' ? 'colecao' : 'convite']: token }).toString();
  return url.toString();
}
