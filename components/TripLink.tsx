'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Heart, Link2, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { createInvitation, listInvitations, revokeInvitation } from '@/lib/access';
import type { Invitation } from '@/lib/types';
import { friendlyError } from '@/lib/useTravelData';
import Modal from './Modal';

export default function TripLink({ onClose, online = true, tripId, tripName, collectionId, canShareTrip = false, canShareCollection = false }: {
  onClose: () => void; online?: boolean; tripId?: string; tripName?: string; collectionId?: string | null;
  canShareTrip?: boolean; canShareCollection?: boolean;
}) {
  const tripAllowed = Boolean(tripId && canShareTrip);
  const collectionAllowed = Boolean(collectionId && canShareCollection);
  const [scope, setScope] = useState<'trip' | 'collection'>(tripAllowed ? 'trip' : 'collection');
  const [acknowledged, setAcknowledged] = useState(false);
  const [link, setLink] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const locked = useRef(false);
  const selectedId = scope === 'trip' ? tripId : collectionId;
  const allowed = scope === 'trip' ? tripAllowed : collectionAllowed;
  useEffect(() => {
    let active = true;
    setInvites([]); setLink(''); setCopied(false); setError('');
    if (!allowed || !selectedId || !online) return;
    setLoading(true);
    void listInvitations(scope, selectedId).then(result => { if (active) setInvites(result); }).catch(err => { if (active) setError(friendlyError(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scope, selectedId, allowed, online]);
  async function create() {
    if (locked.current || !allowed || !selectedId || !online || (scope === 'collection' && !acknowledged)) return;
    locked.current = true; setBusy(true); setError(''); setCopied(false);
    try {
      const result = await createInvitation(scope, selectedId);
      const fragment = scope === 'trip' ? 'convite' : 'colecao';
      setLink(`${window.location.origin}/#${fragment}=${encodeURIComponent(result.token)}`);
      setExpiresAt(result.expires_at);
      setInvites(await listInvitations(scope, selectedId));
    } catch (err) { setError(friendlyError(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { setError('Selecione o convite acima e copie para abrir no outro aparelho.'); }
  }
  async function revoke(id: string) {
    if (locked.current || !online) return;
    locked.current = true; setBusy(true); setError('');
    try { await revokeInvitation(scope, id); setInvites(items => items.map(item => item.id === id ? { ...item, revoked_at: new Date().toISOString() } : item)); setLink(''); setCopied(false); }
    catch (err) { setError(friendlyError(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  function changeScope(next: 'trip' | 'collection') { setScope(next); setAcknowledged(false); setLink(''); }
  const formatExpiry = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
  return <Modal title="Nossos planos em outro aparelho" subtitle="Escolha o acesso que este convite vai autorizar." onClose={onClose}>
    <div className="share-content">
      <div className="notice"><ShieldCheck size={20}/><p>O convite privado autoriza um aparelho a consultar e editar. Compartilhe somente com quem deve participar dos planos de vocês.</p></div>
      {tripAllowed && collectionAllowed && <fieldset className="invite-scope"><legend>O que compartilhar?</legend><label><input type="radio" name="invite-scope" checked={scope === 'trip'} disabled={busy} onChange={() => changeScope('trip')}/><span>Somente esta viagem<small>{tripName || 'A viagem selecionada'}</small></span></label><label><input type="radio" name="invite-scope" checked={scope === 'collection'} disabled={busy} onChange={() => changeScope('collection')}/><span>Todas as viagens desta coleção<small>Viagens atuais e futuras</small></span></label></fieldset>}
      {allowed ? <>
        <div className="invite-scope-description"><Heart size={18}/><p>{scope === 'trip' ? <>Este convite dá acesso somente a <strong>{tripName || 'esta viagem'}</strong>. As outras viagens continuam privadas.</> : <>Este convite dá acesso às viagens <strong>atuais e futuras desta coleção</strong>. Convites antigos de uma única viagem continuam com seu acesso original.</>}</p></div>
        {scope === 'collection' && <label className="notice check-notice"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)}/><span>Quero autorizar este aparelho a consultar e editar todas as viagens atuais e futuras desta coleção.</span></label>}
        <button className="button-primary" disabled={busy || !online || (scope === 'collection' && !acknowledged)} onClick={() => void create()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Link2 size={17}/>}Gerar convite privado</button>
        <p className="field-hint">Válido por 24 horas, para um novo aparelho. Um convite revogado deixa de autorizar novos acessos.</p>
        {link && <div className="invite-result"><label className="field-label">Convite {scope === 'trip' ? 'desta viagem' : 'da coleção'}<input readOnly autoComplete="off" spellCheck={false} value={link} onFocus={event => event.target.select()}/></label><button className="button-secondary" onClick={() => void copy()}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? 'Copiado' : 'Copiar convite'}</button><p className="field-hint">Expira em {formatExpiry(expiresAt)}. Este convite será mostrado somente enquanto esta janela estiver aberta.</p></div>}
        <div className="invite-list"><h3>Convites deste acesso</h3>{loading && <p className="muted" role="status">Carregando convites…</p>}{!loading && !invites.length && <p className="muted">Nenhum convite gerado.</p>}{invites.map(invite => {
          const expired = Date.parse(invite.expires_at) <= Date.now();
          const consumed = invite.use_count >= invite.max_uses;
          return <div className="invite-row" key={invite.id}><div><strong>{invite.revoked_at ? 'Revogado' : expired ? 'Expirado' : consumed ? 'Utilizado' : 'Disponível'}</strong><span>{invite.use_count} de {invite.max_uses} uso · expira {formatExpiry(invite.expires_at)}</span></div>{!invite.revoked_at && !expired && !consumed && <button className="icon-button" aria-label="Revogar convite" disabled={busy || !online} onClick={() => void revoke(invite.id)}><X size={17}/></button>}</div>;
        })}</div>
      </> : <p className="notice">Somente um responsável pela viagem ou pela coleção pode autorizar novos aparelhos.</p>}
      {!online && <p className="notice">Conecte-se para gerar ou revogar convites privados.</p>}
      {error && <p role="alert" className="notice notice-error">{error}</p>}
    </div>
  </Modal>;
}
