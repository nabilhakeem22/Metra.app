import 'server-only';
// The claim-row phases of confirming a client payment claim, each inside the
// confirm's own transaction: lock the claim, check it can still be paid, flip it
// to confirmed. The ledger write between them is payment-claim-ledger.ts.
import {
  clientPaymentClaims,
  type ClientPaymentClaimStatus,
  type MetraDb,
  type MilestoneKind,
} from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import type { OrgContext } from '@/lib/db/context';
// LEAF module (states.ts is itself the leaf — not a barrel): the terminal-state
// predicate, so a claim made while active can't record money after the engagement
// went terminal — mirroring recordPaymentCore.
import { isTerminal } from '@/lib/engagements/states';
import { lockEngagementForMoney, milestoneOutstanding4 } from './milestone-settlement';

export interface LockedClaim {
  id: string;
  engagementId: string;
  milestoneKind: MilestoneKind;
  status: ClientPaymentClaimStatus;
  confirmedPaymentEventId: string | null;
}

/** The claim row, LOCKED for this confirm; undefined when it is absent or foreign. */
export async function lockClaimForConfirm(tx: MetraDb, claimId: string): Promise<LockedClaim | undefined> {
  // Row-lock the claim BEFORE writing money: a concurrent confirm/dismiss must
  // wait here and then re-read the committed status, so the two cannot interleave
  // (no read-then-write race that could leave a real payment against a dismissed
  // claim). RLS still scopes this to the caller's org (foreign -> no row).
  const [claim] = await tx
    .select({
      id: clientPaymentClaims.id,
      engagementId: clientPaymentClaims.engagementId,
      milestoneKind: clientPaymentClaims.milestoneKind,
      status: clientPaymentClaims.status,
      confirmedPaymentEventId: clientPaymentClaims.confirmedPaymentEventId,
    })
    .from(clientPaymentClaims)
    .where(eq(clientPaymentClaims.id, claimId))
    .for('update')
    .limit(1);
  return claim;
}

/** Refuses unless the claim's engagement is live and its milestone still has money outstanding. */
export async function assertClaimStillPayable(
  tx: MetraDb,
  claim: Pick<LockedClaim, 'engagementId' | 'milestoneKind'>,
): Promise<void> {
  // Terminal guard (mirrors recordPaymentCore): never record money once the
  // engagement finished, even if the claim was made while it was active. The
  // engagement row is LOCKED, as recordPaymentCore locks it, so a hand-logged
  // payment for the same milestone and this confirm serialise.
  const engagement = await lockEngagementForMoney(tx, claim.engagementId);
  if (isTerminal(engagement.state)) fail('engagement_not_active');

  // Already paid in full (the studio logged it by hand, or another path did):
  // confirming would write a SECOND ledger row for money received once. The
  // studio dismisses the claim instead.
  const outstanding = await milestoneOutstanding4(
    tx,
    claim.engagementId,
    engagement.designFee,
    claim.milestoneKind,
  );
  if (outstanding !== null && outstanding <= 0n) fail('claim_already_settled');
}

/** Flips the locked claim to confirmed against its payment, or refuses when no row matched. */
export async function markClaimConfirmed(
  tx: MetraDb,
  ctx: OrgContext,
  claim: Pick<LockedClaim, 'id'>,
  paymentId: string,
): Promise<void> {
  // Flip the claim -> confirmed, guarded on status='pending' and `.returning()`:
  // under the row lock this always matches, but if it ever matches 0 rows the
  // row changed under us — THROW so the WHOLE tx (incl. the payment insert above)
  // rolls back, rather than committing a payment with the claim left unresolved.
  const flipped = await tx
    .update(clientPaymentClaims)
    .set({
      status: 'confirmed',
      confirmedPaymentEventId: paymentId,
      resolvedBy: ctx.userId,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientPaymentClaims.id, claim.id),
        eq(clientPaymentClaims.status, 'pending'),
      ),
    )
    .returning({ id: clientPaymentClaims.id });
  if (flipped.length === 0) fail('claim_not_found');
}
