// "Client approved offline" as one API-ready core: the role fence, then the
// normal forward transition with the approval as its payload. Every guard and
// code is Advance's; the side-effect writes the provenance (offline-approval-input.ts).
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { executeTransition } from './executor';
import { mayRecordOfflineApproval } from './offline-approval';

/** The two review edges an offline approval may fire. */
export type OfflineApprovalTrigger = 'selectConcept' | 'approveDesign';

/** What the "Client approved offline" form sends. Parsed by the executor's side-effect. */
export interface OfflineApprovalInput {
  channel: string;
  occurredOn?: string | null;
  note?: string | null;
  chosenArtifactId?: string | null;
}

/**
 * Record an approval the client gave the studio directly, at `concept_review`
 * (`selectConcept`) or `final_approval` (`approveDesign`). Refused `forbidden`
 * before any read unless the role is an offline-approval decider (owner, admin,
 * project manager). A replay finds the state moved and is refused by the
 * executor's gate, so it never advances twice. Never throws.
 */
export function recordOfflineApprovalCore(
  ctx: OrgContext,
  input: { engagementId: string; trigger: OfflineApprovalTrigger; approval: OfflineApprovalInput },
): Promise<ActionResult> {
  if (!mayRecordOfflineApproval(ctx.role)) return Promise.resolve(err('forbidden'));
  return executeTransition(ctx, {
    engagementId: input.engagementId,
    trigger: input.trigger,
    payload: input.approval,
  });
}
