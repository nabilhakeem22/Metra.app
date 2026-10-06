import 'server-only';
// Design-Engagement Machine — the money facts a payment WRITE must decide on,
// read inside the writer's own transaction. Both money writers (the manual
// `recordPaymentCore` and the claim confirm) take the SAME engagement row lock
// first, so a hand-logged payment and a client claim for the same milestone can
// never both land: whichever commits second sees the first.
import {
  MILESTONE_KINDS,
  clientPaymentClaims,
  designEngagements,
  engagementMilestones,
  paymentEvents,
  type DesignEngagementState,
  type MetraDb,
  type MilestoneKind,
} from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { milestoneRequired4 } from './guards';

const MILESTONE_KIND_SET = new Set<string>(MILESTONE_KINDS);

export function isMilestoneKind(kind: string): kind is MilestoneKind {
  return MILESTONE_KIND_SET.has(kind);
}

/**
 * Lock the engagement row (FOR UPDATE) and return what a money write needs.
 * RLS scopes the read: a foreign or absent id is `engagement_not_found`.
 */
export async function lockEngagementForMoney(
  tx: MetraDb,
  engagementId: string,
): Promise<{ state: DesignEngagementState; designFee: string | null }> {
  const [engagement] = await tx
    .select({ state: designEngagements.state, designFee: designEngagements.designFee })
    .from(designEngagements)
    .where(eq(designEngagements.id, engagementId))
    .for('update');
  if (!engagement) fail('engagement_not_found');
  return engagement;
}

/**
 * What is still owed on one milestone (scale-4 BigInt, may be ≤ 0 when it is
 * fully or over-paid), by the same math the money guards admit. An ABSENT
 * milestone owes nothing (0n); a milestone whose amount cannot be computed (no
 * design fee) is null.
 */
export async function milestoneOutstanding4(
  tx: MetraDb,
  engagementId: string,
  designFee: string | null,
  kind: MilestoneKind,
): Promise<bigint | null> {
  const [milestone] = await tx
    .select({ basis: engagementMilestones.basis, value: engagementMilestones.value })
    .from(engagementMilestones)
    .where(and(eq(engagementMilestones.engagementId, engagementId), eq(engagementMilestones.kind, kind)))
    .limit(1);
  if (!milestone) return 0n;
  const required = milestoneRequired4(milestone.basis, milestone.value, designFee);
  if (required === null) return null;
  const paid = await tx
    .select({ amount: paymentEvents.amount })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.engagementId, engagementId), eq(paymentEvents.kind, kind)));
  return paid.reduce((owed, payment) => owed - parseMoney4(payment.amount), required);
}

/** Does a client claim for this milestone still wait for the studio? */
export async function hasPendingClaim(
  tx: MetraDb,
  engagementId: string,
  kind: MilestoneKind,
): Promise<boolean> {
  const [claim] = await tx
    .select({ id: clientPaymentClaims.id })
    .from(clientPaymentClaims)
    .where(
      and(
        eq(clientPaymentClaims.engagementId, engagementId),
        eq(clientPaymentClaims.milestoneKind, kind),
        eq(clientPaymentClaims.status, 'pending'),
      ),
    )
    .limit(1);
  return claim !== undefined;
}
