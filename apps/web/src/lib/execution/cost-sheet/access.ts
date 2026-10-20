// Who may open an execution contract's cost sheet (plan A18, AC31). PURE and
// CLIENT-SAFE: the read core and the contract page ask one rule. The
// `margin_pnl` read grant (owner, admin, project manager, accountant), never
// the client role; the margin INSIDE the sheet is `resolveSeeMargin`'s.
import type { MemberRole } from '@/lib/permissions/roles';
import { can } from '@/lib/permissions/can';

export function mayOpenCostSheet(role: MemberRole): boolean {
  return role !== 'client' && can(role, 'margin_pnl', 'read');
}
