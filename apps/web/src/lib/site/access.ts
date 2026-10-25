// Who may do what with the site diary (Stage 3 site app, the `site_diary` row,
// plan C3). PURE and CLIENT-SAFE: the API cores, the studio Site tab and the
// app's screens ask one rule. Being assigned to the project is a row-level
// rule on top of these (the core checks it, and RLS again).
//
// Location is narrower than the diary: the accountant and the viewer read the
// diary without coordinates, and an engineer sees only his own presence. The
// CLIENT role is refused by name, as the other execution surfaces refuse it.
import type { MemberRole } from '@/lib/permissions/roles';
import { can } from '@/lib/permissions/can';

/** The roles that see check-in coordinates and every engineer's presence. */
const SITE_LOCATION_READERS: ReadonlySet<MemberRole> = new Set<MemberRole>(['owner', 'admin', 'project_manager']);

export function mayReadSiteLocation(role: MemberRole): boolean {
  return SITE_LOCATION_READERS.has(role);
}

/** Check in and record photos, materials and notes. */
export function mayWriteSiteDiary(role: MemberRole): boolean {
  return role !== 'client' && can(role, 'site_diary', 'create');
}

/**
 * May this member be put on a project's site team (an assignment)? Every
 * internal role that reads the diary: the app lists only assigned projects, for
 * every role (plan A1; a PM who wants the app assigns himself). The client role
 * holds no internal membership, so it is never assignable.
 */
export function mayJoinSiteTeam(role: MemberRole): boolean {
  return role !== 'client' && can(role, 'site_diary', 'read');
}

/** Publish a visit's chosen photos to the client. */
export function mayPublishSiteDiary(role: MemberRole): boolean {
  return role !== 'client' && can(role, 'site_diary', 'approve');
}
