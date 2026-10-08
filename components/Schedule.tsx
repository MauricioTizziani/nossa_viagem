"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, Check, Clock3, Copy, Heart, List, MapPin, Pencil, Plus, Receipt, Route, Search, SlidersHorizontal, Table2, Trash2, X } from "lucide-react";
import type { Activity, Expense, Trip } from "../lib/types";
import { dateKey, directionsUrl, filterActivities, formatCurrency, formatDateTime, formatDay, groupActivities, mapsUrl, nextActivity, sortActivities, summarizeActivities } from "../lib/domain";
import { tripBudgetView } from "../lib/budget";
import { BudgetFollowUp } from "./BudgetFollowUp";
import { compareActivityExpenses, describeActivitySpending } from "../lib/expenses";
import { OsmAttribution } from "./OsmPlacePicker";
import { CategoryBadge } from "./Icons";

interface ScheduleProps {
  activities: Activity[];
  /** Registered expenses; only linked ones are compared with the planned budget. */
  expenses?: Expense[];
  trip: Trip;
  online: boolean;
  onAdd: () => void;
  onEdit: (activity: Activity) => void;
  onDuplicate: (activity: Activity) => void;
  onDelete: (activity: Activity) => void;
  onDefineBudget?: () => void;
}

const fieldClass = "h-11 w-full rounded-xl border border-[#e3e8ef] bg-white px-3 text-sm text-[#415b77] outline-none transition focus:border-[#5c7fa3] focus:ring-3 focus:ring-[#dcebfa]";

