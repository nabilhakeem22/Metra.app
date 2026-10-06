'use client';

import type { CommandCardView } from '@/lib/engagements/command-card';
import type { CommandCardCtas } from '@/lib/engagements/command-card-ctas';
import type { FeeSplitPrefill } from '@/lib/engagements/default-fee-split';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { EngagementFeeForm } from './engagement-fee-form';
import { EngagementOffPlanToggle } from './engagement-off-plan-toggle';
import { PaymentForm } from './engagement-payment-form';
import type { RunAction } from './use-engagement-action';

// The three inputs the command card can open under its action row: the design-fee
// form, the payment form (pay-and-advance, or record-only at the ending choice),
// and the off-plan toggle. Each is closed by
// default — the card's premise is ONE unmissable next action, not a form stack.

export interface CommandCardFormsProps {
  engagementId: string;
  preview: EngagementGatePreview;
  view: CommandCardView;
  ctas: Pick<CommandCardCtas, 'payCta' | 'paymentKind' | 'paymentItem' | 'atProposal'>;
  open: { fee: boolean; pay: boolean };
  offPlan: { enabled: boolean; canSet: boolean };
  /** The fee form's opening split (the studio's last, or 50/30/20). */
  feeSplitPrefill: FeeSplitPrefill | null;
  pending: boolean;
  handlers: {
    runAction: RunAction;
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
  feeSplitPrefill,
  pending,
  handlers,
}: CommandCardFormsProps) {
  return (
    <>
      {open.fee && view.mode === 'ready' && view.advanceNeedsForm && (
        <div className="mt-4">
          <EngagementFeeForm
            engagementId={engagementId}
            prefill={feeSplitPrefill}
            pending={pending}
            onSubmit={(fn) => handlers.runAction(fn)}
            onCancel={handlers.closeFee}
          />
        </div>
      )}

      {ctas.payCta &&
        open.pay &&
        ctas.paymentKind &&
        ctas.paymentItem?.amountDue &&
        (ctas.payCta === 'recordOnly' || preview.primaryTrigger) && (
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
            mode={ctas.payCta}
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
