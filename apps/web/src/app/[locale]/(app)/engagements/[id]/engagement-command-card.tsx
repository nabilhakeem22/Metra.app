'use client';

import { Link2, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
// A plain PURE module (no barrel, no server-only, no db runtime) — see the
// guards/money note below for why this component only ever imports leaves.
import { findLatestClientChangeRequestNote } from '@/lib/engagements/client-activity-note';
import { deriveCommandCard, type CommandCardMode } from '@/lib/engagements/command-card';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { EngagementClientActivityRecord } from '@/lib/engagements/queries/client-activity';
// Import from the LEAF (guards/money), not the guards barrel: the barrel also
// re-exports GUARDS from ./registry, which would drag the whole guard engine
// (registry -> readiness/money -> transitions) into THIS client chunk. That heavy,
// cycle-prone graph can evaluate a binding as `undefined` at client module-init
// (vitest even deadlocks importing it) and throw at render. The leaf carries only
// the pure MONEY_GUARD_MILESTONE map + erased types — no registry, no cycle.
import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards/money';
import { stateMilestone } from '@/lib/engagements/journey-map';
import { isTerminal, type DesignState } from '@/lib/engagements/states';
import type { Trigger } from '@/lib/engagements/transitions';
import { formatDate } from '@/lib/format/date';
import { EngagementFeeForm } from './engagement-fee-form';
import { EngagementHeroBadges } from './engagement-hero-badges';
import { EngagementHeroChecklist } from './engagement-hero-checklist';
import {
  EngagementInlineDropzone,
  inlineDropzoneCategory,
} from './engagement-inline-dropzone';
import { EngagementOffPlanToggle } from './engagement-off-plan-toggle';
import { PaymentForm } from './engagement-payment-form';
import { EngagementSecondaryActions } from './engagement-secondary-actions';
import { EngagementStepRibbon } from './engagement-step-ribbon';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';

// The cockpit COMMAND CARD — the single "what's next" surface, redesigned as a
// stacked card: (1) a 5-stage STEP RIBBON over a human STATUS PILL + a "whose
// move" line; (2) THE ONE ACTION — headline + an inline attachment dropzone OR
// the fee/pay fields + one highlighted primary button + a "what happens next"
// helper; (3) a quiet FOOTER (client link + the "more actions" secondary
// controls). It derives a machine-truthful view from the server gate preview
// (`deriveCommandCard`): the headline reflects what ACTUALLY blocks Advance — the
// real unmet forward guards. The client's advisory approval NEVER gates Advance.
// The BLOCKING money gate always offers pay-and-advance (finance roles), pre-filled
// to the exact shortfall, with the S1 remount-on-shortfall guard preserved. Logical
// CSS only (RTL mirrors); money is `tabular-nums`, `dir=ltr` inside the checklist.

/**
 * The human status pill + "whose move" line, pure from the command view + the
 * pending client-payment-claim count. blockedClient with a pending claim reads as
 * "payment to confirm" (the studio's move to record it), not "waiting on client".
 */
function derivePill(
  mode: CommandCardMode,
  paymentClaimCount: number,
): { pillKey: string; moveKey: 'studio' | 'client' | null } {
  switch (mode) {
    case 'closed':
      return { pillKey: 'closed', moveKey: null };
    case 'ready':
      return { pillKey: 'ready', moveKey: 'studio' };
    case 'blockedStudio':
      return { pillKey: 'studio', moveKey: 'studio' };
    default:
      return paymentClaimCount > 0
        ? { pillKey: 'paymentToConfirm', moveKey: 'studio' }
        : { pillKey: 'waitingClient', moveKey: 'client' };
  }
}

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
  canUpload,
  canSetOffPlan,
  offPlan,
  paymentClaimCount,
  clientActivity,
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
  canUpload: boolean;
  canSetOffPlan: boolean;
  offPlan: boolean;
  paymentClaimCount: number;
  clientActivity: EngagementClientActivityRecord[];
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
  const pill = derivePill(view.mode, paymentClaimCount);

  // Mode-driven accent (amber/warn for the blocked attention states, brand for
  // ready, neutral for closed) — expressed through the app's semantic tokens so
  // both themes + RTL stay correct.
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
  const pillClass =
    accent === 'warn'
      ? 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]'
      : accent === 'brand'
        ? 'bg-brand-tint text-brand-ink'
        : 'bg-[color:var(--track)] text-[color:var(--text-muted)]';
  const borderClass =
    accent === 'warn'
      ? 'border-[color:var(--warn-tint)]'
      : accent === 'brand'
        ? 'border-[color:var(--brand-tint-border)]'
        : 'border-[color:var(--rule)]';
  const showNudgePill = view.showNudge && canShare;

  // The inline attachment dropzone is THE ONE ACTION when the studio's next move
  // is to attach a deliverable at this stage (null otherwise).
  const dropzoneCategory = inlineDropzoneCategory(state);
  // The off-plan toggle only makes sense before the survey branch — the proposal
  // milestone (created / design_proposal), and only for a role that may update.
  const atProposal = !closed && stateMilestone(state).index === 0;

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

  // The client's latest change-request text — the brief for the revision the
  // studio is about to make. It belongs next to the headline, not buried in the
  // timeline tab. Null when the client has asked for nothing (or asked with no
  // words), and never an approval's note.
  const clientNote = findLatestClientChangeRequestNote(clientActivity);
  const clientNoteDate = clientNote ? formatDate(clientNote.decidedAt, locale) : '';

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
      {/* Left accent stripe — 4px on the inline-START so it mirrors to the
          inline-END in ar-EG RTL. Mode-driven color. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 w-1 ${stripeClass}`}
        style={{ insetInlineStart: 0 }}
      />

      {/* 1. STEP RIBBON + STATUS PILL + WHOSE-MOVE */}
      <EngagementStepRibbon state={state} />
      <div className="mb-3.5 mt-3 flex flex-wrap items-center gap-2.5">
        <span
          className={`inline-flex items-center rounded-[var(--r-pill)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${pillClass}`}
        >
          {tcmd(`pill.${pill.pillKey}`)}
        </span>
        {pill.moveKey && (
          <span className="text-[12.5px] text-[color:var(--text-muted)]">
            {tcmd(`move.${pill.moveKey}`)}
          </span>
        )}
      </div>

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

      {/* 2. THE ONE ACTION */}
      <h2 className="mb-1 text-[22px] font-semibold leading-tight tracking-[var(--tracking-title)] text-balance">
        {headline}
      </h2>
      {hint && (
        <p className="mb-4 text-[13.5px] text-[color:var(--text-muted)]">{hint}</p>
      )}

      {/* The client's own words — a QUIET callout under the headline, never a
          second CTA. Plain text: React escapes it, so client-authored input can
          never inject markup. Logical CSS only, so it mirrors in ar-EG. */}
      {clientNote && (
        <div className="mb-4 rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-[color:var(--track)] px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-faint)]">
            {tcmd('clientNote')}
          </p>
          {/* Clamped to 4 lines: a long client note must never push the primary
              Advance CTA below the fold — the whole point of this card is one
              unmissable next action. The full text is always in the Timeline. */}
          <p className="mt-1 line-clamp-4 whitespace-pre-line break-words text-[13.5px] text-[color:var(--text)]">
            {t('noteQuote', { note: clientNote.note })}
          </p>
          {(clientNote.actorName || clientNoteDate) && (
            <p className="mt-1 text-[11.5px] text-[color:var(--text-faint)]">
              {clientNote.actorName && (
                <span>{t('clientActivity.by', { name: clientNote.actorName })}</span>
              )}
              {clientNote.actorName && clientNoteDate && <span aria-hidden> · </span>}
              {clientNoteDate && (
                <span className="font-mono" dir="ltr">
                  {clientNoteDate}
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {!closed && (
        <>
          {dropzoneCategory && (
            <EngagementInlineDropzone
              engagementId={engagementId}
              category={dropzoneCategory}
              canUpload={canUpload}
            />
          )}

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
              // disabled — a flat subdued fill, never the brand CTA that looks
              // clickable. Behaviour is unchanged (still gated by `disabled`).
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

          {/* Off-plan toggle — only at the proposal milestone, for update roles.
              It drives Step 2 (survey vs AutoCAD import). */}
          {atProposal && canSetOffPlan && (
            <EngagementOffPlanToggle
              engagementId={engagementId}
              offPlan={offPlan}
              pending={pending}
              runAction={runAction}
            />
          )}

          {/* 3. FOOTER — client link + the "more actions" secondary controls. */}
          {canShare && (
            <div className="mt-5 border-t border-[color:var(--rule)] pt-4">
              <button
                type="button"
                onClick={onNudge}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-ink hover:underline"
              >
                <Link2 className="size-3.5" aria-hidden />
                {tcmd('nudge')}
              </button>
            </div>
          )}

          <EngagementSecondaryActions
            engagementId={engagementId}
            triggers={secondaryTriggers}
            revisionCount={revisionCount}
            freeRevisionN={freeRevisionN}
            pending={pending}
            runAction={runAction}
          />
        </>
      )}
    </section>
  );
}
