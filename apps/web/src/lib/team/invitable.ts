// Which member roles may be invited into the internal app. Pure + client-safe so
// both the invite server action and the team UI share one rule (and it is unit
// testable without a session). 'owner' is never invitable; 'client' belongs to
// the P4 client portal and has no internal use yet.
import { MEMBER_ROLES, type MemberRole } from '../permissions/roles';

export const NON_INVITABLE_ROLES: readonly MemberRole[] = ['owner', 'client'];

export function isInvitableRole(role: string): role is MemberRole {
  return (
    (MEMBER_ROLES as readonly string[]).includes(role) &&
    !(NON_INVITABLE_ROLES as readonly string[]).includes(role)
  );
}

export const INVITABLE_ROLES: MemberRole[] = MEMBER_ROLES.filter(isInvitableRole);
