'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Heart, MapPin, Settings2, Share2, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Trip } from '@/lib/types';
import { friendlyError } from '@/lib/useTravelData';
const timezones = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Rio_Branco', 'America/New_York', 'Europe/Lisbon', 'Europe/Paris', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'];
export default function TripSettings({ trip, online, canShare, onSave, onShare, onDirtyChange, onLoadLatest }: {
  trip: Trip; online: boolean; canShare: boolean;
  onSave: (values: Omit<Trip, 'id' | 'version'>, version: number) => Promise<void>;
  onShare: () => void; onDirtyChange: (value: boolean) => void;
  onLoadLatest: () => Promise<Trip>;
}) {
  const [values, setValues] = useState(trip);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const locked = useRef(false);
  useEffect(() => { if (!dirty) setValues(trip); }, [trip, dirty]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  function change(field: keyof Trip, value: string | null) { setValues(v => ({ ...v, [field]: value })); setDirty(true); setSuccess(false); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current) return;
    setError(''); setSuccess(false);
    if (!values.name.trim()) { setError('Dê um nome à viagem.'); return; }
    if (values.start_date && values.end_date && values.end_date < values.start_date) { setError('A data de término deve ser igual ou posterior à data de início.'); return; }
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: values.timezone }); } catch { setError('Escolha um fuso horário válido.'); return; }
    locked.current = true; setSaving(true);
    try {
      const { id: _id, version: _version, ...input } = values;
      await onSave({ ...input, name: values.name.trim(), destination: values.destination.trim(), person_one: values.person_one?.trim() || null, person_two: values.person_two?.trim() || null }, values.version);
      setDirty(false); setSuccess(true);
    } catch (err) { setError(friendlyError(err)); }
    finally { locked.current = false; setSaving(false); }
  }
  const tzOptions = Array.from(new Set([...timezones, values.timezone]));
  return <div className="settings-grid"><section className="paper-card settings-card"><div className="section-intro"><span className="section-icon"><Settings2 size={22}/></span><div><h2>Do jeitinho de vocês</h2><p>Um nome, um destino e tantos momentos para viver.</p></div></div>
    <form onSubmit={submit} className="settings-form"><fieldset disabled={saving} className="form-fields">
      <label className="field-label">Nome da viagem <span className="required">*</span><input required maxLength={160} value={values.name} onChange={e => change('name', e.target.value)} placeholder="Como vamos chamar nossa aventura?"/></label>
      <label className="field-label">Destino<div className="input-icon"><MapPin size={18}/><input maxLength={240} value={values.destination} onChange={e => change('destination', e.target.value)} placeholder="Para onde vamos?"/></div></label>
      <div className="fields-two"><label className="field-label">Data de início<input type="date" value={values.start_date ?? ''} onChange={e => change('start_date', e.target.value || null)}/></label><label className="field-label">Data de término<input type="date" value={values.end_date ?? ''} onChange={e => change('end_date', e.target.value || null)}/></label></div>
      <div className="fields-two"><label className="field-label">Seu nome <span className="optional">opcional</span><input maxLength={80} value={values.person_one ?? ''} onChange={e => change('person_one', e.target.value)} placeholder="Primeiro nome"/></label><label className="field-label">Nome do seu amor <span className="optional">opcional</span><input maxLength={80} value={values.person_two ?? ''} onChange={e => change('person_two', e.target.value)} placeholder="Primeiro nome"/></label></div>
      <label className="field-label">Fuso horário<select value={values.timezone} onChange={e => change('timezone', e.target.value)}>{tzOptions.map(tz => <option key={tz} value={tz}>{tz.replaceAll('_', ' ')}</option>)}</select><span className="field-hint">O cronograma usa este fuso em todos os aparelhos. Alterar o fuso muda a exibição, mantendo os instantes das atividades.</span></label>
      {!online && <p className="notice">Você está offline. As alterações deste formulário serão mantidas enquanto ele estiver aberto.</p>}
      {error && <div role="alert" className="notice notice-error"><p>{error}</p>{error.includes('outro aparelho') && <button type="button" className="text-button" onClick={async () => { if (window.confirm('Descartar este rascunho e carregar as configurações atuais?')) { try { const current = await onLoadLatest(); setValues(current); setDirty(true); setError(''); } catch (err) { setError(friendlyError(err)); } } }}><RefreshCw size={16}/>Carregar versão atual</button>}</div>}
      {success && <p className="success-message" role="status"><Check size={16}/>Sua viagem foi atualizada.</p>}
      <div className="form-footer"><button className="button-primary" type="submit" disabled={saving || !online}>{saving ? <LoaderCircle size={18} className="spin"/> : <Check size={18}/>} {saving ? 'Salvando…' : 'Salvar nossa viagem'}</button></div>
    </fieldset></form>
  </section><aside className="settings-aside"><section className="paper-card share-card"><span className="section-icon pink-icon"><Heart size={23}/></span><h3>Uma viagem, vários aparelhos</h3><p>Abra o mesmo endereço no computador e nos celulares de vocês. Os planos ficam juntos automaticamente.</p><button className="button-secondary" onClick={onShare} disabled={!canShare}><Share2 size={17}/>Compartilhar viagem</button><p className="field-hint">Quem tiver o endereço poderá consultar e editar a viagem, sem cadastro ou convite.</p></section><div className="quiet-note"><CalendarDays size={20}/><p>Não precisa decidir tudo agora.<br/>Os melhores planos também têm espaço para o inesperado.</p></div></aside></div>;
}
