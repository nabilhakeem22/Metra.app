'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import { deriveCommandCard } from '@/lib/engagements/command-card';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
// Import from the LEAF (guards/money), not the guards barrel: the barrel also
// re-exports GUARDS from ./registry, which would drag the whole guard engine
// (registry -> readiness/money -> transitions) into THIS client chunk. That heavy,
// cycle-prone graph can evaluate a binding as `undefined` at client module-init
// (vitest even deadlocks importing it) and throw at render. The leaf carries only
// the pure MONEY_GUARD_MILESTONE map + erased types — no registry, no cycle.
import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards/money';
import { isTerminal, type DesignState } from '@/lib/engagements/states';
import type { Trigger } from '@/lib/engagements/transitions';
import { EngagementFeeForm } from './engagement-fee-form';
import { EngagementHeroBadges } from './engagement-hero-badges';
import { EngagementHeroChecklist } from './engagement-hero-checklist';
import { PaymentForm } from './engagement-payment-form';
import { EngagementSecondaryActions } from './engagement-secondary-actions';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';

// The cockpit COMMAND CARD — the single "what's next" action surface (replaces the
// old hero + next-actions). It derives a machine-truthful view from the server gate
// preview (`deriveCommandCard`): the headline reflects what ACTUALLY blocks Advance
// — the real unmet forward guards. The client's advisory approval NEVER gates
// Advance. Four modes: closed / ready / blockedStudio / blockedClient.
//   • ready        → Advance fires the forward trigger (or opens its fee form).
//   • blockedStudio→ Advance disabled + a note naming the studio blocker.
//   • blockedClient→ "Waiting on the client"; Advance disabled; Nudge (share roles).
//   • a BLOCKING money gate always offers pay-and-advance (finance roles), pre-filled
//     to the exact shortfall, with the S1 remount-on-shortfall guard preserved.
// This is the ONE cockpit-body surface carrying the `.glass` blur recipe. Logical
// CSS only (RTL mirrors); money is `tabular-nums`, `dir=ltr` inside the checklist.
export function EngagementCommandCard({
  engagementId,
  preview,
  state,
  revisionCount,
  freeRevisionN,
  stallDays,
  canAdvance,
  canRecordPayment,
  canShare,
  secondaryTriggers,
  pending,
  runAction,
  onNudge,
}: {
  engagementId: string;
  preview: EngagementGatePreview;
  state: DesignState;
  revisionCount: number;
  freeRevisionN: number;
  stallDays: number | null;
  canAdvance: boolean;
  canRecordPayment: boolean;
  canShare: boolean;
  secondaryTriggers: Trigger[];
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onNudge: () => void;
}) {
  const t = useTranslations('engagements');
  const th = useTranslations('engagements.hero');
  const tg = useTranslations('engagements.guard');
  const tcmd = useTranslations('engagements.command');
  const locale = useLocale();
  const [feeOpen, setFeeOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const view = deriveCommandCard(preview, {
    canAdvance,
    isTerminal: isTerminal(state),
  });
  const closed = view.mode === 'closed';

  // Mode-driven accent (mockup: amber/warn stripe+label for the blocked attention
  // states, brand for ready, neutral for closed) — expressed through the app's
  // semantic tokens so both themes + RTL stay correct.
  const accent: 'neutral' | 'brand' | 'warn' = closed
    ? 'neutral'
    : view.mode === 'ready'
      ? 'brand'
      : 'warn';
  const stripeClass =
    accent === 'warn'
      ? 'bg-[color:var(--warn)]'
      : accent === 'brand'
        ? 'bg-brand'
        : 'bg-[color:var(--rule)]';
  const accentTextClass =
    accent === 'warn'
      ? 'text-[color:var(--warn)]'
      : accent === 'brand'
        ? 'text-brand-ink'
        : 'text-[color:var(--text-faint)]';
  const borderClass =
    accent === 'warn'
      ? 'border-[color:var(--warn-tint)]'
      : accent === 'brand'
        ? 'border-[color:var(--brand-tint-border)]'
        : 'border-[color:var(--rule)]';
  const showNudgePill = view.showNudge && canShare;

  // A blocking money gate whose shortfall we can pre-fill — the pay-and-advance
  // path. `amountDue` is only set on a blocking payment gate (see gate-preview).
  const paymentItem = preview.items.find(
    (item) => !item.ok && MONEY_GUARD_MILESTONE[item.guard] && item.amountDue,
  );
  const paymentKind = paymentItem
    ? MONEY_GUARD_MILESTONE[paymentItem.guard]
    : undefined;
  const showPayCta = Boolean(
    preview.primaryTrigger &&
      paymentItem &&
      paymentKind &&
      canRecordPayment &&
      canAdvance,
  );

  const headline = closed
    ? tcmd('closedHeadline')
    : view.mode === 'ready'
      ? tcmd('readyHeadline', {
          phase: t(`state.${view.nextPhaseState ?? state}`),
        })
      : view.mode === 'blockedStudio'
        ? tcmd('blockedStudioHeadline')
        : tcmd('blockedClientHeadline');
  const hint =
    view.mode === 'ready'
      ? tcmd('readyHint')
      : view.mode === 'blockedStudio'
        ? tcmd('blockedStudioHint', {
            action: view.primaryBlocker ? tg(view.primaryBlocker) : '',
          })
        : view.mode === 'blockedClient'
          ? tcmd('blockedClientHint')
          : null;

  function fireAdvance() {
    if (view.advanceNeedsForm) {
      setFeeOpen((open) => !open);
      return;
    }
    if (!preview.primaryTrigger) return;
    const action = DIRECT_TRIGGER_ACTIONS[preview.primaryTrigger];
    if (action) runAction(() => action(engagementId));
  }

  return (
    <section
      className={`glass relative overflow-hidden p-5 text-[color:var(--text)] sm:p-6 ${borderClass}`}
    >
      {/* Left accent stripe (mockup `.command::before`) — 4px on the inline-START
          so it mirrors to the inline-END in ar-EG RTL. Mode-driven color. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 w-1 ${stripeClass}`}
        style={{ insetInlineStart: 0 }}
      />

      {!closed && (
        <EngagementHeroBadges
          t={t}
          th={th}
          state={state}
          stallDays={stallDays}
          revisionCount={revisionCount}
          freeRevisionN={freeRevisionN}
        />
      )}

      {!closed && (
        <p
          className={`mb-3 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.11em] ${accentTextClass}`}
        >
          <span aria-hidden>◆</span>
          {tcmd('stepLabel')}
        </p>
      )}
      <h2 className="mb-1 text-[22px] font-semibold leading-tight tracking-[var(--tracking-title)] text-balance">
        {headline}
      </h2>
      {hint && (
        <p className="mb-4 text-[13.5px] text-[color:var(--text-muted)]">{hint}</p>
      )}

      {!closed && (
        <>
          {preview.items.length > 0 && (
            <EngagementHeroChecklist
              th={th}
              tg={tg}
              locale={locale}
              items={preview.items}
              showNudgePill={showNudgePill}
              nudgeLabel={tcmd('nudge')}
              onNudge={onNudge}
            />
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {showPayCta && (
              <Button
                type="button"
                disabled={pending}
                onClick={() => setPayOpen((open) => !open)}
              >
                {th('logPaymentAdvance')}
              </Button>
            )}
            <Button
              type="button"
              // When Advance is blocked (any non-'ready' mode) it must READ as
              // disabled — a flat subdued glass fill, never the brand-gradient CTA
              // that looks clickable. The enabled brand look is kept only when the
              // gate is genuinely all-clear. Behaviour is unchanged (still gated by
              // `disabled` below); this only makes the disabled state unmistakable.
              variant={view.advanceEnabled ? 'default' : 'secondary'}
              disabled={!view.advanceEnabled || pending}
              onClick={fireAdvance}
            >
              {pending && view.advanceEnabled && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {th('advance')}
            </Button>
          </div>

          {view.mode === 'blockedStudio' && view.primaryBlocker && (
            <p className="mt-3.5 text-[12.5px] text-[color:var(--text-muted)]">
              {tcmd('advanceBlockedNote', { blocker: tg(view.primaryBlocker) })}
            </p>
          )}

          {view.showNudge && canShare && (
            <p className="mt-3.5 flex items-baseline gap-1.5 text-[12.5px] text-[color:var(--text-muted)]">
              <span aria-hidden>◆</span>
              <span>{tcmd('nudgeHint')}</span>
            </p>
          )}

          {showPayCta && (
            <p className="mt-3.5 flex items-baseline gap-1.5 text-[12.5px] text-[color:var(--text-muted)]">
              <span aria-hidden>◆</span>
              <span>{th('payNote')}</span>
            </p>
          )}

          {feeOpen && view.mode === 'ready' && view.advanceNeedsForm && (
            <div className="mt-4">
              <EngagementFeeForm
                engagementId={engagementId}
                pending={pending}
                onSubmit={(fn) => runAction(fn)}
                onCancel={() => setFeeOpen(false)}
              />
            </div>
          )}

          {showPayCta &&
            payOpen &&
            paymentKind &&
            paymentItem?.amountDue &&
            preview.primaryTrigger && (
              // key = the current shortfall: when a SHORT payment persists and the
              // server checklist revalidates to a reduced due, this key changes and
              // React REMOUNTS the form — re-deriving the pre-filled amount from the
              // new (smaller) due, so a blind re-click can't re-charge the old figure
              // against the append-only ledger (S1: over-collection on re-click).
              <PaymentForm
                key={paymentItem.amountDue}
                engagementId={engagementId}
                paymentKind={paymentKind}
                defaultAmount={paymentItem.amountDue}
                advanceTrigger={preview.primaryTrigger}
                pending={pending}
                runAction={runAction}
                onDone={() => setPayOpen(false)}
              />
            )}

          <EngagementSecondaryActions
            engagementId={engagementId}
            triggers={secondaryTriggers}
            pending={pending}
            runAction={runAction}
          />
        </>
      )}
    </section>
  );
}
