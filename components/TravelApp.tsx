'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Heart, MapPin, Plane, Plus, RefreshCw, Settings2, Share2, Sparkles, Wallet, WifiOff, X, LoaderCircle, Trash2 } from 'lucide-react';
import type { Activity } from '@/lib/types';
import { formatCurrency, summarizeActivities, tripStatus } from '@/lib/domain';
import { friendlyError, useTravelData } from '@/lib/useTravelData';
import { Schedule } from './Schedule';
import { TripSummary } from './TripSummary';
import ActivityForm from './ActivityForm';
import TripSettings from './TripSettings';
import TripLink from './TripLink';
import PwaManager from './PwaManager';
import Modal from './Modal';

type Tab = 'schedule' | 'summary' | 'trip';
const nav = [{ id: 'schedule' as const, label: 'Cronograma', icon: CalendarDays }, { id: 'summary' as const, label: 'Resumo', icon: Wallet }, { id: 'trip' as const, label: 'Nossa viagem', icon: Heart }];
function shortDate(day: string) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z')); }

export default function TravelApp() {
  const data = useTravelData();
  const [tab, setTab] = useState<Tab>('schedule');
  const [editing, setEditing] = useState<{ activity?: Activity; duplicate?: boolean; key: string } | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [setup, setSetup] = useState(false);
  const [deleting, setDeleting] = useState<Activity | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [toast, setToast] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  const totals = summarizeActivities(data.activities);
  const travelStatus = tripStatus(data.trip, now ?? new Date());
  const unsaved = formDirty || settingsDirty;
  useEffect(() => { setNow(new Date()); const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, [unsaved]);
  function navigate(next: Tab) {
    if (next === tab) return;
    if (settingsDirty && !window.confirm('Descartar as alterações da viagem antes de mudar de tela?')) return;
    setSettingsDirty(false); setTab(next);
  }
  function add() { setEditing({ key: crypto.randomUUID() }); }
  async function remove() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true); setDeleteError('');
    try { await data.deleteActivity(deleting); setDeleting(null); setToast('Atividade excluída.'); }
    catch (err) { setDeleteError(friendlyError(err)); await data.refresh(); }
    finally { setDeleteBusy(false); }
  }
  const synchronized = data.status === 'ready';
  return <div className="app-shell"><header className="topbar"><div className="topbar-inner"><a className="brand" href="/" onClick={e => { e.preventDefault(); navigate('schedule'); }} aria-label="Nossa Viagem, cronograma"><img src="/logo.png" alt="" width="48" height="48"/><span>Nossa <strong>Viagem</strong><small>nosso cantinho de planos</small></span></a>
    <nav className="desktop-nav" aria-label="Navegação principal">{nav.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={17} strokeWidth={1.7}/>{item.label}</button>)}</nav>
    <div className="header-actions"><span className="private-label"><Heart size={13}/>Viagem compartilhada</span><button className="icon-button share-top" aria-label="Compartilhar viagem" title="Compartilhar viagem" disabled={!synchronized} onClick={() => setSharing(true)}><Share2 size={19}/></button></div></div></header>
    <main className="main-content">
      {!data.online && <div className="connection-banner" role="status"><WifiOff size={18}/><div><strong>Você está offline</strong><span>{data.syncedAt ? `Última sincronização: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: data.trip.timezone }).format(new Date(data.syncedAt))}. Consulta disponível; conecte-se para salvar.` : 'Abra a viagem com conexão para sincronizar neste aparelho.'}</span></div></div>}
      {data.status === 'unconfigured' && <div className="setup-banner"><div><span className="status-dot"/><span>Sua viagem está pronta para ser conectada.</span></div><button onClick={() => setSetup(true)}>Como começar<ArrowRight size={15}/></button></div>}
      {data.error && <div className="notice notice-error app-error" role="alert"><p>{data.error}</p><button className="text-button" onClick={() => void data.refresh()}><RefreshCw size={16}/>Tentar novamente</button></div>}
      {tab === 'schedule' && <><section className="journey-hero"><div className="hero-content"><p className="eyebrow"><Sparkles size={13}/>{now ? travelStatus.message : 'Nossa próxima aventura'}</p><h1>{data.trip.name === 'Nossa Viagem' ? <>A próxima aventura<br/>é <em>nossa.</em></> : data.trip.name}</h1><p className="hero-subtitle">Um lugar para sonhar, planejar e guardar<br className="desktop-break"/> os momentos que vamos viver a dois.</p><div className="trip-details"><span><MapPin size={15}/>{data.trip.destination || 'Destino a escolher'}</span><i/><span><CalendarDays size={15}/>{data.trip.start_date ? `${shortDate(data.trip.start_date)}${data.trip.end_date ? ` — ${shortDate(data.trip.end_date)}` : ''}` : 'Datas a combinar'}</span></div>{(data.trip.person_one || data.trip.person_two) && <p className="couple-names"><Heart size={13}/>{[data.trip.person_one, data.trip.person_two].filter(Boolean).join(' & ')}</p>}<button className="hero-edit" onClick={() => navigate('trip')}><Settings2 size={14}/>Personalizar nossa viagem<ArrowRight size={14}/></button></div>
        <div className="hero-art" aria-hidden="true"><span className="art-spark one">✧</span><span className="art-spark two">✧</span><svg className="art-route" viewBox="0 0 340 215" fill="none"><path d="M15 180C70 195 62 115 123 132S200 190 210 125 270 110 297 58" stroke="#9cb8d2" strokeWidth="2" strokeDasharray="5 8"/><circle cx="16" cy="180" r="5" fill="#fffdf9" stroke="#9cb8d2" strokeWidth="2"/><circle cx="211" cy="127" r="5" fill="#f3d8e2" stroke="#b6cce0" strokeWidth="2"/></svg><Plane className="art-plane" size={40} strokeWidth={1.2}/><div className="postcard"><div className="postcard-picture"><svg viewBox="0 0 200 110" fill="none"><circle cx="152" cy="28" r="15" fill="#f3d8e2"/><path d="M0 110L62 24 110 110Z" fill="#b7cfe3"/><path d="M55 110L125 42 200 110Z" fill="#8eacc8"/><path d="M53 37L62 24 75 43 65 39Z" fill="#fffdf9"/><path d="M0 89C46 74 73 107 126 90S184 85 200 82V110H0Z" fill="#dcebf6"/><path d="M70 110C86 94 89 101 104 92S124 85 122 76" stroke="#fffdf9" strokeWidth="5"/></svg><div className="postcard-heart"><Heart size={16}/></div></div><p>O melhor destino<br/><em>é estar com você.</em></p></div><span className="art-caption">colecionando momentos</span></div>
      </section><div className="mini-summary"><div className="mini-total"><span className="summary-icon"><Wallet size={21}/></span><div><span>Total da viagem</span><strong>{formatCurrency(totals.totalCents)}</strong><small>orçamento previsto</small></div></div><div><span className="summary-icon light"><CalendarDays size={20}/></span><div><span>Momentos planejados</span><strong>{totals.activityCount}<small>{totals.activityCount === 1 ? 'atividade' : 'atividades'}</small></strong></div></div><div className="budget-pending"><span className="summary-icon pink-icon"><Heart size={20}/></span><div><span>Ainda vamos decidir</span><strong>{totals.undefinedBudgetCount}<small>orçamento{totals.undefinedBudgetCount === 1 ? '' : 's'} a definir</small></strong></div></div><button className="summary-link" onClick={() => navigate('summary')}>Ver resumo<ArrowRight size={16}/></button></div></>}
      {data.status === 'loading' ? <div className="loading-state" role="status"><LoaderCircle size={30} className="spin"/><p>Preparando nosso cantinho…</p></div> : tab === 'schedule' ? <Schedule activities={data.activities} trip={data.trip} online={data.online} onAdd={add} onEdit={activity => setEditing({ activity, key: crypto.randomUUID() })} onDuplicate={activity => setEditing({ activity, duplicate: true, key: crypto.randomUUID() })} onDelete={activity => { setDeleteError(''); setDeleting(activity); }}/>
      : tab === 'summary' ? <TripSummary activities={data.activities} trip={data.trip}/>
      : <><div className="page-heading"><p className="eyebrow"><Heart size={13}/>Nossa próxima aventura</p><h1>Nossa viagem</h1><p>Os detalhes que fazem essa história ser de vocês.</p></div><TripSettings key={data.trip.id} trip={data.trip} online={data.online} canShare={synchronized} onDirtyChange={setSettingsDirty} onShare={() => setSharing(true)} onSave={data.updateTrip} onLoadLatest={data.latestTrip}/></>}
      <footer className="page-footer"><span><Heart size={12}/>Feito para nossos próximos momentos.</span><span><a href="/termos" className="hover:underline">Termos</a> · <a href="/privacidade" className="hover:underline">Privacidade</a></span>{data.syncedAt && data.online && <span><span className="status-dot success-dot"/>Sincronizado às {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: data.trip.timezone }).format(new Date(data.syncedAt))}</span>}</footer><div className="pwa-controls"><PwaManager hasUnsavedChanges={unsaved}/></div>
    </main>
    <nav className="mobile-nav" aria-label="Navegação principal no celular">{nav.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={21} strokeWidth={1.7}/><span>{item.label}</span></button>)}</nav>
    {tab === 'schedule' && !editing && <button className="mobile-add" onClick={add} aria-label="Adicionar atividade"><Plus size={25}/></button>}
    {editing && <ActivityForm key={editing.key} activity={editing.activity} duplicate={editing.duplicate} trip={data.trip} online={data.online} onDirtyChange={setFormDirty} onClose={() => setEditing(null)} onSave={async (...args) => { await data.saveActivity(...args); setToast('Atividade salva na nossa viagem.'); }} onLoadLatest={async id => { const activity = await data.latestActivity(id); setEditing({ activity, key: crypto.randomUUID() }); }}/>}
    {sharing && <TripLink onClose={() => setSharing(false)}/>}
    {deleting && <Modal title="Excluir este momento?" subtitle="Você pode adicionar uma nova atividade depois." onClose={() => { if (!deleteBusy) setDeleting(null); }}><div className="delete-content"><p>Excluir <strong>{deleting.name}</strong> do cronograma? O orçamento será atualizado automaticamente.</p>{deleteError && <div className="notice notice-error" role="alert"><p>{deleteError}</p>{deleteError.includes('outro aparelho') && <button className="text-button" onClick={async () => { try { const latest = await data.latestActivity(deleting.id); setDeleting(latest); setDeleteError(''); } catch (err) { setDeleteError(friendlyError(err)); } }}><RefreshCw size={16}/>Carregar versão atual</button>}</div>}<div className="form-footer"><button className="button-secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>Manter atividade</button><button className="button-danger" disabled={deleteBusy || !data.online} onClick={() => void remove()}>{deleteBusy ? <LoaderCircle size={17} className="spin"/> : <Trash2 size={17}/>}Excluir atividade</button></div></div></Modal>}
    {setup && <Modal title="Vamos preparar a nossa viagem" subtitle="Uma configuração inicial, sem login ou senha no aplicativo." onClose={() => setSetup(false)}><div className="setup-content"><p>Para guardar os planos e abrir a mesma viagem nos seus aparelhos:</p><ol><li>Configure o Supabase, habilite Anonymous Sign-Ins e aplique as migrações indicadas no README.</li><li>Preencha as configurações do arquivo de exemplo e reinicie o aplicativo.</li><li>Abra o endereço do aplicativo em qualquer aparelho. A mesma viagem será aberta automaticamente.</li></ol><p className="notice">Até a conexão ser configurada, não será possível salvar. Nenhuma atividade ou informação pessoal foi preenchida.</p><button className="button-primary" onClick={() => setSetup(false)}>Entendi<Check size={17}/></button></div></Modal>}
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}<button aria-label="Fechar mensagem" onClick={() => setToast('')}><X size={16}/></button></div>}
  </div>;
}
