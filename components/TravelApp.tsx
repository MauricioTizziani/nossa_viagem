'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Heart, MapPin, Plane, Plus, Receipt, RefreshCw, Settings2, Sparkles, Wallet, WifiOff, X, LoaderCircle, Trash2 } from 'lucide-react';
import type { Activity, Expense } from '@/lib/types';
import { formatCurrency, summarizeActivities, tripStatus } from '@/lib/domain';
import { balanceText, tripBudgetView } from '@/lib/budget';
import { expensesForActivity } from '@/lib/expenses';
import { friendlyError, useTravelData } from '@/lib/useTravelData';
import { Schedule } from './Schedule';
import JourneyIllustration from './JourneyIllustration';
import { Expenses } from './Expenses';
import { TripSummary } from './TripSummary';
import ActivityForm from './ActivityForm';
import ExpenseForm from './ExpenseForm';
import TripSettings from './TripSettings';
import PwaManager from './PwaManager';
import Modal from './Modal';
import { tripTabs, type TravelTab } from '@/lib/navigation';

type Tab = TravelTab;
const nav = [{ id: 'schedule' as const, label: 'Cronograma', icon: CalendarDays }, { id: 'expenses' as const, label: 'Gastos', icon: Receipt }, { id: 'summary' as const, label: 'Resumo', icon: Wallet }, { id: 'trip' as const, label: 'Detalhes', icon: Heart }];
function shortDate(day: string) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z')); }

