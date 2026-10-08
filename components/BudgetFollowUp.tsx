"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Check, CircleHelp, Wallet } from "lucide-react";
import { FILTER_BUDGET_NOTE, OFFLINE_BUDGET_NOTE, ORIGINAL_PLAN_NOTE, PLANNING_NOTE, PROJECTION_NOTE, SPENDING_NOTE, UNDEFINED_BUDGET_LABEL, balanceText, initialBudgetText, planningShortfallLabel, scheduleCalmLabel, spendingStatusLabel, totalText, undefinedBudgetMessage, type BudgetSituation, type TripBudgetView } from "../lib/budget";

interface BudgetPanelProps {
  view: TripBudgetView;
  offline?: boolean;
  filtered?: boolean;
  onDefineBudget?: () => void;
}

const money = "min-w-0 break-words text-right font-semibold leading-none tracking-[-0.03em]";

type StatusVariant = "ok" | "over" | "planning" | "unknown" | "undefined";

function statusVariant(situation: BudgetSituation): StatusVariant {
  if (situation === "over") return "over";
  if (situation === "unknown") return "unknown";
  if (situation === "undefined") return "undefined";
  return "ok";
}

function statusClass(variant: StatusVariant): string {
  if (variant === "over") return "border-[#efdce4] bg-[#fbf0f3] text-[#a05770]";
  if (variant === "planning" || variant === "unknown") return "border-[#efdfba] bg-[#fcf6e9] text-[#95754a]";
  if (variant === "undefined") return "border-[#E3EEEF] bg-[#F8FBFB] text-[#4D8489]";
  return "border-[#CAEAEC] bg-[#F2F7F7] text-[#125E67]";
}

function StatusLine({ testId, variant, children, action }: { testId: string; variant: StatusVariant; children: string; action?: ReactNode }) {
  const alert = variant === "over" || variant === "planning";
  const Icon = alert || variant === "unknown" ? AlertTriangle : variant === "undefined" ? CircleHelp : Check;
  return (
    <div className={`mt-3 flex items-start gap-2 rounded-2xl border px-3.5 py-3 text-sm leading-6 ${statusClass(variant)}`} role={alert ? "alert" : "status"} data-testid={testId}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{children}</p>
        {action}
      </div>
    </div>
  );
}

function DefineButton({ onDefine }: { onDefine?: () => void }) {
  if (!onDefine) return null;
  return <button type="button" onClick={onDefine} className="mt-2 inline-flex min-h-10 items-center rounded-xl border border-[#C9E8EA] bg-white px-3 text-xs font-semibold text-[#125E67] transition hover:bg-[#F6FAFA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#125E67]">Definir orçamento</button>;
}

function ShareBar({ percent, over, label }: { percent: number; over: boolean; label: string }) {
  const caption = `${percent > 100 ? `${percent}% — acima de 100%` : `${percent}%`} ${label}`;
  return (
    <div className="mt-4">
      <div className="h-2 overflow-hidden rounded-full bg-[#E7F1F2]" role="img" aria-label={caption}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: over ? "#c4899b" : "#125E67" }} />
      </div>
      <p className="mt-1.5 text-[11px] text-[#638486]">{caption}</p>
    </div>
  );
}

function Footnotes({ filtered = false, offline = false, children }: { filtered?: boolean; offline?: boolean; children?: ReactNode }) {
  return (
    <>
      {children}
      {filtered && <p className="mt-2 text-[11px] leading-5 text-[#70989B]">{FILTER_BUDGET_NOTE}</p>}
      {offline && <p className="mt-2 text-[11px] leading-5 text-[#70989B]">{OFFLINE_BUDGET_NOTE}</p>}
    </>
  );
}

