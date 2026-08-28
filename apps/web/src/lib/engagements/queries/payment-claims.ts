import 'server-only';
import { clientPaymentClaims, type MilestoneKind } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';

/**
 * One PENDING client payment claim the studio sees in the cockpit — a session-less
 * client's "mark as paid" awaiting confirmation. `claimedAmount` is the server-locked
 * remaining due (scale-4 string); `actorName` is the free-text name the client
 * optionally entered. No cost/margin — a claim carries only the client-facing amount.
 */
export interface EngagementPaymentClaimRecord {
  id: string;
  milestoneKind: MilestoneKind;
  claimedAmount: string;
  note: string | null;
  actorName: string | null;
  createdAt: Date;
}

/**
 * The PENDING client payment claims recorded against an engagement, NEWEST FIRST —
 * the cockpit's "payment claims" panel. Gated on the §2.2 `engagements_finance` read
 * cell (a role without it reads an empty list, mirroring the page guard). RLS scopes
 * the read to the caller's org, so a foreign engagement (or a foreign org's claim)
 * reads as an empty list. Only `pending` claims surface — resolved (confirmed /
 * dismissed) claims are no longer actionable.
 */
export function getEngagementPaymentClaims(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementPaymentClaimRecord[]> {
  if (!can(ctx.role, 'engagements_finance', 'read')) return Promise.resolve([]);
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: clientPaymentClaims.id,
        milestoneKind: clientPaymentClaims.milestoneKind,
        claimedAmount: clientPaymentClaims.claimedAmount,
        note: clientPaymentClaims.note,
        actorName: clientPaymentClaims.actorName,
        createdAt: clientPaymentClaims.createdAt,
      })
      .from(clientPaymentClaims)
      .where(
        and(
          eq(clientPaymentClaims.engagementId, engagementId),
          eq(clientPaymentClaims.status, 'pending'),
        ),
      )
      .orderBy(desc(clientPaymentClaims.createdAt)),
  );
}
