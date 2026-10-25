// What is still open on a FINISHED design phase, for the one line the cockpit
// folds the design into once the delivery is at `execution`. PURE and
// CLIENT-SAFE, over data the cockpit page already loads (the fee schedule, the
// payment ledger, the pending claims, the unanswered client questions), so it
// costs no read.
import { milestoneRequired4 } from './guards';
import { paidForKind } from './pulse';
import type { EngagementFeeSchedule, EngagementPayment } from './queries';

export interface DesignSummary {
  /** Design-fee instalments not cleared yet. */
  openInstalments: number;
  /** Client "I paid" claims on the design fee still waiting for the studio. */
  pendingClaims: number;
  /** Client questions on design documents still waiting for a studio reply. */
  awaitingReply: number;
}

/**
 * An instalment is open while its ledger falls short of what it bills. One whose
 * amount cannot be computed (no design fee) is open too: the money guards fail
 * closed on it the same way, so it was never cleared.
 */
function isOpen(
  milestone: EngagementFeeSchedule['milestones'][number],
  designFee: string | null,
  payments: EngagementPayment[],
): boolean {
  const required = milestoneRequired4(milestone.basis, milestone.value, designFee);
  return required === null || paidForKind(payments, milestone.kind) < required;
}

export function designSummary(input: {
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  paymentClaims: readonly { id: string }[];
  awaitingReplyCount: number;
}): DesignSummary {
  const { milestones, designFee } = input.feeSchedule;
  return {
    openInstalments: milestones.filter((milestone) => isOpen(milestone, designFee, input.payments)).length,
    pendingClaims: input.paymentClaims.length,
    awaitingReply: input.awaitingReplyCount,
  };
}