export function SpendingFollowUp({ view, offline = false, filtered = false, onDefineBudget }: BudgetPanelProps) {
  const label = spendingStatusLabel(view);
  const over = view.spendingSituation === "over";
  const balanceClass = over ? "text-[#a05770]" : "text-[#125E67]";

  return (
    <section aria-labelledby="budget-spending-heading" className="rounded-[24px] border border-[#E2EDEE] bg-white px-5 py-5 shadow-[0_3px_18px_#28AEB903] sm:px-6" data-testid="budget-spending">
      <h2 id="budget-spending-heading" className="text-base font-semibold text-[#125E67]">Saldo da viagem</h2>
      <dl className="mt-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <dt className="text-xs font-semibold text-[#638486]">Orçamento inicial</dt>
          <dd className={`${money} text-[22px] text-[#125E67] sm:text-[26px]`} data-testid="budget-spending-initial">{initialBudgetText(view.initialCents)}</dd>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <dt className="text-xs font-semibold text-[#638486]">Total gasto</dt>
          <dd className={`${money} text-[22px] text-[#125E67] sm:text-[26px]`} data-testid="budget-spending-used">{totalText(view.spentCents)}</dd>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-[#EEF5F5] pt-4">
          <dt className="text-xs font-semibold text-[#638486]">Saldo disponível</dt>
          <dd className={`${money} text-[28px] sm:text-[32px] ${balanceClass}`} data-testid="budget-spending-balance">{balanceText(view.availableCents)}</dd>
        </div>
      </dl>

      {view.spendingPercent !== null && <ShareBar percent={view.spendingPercent} over={over} label="do orçamento inicial" />}

      <StatusLine testId="budget-spending-status" variant={statusVariant(view.spendingSituation)} action={view.spendingSituation === "undefined" ? <DefineButton onDefine={onDefineBudget} /> : undefined}>{label}</StatusLine>
      <Footnotes filtered={filtered} offline={offline}>
        <p className="mt-3 text-[11px] leading-5 text-[#70989B]">{SPENDING_NOTE}</p>
      </Footnotes>
    </section>
  );
}

export function ScheduleBudget({ view, offline = false, filtered = false, onDefineBudget }: BudgetPanelProps) {
  const pendingNote = undefinedBudgetMessage(view.undefinedBudgetCount);
  const spendingAlert = view.spendingSituation === "over" ? spendingStatusLabel(view) : null;
  const planningAlert = view.planningShortfallCents !== null ? planningShortfallLabel(view.planningShortfallCents) : null;
  const calm = !spendingAlert && !planningAlert ? scheduleCalmLabel(view) : null;
  const freeOver = view.freeCents !== null && view.freeCents < 0;
  const availableOver = view.availableCents !== null && view.availableCents < 0;

  return (
    <section aria-labelledby="budget-schedule-heading" className="rounded-[24px] border border-[#E2EDEE] bg-white px-5 py-5 shadow-[0_3px_18px_#28AEB903] sm:px-6" data-testid="budget-schedule">
      <h2 id="budget-schedule-heading" className="text-base font-semibold text-[#125E67]">Orçamento do cronograma</h2>
      <p className="mt-2 max-w-2xl text-[11px] leading-5 text-[#70989B]">{PLANNING_NOTE}</p>

      <div className="mt-5 rounded-[20px] border border-[#BDE4E8] bg-[#EAF2F3] px-4 py-4 sm:px-5">
        <p className="text-xs font-semibold text-[#50888D]">Orçamento disponível após os gastos</p>
        <p className={`mt-2 text-[32px] font-semibold leading-none tracking-[-0.04em] sm:text-[36px] ${availableOver ? "text-[#a05770]" : "text-[#125E67]"}`} data-testid="budget-schedule-available">{balanceText(view.availableCents)}</p>
        {view.initialCents !== null && (
          <p className="mt-3 text-[11px] leading-5 text-[#548286]">
            Orçamento inicial {initialBudgetText(view.initialCents)}
            {view.spentCents !== null && <> · gastos registrados {totalText(view.spentCents)}</>}
          </p>
        )}
        {view.initialCents === null && <DefineButton onDefine={onDefineBudget} />}
      </div>

      <dl className="mt-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <dt className="text-xs font-semibold text-[#638486]">Valor ainda reservado para as atividades</dt>
          <dd className={`${money} text-[22px] text-[#125E67] sm:text-[26px]`} data-testid="budget-schedule-pending">{totalText(view.pendingCents)}</dd>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-[#EEF5F5] pt-4">
          <dt className="text-sm font-semibold text-[#125E67]">Saldo livre após o planejamento</dt>
          <dd className={`${money} text-[28px] sm:text-[32px] ${freeOver ? "text-[#a05770]" : "text-[#125E67]"}`} data-testid="budget-schedule-free">{balanceText(view.freeCents)}</dd>
        </div>
      </dl>

      {view.reservedPercent !== null && <ShareBar percent={view.reservedPercent} over={view.planningShortfallCents !== null} label="do saldo disponível" />}

      <p className="mt-4 text-[11px] leading-5 text-[#70989B]" data-testid="budget-schedule-planned">{ORIGINAL_PLAN_NOTE} <strong className="font-semibold text-[#4F7A7D]">{totalText(view.plannedCents)}</strong></p>

      {spendingAlert && <StatusLine testId="budget-schedule-spending-alert" variant="over">{spendingAlert}</StatusLine>}
      {planningAlert && <StatusLine testId="budget-schedule-planning-alert" variant="planning">{planningAlert}</StatusLine>}
      {calm && <StatusLine testId="budget-schedule-status" variant={statusVariant(view.planningSituation)}>{calm}</StatusLine>}

      <Footnotes filtered={filtered} offline={offline}>
        {pendingNote && <p className="mt-3 text-xs leading-6 text-[#638486]" data-testid="budget-undefined-count">{pendingNote}</p>}
      </Footnotes>
    </section>
  );
}

const flowRow = "flex flex-wrap items-end justify-between gap-x-3 gap-y-1 py-3";

export function BudgetFlow({ view, offline = false, onDefineBudget }: Omit<BudgetPanelProps, "filtered">) {
  const pendingNote = undefinedBudgetMessage(view.undefinedBudgetCount);
  const spendingAlert = view.spendingSituation === "over" ? spendingStatusLabel(view) : null;
  const planningAlert = view.planningShortfallCents !== null ? planningShortfallLabel(view.planningShortfallCents) : null;
  const freeOver = view.freeCents !== null && view.freeCents < 0;
  const availableOver = view.availableCents !== null && view.availableCents < 0;

  return (
    <section aria-labelledby="budget-flow-heading" className="rounded-[24px] border border-[#E2EDEE] bg-white px-5 py-5 shadow-[0_3px_18px_#28AEB903] sm:px-6" data-testid="budget-flow">
      <h2 id="budget-flow-heading" className="inline-flex items-center gap-2 text-base font-semibold text-[#125E67]"><Wallet className="h-4 w-4 text-[#50888D]" aria-hidden="true" />Do orçamento ao saldo livre</h2>
      <ol className="mt-2 divide-y divide-[#EEF5F5]">
        <li className={flowRow}>
          <span className="text-xs font-semibold text-[#638486]">1. Orçamento inicial</span>
          <span className={`${money} text-[22px] text-[#125E67] sm:text-[26px]`} data-testid="budget-flow-initial">{initialBudgetText(view.initialCents)}</span>
        </li>
        <li className={flowRow}>
          <span className="text-xs font-semibold text-[#638486]">2. Menos gastos registrados</span>
          <span className={`${money} text-[22px] text-[#125E67] sm:text-[26px]`} data-testid="budget-flow-spent">{totalText(view.spentCents)}</span>
        </li>
        <li className={`${flowRow} rounded-2xl bg-[#EAF2F3] px-3`}>
          <span className="text-sm font-semibold text-[#125E67]">3. Saldo disponível</span>
          <span className={`${money} text-[28px] sm:text-[32px] ${availableOver ? "text-[#a05770]" : "text-[#125E67]"}`} data-testid="budget-flow-available">{balanceText(view.availableCents)}</span>
        </li>
        <li className={flowRow}>
          <span className="text-xs font-semibold text-[#638486]">4. Menos planejamento ainda pendente</span>
          <span className={`${money} text-[22px] text-[#125E67] sm:text-[26px]`} data-testid="budget-flow-pending">{totalText(view.pendingCents)}</span>
        </li>
        <li className={`${flowRow} rounded-2xl bg-[#F7FAFA] px-3`}>
          <span className="text-sm font-semibold text-[#125E67]">5. Saldo livre após o planejamento</span>
          <span className={`${money} text-[28px] sm:text-[32px] ${freeOver ? "text-[#a05770]" : "text-[#125E67]"}`} data-testid="budget-flow-free">{balanceText(view.freeCents)}</span>
        </li>
      </ol>

      {view.initialCents === null && <DefineButton onDefine={onDefineBudget} />}
      {view.spendingSituation === "unknown" && <StatusLine testId="budget-flow-unknown" variant="unknown">{spendingStatusLabel(view)}</StatusLine>}
      {view.spendingSituation === "undefined" && <StatusLine testId="budget-flow-undefined" variant="undefined">{UNDEFINED_BUDGET_LABEL}</StatusLine>}
      {spendingAlert && <StatusLine testId="budget-flow-spending-alert" variant="over">{spendingAlert}</StatusLine>}
      {planningAlert && <StatusLine testId="budget-flow-planning-alert" variant="planning">{planningAlert}</StatusLine>}
      {!spendingAlert && !planningAlert && view.spendingSituation !== "unknown" && view.spendingSituation !== "undefined" && <StatusLine testId="budget-flow-status" variant={statusVariant(view.planningSituation)}>{scheduleCalmLabel(view)}</StatusLine>}

      <div className="mt-4 rounded-[20px] border border-[#E2EDEE] bg-[#fffdf9] px-4 py-4">
        <p className="text-xs font-semibold text-[#5C8083]">Projeção de custo total</p>
        <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.04em] text-[#125E67]" data-testid="budget-flow-projection">{totalText(view.projectedCents)}</p>
        <p className="mt-2 text-[11px] leading-5 text-[#70989B]">{PROJECTION_NOTE}</p>
      </div>

      <p className="mt-4 text-[11px] leading-5 text-[#70989B]" data-testid="budget-flow-planned">{ORIGINAL_PLAN_NOTE} <strong className="font-semibold text-[#4F7A7D]">{totalText(view.plannedCents)}</strong></p>
      <Footnotes offline={offline}>
        {pendingNote && <p className="mt-3 text-xs leading-6 text-[#638486]" data-testid="budget-undefined-count">{pendingNote}</p>}
        <p className="mt-3 text-[11px] leading-5 text-[#70989B]">{PLANNING_NOTE}</p>
      </Footnotes>
    </section>
  );
}
