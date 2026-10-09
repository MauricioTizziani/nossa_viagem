'use client';
import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, CalendarDays, Heart, LoaderCircle, MapPin, MoreHorizontal, Pencil, Plus, RefreshCw, Search, ShieldCheck, Sparkles, WifiOff } from 'lucide-react';
import { DEFAULT_TIMEZONE, type Trip, type TripCard, type TripListFilter } from '@/lib/types';
import { formatCurrency, tripStatus } from '@/lib/domain';
import { UNDEFINED_BUDGET_LABEL } from '@/lib/budget';
import { orderedTrips, TRIP_GROUP_LABELS, TRIP_PHASE_LABELS, TRIP_PHASE_ORDER, tripPeriod } from '@/lib/trips';
import { useTrips } from '@/lib/useTrips';
import { friendlyError } from '@/lib/useTravelData';
import TripSettings from './TripSettings';
import Modal from './Modal';
import PwaManager from './PwaManager';
import JourneyIllustration from './JourneyIllustration';

const filters: { value: TripListFilter; label: string }[] = [{ value: 'all', label: 'Todas' }, { value: 'upcoming', label: 'Próximas' }, { value: 'ongoing', label: 'Em andamento' }, { value: 'past', label: 'Passadas' }, { value: 'archived', label: 'Arquivadas' }];
const emptyTrip: Trip = { id: '', name: '', destination: '', start_date: null, end_date: null, timezone: DEFAULT_TIMEZONE, person_one: null, person_two: null, initial_budget_cents: null, version: 0 };

