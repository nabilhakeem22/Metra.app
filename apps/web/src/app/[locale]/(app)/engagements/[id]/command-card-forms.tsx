'use client';

import type { ActionResult } from '@/lib/actions/result';
import type { CommandCardView } from '@/lib/engagements/command-card';
import type { CommandCardCtas } from '@/lib/engagements/command-card-ctas';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { Trigger } from '@/lib/engagements/transitions';
import { EngagementFeeForm } from './engagement-fee-form';
import { EngagementOffPlanToggle } from './engagement-off-plan-toggle';
import { PaymentForm } from './engagement-payment-form';

// The three inputs the command card can open under its action row: the design-fee
// form, the pay-and-advance form, and the off-plan toggle. Each is closed by
// default — the card's premise is ONE unmissable next action, not a form stack.

export interface CommandCardFormsProps {
  engagementId: string;
  preview: EngagementGatePreview;
  view: CommandCardView;
  ctas: Pick<CommandCardCtas, 'showPayCta' | 'paymentKind' | 'paymentItem' | 'atProposal'>;
  open: { fee: boolean; pay: boolean };
  offPlan: { enabled: boolean; canSet: boolean };
  pending: boolean;
  handlers: {
    runAction: (
      fn: (idempotencyKey: string) => Promise<ActionResult>,
      trigger?: Trigger,
    ) => void;
    closeFee: () => void;
    closePay: () => void;
  };
}

export function CommandCardForms({
  engagementId,
  preview,
  view,
  ctas,
  open,
  offPlan,
  pending,
  handlers,
}: CommandCardFormsProps) {
  return (
    <>
      {open.fee && view.mode === 'ready' && view.advanceNeedsForm && (
        <div className="mt-4">
          <EngagementFeeForm
            engagementId={engagementId}
            pending={pending}
            onSubmit={(fn) => handlers.runAction(fn)}
            onCancel={handlers.closeFee}
          />
        </div>
      )}

      {ctas.showPayCta &&
        open.pay &&
        ctas.paymentKind &&
        ctas.paymentItem?.amountDue &&
        preview.primaryTrigger && (
          // key = the current shortfall: when a SHORT payment persists and the
          // server checklist revalidates to a reduced due, this key changes and
          // React REMOUNTS the form — re-deriving the pre-filled amount from the
          // new (smaller) due, so a blind re-click can't re-charge the old figure
          // against the append-only ledger (S1: over-collection on re-click).
          <PaymentForm
            key={ctas.paymentItem.amountDue}
            engagementId={engagementId}
            paymentKind={ctas.paymentKind}
            defaultAmount={ctas.paymentItem.amountDue}
            advanceTrigger={preview.primaryTrigger}
            pending={pending}
            runAction={handlers.runAction}
            onDone={handlers.closePay}
          />
        )}

      {/* Off-plan toggle — only at the proposal milestone, for update roles. It
          drives Step 2 (survey vs AutoCAD import). */}
      {ctas.atProposal && offPlan.canSet && (
        <EngagementOffPlanToggle
          engagementId={engagementId}
          offPlan={offPlan.enabled}
          pending={pending}
          runAction={handlers.runAction}
        />
      )}
    </>
  );
}
