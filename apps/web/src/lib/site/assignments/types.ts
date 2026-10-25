// A project's site team as plain data: what the Team tab renders and what the
// candidate picker is answered with. Types and limits only; PURE and
// CLIENT-SAFE.
import type { MemberRole } from '@/lib/permissions/roles';

/** A studio member as the site team shows him. */
export interface SiteTeamPerson {
  userId: string;
  role: MemberRole;
  /** The display name the member gave himself, cleaned; null when he gave none. */
  name: string | null;
  /** The verified email, only for a viewer who manages the site team; else null. */
  email: string | null;
}

/** One page of the members who may be added to a project's site team. */
export interface SiteTeamCandidatesPage {
  candidates: SiteTeamPerson[];
  /** Where the next page starts; null when every candidate has been looked at. */
  nextOffset: number | null;
}

/**
 * At most this many team members are rendered (and their names looked up) in
 * one render of the Team tab, so a render stays under the Workers Free limit of
 * 50 subrequests (S3 ruling); the rest are counted, not named.
 */
export const SITE_TEAM_LIST_LIMIT = 30;

/** At most this many candidates are looked up, and so answered, per picker call. */
export const SITE_TEAM_CANDIDATES_PER_CALL = 20;
