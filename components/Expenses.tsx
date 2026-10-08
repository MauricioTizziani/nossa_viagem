"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronUp, Link2, NotebookPen, Pencil, Plus, Receipt, Search, SlidersHorizontal, Trash2, Wallet, X } from "lucide-react";
import type { Activity, Expense, ExpenseCategory, ExpenseFilters, Trip } from "../lib/types";
import { EXPENSE_CATEGORIES } from "../lib/types";
import { formatCurrency, formatDateTime } from "../lib/domain";
import { filterExpenses, formatCalendarDate, hasExpenseFilters, matchesExpenseFilters, summarizeExpenses, validateExpenseFilters } from "../lib/expenses";
import { tripBudgetView } from "../lib/budget";
import { BudgetFollowUp } from "./BudgetFollowUp";
import { EXPENSES_MIGRATION } from "../lib/useTravelData";
import { ExpenseCategoryBadge, ExpenseCategoryIcon, expenseCategoryStyle } from "./Icons";

interface ExpensesProps {
  expenses: Expense[];
  activities: Activity[];
  trip: Trip;
  online: boolean;
  ready: boolean;
  lastSaved?: Expense | null;
  onAdd: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
  onDefineBudget?: () => void;
}

const fieldClass = "h-11 w-full rounded-xl border border-[#DEEBEC] bg-white px-3 text-sm text-[#355E62] outline-none transition focus:border-[#16727C] focus:ring-3 focus:ring-[#E3EEEF]";
const actionButton = "inline-flex h-11 w-11 items-center justify-center rounded-xl text-[#62888B] lg:h-10 lg:w-10 transition hover:bg-[#EFF5F6] hover:text-[#125E67] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#125E67] disabled:cursor-not-allowed disabled:opacity-35";
const primaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-[15px] bg-[#28AEB9] px-5 text-sm font-semibold text-[#062E32] shadow-[0_5px_15px_#28AEB924] transition hover:bg-[#1F9EAA] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#125E67]";

function ExpenseActions({ expense, online, onEdit, onDelete }: Pick<ExpensesProps, "online" | "onEdit" | "onDelete"> & { expense: Expense }) {
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" className={actionButton} onClick={() => onEdit(expense)} title="Editar gasto" aria-label={`Editar ${expense.description}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" className={`${actionButton} hover:bg-[#faedf2] hover:text-[#a45f74]`} onClick={() => onDelete(expense)} disabled={!online} title={online ? "Excluir gasto" : "Conecte-se para excluir"} aria-label={`Excluir ${expense.description}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
    </div>
  );
}

function DetailsToggle({ expense, open, onToggle }: { expense: Expense; open: boolean; onToggle: () => void }) {
  const Icon = open ? ChevronUp : ChevronDown;
  return <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? "Ocultar" : "Ver"} detalhes de ${expense.description}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#4D8489] transition hover:bg-[#EFF5F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#125E67]"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{open ? "Ocultar detalhes" : "Detalhes"}</button>;
}

function ExpenseDetails({ expense, activity, trip }: { expense: Expense; activity: Activity | null; trip: Trip }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="min-w-0"><dt className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#628689]"><Link2 className="h-3.5 w-3.5" aria-hidden="true" />Atividade vinculada</dt><dd className="mt-1 break-words leading-6 text-[#355E62]">{activity ? <>{activity.name}<span className="block text-xs text-[#638486]">{formatDateTime(activity.starts_at, trip.timezone)} · orçamento previsto {formatCurrency(activity.budget_cents)}</span></> : expense.activity_id ? <span className="text-[#638486]">A atividade não está mais no cronograma.</span> : <span className="text-[#638486]">Sem atividade vinculada</span>}</dd></div>
      <div className="min-w-0"><dt className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#628689]"><NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />Observações</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-6 text-[#355E62]">{expense.notes || <span className="text-[#638486]">Sem observações</span>}</dd></div>
    </dl>
  );
}

function EmptyExpenses({ filtered, ready, onAdd, onClear }: { filtered: boolean; ready: boolean; onAdd: () => void; onClear: () => void }) {
  return (
    <div className="relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden rounded-[26px] border border-dashed border-[#C9E7E9] bg-[#fffdf9] px-6 py-12 text-center">
      <div className="mb-6 flex h-20 w-20 rotate-6 items-center justify-center rounded-[24px] bg-[#EFF5F6] text-[#4D8489] shadow-[0_7px_0_#E4EFF0]"><Receipt className="h-9 w-9" strokeWidth={1.5} aria-hidden="true" /></div>
      <h3 className="text-xl font-semibold tracking-tight text-[#125E67]">{filtered ? "Nenhum gasto encontrado" : "Ainda não registramos nenhum gasto."}</h3>
      <p className="mt-2 max-w-[360px] text-sm leading-6 text-[#628082]">{filtered ? "Nenhum gasto corresponde aos filtros atuais. Experimente outra palavra, categoria ou período." : "Adicione a primeira despesa da nossa viagem."}</p>
      <button type="button" onClick={filtered ? onClear : onAdd} disabled={!filtered && !ready} className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#28AEB9] px-5 text-sm font-semibold text-[#062E32] shadow-[0_5px_16px_#28AEB922] transition hover:bg-[#1F9EAA] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#125E67] disabled:cursor-not-allowed disabled:opacity-50">{filtered ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}{filtered ? "Limpar filtros" : "Adicionar gasto"}</button>
    </div>
  );
}

export function Expenses({ expenses, activities, trip, online, ready, lastSaved, onAdd, onEdit, onDelete, onDefineBudget }: ExpensesProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);

  const requested: ExpenseFilters = { search, category, from, to };
  const filterError = validateExpenseFilters(requested);
  // An inconsistent period is reported and left out until it is corrected; other filters still apply.
  const applied: ExpenseFilters = filterError ? { search, category } : requested;
  const hasFilters = hasExpenseFilters(requested);
  const activityById = useMemo(() => new Map(activities.map((activity) => [activity.id, activity])), [activities]);
  const filtered = filterExpenses(expenses, applied);
  const total = useMemo(() => summarizeExpenses(expenses), [expenses]);
  const budget = tripBudgetView(trip, activities, ready ? expenses : null);
  const subtotal = summarizeExpenses(filtered);
  const breakdown = hasFilters ? subtotal : total;
  const categoriesInUse = EXPENSE_CATEGORIES.map((item) => ({ category: item, ...breakdown.byCategory[item] })).filter((item) => item.count > 0).sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));
  const totalCategories = Object.values(total.byCategory).filter((item) => item.count > 0).length;
  const clear = () => { setSearch(""); setCategory(""); setFrom(""); setTo(""); };
  const toggle = (id: string) => setOpen((current) => ({ ...current, [id]: !current[id] }));
  // Shown after saving while active filters hide the confirmed record; the list itself stays filtered.
  const savedRecord = lastSaved ? expenses.find((expense) => expense.id === lastSaved.id) ?? null : null;
  const noticeKey = savedRecord ? `${savedRecord.id}:${savedRecord.version}` : null;
  const hiddenSaved = savedRecord && hasFilters && noticeKey !== dismissedNotice && !matchesExpenseFilters(savedRecord, applied) ? savedRecord : null;
  useEffect(() => { setDismissedNotice(null); }, [lastSaved]);

  return (
    <section aria-labelledby="expenses-heading" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#618386]"><Receipt className="h-3.5 w-3.5 text-[#bf96aa]" aria-hidden="true" />Onde o dinheiro da viagem foi usado</div>
          <h1 id="expenses-heading" className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-[#125E67] sm:text-[34px]">Nossos gastos</h1>
          <p className="mt-2 text-sm text-[#5A7D80]">Cada despesa registrada uma única vez, com o valor total que pagamos.</p>
        </div>
        <button type="button" onClick={onAdd} disabled={!ready} className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50`}><Plus className="h-4 w-4" aria-hidden="true" />Adicionar gasto</button>
      </div>

      {!ready && <div className="notice notice-warm" role="status"><p>Falta aplicar a atualização de gastos no Supabase: <strong>{EXPENSES_MIGRATION}</strong>. O cronograma continua funcionando normalmente; os gastos ficam disponíveis assim que a migração for executada.</p></div>}

      <BudgetFollowUp kind="spending" initialCents={budget.initialCents} usedCents={budget.spending.usedCents} offline={!online} filtered={hasFilters} onDefineBudget={onDefineBudget} />

      <div className={`grid gap-4 ${hasFilters ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="relative overflow-hidden rounded-[24px] border border-[#BDE4E8] bg-[#EAF2F3] px-6 py-6"><Wallet className="absolute -bottom-5 -right-4 h-28 w-28 rotate-12 text-[#DAE9EA]" strokeWidth={1.1} aria-hidden="true" /><span className="relative inline-flex items-center gap-2 text-xs font-semibold text-[#50888D]"><Wallet className="h-4 w-4" aria-hidden="true" />Total gasto na viagem</span><p className="relative mt-4 text-[32px] font-semibold leading-none tracking-[-0.04em] text-[#125E67] sm:text-[36px]" data-testid="expenses-total">{ready ? formatCurrency(total.totalCents) : "Indisponível"}</p><p className="relative mt-3 text-xs text-[#548286]">{ready ? "Soma de todos os gastos registrados, dentro e fora do período da viagem" : "O total não foi carregado, então o saldo do orçamento não foi calculado."}</p></div>
        <div className="rounded-[24px] border border-[#E2EDEE] bg-[#fffdf9] px-6 py-6"><span className="inline-flex items-center gap-2 text-xs font-semibold text-[#5C8083]"><Receipt className="h-4 w-4" aria-hidden="true" />Gastos registrados</span><div className="mt-4 flex items-end gap-3"><span className="text-[36px] font-semibold leading-none tracking-[-0.04em] text-[#125E67]">{total.count}</span><span className="pb-0.5 text-sm text-[#5B7E81]">{total.count === 1 ? "gasto" : "gastos"}</span></div><p className="mt-3 text-xs text-[#638486]">{total.count === 0 ? "Nenhuma despesa registrada até agora" : `${totalCategories} ${totalCategories === 1 ? "categoria" : "categorias"} em uso`}</p></div>
        {hasFilters && <div className="rounded-[24px] border border-[#ead8e0] bg-[#fdf6f9] px-6 py-6"><span className="inline-flex items-center gap-2 text-xs font-semibold text-[#95647a]"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Subtotal dos filtros</span><p className="mt-4 text-[32px] font-semibold leading-none tracking-[-0.04em] text-[#125E67] sm:text-[36px]" data-testid="expenses-subtotal">{formatCurrency(subtotal.totalCents)}</p><p className="mt-3 text-xs text-[#8a6c7a]">{subtotal.count} de {total.count} {total.count === 1 ? "registro corresponde" : "registros correspondem"} aos filtros</p></div>}
      </div>

      <div className="rounded-[22px] border border-[#E2EEEF] bg-white p-4 shadow-[0_3px_18px_#28AEB905] sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#618386]"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />Encontrar nossos gastos</span>
          {hasFilters && <button type="button" onClick={clear} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-[#4D8489] hover:underline"><X className="h-3.5 w-3.5" aria-hidden="true" />Limpar filtros</button>}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_190px_160px_160px]">
          <label className="relative col-span-2 lg:col-span-1"><span className="sr-only">Pesquisar gasto por descrição</span><Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-[#85A9AC]" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} className={`${fieldClass} pl-10`} placeholder="Pesquisar por descrição..." type="search" /></label>
          <label className="col-span-2 lg:col-span-1"><span className="sr-only">Filtrar por categoria</span><select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory | "")} className={fieldClass}><option value="">Todas as categorias</option>{EXPENSE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="col-span-2 sm:col-span-1"><span className="sr-only">Data inicial</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={fieldClass} aria-invalid={Boolean(filterError) || undefined} /></label>
          <label className="col-span-2 sm:col-span-1"><span className="sr-only">Data final</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={fieldClass} aria-invalid={Boolean(filterError) || undefined} /></label>
        </div>
        <p className="mt-2 text-[11px] text-[#638486]">Período inclusivo, de {from ? formatCalendarDate(from) : "qualquer data"} até {to ? formatCalendarDate(to) : "qualquer data"}.</p>
        {filterError && <p role="alert" className="mt-2 text-xs font-semibold text-[#a05770]">{filterError}</p>}
      </div>

      {hiddenSaved && <div className="notice" role="status"><Receipt size={18} /><p className="flex-1">O gasto <strong>{hiddenSaved.description}</strong> foi salvo, mas não aparece na lista porque está fora dos filtros atuais. <button type="button" className="font-semibold underline underline-offset-4" onClick={clear}>Limpar filtros</button></p><button type="button" aria-label="Fechar aviso" className="self-start text-[#508387]" onClick={() => setDismissedNotice(noticeKey)}><X size={16} /></button></div>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#618386]" role="status"><strong className="font-semibold text-[#4F7A7D]">{filtered.length}</strong> {filtered.length === 1 ? "gasto" : "gastos"}{hasFilters ? " encontrados" : " registrados"}{hasFilters && <span className="ml-2 border-l border-[#D4E9EB] pl-2">Subtotal dos filtros: <strong className="font-semibold text-[#125E67]">{formatCurrency(subtotal.totalCents)}</strong></span>}</p>
        <span className="text-[11px] text-[#638486]">Do mais recente para o mais antigo</span>
      </div>

      <div className="rounded-[24px] border border-[#E2EDEE] bg-white p-5 shadow-[0_3px_18px_#28AEB903] sm:p-6">
        <div className="mb-5 flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#F0F6F7] text-[#53A3A9]"><Wallet className="h-4 w-4" aria-hidden="true" /></span><div><h2 className="text-base font-semibold text-[#125E67]">Total por categoria</h2><p className="mt-0.5 text-xs text-[#638486]">{hasFilters ? "Considerando apenas os resultados filtrados" : "Considerando todos os gastos da viagem"}</p></div></div>
        {categoriesInUse.length === 0 ? <p className="rounded-2xl bg-[#F9FBFB] px-5 py-6 text-center text-sm text-[#638486]">{hasFilters ? "Nenhum valor nos resultados filtrados." : <>Nenhum gasto por enquanto: <strong className="font-semibold text-[#125E67]">{formatCurrency(0)}</strong>.</>}</p> : <ul className="space-y-4">{categoriesInUse.map((item) => {
          const share = breakdown.totalCents > 0 ? Math.max(2, Math.round((item.totalCents / breakdown.totalCents) * 100)) : 0;
          const style = expenseCategoryStyle(item.category);
          return <li key={item.category}><div className="flex items-center justify-between gap-3"><span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-[#355E62]"><span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${style.tile}`}><ExpenseCategoryIcon category={item.category} className="h-4 w-4" strokeWidth={1.6} /></span><span className="truncate">{item.category}</span><span className="shrink-0 text-xs text-[#638486]">· {item.count} {item.count === 1 ? "gasto" : "gastos"}</span></span><span className="shrink-0 text-sm font-semibold text-[#125E67]">{formatCurrency(item.totalCents)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#EFF5F6]" role="img" aria-label={`${item.category}: ${Math.round((item.totalCents / Math.max(1, breakdown.totalCents)) * 100)}% do total`}><div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: style.bar }} /></div></li>;
        })}</ul>}
      </div>

      {filtered.length === 0 ? <EmptyExpenses filtered={hasFilters} ready={ready} onAdd={onAdd} onClear={clear} /> : <>
        <div className="hidden overflow-hidden rounded-[22px] border border-[#E2EDEE] bg-white shadow-[0_4px_22px_#28AEB905] lg:block"><table className="w-full table-fixed border-collapse text-left"><caption className="sr-only">Gastos da viagem, do mais recente para o mais antigo</caption><colgroup><col className="w-[13%]" /><col className="w-[37%]" /><col className="w-[18%]" /><col className="w-[15%]" /><col className="w-[17%]" /></colgroup><thead><tr className="border-b border-[#E7F0F1] bg-[#FCFDFD] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#628689]"><th className="px-5 py-4" scope="col">Data</th><th className="px-4 py-4" scope="col">Descrição</th><th className="px-4 py-4" scope="col">Categoria</th><th className="px-4 py-4 text-right" scope="col">Valor</th><th className="px-3 py-4" scope="col"><span className="sr-only">Ações</span></th></tr></thead><tbody>{filtered.map((expense) => {
          const activity = expense.activity_id ? activityById.get(expense.activity_id) ?? null : null;
          const expanded = Boolean(open[expense.id]);
          return <ExpenseRows key={expense.id} expense={expense} activity={activity} trip={trip} expanded={expanded} onToggle={() => toggle(expense.id)} actions={<ExpenseActions expense={expense} online={online} onEdit={onEdit} onDelete={onDelete} />} />;
        })}</tbody></table></div>

        <div className="space-y-3 lg:hidden">{filtered.map((expense) => {
          const activity = expense.activity_id ? activityById.get(expense.activity_id) ?? null : null;
          const expanded = Boolean(open[expense.id]);
          return <article key={expense.id} className="rounded-[20px] border border-[#E1EDEE] bg-white px-5 py-5 shadow-[0_3px_15px_#28AEB904]">
            <div className="mb-2 flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-base font-semibold leading-6 text-[#125E67]">{expense.description}</h3><span className="shrink-0 text-lg font-semibold tracking-tight text-[#125E67]">{formatCurrency(expense.amount_cents)}</span></div>
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#689599]"><span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{formatCalendarDate(expense.expense_date)}</span><ExpenseCategoryBadge category={expense.category} />{activity && <span className="inline-flex min-w-0 items-center gap-1 text-[#4D8489]"><Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{activity.name}</span></span>}</div>
            {expanded && <div className="mb-3 rounded-2xl bg-[#F9FBFB] px-4 py-3"><ExpenseDetails expense={expense} activity={activity} trip={trip} /></div>}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF5F5] pt-3"><DetailsToggle expense={expense} open={expanded} onToggle={() => toggle(expense.id)} /><ExpenseActions expense={expense} online={online} onEdit={onEdit} onDelete={onDelete} /></div>
          </article>;
        })}</div>
      </>}
      <p className="text-center text-[11px] leading-5 text-[#638486]">Os gastos somam apenas o que foi registrado aqui. Os orçamentos do cronograma continuam sendo planejamento.</p>
    </section>
  );
}

