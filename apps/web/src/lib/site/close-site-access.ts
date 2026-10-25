// What a studio closes on the site side when a member stops being someone who
// may be on a site team (plan C3 and the S3 rulings): removed from the studio,
// or moved to a role that fails mayJoinSiteTeam (today: client). His live site
// assignments and his signed-in phones in THIS studio are revoked, in the
// caller's own transaction. Requests already refuse him; this keeps the
// records honest (no live assignment or device for someone who may not be
// there), and a later re-invite or role restore starts with no site and no
// phone: being put back on a site is a new assignment.
//
// Each closed row is stamped revoked by the acting member (the DB guard
// insists on the current user) and audited as a revoke, like the one-by-one
// acts, with `via` saying why.
import { projectAssignments, siteDevices, type MetraDb } from '@metra/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AuditEntry } from '@/lib/audit';
import { ASSIGNMENT_AUDIT_ENTITY } from './assignments/audit-entity';

/** The audit entity of a site device row. */
const DEVICE_AUDIT_ENTITY = 'site_device';

/** Why the site access was closed, as the audit rows say it. */
type SiteAccessClosure = 'member_removed' | 'role_changed';

/** Revoke `memberId`'s live assignments and devices in the current org, by `closedBy`. */
export async function closeSiteAccessOf(
  tx: MetraDb,
  audit: (entry: AuditEntry) => Promise<void>,
  { memberId, closedBy, via }: { memberId: string; closedBy: string; via: SiteAccessClosure },
): Promise<void> {
  const revoke = { revokedAt: sql`now()`, revokedBy: closedBy, updatedAt: sql`now()` };
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
      after: { revoked: true, project_id: assignment.projectId, user_id: memberId, via },
    });
  }
  for (const device of devices) {
    await audit({
      entity: DEVICE_AUDIT_ENTITY,
      entityId: device.id,
      action: 'update',
      before: { revoked: false },
      after: { revoked: true, user_id: memberId, via },
    });
  }
}
