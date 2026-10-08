"use client";

import { AlertTriangle, Check, CircleHelp, Wallet } from "lucide-react";
import { formatCurrency } from "../lib/domain";
import { FILTER_BUDGET_NOTE, OFFLINE_BUDGET_NOTE, PLANNING_NOTE, SPENDING_NOTE, UNDEFINED_BUDGET_LABEL, budgetSnapshot, formatSignedCurrency, situationLabel, undefinedBudgetMessage, type BudgetKind } from "../lib/budget";

interface BudgetFollowUpProps {
  kind: BudgetKind;
  initialCents: number | null;
  /** Null means the total failed to load. It is not the same as zero. */
  usedCents: number | null;
  undefinedBudgetCount?: number;
  offline?: boolean;
  filtered?: boolean;
  showInitial?: boolean;
  onDefineBudget?: () => void;
}

const money = "text-[22px] font-semibold leading-none tracking-[-0.03em] sm:text-[26px]";

export function BudgetReference({ cents, onDefine }: { cents: number | null; onDefine?: () => void }) {
  return (
    <section aria-labelledby="budget-reference-heading" className="rounded-[24px] border border-[#cbddee] bg-[#e7f0fa] px-6 py-6">
      <h2 id="budget-reference-heading" className="inline-flex items-center gap-2 text-xs font-semibold text-[#6183a5]"><Wallet className="h-4 w-4" aria-hidden="true" />Orçamento inicial da viagem</h2>
      {cents === null ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-lg font-semibold text-[#3b5f86]" data-testid="budget-initial">{UNDEFINED_BUDGET_LABEL}</p>
          {onDefine && <button type="button" onClick={onDefine} className="inline-flex min-h-11 items-center rounded-xl bg-[#3b5f86] px-4 text-sm font-semibold text-white transition hover:bg-[#52779d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b5f86]">Definir orçamento</button>}
        </div>
      ) : <p className="mt-4 text-[32px] font-semibold leading-none tracking-[-0.04em] text-[#3b5f86] sm:text-[36px]" data-testid="budget-initial">{formatCurrency(cents)}</p>}
      <p className="mt-3 max-w-2xl text-xs leading-6 text-[#617e9a]">Valor de referência do casal. O planejamento e os gastos partem deste valor e não descontam um do outro.</p>
    </section>
  );
}

export function BudgetFollowUp({ kind, initialCents, usedCents, undefinedBudgetCount = 0, offline = false, filtered = false, showInitial = true, onDefineBudget }: BudgetFollowUpProps) {
  const snapshot = budgetSnapshot(initialCents, usedCents);
  const label = situationLabel(kind, snapshot);
  const pending = kind === "planning" ? undefinedBudgetMessage(undefinedBudgetCount) : null;
  const usedLabel = kind === "planning" ? "Total planejado no cronograma" : "Total gasto";
  const balanceLabel = kind === "planning" ? "Saldo do planejamento" : "Saldo conforme gastos registrados";
  const title = kind === "planning" ? "Planejamento do cronograma" : "Gastos registrados";
  const over = snapshot.situation === "over";
  const knownBalance = snapshot.balanceCents !== null;
  const statusClass = over
    ? "border-[#efdce4] bg-[#fbf0f3] text-[#a05770]"
    : snapshot.situation === "unknown"
      ? "border-[#efdfba] bg-[#fcf6e9] text-[#95754a]"
      : snapshot.situation === "undefined"
        ? "border-[#e3ebf3] bg-[#f7f9fc] text-[#5c7fa3]"
        : "border-[#d5e4f2] bg-[#eef5fb] text-[#3b5f86]";
  const StatusIcon = over || snapshot.situation === "unknown" ? AlertTriangle : snapshot.situation === "undefined" ? CircleHelp : Check;

  return (
    <section aria-labelledby={`budget-${kind}-heading`} className="rounded-[24px] border border-[#e2e9f2] bg-white px-5 py-5 shadow-[0_3px_18px_#3b5f8603] sm:px-6" data-testid={`budget-${kind}`}>
      <h2 id={`budget-${kind}-heading`} className="text-base font-semibold text-[#3b5f86]">{title}</h2>
      <dl className="mt-4 space-y-4">
        {showInitial && <div className="flex items-end justify-between gap-3"><dt className="text-xs font-semibold text-[#6e8194]">Orçamento inicial</dt><dd className={`${money} text-[#3b5f86]`} data-testid={`budget-${kind}-initial`}>{snapshot.initialCents === null ? UNDEFINED_BUDGET_LABEL : formatCurrency(snapshot.initialCents)}</dd></div>}
        <div className="flex items-end justify-between gap-3"><dt className="text-xs font-semibold text-[#6e8194]">{usedLabel}</dt><dd className={`${money} text-[#3b5f86]`} data-testid={`budget-${kind}-used`}>{snapshot.usedCents === null ? "Indisponível" : formatCurrency(snapshot.usedCents)}</dd></div>
        <div className="flex items-end justify-between gap-3 border-t border-[#edf1f6] pt-4"><dt className="text-xs font-semibold text-[#6e8194]">{balanceLabel}</dt><dd className={`${money} ${over ? "text-[#a05770]" : "text-[#3b5f86]"}`} data-testid={`budget-${kind}-balance`}>{knownBalance ? formatSignedCurrency(snapshot.balanceCents!) : "Não calculado"}</dd></div>
      </dl>

      {snapshot.percent !== null && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-[#e7eef6]" role="img" aria-label={`${snapshot.percent}% do orçamento inicial`}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, snapshot.percent))}%`, backgroundColor: over ? "#c4899b" : "#3b5f86" }} />
          </div>
          <p className="mt-1.5 text-[11px] text-[#6e8194]">{snapshot.percent > 100 ? `${snapshot.percent}% — acima de 100% do orçamento inicial` : `${snapshot.percent}% do orçamento inicial`}</p>
        </div>
      )}

      <div className={`mt-4 flex items-start gap-2 rounded-2xl border px-3.5 py-3 text-sm leading-6 ${statusClass}`} role={over ? "alert" : "status"} data-testid={`budget-${kind}-status`}>
        <StatusIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold">{label}</p>
          {snapshot.situation === "undefined" && onDefineBudget && <button type="button" onClick={onDefineBudget} className="mt-2 inline-flex min-h-10 items-center rounded-xl border border-[#d5e2ef] bg-white px-3 text-xs font-semibold text-[#3b5f86] transition hover:bg-[#f4f8fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b5f86]">Definir orçamento</button>}
        </div>
      </div>

      {pending && <p className="mt-3 text-xs leading-6 text-[#6e8194]" data-testid="budget-undefined-count">{pending}</p>}
      {snapshot.situation !== "unknown" && <p className="mt-3 text-[11px] leading-5 text-[#8194a7]">{kind === "planning" ? PLANNING_NOTE : SPENDING_NOTE}</p>}
      {filtered && <p className="mt-2 text-[11px] leading-5 text-[#8194a7]">{FILTER_BUDGET_NOTE}</p>}
      {offline && <p className="mt-2 text-[11px] leading-5 text-[#8194a7]">{OFFLINE_BUDGET_NOTE}</p>}
    </section>
  );
}
