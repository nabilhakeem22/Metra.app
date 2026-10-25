// How a site team member is named on the Team tab. PURE and CLIENT-SAFE.
import type { SiteTeamPerson } from '@/lib/site/assignments/types';

/** His display name, else his email (only a manager is sent it), else `unnamed`. */
export function siteTeamMemberLabel(member: Pick<SiteTeamPerson, 'name' | 'email'>, unnamed: string): string {
  return member.name ?? member.email ?? unnamed;
}
