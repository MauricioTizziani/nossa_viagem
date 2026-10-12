'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link, LoaderCircle, Share2, ShieldCheck, X } from 'lucide-react';
import { createInvitation, listInvitations, revokeInvitation } from '@/lib/access';
import { invitationUrl, type InvitationScope } from '@/lib/invitationLinks';
import type { Invitation, InvitationCreated, Trip } from '@/lib/types';
import { friendlyError } from '@/lib/useTravelData';
import Modal from './Modal';

function invitationError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    return 'Somente a pessoa que criou estas viagens pode gerar ou desativar convites.';
  }
  return friendlyError(error);
}

export default function InvitationDialog({ trip, canInviteCollection, online, onClose, onBusyChange }: {
  trip: Trip | null; canInviteCollection: boolean; online: boolean;
  onClose: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [scope, setScope] = useState<InvitationScope>(trip ? canInviteCollection && trip.collection_id ? 'collection' : 'trip' : 'site');
  const [result, setResult] = useState<{ invitation: InvitationCreated; url: string } | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [message, setMessage] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [localAddress, setLocalAddress] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const request = useRef(0);
  const targetId = !trip ? undefined : scope === 'collection' ? trip.collection_id ?? undefined : trip.id;

  useEffect(() => {
    setCanShare(typeof navigator.share === 'function');
    setLocalAddress(['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname));
  }, []);

  useEffect(() => {
    const current = ++request.current;
    setInvitations([]); setListError('');
    if (!online || (scope !== 'site' && !targetId)) { setLoading(false); return; }
    setLoading(true);
    void listInvitations(scope, targetId).then(items => {
      if (current === request.current) setInvitations(items);
    }).catch(err => {
      if (current === request.current) setListError(invitationError(err));
    }).finally(() => {
      if (current === request.current) setLoading(false);
    });
    return () => { request.current++; };
  }, [scope, targetId, online]);

  function changeScope(next: InvitationScope) {
    if (locked.current) return;
    setScope(next); setResult(null); setError(''); setMessage('');
  }

  async function generate() {
    if (locked.current || !online || (scope !== 'site' && !targetId)) return;
    request.current++; setLoading(false);
    locked.current = true; setBusy(true); onBusyChange(true); setError(''); setMessage('');
    try {
      const created = await createInvitation(scope, targetId);
      const url = invitationUrl(window.location.origin, scope, created.token);
      setResult({ invitation: created, url });
      setInvitations(items => [{ id: created.invite_id, role: created.role, expires_at: created.expires_at,
        max_uses: created.max_uses, use_count: 0, created_at: new Date().toISOString(), revoked_at: null }, ...items]);
    } catch (err) { setError(invitationError(err)); }
    finally { locked.current = false; setBusy(false); onBusyChange(false); }
  }

  async function revoke(id: string) {
    if (locked.current || !online) return;
    locked.current = true; setBusy(true); onBusyChange(true); setError(''); setMessage('');
    try {
      await revokeInvitation(scope, id);
      setInvitations(items => items.filter(item => item.id !== id));
      if (result?.invitation.invite_id === id) setResult(null);
      setMessage('Convite desativado. Aparelhos já autorizados mantêm o acesso.');
    } catch (err) { setError(invitationError(err)); }
    finally { locked.current = false; setBusy(false); onBusyChange(false); }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setMessage('Link copiado. Abra-o no outro aparelho.');
    } catch {
      linkInput.current?.focus(); linkInput.current?.select();
      setMessage('Selecione e copie o link para abrir no outro aparelho.');
    }
  }

  async function share() {
    if (!result) return;
    try { await navigator.share({ title: 'Nossas Viagens', text: 'Abra este convite para acessar nossas viagens atuais e futuras.', url: result.url }); }
    catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) setMessage('Use Copiar link para compartilhar o convite.');
    }
  }

  const pending = invitations.filter(item => !item.revoked_at && item.use_count < item.max_uses && Date.parse(item.expires_at) > Date.now());
  const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  const globalInvite = scope === 'site';
  return <Modal title={globalInvite ? 'Compartilhar todas as viagens' : 'Convidar outro aparelho'} subtitle={globalInvite ? 'Um único convite dá acesso às viagens atuais e às próximas que você criar.' : `Abra os mesmos dados de ${trip?.name} no computador ou celular.`} onClose={() => { if (!locked.current) onClose(); }}>
    <div className="share-content invitation-content">
      {trip ? <fieldset className="invite-scope" disabled={busy}>
        <legend>Quais viagens compartilhar?</legend>
        <label><input type="radio" name="invite-scope" value="collection" checked={scope === 'collection'} disabled={!canInviteCollection || !trip.collection_id} onChange={() => changeScope('collection')}/><span><strong>Todas as viagens desta coleção</strong><small>Inclui as viagens atuais e as próximas que forem criadas nesta coleção.{!canInviteCollection && ' Esta opção está disponível para o proprietário da coleção.'}</small></span></label>
        <label><input type="radio" name="invite-scope" value="trip" checked={scope === 'trip'} onChange={() => changeScope('trip')}/><span><strong>Somente esta viagem</strong><small>Permite acessar o cronograma, os gastos e os detalhes de {trip.name}.</small></span></label>
      </fieldset> : <div className="invite-scope-description"><ShieldCheck size={21}/><p>O convite libera as viagens que você possui nesta sessão, em qualquer coleção, e também as próximas que criar. O outro aparelho poderá consultar e editar esses dados. O link vale por 24 horas e autoriza um aparelho; depois de aceito, o acesso continua.</p></div>}
      {trip && <div className="invite-scope-description"><ShieldCheck size={21}/><p>O outro aparelho poderá consultar e editar os dados compartilhados. O convite vale por 24 horas e pode autorizar um aparelho. Depois de aceito, o acesso continua.</p></div>}
      {!online && <p className="notice">Conecte-se para gerar ou desativar um convite.</p>}
      {localAddress && <p className="notice">Para convidar outro aparelho, gere o link pelo endereço publicado do aplicativo.</p>}
      <button className="button-primary" disabled={busy || loading || !online} onClick={() => void generate()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Link size={17}/>} {result ? 'Gerar outro convite' : 'Gerar convite'}</button>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {result && <div className="invite-result">
        <label className="field-label">Link do convite<input ref={linkInput} type="text" readOnly value={result.url} onFocus={event => event.currentTarget.select()}/></label>
        <div className="invite-result-actions"><button className="button-secondary" onClick={() => void copy()}><Copy size={16}/>Copiar link</button>{canShare && <button className="button-secondary" onClick={() => void share()}><Share2 size={16}/>Compartilhar link</button>}</div>
        <p className="field-hint">Abra este link no outro aparelho até {date(result.invitation.expires_at)}.</p>
      </div>}
      {message && <p className="success-message" role="status"><Check size={17}/>{message}</p>}
      <section className="invite-list" aria-labelledby="pending-invites-title">
        <h3 id="pending-invites-title">Convites aguardando uso</h3>
        {loading ? <p className="muted" role="status">Carregando convites…</p> : pending.length ? pending.map(item => <div className="invite-row" key={item.id}><div><strong>Válido até {date(item.expires_at)}</strong><span>{scope === 'site' ? 'Todas as viagens atuais e futuras' : scope === 'collection' ? 'Todas as viagens desta coleção' : 'Somente esta viagem'}</span></div><button className="text-button" disabled={busy || !online} onClick={() => void revoke(item.id)} aria-label={`Desativar convite válido até ${date(item.expires_at)}`}><X size={16}/>Desativar</button></div>) : !listError && <p className="muted">Nenhum convite aguardando uso.</p>}
        {listError && <p className="notice notice-error" role="alert">{listError}</p>}
        {pending.length > 0 && <p className="field-hint">Desativar um convite impede novas autorizações por esse link. Aparelhos já autorizados mantêm o acesso.</p>}
      </section>
    </div>
  </Modal>;
}
