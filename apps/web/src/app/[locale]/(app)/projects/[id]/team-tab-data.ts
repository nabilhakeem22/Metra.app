import 'server-only';
// What the project's Team tab (the project's site team) renders from, read on
// the server: the members ON the site team only, at most SITE_TEAM_LIST_LIMIT
// of them, each named by one lookup (lib/site/assignments/people.ts). Nobody
// else in the studio is read here: a manager's add form asks for candidates
// on demand (lib/site/assignments/candidates.ts), so a reader never receives
// the roster and a render never looks up the whole studio (S2 and S3 rulings).
//
// The email is shown only to a viewer who manages the site team (owner, admin,
// project manager), who must tell members apart to assign them. Everyone else
// who may see the team (a site engineer, a viewer) reads names and roles only,
// as the studio Team page keeps colleagues' emails from them.
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { withIdentities } from '@/lib/site/assignments/people';
import { listProjectSiteTeam } from '@/lib/site/assignments/queries';
import { SITE_TEAM_LIST_LIMIT } from '@/lib/site/assignments/types';
import type { TeamTabData } from './team-tab-types';

export async function loadTeamTab(ctx: OrgContext, projectId: string): Promise<TeamTabData> {
  if (!can(ctx.role, 'site_assignments', 'read')) return { access: 'none' };
  const manages = can(ctx.role, 'site_assignments', 'create');
  const team = await listProjectSiteTeam(ctx, projectId, SITE_TEAM_LIST_LIMIT);
  const people = await withIdentities(team.members, { withEmail: manages });
  return {
    access: manages ? 'manage' : 'read',
    members: people.map((person) => ({
      userId: person.userId,
      role: person.role,
      name: person.name,
      email: person.email,
      assignedAt: person.assignedAt.toISOString(),
    })),
    notShown: team.total - team.members.length,
    currentUserId: ctx.userId,
  };
}
