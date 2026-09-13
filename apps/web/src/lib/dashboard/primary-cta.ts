// PURE primary-CTA picker (client-safe: no server-only). The dashboard header
// button must always open something the role can actually reach: /team is behind
// `users_settings` in the §2.2 matrix (owner/admin only), so a role without that
// grant is sent to /projects, which every role may read.
import { can } from '../permissions/can';
import type { MemberRole } from '../permissions/roles';

export interface PrimaryCta {
  /** Key under the `dashboard` message namespace. */
  messageKey:
    | 'ctaCompleteProfile'
    | 'ctaInviteTeam'
    | 'ctaManageTeam'
    | 'cards.projects';
  href: '/settings' | '/team' | '/projects';
}

/** A real primary action, never a dead control and never a link that 403s. */
export function pickPrimaryCta(
  role: MemberRole,
  progress: { profileComplete: boolean; teamInvited: boolean },
): PrimaryCta {
  if (!progress.profileComplete) {
    return { messageKey: 'ctaCompleteProfile', href: '/settings' };
  }
  // No team grant: fall back to the card target every role can open rather than
  // pushing an invite the role cannot send.
  if (!can(role, 'users_settings', 'read')) {
    return { messageKey: 'cards.projects', href: '/projects' };
  }
  // Once an invite is pending we stop pushing "Invite your team".
  return progress.teamInvited
    ? { messageKey: 'ctaManageTeam', href: '/team' }
    : { messageKey: 'ctaInviteTeam', href: '/team' };
}
