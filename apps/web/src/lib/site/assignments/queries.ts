import 'server-only';
import { MEMBER_ROLES, memberships, projectAssignments, projects, type MemberRole } from '@metra/db';
import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { mayJoinSiteTeam } from '@/lib/site/access';

/** The roles that may be on a site team, as the queries filter them. */
const SITE_TEAM_ROLES: MemberRole[] = MEMBER_ROLES.filter(mayJoinSiteTeam);

/** A member on a project's site team. */
interface SiteTeamAssignment {
  userId: string;
  role: MemberRole;
  /** When his live assignment on the project began. */
  assignedAt: Date;
}

/** The first members of a site team, and how many it has in all. */
interface SiteTeamListing {
  members: SiteTeamAssignment[];
  total: number;
}

/** A studio member who may be put on a project's site team and is not on it. */
interface SiteTeamCandidate {
  userId: string;
  role: MemberRole;
}

/**
 * The members with a live assignment on `projectId`, longest on the team
 * first, at most `limit` of them, and the size of the whole team. One
 * statement: the live assignments joined to the members (a role that may not
 * be on a site team is left out, as the role change closes it).
 */
export async function listProjectSiteTeam(ctx: OrgContext, projectId: string, limit: number): Promise<SiteTeamListing> {
  const rows = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        userId: projectAssignments.userId,
        role: memberships.role,
        assignedAt: projectAssignments.createdAt,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(projectAssignments)
      .innerJoin(
        memberships,
        and(eq(memberships.orgId, projectAssignments.orgId), eq(memberships.userId, projectAssignments.userId)),
      )
      .where(
        and(
          eq(projectAssignments.projectId, projectId),
          isNull(projectAssignments.revokedAt),
          inArray(memberships.role, SITE_TEAM_ROLES),
        ),
      )
      .orderBy(asc(projectAssignments.createdAt), asc(projectAssignments.userId))
      .limit(limit),
  );
  return {
    members: rows.map((row) => ({ userId: row.userId, role: row.role, assignedAt: row.assignedAt })),
    total: rows[0]?.total ?? 0,
  };
}

/**
 * The studio's members who may join `projectId`'s site team and are not on
 * it, oldest member first: `limit` of them from `offset`, and whether more
 * follow. Null when the project is not this studio's.
 */
export async function listSiteTeamCandidatePage(
  ctx: OrgContext,
  projectId: string,
  { offset, limit }: { offset: number; limit: number },
): Promise<{ candidates: SiteTeamCandidate[]; hasMore: boolean } | null> {
  return withOrgContext(ctx, async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return null;
    const onTheTeam = tx
      .select({ one: sql`1` })
      .from(projectAssignments)
      .where(
        and(
          eq(projectAssignments.userId, memberships.userId),
          eq(projectAssignments.projectId, projectId),
          isNull(projectAssignments.revokedAt),
        ),
      );
    const rows = await tx
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(and(inArray(memberships.role, SITE_TEAM_ROLES), notExists(onTheTeam)))
      .orderBy(asc(memberships.createdAt), asc(memberships.userId))
      .limit(limit + 1)
      .offset(offset);
    return { candidates: rows.slice(0, limit), hasMore: rows.length > limit };
  });
}
