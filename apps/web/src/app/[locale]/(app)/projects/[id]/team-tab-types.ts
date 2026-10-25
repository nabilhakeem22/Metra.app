// What the project's Team tab renders, as plain data: built on the server
// (./team-tab-data.ts), read by the client tab. Types only.
import type { MemberRole } from '@/lib/permissions/roles';

/** A studio member who may be on this project's site team. */
export interface SiteTeamMember {
  userId: string;
  role: MemberRole;
  /** The display name the member gave himself, cleaned; null when he gave none. */
  name: string | null;
  /** The verified email, only for a viewer who manages the site team; else null. */
  email: string | null;
  /** ISO time his live assignment on this project began; null when he is not on it. */
  assignedAt: string | null;
}

export type TeamTabData =
  | { access: 'none' }
  | { access: 'read' | 'manage'; members: SiteTeamMember[]; currentUserId: string };
