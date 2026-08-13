import 'server-only';
import { invitations, type MemberRole } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
  createdAt: Date;
}

/** The org's pending (not-yet-accepted) invitations. */
export function listPendingInvitations(
  ctx: OrgContext,
): Promise<PendingInvitation[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(eq(invitations.status, 'pending')),
  );
}
