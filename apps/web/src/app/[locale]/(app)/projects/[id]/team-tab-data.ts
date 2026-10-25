import 'server-only';
// What the project's Team tab (the project's site team) renders from, read on
// the server. A member's name and email live in Supabase auth, so each is
// looked up by user id (cached per isolate, bounded by a deadline: a slow or
// failed lookup shows the member unnamed, never blocks the page).
//
// The email is shown only to a viewer who manages the site team (owner, admin,
// project manager), who must tell members apart to assign them. Everyone else
// who may see the team (a site engineer, a viewer) reads names and roles only,
// as the studio Team page keeps colleagues' emails from them.
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { listProjectSiteTeam } from '@/lib/site/assignments/queries';
import { lookupActorIdentity } from '@/lib/team/actor-identity';
import type { TeamTabData } from './team-tab-types';

export async function loadTeamTab(ctx: OrgContext, projectId: string): Promise<TeamTabData> {
  if (!can(ctx.role, 'site_assignments', 'read')) return { access: 'none' };
  const manages = can(ctx.role, 'site_assignments', 'create');
  const team = await listProjectSiteTeam(ctx, projectId);
  const members = await Promise.all(
    team.map(async (membership) => {
      const identity = await lookupActorIdentity(membership.userId);
      return {
        userId: membership.userId,
        role: membership.role,
        name: identity.name,
        email: manages ? identity.email : null,
        assignedAt: membership.assignedAt?.toISOString() ?? null,
      };
    }),
  );
  return { access: manages ? 'manage' : 'read', members, currentUserId: ctx.userId };
}
