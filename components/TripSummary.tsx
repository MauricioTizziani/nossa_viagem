"use client";

import { ArrowRight, CalendarDays, Heart, NotebookPen, Receipt, Wallet } from "lucide-react";
import type { Activity, Expense, Trip } from "../lib/types";
import { EXPENSE_CATEGORIES } from "../lib/types";
import { formatCurrency, formatDay, groupActivities, sortActivities, summarizeActivities } from "../lib/domain";
import { summarizeExpenses } from "../lib/expenses";
import { tripBudgetView } from "../lib/budget";
import { CategoryIcon, ExpenseCategoryIcon, expenseCategoryStyle } from "./Icons";
import { BudgetFollowUp, BudgetReference } from "./BudgetFollowUp";

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
        <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b7f94]"><Heart className="h-3.5 w-3.5 text-[#bf96aa]" aria-hidden="true" />Nossa viagem, em pequenos planos</div>
        <h1 id="summary-heading" className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-[#3b5f86] sm:text-[34px]">O que estamos planejando</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#667b91]">Um olhar sobre os momentos, o planejamento e os gastos da nossa próxima aventura.</p>
      </div>

      <BudgetReference cents={budget.initialCents} onDefine={onDefineBudget} />
      <div className="grid gap-4 md:grid-cols-2">
        <BudgetFollowUp kind="planning" initialCents={budget.initialCents} usedCents={budget.planning.usedCents} undefinedBudgetCount={budget.undefinedBudgetCount} offline={offline} showInitial={false} />
        <BudgetFollowUp kind="spending" initialCents={budget.initialCents} usedCents={budget.spending.usedCents} offline={offline} showInitial={false} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-[24px] border border-[#cbddee] bg-[#e7f0fa] px-6 py-6"><Wallet className="absolute -bottom-5 -right-4 h-28 w-28 rotate-12 text-[#d8e6f5]" strokeWidth={1.1} aria-hidden="true" /><span className="relative inline-flex items-center gap-2 text-xs font-semibold text-[#6183a5]"><Wallet className="h-4 w-4" aria-hidden="true" />Orçamento previsto no cronograma</span><p className="relative mt-4 text-[34px] font-semibold leading-none tracking-[-0.04em] text-[#3b5f86] sm:text-[38px]">{formatCurrency(total)}</p><p className="relative mt-3 text-xs text-[#617e9a]">Soma dos orçamentos informados nas atividades</p></div>
        <div className="rounded-[24px] border border-[#e2e9f2] bg-[#fffdf9] px-6 py-6"><span className="inline-flex items-center gap-2 text-xs font-semibold text-[#687e94]"><NotebookPen className="h-4 w-4" aria-hidden="true" />Momentos no nosso cronograma</span><div className="mt-4 flex items-end gap-3"><span className="text-[38px] font-semibold leading-none tracking-[-0.04em] text-[#3b5f86]">{activities.length}</span><span className="pb-0.5 text-sm text-[#657a8f]">{activities.length === 1 ? "atividade" : "atividades"}</span></div><p className="mt-3 text-xs text-[#6e8194]">{pending > 0 ? `${pending} ${pending === 1 ? "atividade ainda tem" : "atividades ainda têm"} orçamento a definir` : activities.length > 0 ? "Todos os orçamentos foram informados" : "Ainda há tantas memórias para planejar"}</p></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">{types.map((type) => {
        const category = summary.byType[type];
        const budget = category.totalCents;
        const undecided = category.undefinedBudgetCount;
        const iconColor = type === "Refeição" ? "bg-[#fbf1e1] text-[#a3845f]" : type === "Lazer" ? "bg-[#f9eaf0] text-[#ae8197]" : "bg-[#eaf2fb] text-[#7b9bbb]";
        return <div key={type} className="rounded-[22px] border border-[#e2e9f2] bg-white px-5 py-5 shadow-[0_3px_16px_#3b5f8603]"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-[#6a8198]">{type}</h2><span className={`inline-flex h-10 w-10 items-center justify-center rounded-[14px] ${iconColor}`}><CategoryIcon type={type} className="h-5 w-5" strokeWidth={1.5} /></span></div><p className="mt-4 text-[24px] font-semibold tracking-tight text-[#3b5f86]">{formatCurrency(budget)}</p><p className="mt-2 text-xs leading-5 text-[#6e8194]">{category.activityCount} {category.activityCount === 1 ? "atividade" : "atividades"}{undecided > 0 && ` · ${undecided} a definir`}</p></div>;
      })}</div>

      <section aria-labelledby="summary-expenses-heading" className="rounded-[24px] border border-[#e2e9f2] bg-white p-5 shadow-[0_3px_18px_#3b5f8603] sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#f8ecf2] text-[#b28ba1]"><Receipt className="h-4 w-4" aria-hidden="true" /></span><div><h2 id="summary-expenses-heading" className="text-base font-semibold text-[#3b5f86]">Gastos da viagem</h2><p className="mt-0.5 text-xs text-[#6e8194]">Gastos registrados da viagem, separados do orçamento previsto</p></div></div>{onOpenExpenses && <button type="button" onClick={onOpenExpenses} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#dce5ef] bg-white px-3.5 text-xs font-semibold text-[#5c7fa3] transition hover:bg-[#f1f6fb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b5f86]">Ver gastos<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}</div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="rounded-[20px] border border-[#ead8e0] bg-[#fdf6f9] px-5 py-5"><span className="text-xs font-semibold text-[#95647a]">Total gasto</span><p className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.04em] text-[#3b5f86]" data-testid="summary-expenses-total">{formatCurrency(spending.totalCents)}</p><p className="mt-3 text-xs text-[#8a6c7a]">{spending.count === 0 ? "Nenhum gasto registrado até agora" : `${spending.count} ${spending.count === 1 ? "gasto registrado" : "gastos registrados"}, dentro e fora do período da viagem`}</p></div>
          <div className="min-w-0">{spendingByCategory.length === 0 ? <div className="flex h-full items-center rounded-2xl bg-[#f8fafc] px-5 py-6 text-sm text-[#6e8194]">A distribuição por categoria aparecerá aqui quando registrarem o primeiro gasto.</div> : <ul className="space-y-3">{spendingByCategory.map((item) => {
            const share = spending.totalCents > 0 ? Math.max(2, Math.round((item.totalCents / spending.totalCents) * 100)) : 0;
            const style = expenseCategoryStyle(item.category);
            return <li key={item.category}><div className="flex items-center justify-between gap-3 text-sm"><span className="inline-flex min-w-0 items-center gap-2 text-[#415b77]"><span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ${style.tile}`}><ExpenseCategoryIcon category={item.category} className="h-3.5 w-3.5" strokeWidth={1.6} /></span><span className="truncate">{item.category}</span></span><span className="shrink-0 font-semibold text-[#3b5f86]">{formatCurrency(item.totalCents)}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]"><div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: style.bar }} /></div></li>;
          })}</ul>}</div>
        </div>
        <p className="mt-4 text-xs leading-6 text-[#8194a7]">O cronograma mostra quanto do orçamento está comprometido pelo planejamento. A aba Gastos mostra quanto foi utilizado pelas despesas registradas. Ambos partem do mesmo orçamento inicial, mas não descontam valores um do outro.</p>
      </section>

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