function ExpenseRows({ expense, activity, trip, expanded, onToggle, actions }: { expense: Expense; activity: Activity | null; trip: Trip; expanded: boolean; onToggle: () => void; actions: React.ReactNode }) {
  return <>
    <tr className={`border-b border-[#EEF5F5] hover:bg-[#FDFEFE] ${expanded ? "bg-[#FCFDFD]" : ""}`}>
      <td className="px-5 py-5 align-top text-xs font-medium leading-5 text-[#4D7679]">{formatCalendarDate(expense.expense_date)}</td>
      <td className="px-4 py-4 align-top"><div className="break-words text-sm font-semibold leading-6 text-[#125E67]">{expense.description}</div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">{activity && <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-[#4D8489]"><Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{activity.name}</span></span>}<DetailsToggle expense={expense} open={expanded} onToggle={onToggle} /></div></td>
      <td className="px-4 py-5 align-top"><ExpenseCategoryBadge category={expense.category} /></td>
      <td className="px-4 py-5 text-right align-top text-base font-semibold tracking-tight text-[#125E67]">{formatCurrency(expense.amount_cents)}</td>
      <td className="px-1 py-3 align-top">{actions}</td>
    </tr>
    {expanded && <tr className="border-b border-[#EEF5F5] bg-[#FCFDFD]"><td colSpan={5} className="px-5 pb-5 pt-1"><ExpenseDetails expense={expense} activity={activity} trip={trip} /></td></tr>}
  </>;
}
