"use client";

import { CalendarDays, Heart, NotebookPen, Wallet } from "lucide-react";
import type { Activity, Trip } from "../lib/types";
import { formatCurrency, formatDay, groupActivities, sortActivities, summarizeActivities } from "../lib/domain";
import { CategoryIcon } from "./Icons";

interface TripSummaryProps { activities: Activity[]; trip: Trip }

export function TripSummary({ activities, trip }: TripSummaryProps) {
  const summary = summarizeActivities(activities);
  const total = summary.totalCents;
  const pending = summary.undefinedBudgetCount;
  const groups = groupActivities(sortActivities(activities), trip.timezone);
  const types: Activity["type"][] = ["Refeição", "Lazer", "Atividade"];

  return (
    <section aria-labelledby="summary-heading" className="space-y-7">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b7f94]"><Heart className="h-3.5 w-3.5 text-[#bf96aa]" aria-hidden="true" />Nossa viagem, em pequenos planos</div>
        <h1 id="summary-heading" className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-[#3b5f86] sm:text-[34px]">O que estamos planejando</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#667b91]">Um olhar sobre os momentos e o orçamento da nossa próxima aventura.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-[24px] border border-[#cbddee] bg-[#e7f0fa] px-6 py-6"><Wallet className="absolute -bottom-5 -right-4 h-28 w-28 rotate-12 text-[#d8e6f5]" strokeWidth={1.1} aria-hidden="true" /><span className="relative inline-flex items-center gap-2 text-xs font-semibold text-[#6183a5]"><Wallet className="h-4 w-4" aria-hidden="true" />Total da viagem</span><p className="relative mt-4 text-[34px] font-semibold leading-none tracking-[-0.04em] text-[#3b5f86] sm:text-[38px]">{formatCurrency(total)}</p><p className="relative mt-3 text-xs text-[#617e9a]">Orçamento previsto para todas as atividades</p></div>
        <div className="rounded-[24px] border border-[#e2e9f2] bg-[#fffdf9] px-6 py-6"><span className="inline-flex items-center gap-2 text-xs font-semibold text-[#687e94]"><NotebookPen className="h-4 w-4" aria-hidden="true" />Momentos no nosso cronograma</span><div className="mt-4 flex items-end gap-3"><span className="text-[38px] font-semibold leading-none tracking-[-0.04em] text-[#3b5f86]">{activities.length}</span><span className="pb-0.5 text-sm text-[#657a8f]">{activities.length === 1 ? "atividade" : "atividades"}</span></div><p className="mt-3 text-xs text-[#6e8194]">{pending > 0 ? `${pending} ${pending === 1 ? "atividade ainda tem" : "atividades ainda têm"} orçamento a definir` : activities.length > 0 ? "Todos os orçamentos foram informados" : "Ainda há tantas memórias para planejar"}</p></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">{types.map((type) => {
        const category = summary.byType[type];
        const budget = category.totalCents;
        const undecided = category.undefinedBudgetCount;
        const iconColor = type === "Refeição" ? "bg-[#fbf1e1] text-[#a3845f]" : type === "Lazer" ? "bg-[#f9eaf0] text-[#ae8197]" : "bg-[#eaf2fb] text-[#7b9bbb]";
        return <div key={type} className="rounded-[22px] border border-[#e2e9f2] bg-white px-5 py-5 shadow-[0_3px_16px_#3b5f8603]"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-[#6a8198]">{type}</h2><span className={`inline-flex h-10 w-10 items-center justify-center rounded-[14px] ${iconColor}`}><CategoryIcon type={type} className="h-5 w-5" strokeWidth={1.5} /></span></div><p className="mt-4 text-[24px] font-semibold tracking-tight text-[#3b5f86]">{formatCurrency(budget)}</p><p className="mt-2 text-xs leading-5 text-[#6e8194]">{category.activityCount} {category.activityCount === 1 ? "atividade" : "atividades"}{undecided > 0 && ` · ${undecided} a definir`}</p></div>;
      })}</div>

      <div className="rounded-[24px] border border-[#e2e9f2] bg-white p-5 shadow-[0_3px_18px_#3b5f8603] sm:p-6"><div className="mb-5 flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#edf3fa] text-[#799abd]"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span><div><h2 className="text-base font-semibold text-[#3b5f86]">Um dia de cada vez</h2><p className="mt-0.5 text-xs text-[#6e8194]">Atividades e orçamento previsto por dia</p></div></div>{groups.length === 0 ? <div className="rounded-2xl bg-[#f8fafc] px-5 py-8 text-center"><Heart className="mx-auto mb-3 h-5 w-5 text-[#ceb2c0]" strokeWidth={1.5} aria-hidden="true" /><p className="text-sm text-[#6e8194]">Ainda temos espaço para novas memórias.</p><p className="mt-1 text-xs text-[#6e8194]">Os dias aparecerão aqui quando adicionarem atividades.</p></div> : <div className="divide-y divide-[#edf1f6]">{groups.map((group) => {
        const daySummary = summarizeActivities(group.activities);
        const budget = daySummary.totalCents;
        const undecided = daySummary.undefinedBudgetCount;
        return <div key={group.date} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div><h3 className="text-sm font-medium capitalize text-[#627e9a]">{formatDay(group.date)}</h3><p className="mt-1 text-xs text-[#6e8194]">{group.activities.length} {group.activities.length === 1 ? "atividade" : "atividades"}{undecided > 0 && ` · ${undecided} com orçamento a definir`}</p></div><span className="text-base font-semibold text-[#3b5f86]">{formatCurrency(budget)}</span></div>;
      })}</div>}</div>

      <div className="flex items-start gap-3 rounded-2xl border border-[#e5ebf1] bg-[#f4f7fb] px-4 py-4"><span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#adc4dc]" /><p className="text-xs leading-6 text-[#8194a7]">Estes valores representam o nosso planejamento, e somam apenas os orçamentos informados. {pending > 0 && <>{pending} {pending === 1 ? "atividade está" : "atividades estão"} com orçamento <strong className="font-medium">a definir</strong>. </>}O orçamento de cada atividade já é o total previsto para ela.</p></div>
    </section>
  );
}