export default function TravelApp({ tripId, tab, onNavigate, onDirtyChange, onBusyChange }: { tripId: string; tab: Tab; onNavigate: (path: string) => boolean; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const data = useTravelData(tripId);
  const pendingWrites = useRef(0);
  const [editing, setEditing] = useState<{ activity?: Activity; duplicate?: boolean; key: string } | null>(null);
  const [editingExpense, setEditingExpense] = useState<{ expense?: Expense; key: string } | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [setup, setSetup] = useState(false);
  const [focusBudget, setFocusBudget] = useState(false);
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [lastSavedExpense, setLastSavedExpense] = useState<Expense | null>(null);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  const totals = summarizeActivities(data.activities);
  const budgetView = tripBudgetView(data.trip, data.activities, data.expensesReady ? data.expenses : null);
  const travelStatus = tripStatus(data.trip, now ?? new Date());
  const unsaved = formDirty || settingsDirty;
  const linkedToDeleting = deleting ? expensesForActivity(data.expenses, deleting.id) : [];
  useEffect(() => { onDirtyChange(unsaved); }, [unsaved, onDirtyChange]);
  useEffect(() => { setEditing(null); setEditingExpense(null); setFormDirty(false); setSettingsDirty(false); }, [tab]);
  useEffect(() => {
    if (data.status !== 'inaccessible') return;
    setEditing(null); setEditingExpense(null);
    setFormDirty(false); setSettingsDirty(false); onDirtyChange(false);
    pendingWrites.current = 0; onBusyChange(false);
    onNavigate('/viagens');
  }, [data.status, onNavigate, onDirtyChange, onBusyChange]);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const visible = () => { if (document.visibilityState === 'visible') tick(); };
    tick(); const timer = setInterval(tick, 60000);
    window.addEventListener('focus', tick); document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, [unsaved]);
  function navigate(next: Tab, options?: { focusBudget?: boolean }) {
    if (next === tab && !options?.focusBudget) return;
    if (!onNavigate(`/viagens/${tripId}/${tripTabs[next]}`)) return;
    setSettingsDirty(false); setEditing(null); setEditingExpense(null); setFormDirty(false); setFocusBudget(Boolean(options?.focusBudget));
  }
  function add() { setEditing({ key: crypto.randomUUID() }); }
  function addExpense() { setEditingExpense({ key: crypto.randomUUID() }); }
  async function runWrite<T,>(write: () => Promise<T>): Promise<T> {
    pendingWrites.current++; onBusyChange(true);
    try { return await write(); }
    finally { pendingWrites.current = Math.max(0, pendingWrites.current - 1); onBusyChange(pendingWrites.current > 0); }
  }
  async function remove() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true); setDeleteError('');
    try { await runWrite(() => data.deleteActivity(deleting)); setDeleting(null); setToast(linkedToDeleting.length ? 'Atividade excluída. Os gastos vinculados foram mantidos.' : 'Atividade excluída.'); }
    catch (err) { setDeleteError(friendlyError(err)); await data.refresh(); }
    finally { setDeleteBusy(false); }
  }
  async function removeExpense() {
    if (!deletingExpense || deleteBusy) return;
    setDeleteBusy(true); setDeleteError('');
    try { await runWrite(() => data.deleteExpense(deletingExpense)); setDeletingExpense(null); setToast('Gasto excluído. Os totais foram atualizados.'); }
    catch (err) { setDeleteError(friendlyError(err)); await data.refresh(); }
    finally { setDeleteBusy(false); }
  }
  const synchronized = data.status === 'ready';
  if (!synchronized) return <div className="app-shell"><main className="main-content"><button className="text-button" onClick={() => onNavigate('/viagens')}>← Voltar para Minhas viagens</button><div className="loading-state" role="status">{data.status === 'loading' ? <><LoaderCircle size={30} className="spin"/><p>Abrindo esta viagem…</p></> : <><h1>Não foi possível abrir esta viagem</h1><p>{data.error || 'Configure o Supabase para guardar e compartilhar suas viagens.'}</p><button className="button-secondary" onClick={() => void data.refresh()}>Tentar novamente</button></>}</div></main></div>;
  return <div className="app-shell"><header className="topbar"><div className="topbar-inner"><a className="brand" href="/viagens" onClick={e => { e.preventDefault(); onNavigate('/viagens'); }} aria-label="Nossas Viagens, Minhas viagens"><img src="/logo.png" alt="" width="48" height="48"/><span>Nossas <strong>Viagens</strong><small>nosso cantinho de planos</small></span></a>
    <nav className="desktop-nav" aria-label="Navegação principal">{nav.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={17} strokeWidth={1.7}/>{item.label}</button>)}</nav>
    </div></header>
    <main className="main-content">
      <div className="trip-context"><button className="text-button" onClick={() => onNavigate('/viagens')}>← Minhas viagens</button><div><strong>{data.trip.name}</strong><span>{data.trip.destination || 'Destino a escolher'}</span></div><button className="button-secondary" onClick={() => onNavigate('/viagens')}>Trocar viagem</button></div>
      {travelStatus.phase === 'finished' && <div className="notice trip-history-note" role="status"><Heart size={17}/><span>Esta viagem faz parte das nossas memórias. Você pode consultar e corrigir seus registros.</span></div>}
      {data.trip.archived_at && <div className="notice trip-history-note" role="status">Viagem arquivada. Seus planos, gastos e orçamento continuam aqui.</div>}
      {!data.online && data.offlinePartial && <div className="notice" role="status">A cópia desta viagem neste aparelho pode estar incompleta. Conecte-se para atualizar o cronograma, os gastos e seus indicadores.</div>}
      {!data.online && <div className="connection-banner" role="status"><WifiOff size={18}/><div><strong>Você está offline</strong><span>{data.syncedAt ? `Última sincronização: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: data.trip.timezone }).format(new Date(data.syncedAt))}. Consulta disponível; conecte-se para salvar.` : 'Abra a viagem com conexão para sincronizar neste aparelho.'}</span></div></div>}
      {data.status === 'unconfigured' && <div className="setup-banner"><div><span className="status-dot"/><span>Sua viagem está pronta para ser conectada.</span></div><button onClick={() => setSetup(true)}>Como começar<ArrowRight size={15}/></button></div>}
      {data.error && <div className="notice notice-error app-error" role="alert"><p>{data.error}</p><button className="text-button" onClick={() => void data.refresh()}><RefreshCw size={16}/>Tentar novamente</button></div>}
      {tab === 'schedule' && <><section className="journey-hero"><div className="hero-content"><p className="eyebrow"><Sparkles size={13}/>{now ? travelStatus.message : 'Nossa próxima aventura'}</p><h1>{data.trip.name}</h1><p className="hero-subtitle">Um lugar para sonhar, planejar e guardar<br className="desktop-break"/> os momentos que vamos viver a dois.</p><div className="trip-details"><span><MapPin size={15}/>{data.trip.destination || 'Destino a escolher'}</span><i/><span><CalendarDays size={15}/>{data.trip.start_date ? `${shortDate(data.trip.start_date)}${data.trip.end_date ? ` — ${shortDate(data.trip.end_date)}` : ''}` : 'Datas a definir'}</span></div>{(data.trip.person_one || data.trip.person_two) && <p className="couple-names"><Heart size={13}/>{[data.trip.person_one, data.trip.person_two].filter(Boolean).join(' & ')}</p>}<button className="hero-edit" onClick={() => navigate('trip')}><Settings2 size={14}/>Personalizar nossa viagem<ArrowRight size={14}/></button></div>
        <JourneyIllustration/>
      </section><div className="mini-summary"><div className="mini-total"><span className="summary-icon"><Wallet size={21}/></span><div><span>Saldo disponível</span><strong>{budgetView.spendingSituation === 'undefined' ? 'Não definido' : balanceText(budgetView.availableCents)}</strong><small>após os gastos</small></div></div><div><span className="summary-icon light"><CalendarDays size={20}/></span><div><span>Momentos planejados</span><strong>{totals.activityCount}<small>{totals.activityCount === 1 ? 'atividade' : 'atividades'}</small></strong></div></div><div className="budget-pending"><span className="summary-icon pink-icon"><Heart size={20}/></span><div><span>Ainda vamos decidir</span><strong>{totals.undefinedBudgetCount}<small>orçamento{totals.undefinedBudgetCount === 1 ? '' : 's'} a definir</small></strong></div></div><button className="summary-link" onClick={() => navigate('summary')}>Ver resumo<ArrowRight size={16}/></button></div></>}
      {data.status === 'loading' ? <div className="loading-state" role="status"><LoaderCircle size={30} className="spin"/><p>Preparando nosso cantinho…</p></div> : tab === 'schedule' ? <Schedule activities={data.activities} expenses={data.expenses} expensesReady={data.expensesReady} trip={data.trip} online={data.online} onAdd={add} onEdit={activity => setEditing({ activity, key: crypto.randomUUID() })} onDuplicate={activity => setEditing({ activity, duplicate: true, key: crypto.randomUUID() })} onDelete={activity => { setDeleteError(''); setDeleting(activity); }} onDefineBudget={() => navigate('trip', { focusBudget: true })}/>
      : tab === 'expenses' ? <Expenses expenses={data.expenses} activities={data.activities} trip={data.trip} online={data.online} ready={data.expensesReady} lastSaved={lastSavedExpense} onAdd={addExpense} onEdit={expense => setEditingExpense({ expense, key: crypto.randomUUID() })} onDelete={expense => { setDeleteError(''); setDeletingExpense(expense); }} onDefineBudget={() => navigate('trip', { focusBudget: true })}/>
      : tab === 'summary' ? <TripSummary activities={data.activities} expenses={data.expenses} trip={data.trip} expensesReady={data.expensesReady} offline={!data.online} onOpenExpenses={() => navigate('expenses')} onDefineBudget={() => navigate('trip', { focusBudget: true })}/>
      : <><div className="page-heading"><p className="eyebrow"><Heart size={13}/>Nossa próxima aventura</p><h1>Detalhes de {data.trip.name}</h1><p>Os detalhes que fazem essa história ser de vocês.</p></div><TripSettings key={data.trip.id} trip={data.trip} online={data.online} focusBudget={focusBudget} onDirtyChange={setSettingsDirty} onSave={(...args) => runWrite(() => data.updateTrip(...args))} onLoadLatest={data.latestTrip} onBudgetFocused={() => setFocusBudget(false)}/></>}
      <footer className="page-footer"><span><Heart size={12}/>Feito para nossos próximos momentos.</span><span><a href="/termos" className="hover:underline">Termos</a> · <a href="/privacidade" className="hover:underline">Privacidade</a></span>{data.syncedAt && data.online && <span><span className="status-dot success-dot"/>Sincronizado às {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: data.trip.timezone }).format(new Date(data.syncedAt))}</span>}</footer><div className="pwa-controls"><PwaManager hasUnsavedChanges={unsaved}/></div>
    </main>
    <nav className="mobile-nav" aria-label="Navegação principal no celular">{nav.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={21} strokeWidth={1.7}/><span>{item.label}</span></button>)}</nav>
    {tab === 'schedule' && !editing && <button className="mobile-add" onClick={add} aria-label="Adicionar atividade"><Plus size={25}/></button>}
    {tab === 'expenses' && !editingExpense && data.expensesReady && <button className="mobile-add" onClick={addExpense} aria-label="Adicionar gasto"><Plus size={25}/></button>}
    {editing && <ActivityForm key={editing.key} activity={editing.activity} duplicate={editing.duplicate} trip={data.trip} online={data.online} onDirtyChange={setFormDirty} onClose={() => setEditing(current => current?.key === editing.key ? null : current)} onSave={async (...args) => { await runWrite(() => data.saveActivity(...args)); setToast('Atividade salva na nossa viagem.'); }} onLoadLatest={async id => { const activity = await data.latestActivity(id); setEditing({ activity, key: crypto.randomUUID() }); }}/>}
    {editingExpense && <ExpenseForm key={editingExpense.key} expense={editingExpense.expense} trip={data.trip} activities={data.activities} online={data.online} onDirtyChange={setFormDirty} onClose={() => setEditingExpense(current => current?.key === editingExpense.key ? null : current)} onSave={async (...args) => { const saved = await runWrite(() => data.saveExpense(...args)); setLastSavedExpense(saved); setToast('Gasto salvo na nossa viagem.'); }} onLoadLatest={async id => { const expense = await data.latestExpense(id); setEditingExpense({ expense, key: crypto.randomUUID() }); }}/>}
    {deleting && <Modal title="Excluir este momento?" subtitle="Você pode adicionar uma nova atividade depois." onClose={() => { if (!deleteBusy) setDeleting(null); }}><div className="delete-content"><p>Excluir <strong>{deleting.name}</strong> do cronograma? A reserva dessa atividade sai do planejamento. O orçamento inicial e os gastos registrados permanecem.</p>{linkedToDeleting.length > 0 && <div className="notice linked-notice"><Receipt size={18}/><span>{linkedToDeleting.length === 1 ? 'Há 1 gasto vinculado a esta atividade. Ele será preservado na aba Gastos; apenas o vínculo será removido.' : `Há ${linkedToDeleting.length} gastos vinculados a esta atividade. Eles serão preservados na aba Gastos; apenas o vínculo será removido.`}</span></div>}{deleteError && <div className="notice notice-error" role="alert"><p>{deleteError}</p>{deleteError.includes('outro aparelho') && <button className="text-button" onClick={async () => { try { const latest = await data.latestActivity(deleting.id); setDeleting(latest); setDeleteError(''); } catch (err) { setDeleteError(friendlyError(err)); } }}><RefreshCw size={16}/>Carregar versão atual</button>}</div>}<div className="form-footer"><button className="button-secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>Manter atividade</button><button className="button-danger" disabled={deleteBusy || !data.online} onClick={() => void remove()}>{deleteBusy ? <LoaderCircle size={17} className="spin"/> : <Trash2 size={17}/>}Excluir atividade</button></div></div></Modal>}
    {deletingExpense && <Modal title="Excluir este gasto?" subtitle="A atividade relacionada, se houver, não será alterada." onClose={() => { if (!deleteBusy) setDeletingExpense(null); }}><div className="delete-content"><p>Excluir <strong>{deletingExpense.description}</strong> no valor de <strong>{formatCurrency(deletingExpense.amount_cents)}</strong>? Os totais serão atualizados automaticamente.</p>{deleteError && <div className="notice notice-error" role="alert"><p>{deleteError}</p>{deleteError.includes('outro aparelho') && <button className="text-button" onClick={async () => { try { const latest = await data.latestExpense(deletingExpense.id); setDeletingExpense(latest); setDeleteError(''); } catch (err) { setDeleteError(friendlyError(err)); } }}><RefreshCw size={16}/>Carregar versão atual</button>}</div>}<div className="form-footer"><button className="button-secondary" disabled={deleteBusy} onClick={() => setDeletingExpense(null)}>Manter gasto</button><button className="button-danger" disabled={deleteBusy || !data.online} onClick={() => void removeExpense()}>{deleteBusy ? <LoaderCircle size={17} className="spin"/> : <Trash2 size={17}/>}Excluir gasto</button></div></div></Modal>}
    {setup && <Modal title="Vamos preparar a nossa viagem" subtitle="Uma configuração inicial, sem login ou senha no aplicativo." onClose={() => setSetup(false)}><div className="setup-content"><p>Para guardar os planos desta viagem:</p><ol><li>Configure o Supabase, habilite Anonymous Sign-Ins e aplique as migrações indicadas no README.</li><li>Preencha as configurações do arquivo de exemplo e reinicie o aplicativo.</li><li>Cadastre sua viagem. O aplicativo continua sem login e senha.</li></ol><p className="notice">Até a conexão ser configurada, não será possível salvar. Nenhuma atividade ou informação pessoal foi preenchida.</p><button className="button-primary" onClick={() => setSetup(false)}>Entendi<Check size={17}/></button></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}<button aria-label="Fechar mensagem" onClick={() => setToast('')}><X size={16}/></button></div>}
  </div>;
}