export default function TripsHome({ create = false, onNavigate, onDirtyChange, onBusyChange }: {
  create?: boolean; onNavigate: (path: string) => boolean | void; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TripListFilter>('all');
  const data = useTrips({ search: query, filter });
  const [now, setNow] = useState<Date | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [collectionDirty, setCollectionDirty] = useState(false);
  const dirty = formDirty || collectionDirty;
  const [selectedCollection, setSelectedCollection] = useState('');
  const collectionTouched = useRef(false);
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<TripCard | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const archiveLocked = useRef(false);
  const [actionError, setActionError] = useState('');
  const [toast, setToast] = useState('');
  const invitedOpened = useRef<string | null>(null);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick(); const timer = setInterval(tick, 60000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!collectionTouched.current && data.collections.length) setSelectedCollection(data.collections[0].id); }, [data.collections]);
  useEffect(() => {
    if (createdTripId) onNavigate(`/viagens/${createdTripId}/cronograma`);
  }, [createdTripId, onNavigate]);
  useEffect(() => {
    if (!data.invitedTripId || create || invitedOpened.current === data.invitedTripId) return;
    invitedOpened.current = data.invitedTripId;
    onNavigate(`/viagens/${data.invitedTripId}/cronograma`);
  }, [data.invitedTripId, create, onNavigate]);
  async function archive() {
    if (!archiving || archiveLocked.current) return;
    archiveLocked.current = true; setArchiveBusy(true); onBusyChange(true); setActionError('');
    try {
      const wasArchived = Boolean(archiving.archived_at);
      await data.archiveTrip(archiving, !wasArchived);
      setArchiving(null); setToast(wasArchived ? 'Viagem desarquivada. Sua história continua guardada.' : 'Viagem arquivada. Todos os seus registros foram preservados.');
    } catch (err) { setActionError(friendlyError(err)); }
    finally { archiveLocked.current = false; setArchiveBusy(false); onBusyChange(false); }
  }
  function collectionLabel(id: string, index: number) {
    const example = data.trips.find(trip => trip.collection_id === id);
    return example ? `Coleção de ${example.name}` : `Nossas viagens ${data.collections.length > 1 ? `· coleção ${index + 1}` : ''}`;
  }
  const sorted = orderedTrips(data.trips, now ?? new Date());
  const visibleGroups = TRIP_PHASE_ORDER.map(phase => ({ phase, trips: sorted.filter(trip => tripStatus(trip, now ?? new Date()).phase === phase) })).filter(group => group.trips.length);
  const displaySyncedAt = data.syncedAt ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: DEFAULT_TIMEZONE }).format(new Date(data.syncedAt)) : null;
  return <div className="app-shell trips-shell">
    <header className="topbar"><div className="topbar-inner"><a className="brand" href="/viagens" onClick={event => { event.preventDefault(); onNavigate('/viagens'); }} aria-label="Nossas Viagens, Minhas viagens"><img src="/logo.png" alt="" width="48" height="48"/><span>Nossas <strong>Viagens</strong><small>nosso cantinho de planos</small></span></a><div className="header-actions"><span className="private-label"><ShieldCheck size={14}/>Nossas viagens privadas</span>{create ? <button className="button-secondary" onClick={() => onNavigate('/viagens')}><ArrowLeft size={16}/>Minhas viagens</button> : <button className="button-primary" onClick={() => onNavigate('/viagens/nova')}><Plus size={17}/>Nova viagem</button>}</div></div></header>
    <main className="main-content trips-main">
      {!data.online && <div className="connection-banner" role="status"><WifiOff size={20}/><div><strong>Consulta offline neste aparelho</strong><span>{displaySyncedAt ? `Última sincronização da lista: ${displaySyncedAt}. ` : ''}Somente as viagens sincronizadas neste aparelho estão disponíveis; o histórico pode estar incompleto. Conecte-se para confirmar cadastros, alterações e arquivamentos.</span></div></div>}
      {data.status === 'unconfigured' && <div className="notice access-notice"><ShieldCheck size={19}/><p>Conecte o Supabase e aplique as migrações descritas no README para guardar suas viagens. Nenhuma viagem foi preenchida automaticamente.</p></div>}
      {data.error && <div className="notice notice-error app-error" role="alert"><p>{data.error}</p><button className="text-button" disabled={!data.online} onClick={() => void data.refresh()}><RefreshCw size={16}/>Tentar novamente</button></div>}
      {create ? <>
        <div className="page-heading"><p className="eyebrow"><Sparkles size={13}/>Qual será o próximo destino?</p><h1>Nova viagem</h1><p>Comece a planejar uma nova viagem. As anteriores continuam com vocês.</p></div>
        {!!data.collections.length && <section className="paper-card new-trip-collection"><label className="field-label">Guardar com quais viagens?<select value={selectedCollection} onChange={event => { collectionTouched.current = true; setSelectedCollection(event.target.value); setCollectionDirty(true); }}>{data.collections.map((collection, index) => <option key={collection.id} value={collection.id}>{collectionLabel(collection.id, index)}</option>)}<option value="">Criar uma coleção privada separada</option></select><span className="field-hint">A nova viagem fica agrupada com as viagens da coleção escolhida.</span></label></section>}
        <TripSettings mode="create" trip={emptyTrip} online={data.online} canSave={data.status === 'ready'} onDirtyChange={setFormDirty} onLoadLatest={async () => emptyTrip} onSave={async values => {
          onBusyChange(true);
          try {
            const saved = await data.createTrip(values, selectedCollection || null);
            setFormDirty(false); setCollectionDirty(false); onDirtyChange(false); setCreatedTripId(saved.id);
          } finally { onBusyChange(false); }
        }}/>
      </> : <>
        <section className="trips-welcome"><div className="trips-welcome-copy"><p className="eyebrow"><Heart size={14}/>Nossas próximas aventuras</p><h1>Minhas viagens</h1><p>Novos destinos pela frente, memórias sempre por perto.</p></div><JourneyIllustration/></section>
        <div className="trips-toolbar"><label className="trips-search"><Search size={19}/><span className="sr-only">Pesquisar por nome ou destino</span><input type="search" placeholder="Pesquisar por nome ou destino" value={search} onChange={event => setSearch(event.target.value)}/></label></div>
        <nav className="trips-filters" aria-label="Filtrar viagens">{filters.map(item => <button key={item.value} aria-pressed={filter === item.value} className={filter === item.value ? 'active' : ''} onClick={() => setFilter(item.value)}>{item.value === 'archived' && <Archive size={14}/>} {item.label}</button>)}</nav>
        {data.status === 'loading' ? <div className="loading-state" role="status"><LoaderCircle size={30} className="spin"/><p>Preparando nossas aventuras…</p></div> : !sorted.length ? <section className="paper-card trips-empty"><span className="section-icon pink-icon"><Heart size={25}/></span><h2>{search.trim() ? 'Nenhuma viagem por aqui' : filter === 'archived' ? 'Memórias guardadas com carinho' : filter !== 'all' ? 'Nenhuma viagem neste período' : 'Qual será o próximo destino?'}</h2><p>{search.trim() ? 'Tente outro nome ou destino para encontrar sua viagem.' : filter === 'archived' ? 'As viagens que vocês arquivarem aparecerão aqui, com todos os seus registros.' : filter !== 'all' ? 'Suas viagens aparecem aqui conforme as datas de cada aventura.' : 'Comece a planejar uma nova viagem. Este cantinho vai guardar suas próximas aventuras e as memórias das anteriores.'}</p>{filter === 'all' && !search.trim() && <button className="button-primary" onClick={() => onNavigate('/viagens/nova')}><Plus size={17}/>Cadastrar primeira viagem</button>}</section> : <div className="trip-groups">{visibleGroups.map(group => <section className="trip-group" key={group.phase}><div className="trip-group-heading"><h2>{filter === 'archived' ? `Arquivadas · ${TRIP_PHASE_LABELS[group.phase]}` : TRIP_GROUP_LABELS[group.phase]}</h2><span>{group.trips.length} {group.trips.length === 1 ? 'viagem' : 'viagens'} carregadas</span></div><div className="trips-grid">{group.trips.map(trip => <article className="paper-card trip-card" key={trip.id}>
          <div className="trip-card-top"><span className={`trip-phase ${group.phase}`}>{trip.archived_at ? <Archive size={13}/> : <Heart size={13}/>} {trip.archived_at ? 'Arquivada' : TRIP_PHASE_LABELS[group.phase]}</span><details className="trip-card-menu"><summary aria-label={`Ações de ${trip.name}`}><MoreHorizontal size={21}/></summary><div><button onClick={() => onNavigate(`/viagens/${trip.id}/detalhes`)}><Pencil size={15}/>Editar viagem</button><button disabled={!data.online} onClick={() => { setActionError(''); setArchiving(trip); }}>{trip.archived_at ? <ArchiveRestore size={15}/> : <Archive size={15}/>} {trip.archived_at ? 'Desarquivar' : 'Arquivar'}</button></div></details></div>
          <h3>{trip.name}</h3><p className="trip-card-destination"><MapPin size={15}/>{trip.destination || 'Destino a definir'}</p><p className="trip-card-period"><CalendarDays size={15}/>{tripPeriod(trip)}</p><dl className="trip-card-money"><div><dt>Orçamento inicial</dt><dd className={trip.initial_budget_cents === null ? 'undefined-budget' : ''}>{trip.initial_budget_cents === null ? UNDEFINED_BUDGET_LABEL : formatCurrency(trip.initial_budget_cents)}</dd></div><div><dt>Total gasto</dt><dd>{formatCurrency(trip.total_spent_cents)}</dd></div></dl>
          {!data.online && <p className="trip-offline-status"><WifiOff size={13}/><span>{trip.offline_available ? `Cronograma e gastos sincronizados${trip.synced_at ? ` em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: trip.timezone }).format(new Date(trip.synced_at))}` : ''}.` : 'Somente dados da lista. Abra com conexão para sincronizar cronograma e gastos.'}</span></p>}
          <button className="button-secondary trip-card-open" onClick={() => onNavigate(`/viagens/${trip.id}/cronograma`)}>Abrir viagem<ArrowRight size={16}/></button>
        </article>)}</div></section>)}</div>}
        {data.hasMore && <div className="trips-load-more"><button className="button-secondary" disabled={data.loadingMore || !data.online} onClick={() => void data.loadMore()}>{data.loadingMore ? <LoaderCircle size={17} className="spin"/> : <Plus size={17}/>} {data.loadingMore ? 'Carregando…' : 'Mostrar mais viagens'}</button></div>}
      </>}
      <footer className="page-footer"><span><Heart size={12}/>Feito para nossos próximos momentos.</span><span><a href="/termos">Termos</a> · <a href="/privacidade">Privacidade</a></span>{displaySyncedAt && data.online && <span>Lista sincronizada em {displaySyncedAt}</span>}</footer><div className="pwa-controls"><PwaManager hasUnsavedChanges={dirty}/></div>
    </main>
    {archiving && <Modal title={archiving.archived_at ? 'Trazer esta viagem de volta?' : 'Guardar esta viagem no arquivo?'} subtitle="Cronograma, gastos e orçamento permanecem salvos." onClose={() => { if (!archiveBusy) setArchiving(null); }}><div className="delete-content"><p>{archiving.archived_at ? <>Desarquivar <strong>{archiving.name}</strong> para voltar à lista de viagens? Sua situação será atualizada pelas datas atuais.</> : <>Arquivar <strong>{archiving.name}</strong>? Você poderá abri-la e fazer ajustes pelo filtro Arquivadas.</>}</p>{actionError && <p className="notice notice-error" role="alert">{actionError}</p>}<div className="form-footer"><button className="button-secondary" disabled={archiveBusy} onClick={() => setArchiving(null)}>Cancelar</button><button className="button-primary" disabled={archiveBusy || !data.online} onClick={() => void archive()}>{archiveBusy ? <LoaderCircle size={17} className="spin"/> : archiving.archived_at ? <ArchiveRestore size={17}/> : <Archive size={17}/>} {archiving.archived_at ? 'Desarquivar viagem' : 'Arquivar viagem'}</button></div></div></Modal>}
    {toast && <div className="toast" role="status"><CheckIcon/>{toast}</div>}
  </div>;
}

function CheckIcon() { return <ShieldCheck size={17}/>; }
