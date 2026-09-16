// Design-Engagement Machine — the guard-fact LOAD (wave 4, extracted from
// `executor.ts` verbatim). Reads only: five SELECTs inside the caller's
// transaction, in the order they were always issued, with no SQL text changed.
import {
  type MetraDb,
  type DesignEngagement,
  type EngagementEvent,
  engagementArtifacts,
  engagementChangeOrders,
  engagementEvents,
  engagementMilestones,
  paymentEvents,
} from '@metra/db';
import { eq } from 'drizzle-orm';
import { liveEvents } from '../event-provenance';
import type { GuardFacts } from '../guards';

/**
 * Every fact the guards read, loaded inside the transaction and AFTER the
 * self-loop lock. Guards are PURE, so the executor pre-loads for them: the
 * engagement row plus (Step 4) the fee-schedule milestones and the append-only
 * payment ledger, (Step 5) the recorded artifacts, and (Step 9) the raised
 * change orders.
 */
export async function loadGuardFacts(
  tx: MetraDb,
  engagement: DesignEngagement,
): Promise<GuardFacts> {
  const engagementId = engagement.id;
  const milestones = await tx
    .select()
    .from(engagementMilestones)
    .where(eq(engagementMilestones.engagementId, engagementId));
  const payments = await tx
    .select()
    .from(paymentEvents)
    .where(eq(paymentEvents.engagementId, engagementId));
  const artifacts = await tx
    .select()
    .from(engagementArtifacts)
    .where(eq(engagementArtifacts.engagementId, engagementId));
  const changeOrders = await tx
    .select()
    .from(engagementChangeOrders)
    .where(eq(engagementChangeOrders.engagementId, engagementId));
  const events = await loadLiveEvents(tx, engagementId);
  return { engagement, milestones, payments, artifacts, changeOrders, events };
}

/**
 * LIVE events only. A correction cannot delete the row it retracts -- the
 * ledger is INSERT-only by grant -- so the retracted row is still here, and a
 * guard counting it would let a mistake the studio has formally withdrawn go on
 * unlocking the gate it opened.
 */
async function loadLiveEvents(
  tx: MetraDb,
  engagementId: string,
): Promise<EngagementEvent[]> {
  return liveEvents(
    await tx
      .select()
      .from(engagementEvents)
      .where(eq(engagementEvents.engagementId, engagementId)),
  );
}
