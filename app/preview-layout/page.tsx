'use client';

import { useState } from 'react';
import TripSettings from '@/components/TripSettings';
import { Schedule } from '@/components/Schedule';
import { Expenses } from '@/components/Expenses';
import { TripSummary } from '@/components/TripSummary';
import { EMPTY_PLACE, type Activity, type Expense, type Trip } from '@/lib/types';

const trip: Trip = {
  id: 'preview',
  name: 'Porto Alegre',
  destination: 'Porto Alegre',
  start_date: '2026-11-08',
  end_date: '2026-11-11',
  timezone: 'America/Sao_Paulo',
  person_one: 'Maurício',
  person_two: 'Andreina',
  initial_budget_cents: 200000,
  version: 1,
};

const activities: Activity[] = [
  { id: 'a1', trip_id: trip.id, name: 'Caminhada no centro', starts_at: '2026-11-08T15:00:00Z', budget_cents: 8000, type: 'Lazer', version: 1, ...EMPTY_PLACE },
  { id: 'a2', trip_id: trip.id, name: 'Jantar', starts_at: '2026-11-09T23:00:00Z', budget_cents: 15000, type: 'Refeição', version: 1, ...EMPTY_PLACE },
];

const expenses: Expense[] = [
  { id: 'e1', trip_id: trip.id, description: 'Café da manhã', category: 'Alimentação', amount_cents: 4500, expense_date: '2026-11-08', activity_id: null, notes: null, version: 1 },
];

const panels = ['detalhes', 'cronograma', 'gastos', 'resumo'] as const;

export default function PreviewLayout() {
  const [panel, setPanel] = useState<(typeof panels)[number]>('detalhes');
  return <div className="app-shell"><header className="topbar"><div className="topbar-inner"><a className="brand" href="#"><img src="/logo.png" alt="" width="48" height="48"/><span>Nossas <strong>Viagens</strong><small>nosso cantinho de planos</small></span></a><nav className="desktop-nav">{panels.map(item => <button key={item} className={panel === item ? 'active' : ''} onClick={() => setPanel(item)}>{item}</button>)}</nav></div></header><main className="main-content"><div className="trip-context"><button className="text-button">← Minhas viagens</button><div><strong>{trip.name}</strong><span>{trip.destination}</span></div><button className="button-secondary">Trocar viagem</button></div>{panel === 'detalhes' && <><div className="page-heading"><p className="eyebrow">Nossa próxima aventura</p><h1>Detalhes de {trip.name}</h1><p>Os detalhes que fazem essa história ser de vocês.</p></div><TripSettings trip={trip} online canSave mode="edit" onDirtyChange={() => {}} onLoadLatest={async () => trip} onSave={async () => {}}/></>}{panel === 'cronograma' && <Schedule activities={activities} expenses={expenses} expensesReady trip={trip} online onAdd={() => {}} onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}}/>}{panel === 'gastos' && <Expenses expenses={expenses} activities={activities} trip={trip} online ready onAdd={() => {}} onEdit={() => {}} onDelete={() => {}}/>}{panel === 'resumo' && <TripSummary activities={activities} expenses={expenses} trip={trip} expensesReady/>}</main><nav className="mobile-nav">{panels.map(item => <button key={item} className={panel === item ? 'active' : ''} onClick={() => setPanel(item)}><span>{item}</span></button>)}</nav></div>;
}
