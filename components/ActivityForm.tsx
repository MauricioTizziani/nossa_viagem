'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Activity, ActivityInput, PlaceValue, Trip } from '@/lib/types';
import { EMPTY_PLACE } from '@/lib/types';
import { parseBudgetCents, budgetInputValue, isoToLocalDateTime, localDateTimeToIso, isOutsideTripPeriod, validateActivityInput } from '@/lib/domain';
import { friendlyError } from '@/lib/useTravelData';
import PlacePicker from './OsmPlacePicker';
import Modal from './Modal';

export default function ActivityForm({ activity, duplicate, trip, online, onSave, onClose, onDirtyChange, onLoadLatest }: {
  activity?: Activity; duplicate?: boolean; trip: Trip; online: boolean;
  onSave: (input: ActivityInput, id: string, expectedVersion: number) => Promise<void>;
  onClose: () => void; onDirtyChange: (dirty: boolean) => void; onLoadLatest: (id: string) => Promise<void>;
}) {
  const [dateTime, setDateTime] = useState(activity ? isoToLocalDateTime(activity.starts_at, trip.timezone) : '');
  const [editingTimezone] = useState(trip.timezone);
  const [budget, setBudget] = useState(activity ? budgetInputValue(activity.budget_cents) : '');
  const [name, setName] = useState(activity?.name ?? '');
  const [type, setType] = useState<ActivityInput['type']>(activity?.type ?? 'Atividade');
  const [place, setPlace] = useState<PlaceValue>(activity ? Object.fromEntries(Object.keys(EMPTY_PLACE).map(key => [key, activity[key as keyof PlaceValue] ?? null])) as unknown as PlaceValue : { ...EMPTY_PLACE });
  const [dirty, setDirty] = useState(Boolean(duplicate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [outsideAccepted, setOutsideAccepted] = useState(false);
  const id = useRef(duplicate || !activity ? crypto.randomUUID() : activity.id);
  const locked = useRef(false);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  function changed() { setDirty(true); setOutsideAccepted(false); }
  function close() { if (saving) return; if (!dirty || window.confirm('Descartar as alterações deste formulário?')) onClose(); }
  let outside = false;
  try { outside = Boolean(dateTime) && isOutsideTripPeriod(localDateTimeToIso(dateTime, editingTimezone), trip); } catch { /* validated on submit */ }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current) return;
    setError(''); setConflict(false);
    try {
      const cleanName = name.trim();
      if (!cleanName) throw new Error('Informe o nome da atividade.');
      if (!dateTime) throw new Error('Escolha a data e o horário da atividade.');
      const startsAt = localDateTimeToIso(dateTime, editingTimezone);
      const cents = parseBudgetCents(budget);
      if (isOutsideTripPeriod(startsAt, trip) && !outsideAccepted) throw new Error('Revise a data e confirme o aviso sobre o período da viagem.');
      if (!online) throw new Error('Você está offline. O formulário será mantido; conecte-se para salvar.');
      locked.current = true; setSaving(true);
      await onSave(validateActivityInput({ starts_at: startsAt, budget_cents: cents, name: cleanName, type, ...place }), id.current, activity && !duplicate ? activity.version : 0);
      onClose();
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
      const codeError = err && typeof err === 'object' && 'code' in err;
      setConflict(message.includes('VERSION_CONFLICT'));
      setError(codeError || /VERSION_CONFLICT|Failed to fetch|Network/.test(message) ? friendlyError(err) : message || friendlyError(err));
    } finally { locked.current = false; setSaving(false); }
  }
  return <Modal title={duplicate ? 'Mais um momento parecido' : activity ? 'Editar atividade' : 'Um novo momento'} subtitle="Pequenos planos, grandes memórias." onClose={close}>
    <form onSubmit={submit} className="activity-form"><fieldset disabled={saving} className="form-fields">
      <label className="field-label">Data e hora <span className="required">*</span><div className="input-icon"><CalendarDays size={18}/><input type="datetime-local" required value={dateTime} onChange={e => { setDateTime(e.target.value); changed(); }}/></div><span className="field-hint">Horário deste formulário · {editingTimezone.replaceAll('_', ' ')}</span></label>
      <label className="field-label">Orçamento (R$)<div className="input-icon"><span>R$</span><input inputMode="decimal" placeholder="A definir" value={budget} maxLength={16} onChange={e => { setBudget(e.target.value); changed(); }}/></div><span className="field-hint">Valor previsto para a atividade. Deixe vazio se ainda não souber.</span></label>
      <label className="field-label">Nome da atividade <span className="required">*</span><input required maxLength={160} value={name} placeholder="Jantar especial, passeio no parque…" onChange={e => { setName(e.target.value); changed(); }}/></label>
      <div className="field-label">Lugar<PlacePicker value={place} onChange={value => { setPlace(value); changed(); }} disabled={saving}/></div>
      <label className="field-label">Tipo <span className="required">*</span><select required value={type} onChange={e => { setType(e.target.value as ActivityInput['type']); changed(); }}><option>Refeição</option><option>Lazer</option><option>Atividade</option></select></label>
      {outside && <label className="notice notice-warm check-notice"><input type="checkbox" checked={outsideAccepted} onChange={e => setOutsideAccepted(e.target.checked)}/><span>Esta atividade está fora do período da viagem. Revise a data ou marque para manter mesmo assim.</span></label>}
      {editingTimezone !== trip.timezone && <p className="notice notice-warm">O fuso da viagem foi alterado em outro aparelho. Este formulário mantém {editingTimezone.replaceAll('_', ' ')}. Para usar o novo fuso, feche e reabra a atividade.</p>}
      {!online && <p className="notice">Você está offline. Seu formulário continua aqui; conecte-se para salvar.</p>}
      {error && <div role="alert" className="notice notice-error"><p>{error}</p>{conflict && activity && !duplicate && <button type="button" className="text-button" onClick={async () => { if (window.confirm('Carregar a versão atual e descartar as alterações deste formulário?')) { try { await onLoadLatest(activity.id); } catch (err) { setError(friendlyError(err)); } } }}><RefreshCw size={16}/>Carregar versão atual</button>}</div>}
      <div className="form-footer"><button type="button" className="button-secondary" onClick={close} disabled={saving}>Cancelar</button><button className="button-primary" type="submit" disabled={saving || !online}>{saving ? <LoaderCircle className="spin" size={18}/> : <Check size={18}/>} {saving ? 'Salvando…' : 'Salvar atividade'}</button></div>
    </fieldset></form>
  </Modal>;
}
