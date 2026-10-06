import 'server-only';
import { clientPaymentClaims, type MetraDb } from '@metra/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { can } from '@/lib/permissions/can';
import type { MemberRole } from '@/lib/permissions/roles';
import { evaluateGatePreview } from '../gate-preview-evaluate';
import { loadGuardFactsBatch } from '../guard-facts-batch';
import { isTerminal, type DesignState } from '../states';
import { resolveWhoseMove, type WhoseMove } from '../whose-move';

/** One delivery the list or dashboard needs a whose-move for. */
export interface WhoseMoveSubject {
  id: string;
  state: DesignState;
}

/**
 * Pending client payment claims per engagement, in ONE grouped read. A role
 * without `engagements_finance` read sees none, exactly as the cockpit's own
 * claim read (`getEngagementPaymentClaims`) does, so the list and the cockpit
 * agree for the same role.
 */
async function pendingClaimCounts(
  tx: MetraDb,
  role: MemberRole,
  engagementIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (engagementIds.length === 0 || !can(role, 'engagements_finance', 'read')) return counts;
  const rows = await tx
    .select({ engagementId: clientPaymentClaims.engagementId, pending: count() })
    .from(clientPaymentClaims)
    .where(
      and(
        inArray(clientPaymentClaims.engagementId, engagementIds),
        eq(clientPaymentClaims.status, 'pending'),
      ),
    )
    .groupBy(clientPaymentClaims.engagementId);
  for (const row of rows) counts.set(row.engagementId, Number(row.pending));
  return counts;
}

/**
 * Whose move it is for each subject, inside the caller's RLS transaction, with
 * a constant number of reads (≤ 7) however many subjects there are. A terminal
 * subject is `closed` without any read; the rest go through the batch facts,
 * the pure gate evaluation and the one whose-move rule the cockpit uses.
 */
export async function loadWhoseMovesInTx(
  tx: MetraDb,
  role: MemberRole,
  subjects: readonly WhoseMoveSubject[],
): Promise<Map<string, WhoseMove>> {
  const moves = new Map<string, WhoseMove>();
  const live: string[] = [];
  for (const subject of subjects) {
    if (isTerminal(subject.state)) moves.set(subject.id, 'closed');
    else live.push(subject.id);
  }

  const facts = await loadGuardFactsBatch(tx, live);
  const claims = await pendingClaimCounts(tx, role, live);
  for (const [engagementId, engagementFacts] of facts) {
    moves.set(
      engagementId,
      resolveWhoseMove({
        state: engagementFacts.engagement.state,
        preview: evaluateGatePreview(engagementFacts),
        pendingClaimCount: claims.get(engagementId) ?? 0,
      }),
    );
  }
  return moves;
}
