"use client";

import { ArrowRight, CalendarDays, Heart, NotebookPen, Receipt, Wallet } from "lucide-react";
import type { Activity, Expense, Trip } from "../lib/types";
import { EXPENSE_CATEGORIES } from "../lib/types";
import { formatCurrency, formatDay, groupActivities, sortActivities, summarizeActivities } from "../lib/domain";
import { summarizeExpenses } from "../lib/expenses";
import { tripBudgetView } from "../lib/budget";
import { CategoryIcon, ExpenseCategoryIcon, expenseCategoryStyle } from "./Icons";
import { BudgetFlow } from "./BudgetFollowUp";

interface TripSummaryProps { activities: Activity[]; expenses?: Expense[]; trip: Trip; expensesReady?: boolean; offline?: boolean; onOpenExpenses?: () => void; onDefineBudget?: () => void }

export function TripSummary({ activities, expenses = [], trip, expensesReady = true, offline = false, onOpenExpenses, onDefineBudget }: TripSummaryProps) {
  const summary = summarizeActivities(activities);
  const budget = tripBudgetView(trip, activities, expensesReady ? expenses : null);
  const total = summary.totalCents;
  const pending = summary.undefinedBudgetCount;
  const groups = groupActivities(sortActivities(activities), trip.timezone);
  const types: Activity["type"][] = ["Refeição", "Lazer", "Atividade"];
  const spending = summarizeExpenses(expenses);
  const spendingByCategory = EXPENSE_CATEGORIES.map((category) => ({ category, ...spending.byCategory[category] })).filter((item) => item.count > 0).sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));

  return (
    <section aria-labelledby="summary-heading" className="space-y-7">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-[#4F7276]"><Heart className="h-3.5 w-3.5 text-[#A4536D]" aria-hidden="true" />Nossa viagem, em pequenos planos</div>
        <h1 id="summary-heading" className="text-[30px] font-semibold leading-tight tracking-[-0.035em] text-[#125E67] sm:text-[38px]">O que estamos planejando</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#4F7276]">Um olhar sobre os momentos, o planejamento e os gastos da nossa próxima aventura.</p>
      </div>

      <BudgetFlow view={budget} offline={offline} onDefineBudget={onDefineBudget} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-[18px] border border-[#B4D9DD] bg-[#EBF3F4] px-6 py-6"><Wallet className="absolute bottom-4 right-5 h-16 w-16 text-[#DCEAEC]" strokeWidth={1.1} aria-hidden="true" /><span className="relative inline-flex items-center gap-2 text-[13px] font-semibold text-[#4F7276]"><Wallet className="h-4 w-4" aria-hidden="true" />Orçamento previsto no cronograma</span><p className="relative mt-4 text-[34px] font-semibold leading-tight tabular-nums tracking-[-0.04em] text-[#125E67] sm:text-[38px]">{formatCurrency(total)}</p><p className="relative mt-3 text-[13px] leading-6 text-[#4F7276]">Total original informado nas atividades, diferente do valor ainda reservado</p></div>
        <div className="rounded-[18px] border border-[#DCEAEC] bg-[#FFFFFF] px-6 py-6"><span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#4F7276]"><NotebookPen className="h-4 w-4" aria-hidden="true" />Momentos no nosso cronograma</span><div className="mt-4 flex items-end gap-3"><span className="text-[38px] font-semibold leading-tight tabular-nums tracking-[-0.04em] text-[#125E67]">{activities.length}</span><span className="pb-0.5 text-sm text-[#4F7276]">{activities.length === 1 ? "atividade" : "atividades"}</span></div><p className="mt-3 text-[13px] leading-6 text-[#4F7276]">{pending > 0 ? `${pending} ${pending === 1 ? "atividade ainda tem" : "atividades ainda têm"} orçamento a definir` : activities.length > 0 ? "Todos os orçamentos foram informados" : "Ainda há tantas memórias para planejar"}</p></div>
      </div>

      <div className="grid gap-0 overflow-hidden rounded-[18px] border border-[#DCEAEC] bg-white sm:grid-cols-3">{types.map((type) => {
        const category = summary.byType[type];
        const budget = category.totalCents;
        const undecided = category.undefinedBudgetCount;
        const iconColor = type === "Refeição" ? "bg-[#FFF5DE] text-[#805F15]" : type === "Lazer" ? "bg-[#F7EBF0] text-[#A4536D]" : "bg-[#F0F7F7] text-[#125E67]";
        return <div key={type} className="border-b border-[#DCEAEC] px-5 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-[#4F7276]">{type}</h2><span className={`inline-flex h-10 w-10 items-center justify-center rounded-[10px] ${iconColor}`}><CategoryIcon type={type} className="h-5 w-5" strokeWidth={1.5} /></span></div><p className="mt-4 text-[24px] font-semibold tabular-nums tracking-tight text-[#125E67]">{formatCurrency(budget)}</p><p className="mt-2 text-[13px] leading-5 text-[#4F7276]">{category.activityCount} {category.activityCount === 1 ? "atividade" : "atividades"}{undecided > 0 && ` · ${undecided} a definir`}</p></div>;
      })}</div>

      <section aria-labelledby="summary-expenses-heading" className="rounded-[18px] border border-[#DCEAEC] bg-white p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F7EBF0] text-[#A4536D]"><Receipt className="h-4 w-4" aria-hidden="true" /></span><div><h2 id="summary-expenses-heading" className="text-lg font-semibold text-[#125E67]">Gastos da viagem</h2><p className="mt-0.5 text-[13px] text-[#4F7276]">Gastos já registrados. Eles também reduzem o saldo usado pelo cronograma</p></div></div>{onOpenExpenses && <button type="button" onClick={onOpenExpenses} className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-[#DCEAEC] bg-white px-3.5 text-[13px] font-semibold text-[#125E67] transition hover:bg-[#F8FBFB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#125E67]">Ver gastos<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}</div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="rounded-[16px] border border-[#E4D2DA] bg-[#FAF2F6] px-5 py-5"><span className="text-[13px] font-semibold text-[#A4536D]">Total gasto</span><p className="mt-3 text-[30px] font-semibold leading-tight tabular-nums tracking-[-0.04em] text-[#125E67]" data-testid="summary-expenses-total">{formatCurrency(spending.totalCents)}</p><p className="mt-3 text-[13px] leading-6 text-[#775C68]">{spending.count === 0 ? "Nenhum gasto registrado até agora" : `${spending.count} ${spending.count === 1 ? "gasto registrado" : "gastos registrados"}, dentro e fora do período da viagem`}</p></div>
          <div className="min-w-0">{spendingByCategory.length === 0 ? <div className="flex h-full items-center rounded-2xl bg-[#F8FBFB] px-5 py-6 text-sm text-[#4F7276]">A distribuição por categoria aparecerá aqui quando registrarem o primeiro gasto.</div> : <ul className="space-y-3">{spendingByCategory.map((item) => {
            const share = spending.totalCents > 0 ? Math.max(2, Math.round((item.totalCents / spending.totalCents) * 100)) : 0;
            const style = expenseCategoryStyle(item.category);
            return <li key={item.category}><div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm"><span className="inline-flex min-w-0 items-center gap-2 text-[#125E67]"><span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ${style.tile}`}><ExpenseCategoryIcon category={item.category} className="h-3.5 w-3.5" strokeWidth={1.6} /></span><span className="truncate">{item.category}</span></span><span className="shrink-0 font-semibold tabular-nums text-[#125E67]">{formatCurrency(item.totalCents)}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#F0F7F7]"><div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: style.bar }} /></div></li>;
          })}</ul>}</div>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-[#4F7276]">Cada gasto reduz o saldo disponível da viagem e, com ele, o orçamento do cronograma. O fluxo acima não reserva de novo uma despesa já vinculada à própria atividade.</p>
      </section>

      <div className="rounded-[18px] border border-[#DCEAEC] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#EBF3F4] text-[#125E67]"><CalendarDays className="h-4 w-4" aria-hidden="true" /></span><div><h2 className="text-lg font-semibold text-[#125E67]">Um dia de cada vez</h2><p className="mt-0.5 text-[13px] text-[#4F7276]">Atividades e orçamento original por dia</p></div></div>{groups.length === 0 ? <div className="rounded-2xl bg-[#F8FBFB] px-5 py-8 text-center"><Heart className="mx-auto mb-3 h-5 w-5 text-[#A4536D]" strokeWidth={1.5} aria-hidden="true" /><p className="text-sm text-[#4F7276]">Ainda temos espaço para novas memórias.</p><p className="mt-1 text-[13px] text-[#4F7276]">Os dias aparecerão aqui quando adicionarem atividades.</p></div> : <div className="divide-y divide-[#DCEAEC]">{groups.map((group) => {
        const daySummary = summarizeActivities(group.activities);
        const budget = daySummary.totalCents;
        const undecided = daySummary.undefinedBudgetCount;
        return <div key={group.date} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"><div><h3 className="text-sm font-medium capitalize text-[#125E67]">{formatDay(group.date)}</h3><p className="mt-1 text-[13px] text-[#4F7276]">{group.activities.length} {group.activities.length === 1 ? "atividade" : "atividades"}{undecided > 0 && ` · ${undecided} com orçamento a definir`}</p></div><span className="text-lg font-semibold tabular-nums text-[#125E67]">{formatCurrency(budget)}</span></div>;
      })}</div>}</div>

      <div className="flex items-start gap-3 rounded-2xl border border-[#DCEAEC] bg-[#F8FBFB] px-4 py-4"><span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#B4D9DD]" /><p className="text-[13px] leading-6 text-[#4F7276]">Os totais por tipo e por dia somam os orçamentos originais informados nas atividades. O saldo da viagem está no fluxo acima e já desconta os gastos. {pending > 0 && <>{pending} {pending === 1 ? "atividade está" : "atividades estão"} com orçamento <strong className="font-medium">a definir</strong>. </>}O orçamento de cada atividade continua sendo o valor previsto para ela.</p></div>
    </section>
  );
}