function ActivityPlace({ activity, online }: { activity: Activity; online: boolean }) {
  const name = activity.osm_place_name || activity.manual_place_name || activity.manual_place_address;
  const address = activity.osm_place_address || activity.manual_place_address;
  const map = mapsUrl(activity);
  const route = directionsUrl(activity);

  if (!name && !activity.place_id && !activity.osm_place_id && !activity.manual_place_url) {
    return <span className="text-sm text-[#7f8b9a]">A definir</span>;
  }

  return (
    <div className="min-w-0">
      <div className="break-words text-sm font-medium leading-relaxed text-[#415b77]">{name || (activity.place_id ? "Lugar salvo antes da troca de mapas" : "Local informado por link")}</div>
      {address && address !== name && <p className="mt-0.5 break-words text-xs leading-relaxed text-[#6c7e91]">{address}</p>}
      {activity.osm_place_id ? <OsmAttribution /> : !activity.place_id && <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-[#6c7e91]">Informado manualmente</span>}
      {online ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {map && <a href={map} target="_blank" rel="noopener noreferrer" aria-label="Abrir mapa" className="inline-flex items-center gap-1 text-xs font-semibold text-[#52799f] underline-offset-4 hover:underline"><ArrowUpRight className="h-3 w-3" aria-hidden="true" />Abrir mapa</a>}
          {route && <a href={route} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#52799f] underline-offset-4 hover:underline"><Route className="h-3 w-3" aria-hidden="true" />Traçar rota</a>}
        </div>
      ) : <span className="mt-1 block text-xs text-[#6c7e91]">Mapas disponíveis com conexão</span>}
    </div>
  );
}

/* Complementary detail: linked expenses so far versus the plan. The five schedule columns stay untouched. */
function ActivitySpending({ activity, expenses }: { activity: Activity; expenses: Expense[] }) {
  const comparison = compareActivityExpenses(activity, expenses);
  const tone = comparison.count === 0 ? "text-[#8294a7]" : comparison.differenceCents !== null && comparison.differenceCents > 0 ? "text-[#a0657a]" : "text-[#5c7fa3]";
  return <span className={`inline-flex max-w-full items-start gap-1 text-[11px] leading-5 ${tone}`}><Receipt className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{describeActivitySpending(comparison)}</span></span>;
}

function ActivityActions({ activity, online, onEdit, onDuplicate, onDelete }: Pick<ScheduleProps, "online" | "onEdit" | "onDuplicate" | "onDelete"> & { activity: Activity }) {
  const button = "inline-flex h-11 w-11 items-center justify-center rounded-xl text-[#70859a] lg:h-10 lg:w-10 transition hover:bg-[#edf3f8] hover:text-[#3b5f86] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b5f86] disabled:cursor-not-allowed disabled:opacity-35";
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" className={button} onClick={() => onEdit(activity)} title="Editar atividade" aria-label={`Editar ${activity.name}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" className={button} onClick={() => onDuplicate(activity)} title="Duplicar atividade" aria-label={`Duplicar ${activity.name}`}><Copy className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" className={`${button} hover:bg-[#faedf2] hover:text-[#a45f74]`} onClick={() => onDelete(activity)} disabled={!online} title={online ? "Excluir atividade" : "Conecte-se para excluir"} aria-label={`Excluir ${activity.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
    </div>
  );
}

function EmptySchedule({ filtered, onAdd, onClear }: { filtered: boolean; onAdd: () => void; onClear: () => void }) {
  return (
    <div className="relative flex min-h-[330px] flex-col items-center justify-center overflow-hidden rounded-[26px] border border-dashed border-[#d5e1ee] bg-[#fffdf9] px-6 py-12 text-center">
      <div className="absolute right-8 top-8 rotate-12 text-[#eedde4]"><Heart className="h-6 w-6" strokeWidth={1.4} aria-hidden="true" /></div>
      <div className="mb-6 flex h-20 w-20 -rotate-6 items-center justify-center rounded-[24px] bg-[#eaf2fb] text-[#5c7fa3] shadow-[0_7px_0_#e3ebf5]"><CalendarDays className="h-9 w-9" strokeWidth={1.5} aria-hidden="true" /></div>
      <h3 className="text-xl font-semibold tracking-tight text-[#3b5f86]">{filtered ? "Nenhum plano por aqui" : "Nossa próxima aventura começa aqui"}</h3>
      <p className="mt-2 max-w-[340px] text-sm leading-6 text-[#6b7c8e]">{filtered ? "Experimente outro dia, tipo ou palavra para encontrar o que procuram." : "Um passeio, um jantar, um lugar especial. Vamos planejar nosso próximo momento?"}</p>
      <button type="button" onClick={filtered ? onClear : onAdd} className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#3b5f86] px-5 text-sm font-semibold text-white shadow-[0_5px_16px_#3b5f8622] transition hover:bg-[#52779d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3b5f86]">{filtered ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}{filtered ? "Limpar filtros" : "Adicionar primeira atividade"}</button>
    </div>
  );
}

export function Schedule({ activities, expenses = [], trip, online, onAdd, onEdit, onDuplicate, onDelete, onDefineBudget }: ScheduleProps) {
  const [view, setView] = useState<"table" | "timeline">("table");
  const [day, setDay] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const sorted = useMemo(() => sortActivities(activities), [activities]);
  const days = useMemo(() => [...new Set(sorted.map((activity) => dateKey(activity.starts_at, trip.timezone)))], [sorted, trip.timezone]);
  const filtered = filterActivities(sorted, { day, type: type as Activity["type"] | "", search }, trip.timezone);
  const groups = groupActivities(filtered, trip.timezone);
  const upcoming = nextActivity(sorted, now);
  const hasFilters = Boolean(day || type || search.trim());
  const { totalCents: subtotal, undefinedBudgetCount: undefinedBudgets } = summarizeActivities(filtered);
  const budget = tripBudgetView(trip, activities, expenses);
  const clear = () => { setDay(""); setType(""); setSearch(""); };
  const actions = { online, onEdit, onDuplicate, onDelete };

  return (
    <section aria-labelledby="schedule-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b7f94]"><Heart className="h-3.5 w-3.5 text-[#bf96aa]" aria-hidden="true" />Pequenos planos, grandes memórias</div>
          <h1 id="schedule-heading" className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-[#3b5f86] sm:text-[34px]">Nosso cronograma</h1>
          <p className="mt-2 text-sm text-[#667b91]">Cada momento tem um lugar na nossa viagem.</p>
        </div>
        <button type="button" onClick={onAdd} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[15px] bg-[#3b5f86] px-5 text-sm font-semibold text-white shadow-[0_5px_15px_#3b5f8624] transition hover:bg-[#52779d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3b5f86]"><Plus className="h-4 w-4" aria-hidden="true" />Adicionar atividade</button>
      </div>

      <BudgetFollowUp kind="planning" initialCents={budget.initialCents} usedCents={budget.planning.usedCents} undefinedBudgetCount={budget.undefinedBudgetCount} offline={!online} filtered={hasFilters} onDefineBudget={onDefineBudget} />

      <div className="rounded-[22px] border border-[#e3eaf2] bg-white p-4 shadow-[0_3px_18px_#3b5f8605] sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#6b7f94]"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />Encontrar nossos planos</span>
          {hasFilters && <button type="button" onClick={clear} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-[#5c7fa3] hover:underline"><X className="h-3.5 w-3.5" aria-hidden="true" />Limpar filtros</button>}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_185px_185px]">
          <label className="relative col-span-2 lg:col-span-1"><span className="sr-only">Pesquisar atividade ou lugar</span><Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-[#94a5b6]" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${fieldClass} pl-10`} placeholder="Pesquisar atividade ou lugar..." type="search" /></label>
          <label className="col-span-2 sm:col-span-1"><span className="sr-only">Filtrar por dia</span><select value={day} onChange={(event) => setDay(event.target.value)} className={fieldClass}><option value="">Todos os dias</option>{days.map((date) => <option key={date} value={date}>{formatDay(date)}</option>)}</select></label>
          <label className="col-span-2 sm:col-span-1"><span className="sr-only">Filtrar por tipo</span><select value={type} onChange={(event) => setType(event.target.value)} className={fieldClass}><option value="">Todos os tipos</option><option>Refeição</option><option>Lazer</option><option>Atividade</option></select></label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#6b7f94]" role="status"><strong className="font-semibold text-[#5c7691]">{filtered.length}</strong> {filtered.length === 1 ? "atividade" : "atividades"}{hasFilters ? " encontradas" : " planejadas"}{hasFilters && <span className="ml-2 border-l border-[#dce5ef] pl-2">Subtotal dos filtros: <strong className="font-semibold text-[#3b5f86]">{formatCurrency(subtotal)}</strong>{undefinedBudgets > 0 && ` · ${undefinedBudgets} a definir`}</span>}</p>
        <div className="hidden items-center gap-1 rounded-xl border border-[#e1e8f0] bg-[#edf2f7] p-1 lg:flex" aria-label="Visualização do cronograma">
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${view === "table" ? "bg-white text-[#3b5f86] shadow-sm" : "text-[#8899aa] hover:text-[#3b5f86]"}`}><Table2 className="h-3.5 w-3.5" aria-hidden="true" />Tabela</button>
          <button type="button" aria-pressed={view === "timeline"} onClick={() => setView("timeline")} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${view === "timeline" ? "bg-white text-[#3b5f86] shadow-sm" : "text-[#8899aa] hover:text-[#3b5f86]"}`}><List className="h-3.5 w-3.5" aria-hidden="true" />Linha do tempo</button>
        </div>
      </div>

      {filtered.length === 0 ? <EmptySchedule filtered={hasFilters} onAdd={onAdd} onClear={clear} /> : <>
        {view === "table" && <div className="hidden overflow-hidden rounded-[22px] border border-[#e2e9f2] bg-white shadow-[0_4px_22px_#3b5f8605] lg:block"><table className="w-full table-fixed border-collapse text-left"><caption className="sr-only">Atividades da viagem, organizadas por dia no fuso {trip.timezone}</caption><colgroup><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[21%]" /><col className="w-[22%]" /><col className="w-[13%]" /><col className="w-[14%]" /></colgroup><thead><tr className="border-b border-[#e7edf5] bg-[#fbfcfe] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6f8398]"><th className="px-5 py-4" scope="col">Data e hora</th><th className="px-4 py-4" scope="col">Orçamento (R$)</th><th className="px-4 py-4" scope="col">Nome da atividade</th><th className="px-4 py-4" scope="col">Lugar</th><th className="px-3 py-4" scope="col">Tipo</th><th className="px-3 py-4" scope="col"><span className="sr-only">Ações</span></th></tr></thead>{groups.map((group) => <tbody key={group.date}><tr><th scope="rowgroup" colSpan={6} className="border-y border-[#e8eef6] bg-[#f3f7fc] px-5 py-3 text-xs font-semibold capitalize tracking-wide text-[#64819e]"><span className="inline-flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{formatDay(group.date)}<span className="ml-1 text-[10px] font-normal normal-case text-[#6e8194]">{group.activities.length} {group.activities.length === 1 ? "plano" : "planos"}</span></span></th></tr>{group.activities.map((activity) => {
          const next = upcoming?.id === activity.id;
          return <tr key={activity.id} className={`border-b border-[#edf1f6] last:border-b-0 ${next ? "bg-[#f4f8fd]" : "hover:bg-[#fcfdff]"}`}><td className={`px-5 py-5 align-top ${next ? "border-l-[3px] border-[#719ac0]" : "border-l-[3px] border-transparent"}`}><div className="text-xs font-medium leading-5 text-[#5b7290]">{formatDateTime(activity.starts_at, trip.timezone)}</div>{next && <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-[#6d95ba]"><Clock3 className="h-3 w-3" aria-hidden="true" />Próxima atividade</span>}</td><td className="px-4 py-5 align-top text-sm font-semibold text-[#526d88]">{formatCurrency(activity.budget_cents)}</td><td className="px-4 py-5 align-top"><div className="break-words text-sm font-semibold leading-6 text-[#3b5f86]">{activity.name}</div><div className="mt-1"><ActivitySpending activity={activity} expenses={expenses} /></div></td><td className="px-4 py-5 align-top"><ActivityPlace activity={activity} online={online} /></td><td className="px-3 py-5 align-top"><CategoryBadge type={activity.type} /></td><td className="px-1 py-3 align-top"><ActivityActions activity={activity} {...actions} /></td></tr>;
        })}</tbody>)}</table></div>}

        <div className={`${view === "table" ? "lg:hidden" : ""} space-y-7`}>{groups.map((group) => <div key={group.date}><div className="mb-4 flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#dce7f2] bg-[#eaf2fb] text-[#6688ab]"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span><h2 className="text-sm font-semibold capitalize text-[#5d7b99]">{formatDay(group.date)}</h2><span className="h-px flex-1 bg-[#dfe8f2]" /><span className="text-[11px] text-[#6d8298]">{group.activities.length} {group.activities.length === 1 ? "plano" : "planos"}</span></div><div className="space-y-3 sm:ml-4 sm:border-l sm:border-[#d9e4f0] sm:pl-7">{group.activities.map((activity) => {
          const next = upcoming?.id === activity.id;
          return <article key={activity.id} className={`relative rounded-[20px] border bg-white px-5 py-5 shadow-[0_3px_15px_#3b5f8604] ${next ? "border-[#a8c0d9] ring-3 ring-[#dcebfa55]" : "border-[#e2e9f1]"}`}><span className={`absolute -left-[33px] top-7 hidden h-2.5 w-2.5 rounded-full border-2 border-[#f7f9fc] sm:block ${next ? "bg-[#7ba1c5]" : "bg-[#c3d3e4]"}`} /><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7b90a6]"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{formatDateTime(activity.starts_at, trip.timezone)}</span><span className="text-sm font-semibold text-[#527390]">{formatCurrency(activity.budget_cents)}</span></div>{next && <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[#edf4fc] px-2 py-1 text-[10px] font-semibold text-[#6289b0]"><Check className="h-3 w-3" aria-hidden="true" />Nossa próxima atividade</span>}<h3 className="mb-3 break-words text-base font-semibold leading-6 text-[#3b5f86]">{activity.name}</h3><div className="mb-3 flex min-w-0 items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#99adc1]" aria-hidden="true" /><ActivityPlace activity={activity} online={online} /></div><div className="mb-4"><ActivitySpending activity={activity} expenses={expenses} /></div><div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf1f6] pt-3"><CategoryBadge type={activity.type} /><ActivityActions activity={activity} {...actions} /></div></article>;
        })}</div></div>)}</div>
      </>}
      <p className="text-center text-[11px] leading-5 text-[#6e8194]">Horários no fuso da viagem: {trip.timezone}.</p>
    </section>
  );
}
