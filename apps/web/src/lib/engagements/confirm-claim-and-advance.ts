import 'server-only';
// Design-Engagement Machine — "Confirm the client's payment" as ONE action:
// confirm the pending claim (record the real payment), then advance when that
// claim pays the money gate the delivery is waiting on. It mirrors
// `logPaymentAndAdvanceCore`: both steps delegate to the already-reviewed cores
// (`confirmPaymentClaimCore` unchanged, then `executeTransition`), so every gate
// they enforce still applies and this core adds NO new authority.
//
// It can never pick an ENDING: the trigger it may fire is the resolved forward
// trigger, which excludes the endings, and it is re-checked here as well. At
// `execution_decision` a balance claim is therefore recorded and the state stays.
import { clientPaymentClaims, designEngagements } from '@metra/db';
import { eq } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { ActionResult } from '@/lib/actions/result';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { executeTransition } from './executor';
import { isEndingTrigger, resolveForwardTrigger } from './forward-trigger';
import { MONEY_GUARD_MILESTONE, moneyGuardOf } from './guards';
import { confirmPaymentClaimCore, type ConfirmPaymentClaimInput } from './payment-claims';
import type { DesignState } from './states';
import type { Trigger } from './transitions';
import { canRunTrigger } from './ui';

/**
 * The confirm's result (payment id in `data`, `already` = the claim was already
 * confirmed), or the advance's when one ran. `paymentRecorded` says the ledger
 * holds the payment, so the wrapper revalidates even when the advance refused.
 */
export type ConfirmClaimAndAdvanceResult = ActionResult & {
  data?: string;
  already?: boolean;
  paymentRecorded: boolean;
  advanced: boolean;
};

interface ClaimGate {
  engagementId: string;
  milestoneKind: string;
  status: string;
  state: DesignState;
}

/** The claim and its engagement's state, RLS-scoped (a foreign claim reads as absent). */
function loadClaimGate(ctx: OrgContext, claimId: string): Promise<ClaimGate | undefined> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        engagementId: clientPaymentClaims.engagementId,
        milestoneKind: clientPaymentClaims.milestoneKind,
        status: clientPaymentClaims.status,
        state: designEngagements.state,
      })
      .from(clientPaymentClaims)
      .innerJoin(designEngagements, eq(designEngagements.id, clientPaymentClaims.engagementId))
      .where(eq(clientPaymentClaims.id, claimId))
      .limit(1);
    return row;
  });
}

/** The forward trigger this claim's payment opens, or null when it opens none. */
function triggerPaidBy(ctx: OrgContext, gate: ClaimGate): Trigger | null {
  if (gate.status !== 'pending') return null;
  const trigger = resolveForwardTrigger(gate.state);
  if (trigger === null || isEndingTrigger(trigger)) return null;
  const moneyGuard = moneyGuardOf(trigger);
  if (moneyGuard === null || MONEY_GUARD_MILESTONE[moneyGuard] !== gate.milestoneKind) {
    return null;
  }
  return canRunTrigger(ctx.role, trigger) ? trigger : null;
}

/**
 * Confirm a pending client payment claim, then advance if it pays the current
 * forward gate. A failed confirm is returned unchanged (`paymentRecorded:false`).
 * A guard refusal after the payment landed (the studio typed a lower amount) is
 * returned as the guard's code, exactly like `logPaymentAndAdvance`. Never throws.
 */
export async function confirmPaymentClaimAndAdvanceCore(
  ctx: OrgContext,
  input: ConfirmPaymentClaimInput,
): Promise<ConfirmClaimAndAdvanceResult> {
  let gate: ClaimGate | undefined;
  try {
    gate = await loadClaimGate(ctx, input.claimId);
  } catch (error) {
    console.error('confirmPaymentClaimAndAdvance read failed:', loggableFailure(error));
    return { ok: false, error: 'generic', paymentRecorded: false, advanced: false };
  }
  if (!gate) {
    return { ok: false, error: 'claim_not_found', paymentRecorded: false, advanced: false };
  }
  const advanceTrigger = triggerPaidBy(ctx, gate);

  const confirmed = await confirmPaymentClaimCore(ctx, input);
  if (!confirmed.ok) return { ...confirmed, paymentRecorded: false, advanced: false };
  if (advanceTrigger === null) return { ...confirmed, paymentRecorded: true, advanced: false };

  const advance = await executeTransition(ctx, {
    engagementId: gate.engagementId,
    trigger: advanceTrigger,
  });
  return {
    ...advance,
    data: confirmed.data,
    already: confirmed.already === true,
    paymentRecorded: true,
    advanced: advance.ok,
  };
}
