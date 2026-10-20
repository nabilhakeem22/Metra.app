// Who may do what on an execution contract's Payments tab (plan A18), read
// off the permission matrix in one place. PURE and CLIENT-SAFE: the contract
// page, the delivery card and the tab's read actions ask the same question.
//
// The CLIENT role is refused here by name (A4 security S4). The matrix gives it
// `payments` read for the portal it will have (P4), and today two fences keep
// it out of the studio app (requireOrg drops client memberships, the (app)
// layout answers 404). The studio's billing surface must not depend on them:
// its notes, references and every request are the studio's.
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';

type Role = OrgContext['role'];

const isStudioRole = (role: Role) => role !== 'client';

/** `payments` read, studio roles only: owner, admin, project manager, accountant, viewer. */
export function maySeeBilling(role: Role): boolean {
  return isStudioRole(role) && can(role, 'payments', 'read');
}

/** Send and void payment requests: `invoices_issue` (owner, admin, accountant). */
export function mayIssueRequests(role: Role): boolean {
  return isStudioRole(role) && can(role, 'invoices_issue', 'approve');
}

/** Record money received, and answer a client's "I paid" claim: `payments` create (owner, admin, accountant). */
export function mayRecordPayments(role: Role): boolean {
  return isStudioRole(role) && can(role, 'payments', 'create');
}
