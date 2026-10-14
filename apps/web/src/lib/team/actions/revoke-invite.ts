'use server';

import { invitations } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { canManageOrg } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';

/** Revoke an invite: its link stops working. One already gone is `record_not_found`. */
export async function revokeInvite(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  if (!canManageOrg(ctx.role)) return err('forbidden');
  if (!isUuid(id)) return err('malformed');

  return mutateInOrg(ctx, {}, async (tx, audit) => {
    const [invitation] = await tx
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1);
    if (!invitation) fail('record_not_found');
    await tx.update(invitations).set({ status: 'revoked', updatedAt: new Date() }).where(eq(invitations.id, id));
    await audit({
      entity: 'invitation',
      entityId: id,
      action: 'update',
      before: { status: invitation.status },
      after: { status: 'revoked' },
    });
  });
}
