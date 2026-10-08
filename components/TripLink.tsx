'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import Modal from './Modal';

export default function TripLink({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setLink(`${window.location.origin}${window.location.pathname}`); }, []);
  async function copy() {
    setError('');
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { setError('Selecione o endereço acima e copie para abrir em outro aparelho.'); }
  }
  return <Modal title="Leve a viagem com vocês" subtitle="O mesmo endereço no computador e nos celulares." onClose={onClose}>
    <div className="share-content"><div className="notice"><Link2 size={20}/><p>Abra este endereço em qualquer aparelho para consultar e editar a mesma viagem. Sem cadastro, convite ou liberação.</p></div>
      <div className="invite-result"><label className="field-label">Link da viagem<input readOnly value={link} onFocus={event => event.target.select()}/></label>
        <button className="button-secondary" onClick={() => void copy()} disabled={!link}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? 'Copiado' : 'Copiar link'}</button>
      </div>
      {error && <p role="status" className="field-hint">{error}</p>}
    </div>
  </Modal>;
}
