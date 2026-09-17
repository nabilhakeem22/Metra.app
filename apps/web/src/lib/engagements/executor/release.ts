// Design-Engagement Machine — the CLIENT RELEASE (Client Deliverables, Step 1;
// wave 4, extracted from `executor.ts` verbatim). Deliberately separate from the
// side-effect table: an edge may carry both, and this one always runs last of
// the two.
import { type EngagementArtifact, engagementArtifacts } from '@metra/db';
import { and, eq, inArray } from 'drizzle-orm';
import { CLIENT_RELEASES, selectReleaseArtifactIds } from '../client-release';
import type { TransitionRun } from './index';

/**
 * Client Deliverables (Step 1): auto-share. A release-carrying edge publishes
 * its deliverable package to the tokenized client portal INSIDE this tx, after
 * the atomic gate — so a guard failure (which returns above, before the gate)
 * flips nothing, and a losing concurrent caller shares nothing either. The
 * selector is PURE and reads the `artifacts` already loaded as guard facts, so
 * this costs zero extra reads. Visibility is only ever ADDED; the studio's
 * per-file manual override is the only way to take it back.
 */
export async function persistClientRelease(
  run: TransitionRun,
  artifacts: EngagementArtifact[],
): Promise<void> {
  if (run.def.clientRelease) {
    const releaseIds = selectReleaseArtifactIds(
      CLIENT_RELEASES[run.def.clientRelease],
      artifacts,
    );
    if (releaseIds.length > 0) {
      await run.tx
        .update(engagementArtifacts)
        .set({ clientVisible: true, updatedAt: new Date() })
        .where(
          and(
            eq(engagementArtifacts.orgId, run.ctx.orgId),
            eq(engagementArtifacts.engagementId, run.input.engagementId),
            inArray(engagementArtifacts.id, releaseIds),
          ),
        );
    }
  }
}
