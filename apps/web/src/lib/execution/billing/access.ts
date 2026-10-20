// Who may do what on an execution contract's Payments tab (plan A18), read
// off the permission matrix in one place. PURE and CLIENT-SAFE: the contract
// page, the delivery card and the tab's read actions ask the same question.
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';

type Role = OrgContext['role'];

/** `payments` read: owner, admin, project manager, accountant, viewer. */
export function maySeeBilling(role: Role): boolean {
  return can(role, 'payments', 'read');
}

/** Send and void payment requests: `invoices_issue` (owner, admin, accountant). */
export function mayIssueRequests(role: Role): boolean {
  return can(role, 'invoices_issue', 'approve');
}

/** Record money received: `payments` create (owner, admin, accountant). */
export function mayRecordPayments(role: Role): boolean {
  return can(role, 'payments', 'create');
}
