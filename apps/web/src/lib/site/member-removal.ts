// What removing a member from a studio closes on the site side (plan C3,
// removeMemberCore's boy-scout cascade): his live site assignments and his
// signed-in phones in THIS studio, in the removal's own transaction. The
// removal already cuts him out of every request; this keeps the records honest
// (no live assignment or device for someone who is no longer there) and
// makes a later re-invite start with no site and no phone.
//
// Each closed row is stamped revoked by the remover (the DB guard insists on
// the current user) and audited as a revoke, like the one-by-one acts.
import { projectAssignments, siteDevices, type MetraDb } from '@metra/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AuditEntry } from '@/lib/audit';
import { ASSIGNMENT_AUDIT_ENTITY } from './assignments/audit-entity';

/** The audit entity of a site device row. */
const DEVICE_AUDIT_ENTITY = 'site_device';

/** Revoke `memberId`'s live assignments and devices in the current org, by `removedBy`. */
export async function closeSiteAccessOfRemovedMember(
  tx: MetraDb,
  audit: (entry: AuditEntry) => Promise<void>,
  { memberId, removedBy }: { memberId: string; removedBy: string },
): Promise<void> {
  const revoke = { revokedAt: sql`now()`, revokedBy: removedBy, updatedAt: sql`now()` };
  const assignments = await tx
    .update(projectAssignments)
    .set(revoke)
    .where(and(eq(projectAssignments.userId, memberId), isNull(projectAssignments.revokedAt)))
    .returning({ id: projectAssignments.id, projectId: projectAssignments.projectId });
  const devices = await tx
    .update(siteDevices)
    .set(revoke)
    .where(and(eq(siteDevices.userId, memberId), isNull(siteDevices.revokedAt)))
    .returning({ id: siteDevices.id });

  for (const assignment of assignments) {
    await audit({
      entity: ASSIGNMENT_AUDIT_ENTITY,
      entityId: assignment.id,
      action: 'update',
      before: { revoked: false },
      after: { revoked: true, project_id: assignment.projectId, user_id: memberId, via: 'member_removed' },
    });
  }
  for (const device of devices) {
    await audit({
      entity: DEVICE_AUDIT_ENTITY,
      entityId: device.id,
      action: 'update',
      before: { revoked: false },
      after: { revoked: true, user_id: memberId, via: 'member_removed' },
    });
  }
}
