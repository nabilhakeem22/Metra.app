// PURE cores for a project's site team (Stage 3, plan C3): put a studio member
// on a project's site, take him off. No next/*, no session, no cookies: the
// 'use server' wrappers in ./actions resolve the context and delegate here.
// Exercised directly by tests/actions/site-assignments.dbtest.ts.
//
// THE DATABASE SAYS IT AGAIN (rls/policies/70-site.sql), for a writer that
// skips these cores: only an owner, admin or project manager writes
// project_assignments, `assigned_by` and `revoked_by` are the current user, a
// revoke is final, and the identity columns never change. What only the core
// can say is WHO may be assigned: a member of this studio with an internal
// role (the table has no foreign key to auth users).
import { memberships, projectAssignments, projects } from '@metra/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { lockOrgMemberships } from '@/lib/aggregates/membership';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, ok, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { mayJoinSiteTeam } from '@/lib/site/access';
import { isUuid } from '@/lib/uuid';
import { ASSIGNMENT_AUDIT_ENTITY } from './audit-entity';

/** Which member, on which project's site. */
export interface SiteTeamInput {
  projectId: string;
  userId: string;
}

/** A server action's input is whatever the caller sent: an object with two uuids, or malformed. */
function isSiteTeamInput(input: unknown): input is SiteTeamInput {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  return isUuid(fields.projectId) && isUuid(fields.userId);
}

/**
 * Put `userId` on the site team of `projectId`. Assigning a member who is
 * already on it answers `already` and adds nothing (one live row per member and
 * project: the partial unique index is the arbiter, so two racing assigns make
 * one row). A uuid that is not a member of this studio, or a member with the
 * client role, is `not_member`.
 */
export async function assignSiteMemberCore(ctx: OrgContext, input: SiteTeamInput): Promise<ActionResult> {
  if (!isSiteTeamInput(input)) return err('malformed');

  const result = await mutateInOrg(
    ctx,
    { capability: 'site_assignments', action: 'create' },
    async (tx, audit): Promise<'assigned' | 'already'> => {
      // The per-org lock removeMemberCore takes: a member removed meanwhile is
      // either gone before this reads him (not_member) or removed after this
      // commits, and the removal closes the new assignment.
      await lockOrgMemberships(tx, ctx.orgId);
      await requireInOrg(tx, projects, input.projectId, { id: projects.id }, 'project_not_found');
      const [member] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, input.userId))
        .limit(1);
      if (!member || !mayJoinSiteTeam(member.role)) fail('not_member');

      const [created] = await tx
        .insert(projectAssignments)
        .values({ orgId: ctx.orgId, projectId: input.projectId, userId: input.userId, assignedBy: ctx.userId })
        .onConflictDoNothing({
          target: [projectAssignments.orgId, projectAssignments.projectId, projectAssignments.userId],
          where: sql`revoked_at is null`,
        })
        .returning({ id: projectAssignments.id });
      if (!created) return 'already';

      await audit({
        entity: ASSIGNMENT_AUDIT_ENTITY,
        entityId: created.id,
        action: 'create',
        before: null,
        after: { project_id: input.projectId, user_id: input.userId, role: member.role },
      });
      return 'assigned';
    },
  );

  if (!result.ok) return result;
  return result.data === 'already' ? ok({ already: true }) : ok();
}

/**
 * Take `userId` off the site team of `projectId`: his live assignment is
 * stamped revoked, by the current user, for good (a later assign is a new
 * row). Nothing he recorded on the site changes. No live assignment (never
 * assigned, already taken off, or another studio's project) is
 * `entry_not_found`.
 */
export async function unassignSiteMemberCore(ctx: OrgContext, input: SiteTeamInput): Promise<ActionResult> {
  if (!isSiteTeamInput(input)) return err('malformed');

  return mutateInOrg(
    ctx,
    { capability: 'site_assignments', action: 'update' },
    async (tx, audit) => {
      const [revoked] = await tx
        .update(projectAssignments)
        .set({ revokedAt: sql`now()`, revokedBy: ctx.userId, updatedAt: sql`now()` })
        .where(
          and(
            eq(projectAssignments.projectId, input.projectId),
            eq(projectAssignments.userId, input.userId),
            isNull(projectAssignments.revokedAt),
          ),
        )
        .returning({ id: projectAssignments.id });
      if (!revoked) fail('entry_not_found');

      await audit({
        entity: ASSIGNMENT_AUDIT_ENTITY,
        entityId: revoked.id,
        action: 'update',
        before: { revoked: false },
        after: { revoked: true, project_id: input.projectId, user_id: input.userId },
      });
    },
  );
}
