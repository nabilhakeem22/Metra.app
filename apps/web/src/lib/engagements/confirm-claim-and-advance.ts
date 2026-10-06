import 'server-only';
// Design-Engagement Machine — "Confirm the client's payment" as ONE action:
// confirm the pending claim (record the real payment), then advance when that
// claim pays the money gate the delivery is waiting on. It mirrors
// `logPaymentAndAdvanceCore`: both steps delegate to the already-reviewed cores
// (`confirmPaymentClaimCore`, then `executeTransition`), so every gate
// they enforce still applies and this core adds NO new authority.
//
// It can never pick an ENDING: the trigger it may fire is the resolved forward
// trigger, which excludes the endings, and it is re-checked here as well. At
// `execution_decision` a balance claim is therefore recorded and the state stays.
import { clientPaymentClaims, designEngagements } from '@metra/db';
import { eq } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';
import { executeTransition } from './executor';
import { getEngagementGatePreview } from './gate-preview';
import { isEndingTrigger, resolveForwardTrigger } from './forward-trigger';
import { MONEY_GUARD_MILESTONE, moneyGuardOf } from './guards';
import { confirmPaymentClaimCore, type ConfirmPaymentClaimInput } from './payment-claims';
import type { DesignState } from './states';
import type { Trigger } from './transitions';
import { canRunTrigger } from './ui';

/**
 * `ok` once the PAYMENT is recorded (payment id in `data`; `already` = the claim
 * had been confirmed before). Whether the delivery also moved is `advanced`;
 * when the claim paid the gate but the move could not happen, `waitingOn` is the
 * machine's reason (another guard still unmet, or the state moved meanwhile) so
 * the card can say "payment recorded" plus what is still waiting, not an error.
 * `paymentRecorded` lets the wrapper revalidate whenever the ledger changed.
 */
export type ConfirmClaimAndAdvanceResult = ActionResult & {
  data?: string;
  already?: boolean;
  paymentRecorded: boolean;
  advanced: boolean;
  waitingOn?: ActionCode;
};

interface ClaimGate {
  engagementId: string;
  milestoneKind: string;
  state: DesignState;
}

/** The claim and its engagement's state, RLS-scoped (a foreign claim reads as absent). */
function loadClaimGate(ctx: OrgContext, claimId: string): Promise<ClaimGate | undefined> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        engagementId: clientPaymentClaims.engagementId,
        milestoneKind: clientPaymentClaims.milestoneKind,
        state: designEngagements.state,
      })
      .from(clientPaymentClaims)
      .innerJoin(designEngagements, eq(designEngagements.id, clientPaymentClaims.engagementId))
      .where(eq(clientPaymentClaims.id, claimId))
      .limit(1);
    return row;
  });
}

/** The forward trigger this claim's payment opens NOW, or null when it opens none. */
function triggerPaidBy(ctx: OrgContext, gate: ClaimGate): Trigger | null {
  const trigger = resolveForwardTrigger(gate.state);
  if (trigger === null || isEndingTrigger(trigger)) return null;
  const moneyGuard = moneyGuardOf(trigger);
  if (moneyGuard === null || MONEY_GUARD_MILESTONE[moneyGuard] !== gate.milestoneKind) {
    return null;
  }
  return canRunTrigger(ctx.role, trigger) ? trigger : null;
}

/**
 * The one IMPLICIT advance never moves past a review the client has not
 * answered: the studio confirms the money, and the delivery keeps waiting for
 * the client (or for an approval the studio records as taken offline). Null
 * when nothing holds it. While a guard is still unmet too, that guard is the
 * truer reason (a short payment says so), and the advance is not attempted.
 */
async function clientReviewHold(ctx: OrgContext, engagementId: string): Promise<ActionCode | null> {
  const preview = await getEngagementGatePreview(ctx, engagementId);
  if (!preview.awaitingClientReview) return null;
  return preview.items.find((item) => !item.ok)?.code ?? 'client_review_pending';
}

/**
 * Confirm a pending client payment claim, then advance if it pays the forward
 * gate of the state the delivery is in AFTER the confirm. The gate is read
 * fresh once the payment has committed, so a retry (`already`) or a concurrent
 * confirm never fires a stale trigger: it converges on whatever the forward
 * move now is, like `logPaymentAndAdvance`. Never an ending, never past a review
 * the client has not answered (`waitingOn: 'client_review_pending'`). Never
 * throws.
 */
export async function confirmPaymentClaimAndAdvanceCore(
  ctx: OrgContext,
  input: ConfirmPaymentClaimInput,
): Promise<ConfirmClaimAndAdvanceResult> {
  // Refused before any read, as attachDeliverableCore does.
  if (!can(ctx.role, 'engagements_finance', 'create')) {
    return { ok: false, error: 'forbidden', paymentRecorded: false, advanced: false };
  }
  if (typeof input.claimId !== 'string' || !isUuid(input.claimId)) {
    return { ok: false, error: 'invalid', paymentRecorded: false, advanced: false };
  }

  const confirmed = await confirmPaymentClaimCore(ctx, input);
  if (!confirmed.ok) return { ...confirmed, paymentRecorded: false, advanced: false };
  const recorded = {
    ok: true,
    data: confirmed.data,
    already: confirmed.already === true,
    paymentRecorded: true,
  } as const;

  // The claim's gate first: the review read below is a transaction of its own,
  // spent only when this payment could move the delivery at all.
  let gate: ClaimGate | undefined;
  try {
    gate = await loadClaimGate(ctx, input.claimId);
  } catch (error) {
    console.error('confirmPaymentClaimAndAdvance read failed:', loggableFailure(error));
    return { ...recorded, advanced: false, waitingOn: 'generic' };
  }
  const advanceTrigger = gate ? triggerPaidBy(ctx, gate) : null;
  if (!gate || advanceTrigger === null) return { ...recorded, advanced: false };

  let reviewHold: ActionCode | null;
  try {
    reviewHold = await clientReviewHold(ctx, gate.engagementId);
  } catch (error) {
    console.error('confirmPaymentClaimAndAdvance review read failed:', loggableFailure(error));
    return { ...recorded, advanced: false, waitingOn: 'generic' };
  }
  if (reviewHold !== null) return { ...recorded, advanced: false, waitingOn: reviewHold };

  const advance = await executeTransition(ctx, {
    engagementId: gate.engagementId,
    trigger: advanceTrigger,
  });
  if (advance.ok) return { ...recorded, advanced: true };
  return { ...recorded, advanced: false, waitingOn: advance.error ?? 'generic' };
}
