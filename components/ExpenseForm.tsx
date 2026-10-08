'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import type { Activity, Expense, ExpenseCategory, ExpenseInput, Trip } from '@/lib/types';
import { EXPENSE_CATEGORIES } from '@/lib/types';
import { formatDateTime, sortActivities } from '@/lib/domain';
import { MAX_DESCRIPTION_LENGTH, MAX_NOTES_LENGTH, amountInputValue, formatCalendarDate, isExpenseCategory, parseAmountCents, todayInTimezone, validateExpenseInput } from '@/lib/expenses';
import { friendlyError } from '@/lib/useTravelData';
import Modal from './Modal';

const plain = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export default function ExpenseForm({ expense, trip, activities, online, onSave, onClose, onDirtyChange, onLoadLatest }: {
  expense?: Expense; trip: Trip; activities: Activity[]; online: boolean;
  onSave: (input: ExpenseInput, id: string, expectedVersion: number) => Promise<void>;
  onClose: () => void; onDirtyChange: (dirty: boolean) => void; onLoadLatest: (id: string) => Promise<void>;
}) {
  const [description, setDescription] = useState(expense?.description ?? '');
  const [category, setCategory] = useState<ExpenseCategory | ''>(expense?.category ?? '');
  const [amount, setAmount] = useState(expense ? amountInputValue(expense.amount_cents) : '');
  // The suggestion is today's calendar date in the trip timezone; the chosen day is stored as typed.
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? todayInTimezone(trip.timezone));
  const [activityId, setActivityId] = useState(expense?.activity_id ?? '');
  const [activitySearch, setActivitySearch] = useState('');
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const id = useRef(expense?.id ?? crypto.randomUUID());
  const locked = useRef(false);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  function changed() { setDirty(true); }
  function close() { if (saving) return; if (!dirty || window.confirm('Descartar as alterações deste gasto?')) onClose(); }

  const sorted = useMemo(() => sortActivities(activities), [activities]);
  const linkedMissing = Boolean(activityId) && !sorted.some(activity => activity.id === activityId);
  const query = plain(activitySearch.trim());
  const options = query ? sorted.filter(activity => activity.id === activityId || plain(activity.name).includes(query)) : sorted;
  const beforeTrip = Boolean(trip.start_date && expenseDate && expenseDate < trip.start_date);
  const afterTrip = Boolean(trip.end_date && expenseDate && expenseDate > trip.end_date);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current) return;
    setError(''); setConflict(false);
    try {
      if (!description.trim()) throw new Error('Informe a descrição do gasto.');
      if (!isExpenseCategory(category)) throw new Error('Escolha a categoria do gasto.');
      const cents = parseAmountCents(amount);
      if (!expenseDate) throw new Error('Escolha a data do gasto.');
      const input = validateExpenseInput({ description, category, amount_cents: cents, expense_date: expenseDate, activity_id: linkedMissing ? null : activityId || null, notes: notes || null }, sorted, trip.id);
      if (!online) throw new Error('Você está offline. O formulário será mantido; conecte-se para salvar.');
      locked.current = true; setSaving(true);
      await onSave(input, id.current, expense ? expense.version : 0);
      onClose();
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
      const codeError = err && typeof err === 'object' && 'code' in err;
      setConflict(message.includes('VERSION_CONFLICT'));
      setError(codeError || /VERSION_CONFLICT|Failed to fetch|Network|EXPENSE_/.test(message) ? friendlyError(err) : message || friendlyError(err));
    } finally { locked.current = false; setSaving(false); }
  }

  return <Modal title={expense ? 'Editar gasto' : 'Um novo gasto'} subtitle="Para sabermos onde o dinheiro da viagem foi usado." onClose={close}>
    <form onSubmit={submit} className="activity-form expense-form"><fieldset disabled={saving} className="form-fields">
      <label className="field-label">Descrição <span className="required">*</span><input required maxLength={MAX_DESCRIPTION_LENGTH} value={description} placeholder="Gasolina — viagem de ida, Airbnb — hospedagem…" onChange={e => { setDescription(e.target.value); changed(); }}/></label>
      <div className="fields-two">
        <label className="field-label">Categoria <span className="required">*</span><select required value={category} onChange={e => { setCategory(e.target.value as ExpenseCategory | ''); changed(); }}><option value="">Escolha a categoria</option>{EXPENSE_CATEGORIES.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
        <label className="field-label">Valor (R$) <span className="required">*</span><div className="input-icon"><span>R$</span><input required inputMode="decimal" placeholder="Ex.: 150,00" value={amount} maxLength={16} onChange={e => { setAmount(e.target.value); changed(); }}/></div><span className="field-hint">Valor total desta despesa para a viagem.</span></label>
      </div>
      <label className="field-label">Data do gasto <span className="required">*</span><div className="input-icon"><CalendarDays size={18}/><input type="date" required value={expenseDate} onChange={e => { setExpenseDate(e.target.value); changed(); }}/></div><span className="field-hint">{expenseDate ? `${formatCalendarDate(expenseDate)} · ` : ''}data de calendário, igual em todos os aparelhos.</span></label>
      {(beforeTrip || afterTrip) && <p className="notice">{beforeTrip ? 'Este gasto é anterior ao início da viagem, como um pagamento antecipado. Ele entra normalmente no total.' : 'Este gasto é posterior ao término da viagem. Ele entra normalmente no total.'}</p>}
      <div className="field-label">
        <span className="inline-flex items-center gap-1.5">Atividade relacionada <span className="optional">opcional</span></span>
        {sorted.length > 0 && <div className="input-icon"><Search size={17}/><input type="search" aria-label="Pesquisar atividade do cronograma" placeholder="Pesquisar atividade…" value={activitySearch} onChange={e => setActivitySearch(e.target.value)}/></div>}
        <select aria-label="Atividade relacionada" value={linkedMissing ? '' : activityId} onChange={e => { setActivityId(e.target.value); changed(); }}><option value="">Sem atividade vinculada</option>{options.map(activity => <option key={activity.id} value={activity.id}>{activity.name} · {formatDateTime(activity.starts_at, trip.timezone)}</option>)}</select>
        <span className="field-hint">{sorted.length === 0 ? 'O cronograma ainda não tem atividades. Dá para vincular depois.' : query && options.length === 0 ? 'Nenhuma atividade encontrada com essa pesquisa.' : 'Vincular não cria outra despesa nem altera o orçamento da atividade.'}</span>
        {linkedMissing && <p className="notice notice-warm">A atividade vinculada antes não está mais no cronograma. O gasto será mantido sem vínculo.</p>}
      </div>
      <label className="field-label">Observações <span className="optional">opcional</span><textarea rows={3} maxLength={MAX_NOTES_LENGTH} value={notes} placeholder="Abastecimento antes de sair, hospedagem já paga…" onChange={e => { setNotes(e.target.value); changed(); }}/></label>
      {!online && <p className="notice">Você está offline. Seu formulário continua aqui; conecte-se para salvar.</p>}
      {error && <div role="alert" className="notice notice-error"><p>{error}</p>{conflict && expense && <button type="button" className="text-button" onClick={async () => { if (window.confirm('Carregar a versão atual e descartar as alterações deste formulário?')) { try { await onLoadLatest(expense.id); } catch (err) { setError(friendlyError(err)); } } }}><RefreshCw size={16}/>Carregar versão atual</button>}</div>}
      <div className="form-footer"><button type="button" className="button-secondary" onClick={close} disabled={saving}>Cancelar</button><button className="button-primary" type="submit" disabled={saving || !online}>{saving ? <LoaderCircle className="spin" size={18}/> : <Check size={18}/>} {saving ? 'Salvando…' : 'Salvar gasto'}</button></div>
    </fieldset></form>
  </Modal>;
}
