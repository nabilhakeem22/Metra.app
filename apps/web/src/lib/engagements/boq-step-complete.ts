import 'server-only';
// Sending the BOQ completes the delivery's BOQ step (Round C, owner decision Q1,
// Oct 9): Send as BOQ and the sheet's Issue both record the `boq` artifact that
// `boqPresent` reads, so the move the studio would make next is already decided.
// No new authority: the step completes only when the SENDER may fire
// `finalizeBOQ` (a finance edge: owner, admin, accountant). A project manager's
// send records the BOQ and the card keeps the step for those roles to complete.
import { designEngagements } from '@metra/db';
import { eq } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { executeConsequence } from './executor/consequence';
import { canRunTrigger } from './ui';

export type BoqStepCompletion = 'completed' | 'not_at_boq' | 'not_permitted' | 'failed';

async function engagementState(ctx: OrgContext, engagementId: string): Promise<string | null> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ state: designEngagements.state })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1),
  );
  return row?.state ?? null;
}

/**
 * Move the delivery past its BOQ step after a BOQ went out, when that is the
 * caller's move to make. Never throws: the BOQ is already sent, so a failure
 * here is logged once and answered `failed` (the card still offers Advance, and
 * a retried send repairs it).
 */
export async function completeBoqStep(ctx: OrgContext, engagementId: string): Promise<BoqStepCompletion> {
  try {
    if ((await engagementState(ctx, engagementId)) !== 'boq') return 'not_at_boq';
    if (!canRunTrigger(ctx.role, 'finalizeBOQ')) return 'not_permitted';
    const moved = await executeConsequence(ctx, { engagementId, consequence: 'boqSent' });
    if (moved.ok) return 'completed';
    if (moved.error === 'illegal_trigger' || moved.error === 'engagement_state_conflict') return 'not_at_boq';
    console.error('BOQ step completion failed:', { code: moved.error ?? 'generic' });
    return 'failed';
  } catch (e) {
    console.error('BOQ step completion failed:', loggableFailure(e));
    return 'failed';
  }
}
