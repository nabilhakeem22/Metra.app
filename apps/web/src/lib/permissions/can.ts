import { PERMISSION_MATRIX } from './matrix';
import type { Capability, MemberRole, PermissionAction } from './roles';

const ACTION_TO_LETTER: Record<PermissionAction, string> = {
  create: 'C',
  read: 'R',
  update: 'U',
  approve: 'A',
};

/**
 * §2.2 capability check. Returns true if `role` may perform `action` on
 * `capability`. Row-level scoping (own/assigned) and org-setting gates
 * (hide_margin_from_pm) are enforced separately at query time.
 */
export function can(
  role: MemberRole,
  capability: Capability,
  action: PermissionAction,
): boolean {
  const cell = PERMISSION_MATRIX[capability]?.[role] ?? '';
  return cell.includes(ACTION_TO_LETTER[action]);
}

/**
 * The single "can this role administer the org / its people" gate (owner/admin).
 * Used by team + org-settings actions — one definition, not per-file copies.
 */
export function canManageOrg(role: MemberRole): boolean {
  return can(role, 'users_settings', 'update');
}

/**
 * May this role see cost/margin figures? Derived from the §2.2 margin_pnl grant
 * (owner/admin/PM/accountant have R; site_engineer/client/viewer don't) AND the
 * org's `hide_margin_from_pm` toggle, which removes PMs when on (default).
 */
export function canSeeMargin(
  role: MemberRole,
  hideMarginFromPm: boolean,
): boolean {
  if (!can(role, 'margin_pnl', 'read')) return false;
  if (role === 'project_manager' && hideMarginFromPm) return false;
  return true;
}
