'use client';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Heart, MapPin, Settings2, Share2, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Trip } from '@/lib/types';
import { INITIAL_BUDGET_HELP, UNDEFINED_BUDGET_LABEL, formatBudgetInput, parseInitialBudgetCents } from '@/lib/budget';
import { validateTripInput } from '@/lib/domain';
import { friendlyError } from '@/lib/useTravelData';
const timezones = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Rio_Branco', 'America/New_York', 'Europe/Lisbon', 'Europe/Paris', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'];
export default function TripSettings({ trip, online, canShare, focusBudget = false, onSave, onShare, onDirtyChange, onLoadLatest, onBudgetFocused }: {
  trip: Trip; online: boolean; canShare: boolean; focusBudget?: boolean;
  onSave: (values: Omit<Trip, 'id' | 'version'>, version: number, options: { touchBudget: boolean }) => Promise<void>;
  onShare: () => void; onDirtyChange: (value: boolean) => void;
  onLoadLatest: () => Promise<Trip>;
  onBudgetFocused?: () => void;
}) {
  const [values, setValues] = useState(trip);
  const [budgetText, setBudgetText] = useState(trip.initial_budget_cents === null ? '' : formatBudgetInput(trip.initial_budget_cents));
  const [defining, setDefining] = useState(focusBudget);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const locked = useRef(false);
  const budgetRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dirty) return;
    setValues(trip);
    setBudgetText(trip.initial_budget_cents === null ? '' : formatBudgetInput(trip.initial_budget_cents));
  }, [trip, dirty]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!focusBudget) return;
    setDefining(true);
    budgetRef.current?.focus();
    budgetRef.current?.scrollIntoView({ block: 'center' });
    onBudgetFocused?.();
  }, [focusBudget, onBudgetFocused]);
  function change(field: keyof Trip, value: string | null) { setValues(v => ({ ...v, [field]: value })); setDirty(true); setSuccess(false); }
  function changeBudget(value: string) { setBudgetText(value); if (value.trim()) setDefining(true); setDirty(true); setSuccess(false); }
  function defineBudget() { setDefining(true); setSuccess(false); budgetRef.current?.focus(); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current) return;
    setError(''); setSuccess(false);
    if (!values.name.trim()) { setError('Dê um nome à viagem.'); return; }
    if (values.start_date && values.end_date && values.end_date < values.start_date) { setError('A data de término deve ser igual ou posterior à data de início.'); return; }
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: values.timezone }); } catch { setError('Escolha um fuso horário válido.'); return; }
    let cents: number | null;
    try { cents = parseInitialBudgetCents(budgetText); }
    catch (err) { setError(err instanceof Error ? err.message : 'Informe um orçamento inicial válido.'); return; }
    const requireInitialBudget = defining || values.initial_budget_cents !== null;
    if (requireInitialBudget && cents === null) { setError('Informe o orçamento inicial da viagem.'); budgetRef.current?.focus(); return; }
    locked.current = true; setSaving(true);
    try {
      const { id: _id, version: _version, ...input } = values;
      const validated = validateTripInput({ ...input, name: values.name.trim(), destination: values.destination.trim(), person_one: values.person_one?.trim() || null, person_two: values.person_two?.trim() || null, initial_budget_cents: cents }, { requireInitialBudget });
      await onSave(validated, values.version, { touchBudget: cents !== null });
      setDefining(false); setDirty(false); setSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(/Informe|Escolha|deve ter|não pode|fuso|orçamento/i.test(message) && !/Failed to fetch|Network|VERSION|supabase/i.test(message) ? message : friendlyError(err));
    }
    finally { locked.current = false; setSaving(false); }
  }
  const tzOptions = Array.from(new Set([...timezones, values.timezone]));
  return <div className="settings-grid"><section className="paper-card settings-card"><div className="section-intro"><span className="section-icon"><Settings2 size={22}/></span><div><h2>Do jeitinho de vocês</h2><p>Um nome, um destino e tantos momentos para viver.</p></div></div>
    <form onSubmit={submit} className="settings-form"><fieldset disabled={saving} className="form-fields">
      <label className="field-label">Nome da viagem <span className="required">*</span><input required maxLength={160} value={values.name} onChange={e => change('name', e.target.value)} placeholder="Como vamos chamar nossa aventura?"/></label>
      <label className="field-label">Destino<div className="input-icon"><MapPin size={18}/><input maxLength={240} value={values.destination} onChange={e => change('destination', e.target.value)} placeholder="Para onde vamos?"/></div></label>
      <div className="fields-two"><label className="field-label">Data de início<input type="date" value={values.start_date ?? ''} onChange={e => change('start_date', e.target.value || null)}/></label><label className="field-label">Data de término<input type="date" value={values.end_date ?? ''} onChange={e => change('end_date', e.target.value || null)}/></label></div>
      <div className="fields-two"><label className="field-label">Seu nome <span className="optional">opcional</span><input maxLength={80} value={values.person_one ?? ''} onChange={e => change('person_one', e.target.value)} placeholder="Primeiro nome"/></label><label className="field-label">Nome do seu amor <span className="optional">opcional</span><input maxLength={80} value={values.person_two ?? ''} onChange={e => change('person_two', e.target.value)} placeholder="Primeiro nome"/></label></div>
      <div>
        <label className="field-label">Orçamento inicial da viagem {(defining || values.initial_budget_cents !== null) && <span className="required">*</span>}{values.initial_budget_cents === null && !budgetText.trim() && <span className="optional">{UNDEFINED_BUDGET_LABEL}</span>}<div className="input-icon"><span>R$</span><input ref={budgetRef} inputMode="decimal" autoComplete="off" placeholder="Ex.: 2.000,00" maxLength={20} value={budgetText} aria-describedby="initial-budget-hint" onChange={e => changeBudget(e.target.value)} onBlur={() => { try { const cents = parseInitialBudgetCents(budgetText); if (cents !== null) setBudgetText(formatBudgetInput(cents)); } catch { /* Keep the typed text so it can be corrected. */ } }}/></div><span id="initial-budget-hint" className="field-hint">{INITIAL_BUDGET_HELP}</span></label>
        {values.initial_budget_cents === null && <button type="button" className="text-button" onClick={defineBudget}>Definir orçamento</button>}
      </div>
      <label className="field-label">Fuso horário<select value={values.timezone} onChange={e => change('timezone', e.target.value)}>{tzOptions.map(tz => <option key={tz} value={tz}>{tz.replaceAll('_', ' ')}</option>)}</select><span className="field-hint">O cronograma usa este fuso em todos os aparelhos. Alterar o fuso muda a exibição, mantendo os instantes das atividades.</span></label>
      {!online && <p className="notice">Você está offline. As alterações deste formulário serão mantidas enquanto ele estiver aberto.</p>}
      {error && <div role="alert" className="notice notice-error"><p>{error}</p>{error.includes('outro aparelho') && <button type="button" className="text-button" onClick={async () => { if (window.confirm('Descartar este rascunho e carregar as configurações atuais?')) { try { const current = await onLoadLatest(); setValues(current); setBudgetText(current.initial_budget_cents === null ? '' : formatBudgetInput(current.initial_budget_cents)); setDefining(current.initial_budget_cents !== null); setDirty(true); setError(''); } catch (err) { setError(friendlyError(err)); } } }}><RefreshCw size={16}/>Carregar versão atual</button>}</div>}
      {success && <p className="success-message" role="status"><Check size={16}/>Sua viagem foi atualizada.</p>}
      <div className="form-footer"><button className="button-primary" type="submit" disabled={saving || !online}>{saving ? <LoaderCircle size={18} className="spin"/> : <Check size={18}/>} {saving ? 'Salvando…' : 'Salvar nossa viagem'}</button></div>
    </fieldset></form>
  </section><aside className="settings-aside"><section className="paper-card share-card"><span className="section-icon pink-icon"><Heart size={23}/></span><h3>Uma viagem, vários aparelhos</h3><p>Abra o mesmo endereço no computador e nos celulares de vocês. Os planos ficam juntos automaticamente.</p><button className="button-secondary" onClick={onShare} disabled={!canShare}><Share2 size={17}/>Compartilhar viagem</button><p className="field-hint">Quem tiver o endereço poderá consultar e editar a viagem, sem cadastro ou convite.</p></section><div className="quiet-note"><CalendarDays size={20}/><p>Não precisa decidir tudo agora.<br/>Os melhores planos também têm espaço para o inesperado.</p></div></aside></div>;
}
