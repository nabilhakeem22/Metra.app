// How a site team member is named on the Team tab. PURE and CLIENT-SAFE.
import type { SiteTeamMember } from './team-tab-types';

/** His display name, else his email (only a manager is sent it), else `unnamed`. */
export function siteTeamMemberLabel(member: Pick<SiteTeamMember, 'name' | 'email'>, unnamed: string): string {
  return member.name ?? member.email ?? unnamed;
}
