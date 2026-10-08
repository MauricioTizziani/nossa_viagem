'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, Link2, LoaderCircle, Trash2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/useTravelData';
import Modal from './Modal';
type Invite = { id?: string; invite_id?: string; expires_at: string; revoked_at?: string | null; uses?: number; use_count?: number; max_uses: number; role: string };
export default function SharePanel({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const locked = useRef(false);
  async function load() {
    const result = await getSupabase().rpc('list_trip_invites', { p_trip_id: tripId });
    if (result.error) throw result.error;
    setInvites((result.data ?? []) as Invite[]);
  }
  useEffect(() => { void load().catch(err => setError(friendlyError(err))); }, [tripId]);
  async function create() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await getSupabase().rpc('create_trip_invite', { p_trip_id: tripId, p_role: 'member', p_max_uses: 1, p_expires_in_hours: 24 });
      if (result.error) throw result.error;
      const invite = Array.isArray(result.data) ? result.data[0] : result.data;
      setLink(`${window.location.origin}/#convite=${encodeURIComponent(invite.token)}`);
      setCopied(false); await load();
    } catch (err) { setError(friendlyError(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  async function revoke(invite: Invite) {
    if (!window.confirm('Revogar este convite? Ele deixará de autorizar novos aparelhos.')) return;
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { const result = await getSupabase().rpc('revoke_trip_invite', { p_invite_id: invite.invite_id ?? invite.id }); if (result.error) throw result.error; setLink(''); await load(); }
    catch (err) { setError(friendlyError(err)); }
    finally { locked.current = false; setBusy(false); }
  }
  return <Modal title="Leve a viagem com vocês" subtitle="Um convite privado para cada novo aparelho." onClose={onClose}><div className="share-content"><div className="notice"><KeyRound size={20}/><p>Este link funciona como uma chave: quem abrir poderá consultar e editar a viagem. Cada convite vale por 24 horas e autoriza um aparelho. Não publique o link.</p></div><button className="button-primary" onClick={create} disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <Link2 size={18}/>}Gerar convite privado</button>
    {link && <div className="invite-result"><label className="field-label">Link de convite<input readOnly value={link} onFocus={e => e.target.select()}/></label><button className="button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Selecione e copie o link acima para compartilhar.'); } }}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? 'Copiado' : 'Copiar link'}</button><p className="field-hint">O link é exibido apenas agora. Você pode gerar outro se fechar esta janela.</p></div>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <h3>Convites recentes</h3><div className="invite-list">{invites.length === 0 && <p className="muted">Nenhum convite por aqui ainda.</p>}{invites.map(invite => {
      const expired = Date.parse(invite.expires_at) <= Date.now();
      const used = (invite.use_count ?? invite.uses ?? 0) >= invite.max_uses;
      const disabled = Boolean(invite.revoked_at) || expired || used;
      return <div className="invite-row" key={invite.invite_id ?? invite.id}><div><strong>{invite.revoked_at ? 'Revogado' : used ? 'Utilizado' : expired ? 'Expirado' : 'Disponível'}</strong><span>Validade: {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(invite.expires_at))}</span></div><button className="icon-button" onClick={() => void revoke(invite)} disabled={busy || disabled} aria-label="Revogar convite"><Trash2 size={18}/></button></div>;
    })}</div><p className="field-hint">Se os dados do navegador forem apagados, use outro aparelho autorizado para gerar um convite. Se perder todos os acessos, siga a recuperação no README do projeto.</p></div></Modal>;
}
