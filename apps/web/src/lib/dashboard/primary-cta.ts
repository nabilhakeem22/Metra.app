// PURE primary-CTA picker (client-safe: no server-only). The dashboard header
// button must always open something the role can actually reach: the setup
// steps are gated on each module's create grant, and /team is behind
// `users_settings` in the §2.2 matrix (owner/admin only), so a role without
// either is sent to /projects, which every role may read.
import { can } from '../permissions/can';
import type { MemberRole } from '../permissions/roles';
import { nextSetupStep, type SetupProgress } from './setup-step';

export interface PrimaryCta {
  /** Key under the `dashboard` message namespace. */
  messageKey:
    | 'ctaCompleteProfile'
    | 'ctaAddClient'
    | 'ctaAddProject'
    | 'ctaStartDelivery'
    | 'ctaInviteTeam'
    | 'ctaManageTeam'
    | 'cards.projects';
  href:
    | '/settings'
    | '/clients?new=1'
    | '/projects?new=1'
    | '/engagements?new=1'
    | '/team'
    | '/projects';
}

/**
 * A real primary action, never a dead control and never a link that 403s. The
 * ladder: profile, then add a client, add a project, start a delivery, then the
 * team.
 */
export function pickPrimaryCta(
  role: MemberRole,
  progress: SetupProgress & { profileComplete: boolean; teamInvited: boolean },
): PrimaryCta {
  if (!progress.profileComplete) {
    return { messageKey: 'ctaCompleteProfile', href: '/settings' };
  }
  const setupStep = nextSetupStep(role, progress);
  if (setupStep) return setupStep;
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
