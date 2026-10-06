// Design-Engagement Machine — the Hero "next action" gate preview (Epic D,
// Slice 3). SERVER-ONLY read-model: it loads the SAME facts the executor loads
// (`loadGuardFacts`, not a copy of its SELECTs) and hands them to the pure
// `evaluateGatePreview`, which the batch whose-move loader shares. It NEVER
// mutates and NEVER re-implements guard logic or money math.
import 'server-only';
import { designEngagements } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { loadGuardFacts } from './executor/facts';
import {
  EMPTY_GATE_PREVIEW,
  evaluateGatePreview,
  type EngagementGatePreview,
} from './gate-preview-evaluate';
import { isTerminal } from './states';

export type {
  ClientDecisionSummary,
  EngagementGatePreview,
  GateChecklistItem,
} from './gate-preview-evaluate';

/**
 * Build the gate preview for one engagement. RLS-scoped: a foreign/absent id
 * yields an empty, all-clear preview. The CALLER gates the read on the
 * `engagements_design` read capability; RLS is the second factor.
 */
export function getEngagementGatePreview(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementGatePreview> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select()
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);
    if (!engagement || isTerminal(engagement.state)) return { ...EMPTY_GATE_PREVIEW };
    return evaluateGatePreview(await loadGuardFacts(tx, engagement));
  });
}
