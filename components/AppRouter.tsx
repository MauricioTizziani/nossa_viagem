'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import TravelApp from './TravelApp';
import TripsHome from './TripsHome';
import { tripTabs, type TravelTab } from '@/lib/navigation';

/** Route identity is local to this browser. The database validates access separately. */
export default function AppRouter() {
  const pathname = usePathname();
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const dirty = useRef(false);
  const busy = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; }, []);
  const onBusyChange = useCallback((value: boolean) => { busy.current = value; }, []);
  const navigate = useCallback((path: string) => {
    if (!path.startsWith('/') || path.startsWith('//')) return false;
    if (busy.current) { window.alert('Aguarde a confirmação do salvamento antes de mudar de tela ou viagem.'); return false; }
    if (dirty.current && !window.confirm('Descartar as alterações do formulário antes de mudar de tela ou viagem?')) return false;
    dirty.current = false;
    setCurrentPath(path);
    window.history.pushState(null, '', path);
    window.scrollTo({ top: 0 });
    return true;
  }, []);

  useEffect(() => {
    const requested = window.location.pathname;
    if (currentPath === null) { setCurrentPath(requested); return; }
    if (requested === currentPath) return;
    if (busy.current) {
      window.history.pushState(null, '', currentPath);
      window.alert('Aguarde a confirmação do salvamento antes de mudar de tela ou viagem.');
      return;
    }
    // Browser Back/Forward receives the same draft protection as app navigation.
    if (dirty.current && !window.confirm('Descartar as alterações do formulário antes de mudar de tela ou viagem?')) {
      window.history.pushState(null, '', currentPath);
      return;
    }
    dirty.current = false;
    setCurrentPath(requested);
  }, [pathname, currentPath]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || busy.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);

  if (currentPath === null) return <main className="main-content loading-state" role="status">Preparando nossas viagens…</main>;
  let screen: React.ReactNode;
  if (currentPath === '/' || currentPath === '/viagens' || currentPath === '/viagens/' || currentPath === '/viagens/nova') {
    screen = <TripsHome key={currentPath === '/viagens/nova' ? 'new-trip' : 'trip-list'} create={currentPath === '/viagens/nova'} onNavigate={navigate} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange}/>;
  } else {
    const parts = currentPath.split('/').filter(Boolean);
    const tab = (Object.entries(tripTabs).find(([, segment]) => segment === parts[2])?.[0] ?? 'schedule') as TravelTab;
    if (parts[0] !== 'viagens' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[1] ?? '') || parts.length > 3 || (parts[2] && !Object.values(tripTabs).includes(parts[2]))) {
      screen = <main className="main-content"><h1>Este endereço não está disponível</h1><button className="button-primary" onClick={() => navigate('/viagens')}>Voltar para Minhas viagens</button></main>;
    } else {
      screen = <TravelApp key={parts[1]} tripId={parts[1]} tab={tab} onNavigate={navigate} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange}/>;
    }
  }
  // Retain an unaccepted draft in memory, but never paint the previous trip under a new URL.
  const pendingNavigation = pathname !== currentPath;
  return <>{pendingNavigation && <main className="main-content loading-state" role="status">Abrindo nossas viagens…</main>}<div hidden={pendingNavigation}>{screen}</div></>;
}
