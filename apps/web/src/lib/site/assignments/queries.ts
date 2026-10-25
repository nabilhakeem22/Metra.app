import 'server-only';
import { memberships, projectAssignments, type MemberRole } from '@metra/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { mayJoinSiteTeam } from '@/lib/site/access';

/** A studio member who may be on a project's site team, and whether he is. */
export interface SiteTeamMembership {
  userId: string;
  role: MemberRole;
  /** When his live assignment on the project began; null when he is not on it. */
  assignedAt: Date | null;
}

/**
 * Every member of the studio who may join a site team, with his live
 * assignment on `projectId` if he has one, oldest member first. One statement:
 * the members left-joined to the project's live assignments (at most one per
 * member, by the partial unique index).
 */
export async function listProjectSiteTeam(ctx: OrgContext, projectId: string): Promise<SiteTeamMembership[]> {
  const rows = await withOrgContext(ctx, (tx) =>
    tx
      .select({ userId: memberships.userId, role: memberships.role, assignedAt: projectAssignments.createdAt })
      .from(memberships)
      .leftJoin(
        projectAssignments,
        and(
          eq(projectAssignments.userId, memberships.userId),
          eq(projectAssignments.projectId, projectId),
          isNull(projectAssignments.revokedAt),
        ),
      )
      .orderBy(asc(memberships.createdAt), asc(memberships.userId)),
  );
  return rows.filter((row) => mayJoinSiteTeam(row.role));
}
