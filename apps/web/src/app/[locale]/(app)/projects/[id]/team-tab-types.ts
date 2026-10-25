// What the project's Team tab renders, as plain data: built on the server
// (./team-tab-data.ts), read by the client tab. Types only.
import type { SiteTeamPerson } from '@/lib/site/assignments/types';

/** A member on this project's site team. */
export interface SiteTeamMember extends SiteTeamPerson {
  /** ISO time his live assignment on this project began. */
  assignedAt: string;
}

export type TeamTabData =
  | { access: 'none' }
  | {
      access: 'read' | 'manage';
      /** The first SITE_TEAM_LIST_LIMIT members of the site team. */
      members: SiteTeamMember[];
      /** How many more are on the team and not rendered. */
      notShown: number;
      currentUserId: string;
    };
