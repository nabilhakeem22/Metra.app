import 'server-only';
// The client's handover confirmation closes the design-only delivery (Round C,
// decision 3). The ending itself was chosen earlier and explicitly
// (`chooseDesignOnly`, owner/admin/PM behind a confirmation); the confirmation
// only completes it: `recipientAcknowledges` (design_only_handoff ->
// closed_design_only), whose guard still requires a LIVE acknowledgement. Fired
// as a consequence by the system actor (resolveSystemContext), so the ledger row
// names no one and the audit says why.
import { designEngagements } from '@metra/db';
import { eq } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import { resolveSystemContext } from '@/lib/automation/system-context';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { executeConsequence } from './executor/consequence';
import { recordHandoffAcknowledgementCore, type RecordHandoffAcknowledgementInput } from './handoff';

export type HandoverCloseOutcome = 'closed' | 'not_closable' | 'failed';

/**
 * Refusals that mean "nothing to close here", not a fault: already moved on, no
 * live acknowledgement, gone, or a workspace whose design flow is off (a plan
 * change), which no retry will fix.
 */
const NOT_CLOSABLE: ReadonlySet<ActionCode> = new Set<ActionCode>([
  'illegal_trigger',
  'engagement_state_conflict',
  'handoff_not_acknowledged',
  'engagement_not_found',
  'flow_not_enabled',
  'forbidden',
]);

/**
 * Close a delivery whose client confirmed the handover. `systemCtx` is the org's
 * system actor (callers resolve it; none -> they answer `failed`); `recordedBy`
 * is who confirmed it (the member who recorded it, or 'client'), for the audit.
 * Never throws: a fault is one log line and `failed`, and the hourly closer
 * tries again.
 */
export async function closeAcknowledgedHandover(
  systemCtx: OrgContext,
  engagementId: string,
  recordedBy: string,
): Promise<HandoverCloseOutcome> {
  try {
    const closed = await executeConsequence(systemCtx, {
      engagementId,
      consequence: 'handoverAcknowledged',
      recordedBy,
    });
    if (closed.ok) return 'closed';
    if (closed.error && NOT_CLOSABLE.has(closed.error)) return 'not_closable';
    console.error('handover close failed:', { code: closed.error ?? 'generic' });
    return 'failed';
  } catch (e) {
    console.error('handover close failed:', loggableFailure(e));
    return 'failed';
  }
}

/**
 * The staff path: record the client's confirmation for them (any role the
 * acknowledgement core allows; a second recording of the same confirmation adds
 * no row), then close the delivery as the system actor, naming the recorder in
 * the audit. `closed` is the delivery's state afterwards, so two members
 * recording at once are both told the truth. The confirmation stands either way,
 * and the hourly closer (lib/automation/handover-closer.ts) repairs a close that
 * failed.
 */
export async function recordHandoffAndCloseCore(
  ctx: OrgContext,
  input: RecordHandoffAcknowledgementInput,
): Promise<ActionResult & { data?: string; closed?: boolean }> {
  const recorded = await recordHandoffAcknowledgementCore(ctx, input);
  // A colleague's recording closed it first (this caller waited on the row lock):
  // the confirmation is on file and the delivery closed, which is the truth.
  if (!recorded.ok && recorded.error === 'engagement_not_active' && (await isClosed(ctx, input.engagementId))) {
    return { ok: true, already: true, closed: true };
  }
  if (!recorded.ok) return recorded;
  const outcome = await closeAsSystemActor(ctx.orgId, input.engagementId, ctx.userId);
  const closed = outcome === 'closed' || (await isClosed(ctx, input.engagementId));
  return { ...recorded, closed };
}

/** Close as the org's system actor; an org with no owner or admin cannot. Never throws. */
async function closeAsSystemActor(orgId: string, engagementId: string, recordedBy: string): Promise<HandoverCloseOutcome> {
  try {
    const systemCtx = await resolveSystemContext(orgId);
    if (systemCtx) return await closeAcknowledgedHandover(systemCtx, engagementId, recordedBy);
    console.error('handover close failed:', { code: 'no_system_actor' });
    return 'failed';
  } catch (e) {
    console.error('handover close failed:', loggableFailure(e));
    return 'failed';
  }
}

/** Whether the delivery now sits closed (another member's close may have won). Never throws. */
async function isClosed(ctx: OrgContext, engagementId: string): Promise<boolean> {
  try {
    const [row] = await withOrgContext(ctx, (tx) =>
      tx
        .select({ state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, engagementId))
        .limit(1),
    );
    return row?.state === 'closed_design_only';
  } catch (e) {
    console.error('handover close state read failed:', loggableFailure(e));
    return false;
  }
}
